import { app, globalShortcut, ipcMain } from 'electron'
import type { Action, Settings } from '@core/index'
import { IPC, type Command, type UiMode } from '../shared/bridge'
import { Engine } from './engine'
import { registerHotkeys } from './hotkeys'
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
  const dataDir = app.getPath('userData')
  const store = new Store(dataDir)
  const engine = new Engine(store)
  const overlay = new Overlay()

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

  engine.on((state, events) => {
    send(IPC.state, state)
    if (events.length) send(IPC.events, events)
  })

  let applied: Settings | null = null
  const applySettings = (s: Settings) => {
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
        overlay.win.webContents.once('did-finish-load', () => send(IPC.hotkeyFailures, failed))
        send(IPC.hotkeyFailures, failed)
      }
    }
    if (app.isPackaged) app.setLoginItemSettings({ openAtLogin: s.openAtLogin })
    applied = { ...s, hotkeys: { ...s.hotkeys } }
  }
  applySettings(engine.state.settings)
  engine.on((state) => applySettings(state.settings))

  createTray(engine, overlay, { command, togglePause, dataDir })
  overlay.load()
  engine.start()

  app.on('second-instance', () => command('deck'))
  app.on('before-quit', () => engine.stop())
  app.on('will-quit', () => globalShortcut.unregisterAll())
  // The HUD lives in the tray; closing its window is not quitting.
  app.on('window-all-closed', () => {})
}
