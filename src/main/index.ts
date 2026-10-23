import { hostname } from 'node:os'
import { app, globalShortcut, ipcMain, nativeTheme } from 'electron'
import type { Action, Settings } from '@core/index'
import { IPC, type Command, type UiMode } from '../shared/bridge'
import { signInWithGoogle } from './auth'
import { accountsConfigured, config } from './config'
import { Engine } from './engine'
import { SessionStore } from './session'
import { Sync } from './sync'
import { refusedAsOptionOnly, registerHotkeys } from './hotkeys'
import { Overlay } from './overlay'
import { Store } from './store'
import { createTray } from './tray'

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.setAppUserModelId('app.mayorly')
  void app.whenReady().then(boot)
}

function boot() {
  if (process.platform === 'darwin') {
    // A menu bar app: no Dock icon, no app switcher entry, no menu bar of its own.
    // Packaged builds also carry LSUIElement; this covers `npm run dev`.
    app.setActivationPolicy('accessory')
    // The HUD has one dark theme. Native popups (the deck's selects) follow this.
    nativeTheme.themeSource = 'dark'
  }
  const dataDir = app.getPath('userData')
  const store = new Store(dataDir)
  const engine = new Engine(store)
  const overlay = new Overlay(dataDir)

  const send = (channel: string, payload: unknown) => {
    if (!overlay.win.isDestroyed()) overlay.win.webContents.send(channel, payload)
  }
  const command = (cmd: Command) => {
    if (!overlay.win.isVisible()) overlay.toggleVisible()
    send(IPC.command, cmd)
  }
  const togglePause = () => {
    const st = engine.state.desk.status
    if (st === 'running') engine.dispatch({ type: 'desk/pause' })
    else if (st === 'paused' || st === 'ready') engine.dispatch({ type: 'desk/resume' })
  }

  ipcMain.handle(IPC.getState, () => engine.state)
  ipcMain.handle(IPC.dispatch, (_e, action: Action) => engine.dispatch(action))
  ipcMain.on(IPC.setMode, (_e, mode: UiMode) => overlay.setMode(mode))
  ipcMain.on(IPC.setHit, (_e, hit: boolean) => overlay.setHit(hit))

  // Account and sync. The session lives encrypted in userData; the sync loop pushes
  // this machine's state and takes the server's when another machine wrote first.
  const sessions = new SessionStore(dataDir)
  const sync = new Sync(engine, config.apiUrl, `${hostname()} (${process.platform})`, (st) => send(IPC.sync, st))
  let session = accountsConfigured() ? sessions.load() : null
  const setSession = (s: typeof session) => {
    session = s
    if (s) sessions.save(s)
    else sessions.clear()
    sync.setSession(s?.token ?? null)
    send(IPC.account, s?.user ?? null)
  }
  sync.onExpired = () => setSession(null)
  if (session) sync.setSession(session.token)
  overlay.win.webContents.on('did-finish-load', () => {
    send(IPC.account, session?.user ?? null)
    send(IPC.sync, sync.current())
  })
  ipcMain.handle(IPC.getLayout, () => overlay.layout())
  ipcMain.on(IPC.setCaption, (_e, text: string | null) => overlay.setCaption(text))
  ipcMain.handle(IPC.accountsAvailable, () => accountsConfigured())
  ipcMain.handle(IPC.getAccount, () => session?.user ?? null)
  ipcMain.handle(IPC.signIn, async () => {
    const s = await signInWithGoogle()
    setSession(s)
    return s.user
  })
  ipcMain.handle(IPC.signOut, () => setSession(null))

  engine.on((state, events) => {
    send(IPC.state, state)
    if (events.length) send(IPC.events, events)
  })

  let applied: Settings | null = null
  const applySettings = (s: Settings) => {
    overlay.setScale(s.hudScale)
    if (applied && JSON.stringify(applied.hotkeys) === JSON.stringify(s.hotkeys) && applied.openAtLogin === s.openAtLogin) return
    if (!applied || JSON.stringify(applied.hotkeys) !== JSON.stringify(s.hotkeys)) {
      const failed = registerHotkeys(s.hotkeys, {
        plus: () => command('plus'),
        capture: () => command('capture'),
        deck: () => command('deck'),
        pause: togglePause,
        hide: () => overlay.toggleVisible(),
      })
      if (failed.length) {
        const failures = { keys: failed, reason: refusedAsOptionOnly(failed) ? ('option-only' as const) : undefined }
        overlay.win.webContents.once('did-finish-load', () => send(IPC.hotkeyFailures, failures))
        send(IPC.hotkeyFailures, failures)
      }
    }
    if (app.isPackaged) {
      // Only touch the system when the setting differs from it. On macOS each call is a
      // launch-services registration that logs an error when there is nothing to change,
      // and an unsigned build may be refused; the system's answer is what counts.
      const cur = app.getLoginItemSettings()
      if (cur.openAtLogin !== s.openAtLogin) app.setLoginItemSettings({ openAtLogin: s.openAtLogin })
    }
    applied = { ...s, hotkeys: { ...s.hotkeys } }
  }
  applySettings(engine.state.settings)
  engine.on((state) => applySettings(state.settings))

  createTray(engine, overlay, { command, togglePause, dataDir })
  overlay.load()
  engine.start()

  app.on('second-instance', () => command('deck'))
  // macOS: opening the app again from Finder or Launchpad arrives here, not as a second instance.
  app.on('activate', () => command('deck'))
  let flushed = false
  app.on('before-quit', (e) => {
    engine.stop()
    if (flushed || sync.current().phase === 'off') return
    // One bounded push so the last seconds of desk time reach the server.
    e.preventDefault()
    flushed = true
    void sync.flush().finally(() => app.quit())
  })
  app.on('will-quit', () => globalShortcut.unregisterAll())
  // The HUD lives in the tray; closing its window is not quitting.
  app.on('window-all-closed', () => {})
}
