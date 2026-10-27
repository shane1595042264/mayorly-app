import { readFileSync, writeFileSync } from 'node:fs'
import { hostname } from 'node:os'
import { app, dialog, globalShortcut, ipcMain, Menu, nativeTheme, Notification } from 'electron'
import { migrate, type Action, type HudEvent, type Settings } from '@core/index'
import { IPC, type AiProvider, type ClerkNotice, type Command, type UiMode } from '../shared/bridge'
import { AiClerk, KeyCheckError } from './ai/service'
import { signInWithGoogle } from './auth'
import { accountsConfigured, config } from './config'
import { Engine } from './engine'
import { installLog, log } from './log'
import { SessionStore } from './session'
import { Sync } from './sync'
import { refusedAsOptionOnly, registerHotkeys } from './hotkeys'
import { Overlay } from './overlay'
import { Store } from './store'
import { createTray } from './tray'
import { installUpdates } from './updates'

// mayorly:// links (Shortcuts, Raycast, a browser) arrive here on macOS, sometimes before boot.
let onUrl: ((url: string) => void) | null = null
const queuedUrls: string[] = []
app.on('open-url', (e, url) => {
  e.preventDefault()
  if (onUrl) onUrl(url)
  else queuedUrls.push(url)
})

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
  installLog(dataDir)
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
  // An accessory app has no menu bar, but its menu still gives the panel its key equivalents:
  // Cmd+C, V, X, A, Z in text fields, Cmd+Q to quit, Cmd+W to close what is open.
  Menu.setApplicationMenu(
    process.platform === 'darwin'
      ? Menu.buildFromTemplate([
          { role: 'appMenu' },
          { role: 'editMenu' },
          { label: 'Window', submenu: [{ label: 'Close', accelerator: 'Command+W', click: () => send(IPC.command, 'close') }] },
        ])
      : null,
  )
  // Losing focus (Cmd-Tab, a click into another app's window) closes whatever is open.
  // The first moments after opening are ignored: making the window key can bounce once.
  // A file dialog of our own takes focus too; it is not a reason to close.
  let opened = 0
  let dialogOpen = false
  ipcMain.on(IPC.setMode, (_e, mode: UiMode) => { if (mode !== 'field') opened = Date.now() })
  overlay.win.on('blur', () => {
    if (!dialogOpen && overlay.mode !== 'field' && Date.now() - opened > 400) send(IPC.command, 'close')
  })
  const togglePause = () => {
    const st = engine.state.desk.status
    if (st === 'running') engine.dispatch({ type: 'desk/pause' })
    else if (st === 'paused' || st === 'ready') engine.dispatch({ type: 'desk/resume' })
  }

  // The AI clerk: a captured line goes to the user's own model first, when there is
  // one, and arrives at the reducer with its filing. Any failure files by prefix.
  const clerk = new AiClerk(dataDir, (pub) => send(IPC.ai, pub))
  const say = (n: ClerkNotice) => send(IPC.clerk, n)
  const short = (t: string) => (t.length > 36 ? `${t.slice(0, 35)}…` : t)
  // Everything still in the tray goes to the clerk in one call; what fits a ledger moves.
  let sweeping = false
  const sweepTray = async () => {
    if (sweeping) return
    if (!clerk.enabled()) {
      say({ phase: 'done', text: 'No working AI key: add one in Settings for the clerk to sort the tray' })
      return
    }
    const tray = engine.state.entries.filter((e) => e.ledgerId === null && e.doneAt === null)
    if (tray.length === 0) {
      say({ phase: 'done', text: 'The tray is empty' })
      return
    }
    sweeping = true
    try {
      say({ phase: 'working', text: `Clerk is sorting the tray, ${tray.length} ${tray.length === 1 ? 'entry' : 'entries'}` })
      const filed = await clerk.fileMany(tray.map((e) => ({ id: e.id, title: e.title })), engine.state.ledgers, engine.state.houseRules.map((r) => r.text))
      for (const [id, f] of filed) {
        if (f.leisure) engine.dispatch({ type: 'entry/toLeisure', id, log: f.log })
        else engine.dispatch({ type: 'entry/file', id, ledgerId: f.ledgerId, estimateMin: f.estimateMin, log: f.log, model: f.model, confidence: f.confidence })
      }
      const unsure = [...filed.values()].filter((f) => f.confidence === 'unsure').length
      say({ phase: 'done', text: filed.size === 0 ? 'The clerk could not read the tray this time' : `Clerk filed ${filed.size} of ${tray.length} from the tray${unsure ? `, ${unsure} with a question mark` : ''}` })
    } finally {
      sweeping = false
    }
  }
  ipcMain.handle(IPC.getState, () => engine.state)
  // A captured line goes to the clerk first, when there is one, then to the reducer with its
  // filing. The capture window, a mayorly:// link and anything else that captures come through here.
  const captureLine = async (text: string) => {
    const action: Action = { type: 'entry/capture', text }
    if (!clerk.enabled()) return engine.dispatch(action)
    say({ phase: 'working', text: `Clerk is filing '${short(text.trim())}'` })
    const filing = await clerk.fileEntry(text, engine.state.ledgers, engine.state.houseRules.map((r) => r.text))
    const r = engine.dispatch(filing ? { ...action, filing } : action)
    const ledger = filing?.ledgerId ? engine.state.ledgers.find((l) => l.id === filing.ledgerId) : null
    const title = short(filing?.title ?? text.trim())
    say({ phase: 'done', text: filing?.leisure ? `'${title}' is entertainment: on the couch list` : ledger ? `'${title}' went to ${ledger.name}${filing?.confidence === 'unsure' ? ', best guess' : ''}` : `'${title}' stays in the tray` })
    void sweepTray()
    return r
  }
  ipcMain.handle(IPC.dispatch, (_e, action: Action) => (action.type === 'entry/capture' ? captureLine(action.text) : engine.dispatch(action)))
  const aiCall = async (fn: () => Promise<unknown> | unknown) => {
    try {
      return await fn()
    } catch (err) {
      if (err instanceof KeyCheckError) throw new Error(`${err.code}: ${err.message}`)
      throw err
    }
  }
  ipcMain.handle(IPC.aiGet, () => clerk.public())
  ipcMain.handle(IPC.aiSweep, () => sweepTray())
  ipcMain.handle(IPC.aiAddKey, (_e, key: string) => aiCall(async () => {
    const pub = await clerk.addKey(String(key))
    void sweepTray()
    return pub
  }))
  ipcMain.handle(IPC.aiRemoveKey, (_e, id: string) => clerk.removeKey(String(id)))
  ipcMain.handle(IPC.aiRecheckKey, (_e, id: string) => clerk.recheckKey(String(id)))
  ipcMain.handle(IPC.aiPreferredModel, (_e, id: string, model: string | null) => clerk.setPreferredModel(String(id), model))
  ipcMain.handle(IPC.aiPreferredProvider, (_e, provider: AiProvider | null) => clerk.setPreferredProvider(provider))
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
  ipcMain.handle(IPC.deleteAccount, async () => {
    if (!session) return
    const res = await fetch(`${config.apiUrl}/account`, { method: 'DELETE', headers: { Authorization: `Bearer ${session.token}` } })
    if (!res.ok && res.status !== 401) throw new Error(`The server answered ${res.status}`)
    setSession(null)
  })
  ipcMain.handle(IPC.getInfo, () => ({ version: app.getVersion(), platform: process.platform, arch: process.arch, dataDir, packaged: app.isPackaged }))
  ipcMain.handle(IPC.exportState, async () => {
    dialogOpen = true
    try {
      const r = await dialog.showSaveDialog({ title: 'Export Mayorly data', defaultPath: `Mayorly-${new Date().toISOString().slice(0, 10)}.json`, filters: [{ name: 'JSON', extensions: ['json'] }] })
      if (r.canceled || !r.filePath) return null
      writeFileSync(r.filePath, JSON.stringify({ app: 'mayorly', exportedAt: new Date().toISOString(), state: engine.state }, null, 2))
      return r.filePath
    } finally {
      dialogOpen = false
    }
  })
  ipcMain.handle(IPC.importState, async () => {
    dialogOpen = true
    try {
      const r = await dialog.showOpenDialog({ title: 'Import Mayorly data', filters: [{ name: 'JSON', extensions: ['json'] }], properties: ['openFile'] })
      if (r.canceled || !r.filePaths[0]) return { ok: false, message: '' }
      const raw = JSON.parse(readFileSync(r.filePaths[0], 'utf8')) as unknown
      const inner = raw && typeof raw === 'object' && 'state' in (raw as object) ? (raw as { state: unknown }).state : raw
      const state = migrate(inner)
      if (!state) return { ok: false, message: 'That file is not a Mayorly export.' }
      engine.snapshot('before-import')
      engine.dispatch({ type: 'sync/replace', state })
      return { ok: true, message: `Imported ${state.entries.length} entries and ${state.ledgers.length} ledgers. The copy from before is in backups.` }
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : String(err) }
    } finally {
      dialogOpen = false
    }
  })

  engine.on((state, events) => {
    send(IPC.state, state)
    if (events.length) send(IPC.events, events)
    for (const ev of events) {
      if (ev.type === 'clerk-wonders') void ask(ev)
      // The HUD is hidden: the desk still speaks, through the system.
      if ((ev.type === 'block' || ev.type === 'sitting-end') && !overlay.win.isVisible()) notify(ev)
      // macOS: the coins fly across the screen in the effects window; Windows draws them in the overlay.
      if (ev.type === 'harvest' && process.platform === 'darwin' && overlay.mode === 'field') overlay.cashIn(ev.tokens, state.tokens.reduce((n, t) => n + t.amount, 0))
    }
  })
  ipcMain.on(IPC.effectDone, () => overlay.effectDone())
  ipcMain.on(IPC.moving, (_e, on: boolean) => overlay.setMoving(!!on))
  ipcMain.on(IPC.nudge, (_e, dx: number, dy: number) => overlay.nudge(Number(dx) || 0, Number(dy) || 0))
  ipcMain.on(IPC.snap, (_e, corner: number) => {
    if (corner === 1 || corner === 2 || corner === 3 || corner === 4) overlay.snap(corner)
  })
  // MAYORLY_DEBUG: `kill -USR2 <pid>` previews the cash-in without clearing anything.
  if (process.env.MAYORLY_DEBUG) {
    process.on('SIGUSR2', () => overlay.cashIn(3, engine.state.tokens.reduce((n, t) => n + t.amount, 0)))
    // `kill -USR1 <pid>` nudges the tomato 40 points right and shows a caption for a moment.
    process.on('SIGUSR1', () => {
      overlay.nudge(40, 0)
      overlay.setCaption('Caption check: the quick brown fox jumps')
      setTimeout(() => overlay.setCaption(null), 4000)
    })
  }
  // After a correction or a confirmation the clerk asks one question; the answer is optional.
  const ask = async (ev: Extract<HudEvent, { type: 'clerk-wonders' }>) => {
    const name = (id: string | null) => engine.state.ledgers.find((l) => l.id === id)?.name ?? null
    const to = name(ev.ledgerId) ?? 'the tray'
    const asked = await clerk.askAbout(ev.title, to, name(ev.fromLedgerId), ev.reason)
    const question = asked ?? (ev.reason === 'moved' ? `What makes "${ev.title}" ${to}?` : `Noted. What is "${ev.title}" about?`)
    send(IPC.clerkAsk, { entryId: ev.entryId, ruleId: ev.ruleId, title: ev.title, question })
  }

  const clearDesk = () => {
    const id = engine.state.desk.block?.entryId
    if (id) engine.dispatch({ type: 'entry/complete', id })
    else say({ phase: 'done', text: 'Nothing on the desk to clear' })
  }
  const notify = (ev: HudEvent) => {
    if (!Notification.isSupported()) return
    const hk = engine.state.settings.hotkeys
    const key = (a: string) => (process.platform === 'darwin' ? a.replace('Alt', 'Option') : a)
    const body =
      ev.type === 'block'
        ? ev.started ? `${ev.block.label} is on` : `${ev.block.label} is ready. ${key(hk.pause)} starts it.`
        : ev.type === 'sitting-end' ? `Sitting over: ${ev.tomatoes} ${ev.tomatoes === 1 ? 'tomato' : 'tomatoes'}` : ''
    if (!body) return
    new Notification({ title: 'Mayorly', body, silent: true }).show()
  }

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
        switch: () => engine.dispatch({ type: 'desk/switch' }),
        move: () => command('move'),
        clear: clearDesk,
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

  const updates = installUpdates()
  updates.onReady((v) => say({ phase: 'done', text: `Mayorly ${v} is ready. Restart from the menu bar tomato to update.` }))
  createTray(engine, overlay, { command, togglePause, dataDir, updates })
  overlay.load()
  // The first launch opens the deck on the flow, which says what the keys are.
  if (engine.fresh) overlay.win.webContents.once('did-finish-load', () => setTimeout(() => command('deck'), 1200))
  engine.start()
  // The tray is sorted once at every launch, after the window is up.
  setTimeout(() => void sweepTray(), 4000)

  // mayorly://capture?text=..., mayorly://deck, plus, capture, pause, clear, switch.
  const handleUrl = (raw: string) => {
    let u: URL
    try {
      u = new URL(raw)
    } catch {
      return
    }
    if (u.protocol !== 'mayorly:') return
    const what = (u.hostname || u.pathname.replace(/^\/+/, '')).toLowerCase()
    const text = (u.searchParams.get('text') ?? '').trim().slice(0, 500)
    log.info('url', what, text ? `${text.length} chars` : '')
    if (what === 'capture' && text) void captureLine(text)
    else if (what === 'capture' || what === 'deck' || what === 'plus') command(what)
    else if (what === 'pause') togglePause()
    else if (what === 'clear') clearDesk()
    else if (what === 'switch') engine.dispatch({ type: 'desk/switch' })
  }
  if (app.isPackaged) app.setAsDefaultProtocolClient('mayorly')
  onUrl = handleUrl
  for (const u of queuedUrls.splice(0)) handleUrl(u)
  for (const a of process.argv) if (a.startsWith('mayorly://')) handleUrl(a)
  app.on('second-instance', (_e, argv) => {
    const u = argv.find((a) => a.startsWith('mayorly://'))
    if (u) handleUrl(u)
    else command('deck')
  })
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
