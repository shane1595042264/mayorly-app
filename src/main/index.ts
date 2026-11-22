import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { hostname } from 'node:os'
import { join } from 'node:path'
import { app, dialog, globalShortcut, ipcMain, Menu, nativeTheme, Notification, powerMonitor, type MessageBoxOptions, type OpenDialogOptions, type SaveDialogOptions } from 'electron'
import { isDeviceOnly, migrate, onDeskId, randomTask, scheduledNow, switchToAction, type Action, type ClerkCommand, type HudEvent, type MayorlyState, type Settings } from '@core/index'
import { IPC, type AiProvider, type Arrangement, type CaptionStyle, type ClerkNotice, type Command, type UiMode } from '../shared/bridge'
import { BUILD } from '../shared/build'
import { AiClerk, KeyCheckError } from '../shared/ai/service'
import { makeCapture } from '../shared/capture'
import { INSTRUCT_SYSTEM, instructContext, parseInstruction, permit, resolveInstruction, stripInstruction, type InstructionPlan } from '../shared/instruct'
import { dayKey, recipeRunsOn, wallClock } from '../shared/windows'
import { watchAgents } from './agents'
import { streamRule } from './streamwatch'
import { SwitchLog } from './switchlog'
import { deskEnd, endLabel, type SwitchWhy } from '../shared/switchlog'
import { AGENT_NAME, HOOK_OF, PAIR_WAIT_MS, pairedHook, promptStep, type AgentPrompt } from '../shared/aiswitch'
import { sealedClerkStore } from './ai/store'
import { signInWithGoogle } from './auth'
import { accountsConfigured, config } from './config'
import { Engine } from './engine'
import { installLog, log } from './log'
import { randomUUID } from 'node:crypto'
import { describeForClerk, draftCommands, fillDraft, parseAnswer, previewApply, PROPOSAL_TTL_MS, toArrangement, type Draft } from '../shared/ai/arrange'
import { Seal } from './seal'
import { SessionStore } from './session'
import { Sync } from './sync'
import { KeySync } from '../shared/ai/keysync'
import { refusedAsOptionOnly, registerHotkeys } from './hotkeys'
import { Overlay } from './overlay'
import { Store } from './store'
import { createTray } from './tray'
import { installUpdates } from './updates'
import { installReplanner } from './calendar/replanner'
import { Feeds } from './calendar/feeds'
import { AlarmFiles, AUDIO_EXTENSIONS } from './alarms'

// mayorly:// links (Shortcuts, Raycast, a browser) arrive here on macOS, sometimes before boot.
let onUrl: ((url: string) => void) | null = null
const queuedUrls: string[] = []
app.on('open-url', (e, url) => {
  e.preventDefault()
  if (onUrl) onUrl(url)
  else queuedUrls.push(url)
})

// One Mayorly per computer. The lock is taken in the usual profile before anything else, so a
// second copy is refused however it was started, a test profile included: two would both answer
// the hotkeys, both switch the desk on every AI prompt, and race each other's saves. The second
// says so and quits; the one running says it is the one.
const primary = app.requestSingleInstanceLock()

// A profile of its own (scripts/e2e-drag.ps1, on a CI runner): its own save, pet place and log.
if (process.env.MAYORLY_DATA_DIR) app.setPath('userData', process.env.MAYORLY_DATA_DIR)

if (!primary) {
  // A mayorly:// link opened while Mayorly runs comes here on Windows: the one running has it
  // already (second-instance), so this copy just goes, with nothing to click.
  if (process.argv.some((a) => a.startsWith('mayorly://'))) app.exit(0)
  else void app.whenReady().then(() => {
    dialog.showMessageBoxSync({
      type: 'warning',
      title: 'Mayorly',
      message: 'Mayorly is already running',
      detail: 'Only one Mayorly runs on a computer at a time, so this one will not start. The one already running is the tomato on your screen; right-click it, or the tray icon, for its menu.',
      buttons: ['OK'],
      noLink: true,
    })
    app.quit()
  })
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
  // This computer's id for the desk: made once, kept beside the save. The id file is ours, so a
  // missing or unreadable one is simply made again (this computer then counts as a new device).
  const deviceFile = join(dataDir, 'device.json')
  let deviceId = ''
  try {
    if (existsSync(deviceFile)) deviceId = String((JSON.parse(readFileSync(deviceFile, 'utf8')) as { id?: unknown }).id ?? '')
  } catch (err) {
    console.warn('[device] unreadable id, making a new one:', err instanceof Error ? err.message : String(err))
  }
  if (!deviceId) {
    deviceId = randomUUID()
    writeFileSync(deviceFile, JSON.stringify({ id: deviceId }))
  }
  const device = { id: deviceId, name: hostname().replace(/\.local$/, '') || (process.platform === 'darwin' ? 'Mac' : 'PC') }
  const engine = new Engine(store, device)
  const overlay = new Overlay(dataDir)
  // The pet goes anywhere on both desktops. A first run on Windows starts it on the side the
  // settings name; after that, wherever it is decides `hudSide`, so Settings shows the truth.
  overlay.setScale(engine.state.settings.hudScale)
  overlay.adoptSide(engine.state.settings.hudSide)
  overlay.onLayout = (layout) => {
    if (engine.state.settings.hudSide !== layout.side) engine.dispatch({ type: 'settings/update', patch: { hudSide: layout.side } })
  }

  // Every page of ours gets the broadcast: the drawer is its own window on a Mac and is
  // kept, hidden, between uses, so it must see the desk move while it is away.
  const send = (channel: string, payload: unknown) => {
    for (const wc of overlay.pages()) wc.send(channel, payload)
  }
  const command = (cmd: Command) => {
    if (!overlay.win.isVisible()) overlay.toggleVisible()
    send(IPC.command, cmd)
  }
  // While the Plus menu is open, the swap key's modifiers with an arrow point at an arm:
  // Option+T then Option+Left in the same breath. Taken as global shortcuts so the press
  // lands even before the window has the keyboard; registered as the menu opens, released
  // as it closes, so Option+arrows are the system's again the rest of the time.
  const ARM_COMMANDS: Record<string, Command> = { Up: 'arm-up', Down: 'arm-down', Left: 'arm-left', Right: 'arm-right' }
  for (let n = 0; n <= 9; n++) ARM_COMMANDS[String(n)] = `pick-${n}` as Command
  let armAccels: string[] = []
  const armsOff = () => {
    for (const a of armAccels) {
      try {
        globalShortcut.unregister(a)
      } catch {
        // Already gone.
      }
    }
    armAccels = []
  }
  const armsOn = () => {
    armsOff()
    const mods = engine.state.settings.hotkeys.plus.split('+').slice(0, -1).join('+')
    if (!mods) return
    for (const [dir, cmd] of Object.entries(ARM_COMMANDS)) {
      const accel = `${mods}+${dir}`
      try {
        if (globalShortcut.register(accel, () => send(IPC.command, cmd))) armAccels.push(accel)
      } catch {
        // Taken by another app: the arrow still works once the menu has the keyboard.
      }
    }
  }
  // An accessory app has no menu bar, but its menu still gives the panel its key equivalents:
  // Cmd+C, V, X, A, Z in text fields, Cmd+Q to quit, Cmd+W to close what is open.
  // Not the appMenu role: it would give a menu bar app Cmd+H and Hide Others with no way back.
  Menu.setApplicationMenu(
    process.platform === 'darwin'
      ? Menu.buildFromTemplate([
          { label: 'Mayorly', submenu: [{ label: 'Quit Mayorly', accelerator: 'Command+Q', click: () => app.quit() }] },
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
  // Off macOS the overlay is a topmost window over the whole work area, so a dialog nobody owns
  // opens beneath it; owned by the overlay it stays on top. The Mac panel gets no sheet.
  // On a Mac it is app-modal while the deck floats above everything, so the overlay yields
  // (drops to an ordinary level) until it is answered, or the dialog would be hidden and frozen.
  const underMacDialog = async <T,>(show: () => Promise<T>): Promise<T> => {
    overlay.yieldTo(true)
    try {
      return await show()
    } finally {
      overlay.yieldTo(false)
    }
  }
  const openDialog = (options: OpenDialogOptions) => (process.platform === 'darwin' ? underMacDialog(() => dialog.showOpenDialog(options)) : dialog.showOpenDialog(overlay.win, options))
  const saveDialog = (options: SaveDialogOptions) => (process.platform === 'darwin' ? underMacDialog(() => dialog.showSaveDialog(options)) : dialog.showSaveDialog(overlay.win, options))
  const alarmFiles = new AlarmFiles(dataDir)
  ipcMain.handle(IPC.alarmRead, (_e, id: string) => alarmFiles.read(id))
  ipcMain.handle(IPC.alarmPick, async () => {
    dialogOpen = true
    try {
      const result = await openDialog({ title: 'Choose an alarm sound', properties: ['openFile'], filters: [{ name: 'Audio', extensions: AUDIO_EXTENSIONS }] })
      return result.canceled || !result.filePaths[0] ? null : alarmFiles.pickFile(result.filePaths[0])
    } finally { dialogOpen = false }
  })
  ipcMain.handle(IPC.alarmSave, (_e, kind: string, name: string, dataUrl: string) => {
    if (kind !== 'work' && kind !== 'rest') throw new Error('Unknown alarm')
    const choice = alarmFiles.save(name, dataUrl)
    engine.act({ type: 'settings/update', patch: { alarms: { ...engine.state.settings.alarms, [kind]: choice } } })
  })
  ipcMain.on(IPC.setMode, (_e, mode: UiMode) => { if (mode !== 'field') opened = Date.now() })
  overlay.win.on('blur', () => {
    if (!dialogOpen && overlay.mode !== 'field' && Date.now() - opened > 400) send(IPC.command, 'close')
  })
  const togglePause = () => {
    const st = engine.state.desk.status
    if (st === 'running') engine.act({ type: 'desk/pause' })
    else if (st === 'paused' || st === 'ready') engine.act({ type: 'desk/resume' })
  }
  // A locked screen or a sleeping machine is not a desk. The rule that time the app could not
  // see is not desk time, applied the moment it starts; the user resumes when they are back.
  const hold = () => {
    if (engine.state.desk.status === 'running') engine.dispatch({ type: 'desk/pause', at: Date.now() })
  }
  powerMonitor.on('suspend', hold)
  powerMonitor.on('lock-screen', hold)

  // The AI clerk: a captured line goes to the user's own model first, when there is
  // one, and arrives at the reducer with its filing. Any failure files by prefix.
  installReplanner(engine)
  const seal = new Seal(dataDir)
  const feeds = new Feeds(engine, seal, dataDir)
  ipcMain.handle(IPC.calAddSource, (_e, url: string, label: string, titles: boolean) => feeds.add(String(url ?? ''), String(label ?? ''), !!titles))
  ipcMain.handle(IPC.calRemoveSource, (_e, id: string) => feeds.remove(String(id)))
  ipcMain.handle(IPC.calRefresh, () => feeds.refresh())
  const clerk = new AiClerk(sealedClerkStore(dataDir, seal), (pub) => send(IPC.ai, pub))
  // Its keys ride the account's sign-in to the other computers, sealed with the sync passphrase (ai/keysync.ts).
  const keySync = new KeySync(config.apiUrl, clerk)
  const say = (n: ClerkNotice) => send(IPC.clerk, n)
  const short = (t: string) => (t.length > 36 ? `${t.slice(0, 35)}…` : t)
  const deskTitle = (id: string | null) => (id ? (engine.state.entries.find((e) => e.id === id)?.title ?? engine.state.leisure.find((l) => l.id === id)?.title ?? '') : '')
  // When an automatic rule last switched the desk (an AI prompt, a streamer's death), so the stream
  // rule's log does not take that switch for one made by hand.
  const auto = { at: 0 }
  // The switch log: every change of the task on the desk and what moved it, kept here and shown
  // under the tomato on Alt+Shift+H (shared/switchlog.ts).
  const switches = new SwitchLog(join(dataDir, 'switches.jsonl'), (r) => send(IPC.switchLog, r))
  engine.onSwitch((r) => {
    switches.add(r)
    log.info('[switch]', `${endLabel(r.from)} -> ${endLabel(r.to)}: ${r.via}${r.detail ? ` (${r.detail})` : ''}`)
  })
  ipcMain.handle(IPC.switchLogGet, () => switches.list())
  /** A switch that was let go, kept in the log so you can see why nothing moved. */
  const kept = (why: SwitchWhy) => {
    const here = deskEnd(engine.state)
    switches.add({ id: randomUUID(), at: Date.now(), from: here, to: here, status: engine.state.desk.status, ...why, kept: true })
  }
  // A League streamer's death is Alt+Q, seen in the stream's own video (streamwatch.ts).
  const stream = streamRule({ engine, say, send, statusChannel: IPC.streamStatus, title: (id) => short(deskTitle(id)), auto, traceFile: join(dataDir, 'logs', 'stream-trace.jsonl') })
  ipcMain.handle(IPC.streamGet, () => stream.status())
  const { captureLine, sweepTray, consolidate } = makeCapture(engine, clerk, say)
  // The trial that sets the level for starting a ledger goes to the log, line by line.
  clerk.onTuned = (lines) => {
    for (const line of lines) log.info('[clerk]', line)
  }
  // Tuned once per model, early, when the clerk is allowed to touch the shelf; and the shelf is
  // tidied a while after launch and then every few hours.
  // A key that comes back from its rest may file with another model, so that one is tuned too.
  const tune = () => {
    const c = engine.state.settings.clerk
    if (c.createLedgers || c.consolidate) clerk.ensureTuned()
  }
  setTimeout(async () => {
    // A key turned away before this launch, for a rate limit or a day ago, is tried again first.
    await clerk.heal(true)
    tune()
  }, 20_000)
  setInterval(() => void clerk.heal().then((back) => back > 0 && tune()), 2 * 60_000)
  setTimeout(() => void consolidate(), 2 * 60_000)
  setInterval(() => void consolidate(), 6 * 3_600_000)
  ipcMain.handle(IPC.getState, () => engine.state)
  // Everything the pages send is something a person did here.
  ipcMain.handle(IPC.dispatch, (_e, action: Action) => {
    if (action.type === 'entry/capture') return captureLine(action.text, !!action.start)
    // You saw the streamer die too and pressed Alt+Q a beat after the rule switched: one switch.
    const g = stream.grace(action)
    if (g.drop) {
      log.info('[stream]', g.why)
      kept({ cause: 'you', via: 'Your switch let go: a death had just switched you' })
      say({ phase: 'done', text: 'Switched already: the streamer died' })
      return
    }
    return isDeviceOnly(action) ? engine.dispatch(action) : engine.act(action)
  })
  const aiCall = async (fn: () => Promise<unknown> | unknown) => {
    try {
      return await fn()
    } catch (err) {
      if (err instanceof KeyCheckError) throw new Error(`${err.code}: ${err.message}`)
      throw err
    }
  }
  ipcMain.handle(IPC.aiGet, () => {
    // Settings asking is a good moment to look for keys from another computer.
    void keySync.sync()
    return clerk.public()
  })
  ipcMain.handle(IPC.aiSweep, () => sweepTray())
  ipcMain.handle(IPC.aiCalibrate, () => aiCall(() => clerk.calibrate()))
  // The clerk arranging the calendar: a request becomes a held proposal, previewed through pure
  // reduce; applying dispatches the real schedule/apply, which checks everything again.
  const proposals = new Map<string, { drafts: Draft[]; log: string; model: string; at: number }>()
  ipcMain.handle(IPC.aiArrange, async (_e, request: string): Promise<Arrangement | null> => {
    const text = String(request ?? '').trim()
    if (!text) return null
    if (!clerk.enabled()) {
      say({ phase: 'done', text: 'No working AI key: add one in Settings for the clerk to arrange the calendar' })
      return null
    }
    const st = engine.state
    say({ phase: 'working', text: `Clerk is reading '${short(text)}'` })
    const answer = await clerk.arrange(text, describeForClerk(st, Date.now()), st.houseRules.map((r) => r.text))
    const parsed = answer ? parseAnswer(answer.text) : null
    if (!answer || !parsed) {
      say({ phase: 'done', text: 'The clerk could not read that request' })
      return null
    }
    const now = Date.now()
    const live = engine.state
    const drafts = draftCommands(parsed, live, now)
    const ready = drafts.map((d) => d.command).filter((c): c is ClerkCommand => !!c)
    const ctx = { now, newId: () => randomUUID(), random: Math.random, device: device.id }
    const outcome = ready.length ? previewApply(live, ready, parsed.log, ctx) : { moved: 0, newLate: 0 }
    const id = randomUUID()
    proposals.set(id, { drafts, log: parsed.log || `clerk: arranged '${short(text)}'`, model: answer.model, at: now })
    for (const [k, p] of proposals) if (now - p.at > PROPOSAL_TTL_MS) proposals.delete(k)
    say({ phase: 'done', text: drafts.length ? `Clerk proposes ${drafts.filter((d) => d.line.ok).length} ${drafts.length === 1 ? 'change' : 'changes'}` : parsed.ask ? 'The clerk has a question' : 'The clerk found nothing to do' })
    return toArrangement(id, parsed.log || 'clerk: proposal ready', parsed.ask, drafts, live, outcome)
  })
  ipcMain.handle(IPC.aiApplyArrangement, (_e, id: string, picks: Record<string, string>) => {
    const p = proposals.get(String(id))
    if (!p || Date.now() - p.at > PROPOSAL_TTL_MS) return false
    const now = Date.now()
    const commands: ClerkCommand[] = []
    for (const d of p.drafts) {
      if (!d.line.ok) continue
      const c = fillDraft(d, picks && typeof picks === 'object' ? picks : {}, engine.state, now)
      if (c) commands.push(c)
    }
    proposals.delete(String(id))
    if (commands.length === 0) return false
    engine.act({ type: 'schedule/apply', commands, log: p.log, model: p.model })
    return true
  })
  ipcMain.on(IPC.aiDiscardArrangement, (_e, id: string) => void proposals.delete(String(id)))
  ipcMain.handle(IPC.aiPickGlyph, (_e, name: string, criterion: string, options: string[], taken: string[]) =>
    clerk.pickGlyph(String(name), String(criterion), Array.isArray(options) ? options.map(String) : [], Array.isArray(taken) ? taken.map(String) : []))
  ipcMain.handle(IPC.aiAddKey, (_e, key: string) => aiCall(async () => {
    const pub = await clerk.addKey(String(key))
    void sweepTray()
    return pub
  }))
  ipcMain.handle(IPC.aiRemoveKey, (_e, id: string) => clerk.removeKey(String(id)))
  ipcMain.handle(IPC.aiSyncSetup, (_e, passphrase: string) => aiCall(async () => {
    await keySync.setup(String(passphrase))
    return clerk.public()
  }))
  ipcMain.handle(IPC.aiSyncUnlock, (_e, passphrase: string) => aiCall(async () => {
    await keySync.unlock(String(passphrase))
    return clerk.public()
  }))
  ipcMain.handle(IPC.aiSyncReset, () => aiCall(async () => {
    await keySync.reset()
    return clerk.public()
  }))
  ipcMain.handle(IPC.aiRecheckKey, (_e, id: string) => clerk.recheckKey(String(id)))
  ipcMain.handle(IPC.aiPreferredModel, (_e, id: string, model: string | null) => clerk.setPreferredModel(String(id), model))
  ipcMain.handle(IPC.aiPreferredProvider, (_e, provider: AiProvider | null) => clerk.setPreferredProvider(provider))
  // Set once the update prompt exists: a panel closing is when a waiting prompt may show.
  let onFieldMode: (() => void) | null = null
  ipcMain.on(IPC.setMode, (_e, mode: UiMode) => {
    overlay.setMode(mode)
    if (mode === 'plus') armsOn()
    else armsOff()
    if (mode === 'field') onFieldMode?.()
  })
  ipcMain.on(IPC.setHit, (_e, hit: boolean) => overlay.setHit(hit))

  // Account and sync. The session lives encrypted in userData; the sync loop pushes
  // this machine's state and takes the server's when another machine wrote first.
  const sessions = new SessionStore(dataDir, seal)
  const sync = new Sync(engine, config.apiUrl, dataDir, (st) => send(IPC.sync, st))
  let session = accountsConfigured() ? sessions.load() : null
  const setSession = (s: typeof session) => {
    session = s
    if (s) sessions.save(s)
    else sessions.clear()
    sync.setSession(s?.token ?? null)
    keySync.setSession(s?.token ?? null)
    send(IPC.account, s?.user ?? null)
  }
  sync.onExpired = () => setSession(null)
  sync.onRefreshed = (token) => {
    if (!session) return
    session = { ...session, token }
    sessions.save(session)
    keySync.setToken(token)
  }
  if (session) {
    sync.setSession(session.token)
    keySync.setSession(session.token)
  }
  overlay.win.webContents.on('did-finish-load', () => {
    send(IPC.account, session?.user ?? null)
    send(IPC.sync, sync.current())
  })
  ipcMain.handle(IPC.getLayout, () => overlay.layout())
  ipcMain.on(IPC.setCaption, (_e, text: string | null, style?: CaptionStyle) => overlay.setCaption(text, style === 'scheduled' || style === 'notice' ? style : undefined))
  ipcMain.handle(IPC.accountsAvailable, () => accountsConfigured())
  ipcMain.handle(IPC.getAccount, () => session?.user ?? null)
  ipcMain.handle(IPC.signIn, async () => {
    const s = await signInWithGoogle()
    setSession(s)
    return s.user
  })
  ipcMain.handle(IPC.signOut, () => setSession(null))
  ipcMain.handle(IPC.signOutEverywhere, async () => {
    if (!session) return
    const res = await fetch(`${config.apiUrl}/auth/signout-all`, { method: 'POST', headers: { Authorization: `Bearer ${session.token}` } })
    if (!res.ok && res.status !== 401) throw new Error(`The server answered ${res.status}`)
    setSession(null)
  })
  // The plan's feed address: the server keeps one secret token per account; the address is
  // the API's own, so a subscriber reads the plan straight from it.
  ipcMain.handle(IPC.calFeed, async (_e, op: 'get' | 'create' | 'rotate' | 'drop'): Promise<string | null> => {
    if (!session) throw new Error('Sign in first')
    const path = op === 'rotate' ? '/cal/feed/rotate' : '/cal/feed'
    const method = op === 'get' ? 'GET' : op === 'drop' ? 'DELETE' : 'POST'
    const res = await fetch(`${config.apiUrl}${path}`, { method, headers: { Authorization: `Bearer ${session.token}` } })
    if (res.status === 401) {
      setSession(null)
      throw new Error('The session has ended. Sign in again.')
    }
    if (!res.ok) throw new Error(`The server answered ${res.status}`)
    if (op === 'drop') return null
    const body = (await res.json()) as { token?: string | null }
    return body.token ? `${config.apiUrl}/cal/${body.token}.ics` : null
  })
  ipcMain.on(IPC.log, (_e, level: string, message: string) => (level === 'error' ? log.error : log.warn)('[renderer]', String(message).slice(0, 2000)))
  ipcMain.handle(IPC.linkPhone, async () => {
    if (!session) throw new Error('Sign in first')
    const res = await fetch(`${config.apiUrl}/auth/link`, { method: 'POST', headers: { Authorization: `Bearer ${session.token}` } })
    if (res.status === 401) {
      setSession(null)
      throw new Error('The session has ended. Sign in again.')
    }
    if (!res.ok) throw new Error(`The server answered ${res.status}`)
    return (await res.json()) as { code: string; expiresAt: string }
  })
  ipcMain.handle(IPC.deleteAccount, async () => {
    if (!session) return
    const res = await fetch(`${config.apiUrl}/account`, { method: 'DELETE', headers: { Authorization: `Bearer ${session.token}` } })
    if (!res.ok && res.status !== 401) throw new Error(`The server answered ${res.status}`)
    setSession(null)
  })
  ipcMain.handle(IPC.getInfo, () => ({ version: app.getVersion(), platform: process.platform, arch: process.arch, dataDir, packaged: app.isPackaged, commit: BUILD.commit, builtAt: BUILD.builtAt, device: device.id }))
  // What changed: once per build on this machine. notes.json beside the save remembers the
  // build last seen. A first run has nothing to compare with and is not an update.
  const notesFile = join(dataDir, 'notes.json')
  const seenBuild = (): string | null => {
    try {
      return (JSON.parse(readFileSync(notesFile, 'utf8')) as { seen?: string }).seen ?? null
    } catch {
      return null
    }
  }
  const markSeen = () => {
    try {
      writeFileSync(notesFile, JSON.stringify({ seen: BUILD.commit, at: new Date().toISOString() }))
    } catch (err) {
      console.warn('[notes] could not write notes.json:', err)
    }
  }
  if (engine.fresh) markSeen()
  feeds.start()
  ipcMain.handle(IPC.getBuild, () => BUILD)
  ipcMain.handle(IPC.whatsNew, () => app.isPackaged && seenBuild() !== BUILD.commit)
  ipcMain.on(IPC.seenBuild, markSeen)
  ipcMain.handle(IPC.exportState, async () => {
    dialogOpen = true
    try {
      const r = await saveDialog({ title: 'Export Mayorly data', defaultPath: `Mayorly-${new Date().toISOString().slice(0, 10)}.json`, filters: [{ name: 'JSON', extensions: ['json'] }] })
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
      const r = await openDialog({ title: 'Import Mayorly data', filters: [{ name: 'JSON', extensions: ['json'] }], properties: ['openFile'] })
      if (r.canceled || !r.filePaths[0]) return { ok: false, message: '' }
      const raw = JSON.parse(readFileSync(r.filePaths[0], 'utf8')) as unknown
      const inner = raw && typeof raw === 'object' && 'state' in (raw as object) ? (raw as { state: unknown }).state : raw
      const state = migrate(inner)
      if (!state) return { ok: false, message: 'That file is not a Mayorly export.' }
      engine.snapshot('before-import')
      engine.dispatch({ type: 'sync/replace', state }, { cause: 'import', via: 'Imported a save' })
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
      if (ev.type === 'harvest' && ev.tokens > 0 && process.platform === 'darwin' && overlay.mode === 'field') overlay.cashIn(ev.tokens, state.tokens.reduce((n, t) => n + t.amount, 0))
      // A couch block's coin, taken: the same counter, counting down.
      if (ev.type === 'spend' && ev.tokens > 0 && process.platform === 'darwin' && overlay.mode === 'field') overlay.cashIn(ev.tokens, state.tokens.reduce((n, t) => n + t.amount, 0), true)
      if (ev.type === 'refund' && ev.tokens > 0 && process.platform === 'darwin' && overlay.mode === 'field') overlay.cashIn(ev.tokens, state.tokens.reduce((n, t) => n + t.amount, 0))
    }
  })
  ipcMain.on(IPC.effectDone, () => overlay.effectDone())
  ipcMain.on(IPC.drawerClose, () => overlay.closeDrawer())
  ipcMain.on(IPC.switchLogClose, () => overlay.closeSwitchLog())
  ipcMain.on(IPC.moving, (_e, on: boolean) => overlay.setMoving(!!on))
  ipcMain.on(IPC.nudge, (_e, dx: number, dy: number) => overlay.nudge(Number(dx) || 0, Number(dy) || 0))
  ipcMain.on(IPC.placePet, (_e, x: number, y: number, sx?: number, sy?: number) => overlay.placeAt(Number(x), Number(y), Number(sx), Number(sy)))
  ipcMain.on(IPC.petHeld, (_e, held: boolean) => overlay.setHeld(!!held))
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
    if (id) engine.act({ type: 'entry/complete', id }, { cause: 'you', via: 'Cleared with the clear key; the desk took the next' })
    else say({ phase: 'done', text: 'Nothing on the desk to clear' })
  }
  /**
   * Alt+I: onto what the calendar says now, the way the switcher would go there, so a parked or
   * swapped-back session keeps its clock. Nothing on the calendar: a task at random, and another
   * on the next press, so there is always something to do without reading the whole list.
   */
  const goScheduled = () => {
    const st = engine.state
    const at = scheduledNow(st, Date.now())
    const entry = at ? st.entries.find((x) => x.id === at.entryId) : randomTask(st, Math.random())
    if (!entry) {
      say({ phase: 'done', text: 'Nothing open to do' })
      return
    }
    if (!at) say({ phase: 'done', text: `Nothing scheduled. At random: ${short(entry.title)}` })
    if (onDeskId(st) === entry.id && st.desk.status !== 'idle') {
      say({ phase: 'done', text: `On schedule: ${short(entry.title)}` })
      return
    }
    const act = switchToAction(st, { kind: 'entry', entry }) ?? { type: 'desk/select' as const, entryId: entry.id, ledgerId: entry.ledgerId }
    engine.act(act, { cause: 'you', via: at ? 'The scheduled key: on the calendar now' : 'The scheduled key: nothing scheduled, one at random' })
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

  // A recipe on a key: today's entry, made once, and onto the desk when the recipe says so.
  const recipeKeys = (st: MayorlyState) => st.recipes.flatMap((r) => (r.enabled && r.when.kind === 'key' ? [{ id: r.id, key: r.when.key }] : []))
  const runKeyRecipe = (id: string) => {
    const st = engine.state
    const r = st.recipes.find((x) => x.id === id)
    if (!r) return
    const day = dayKey(Date.now(), st.settings.calendar.tz)
    const made = st.entries.find((e) => e.id === `recipe:${r.id}:${day}`)
    if (made?.doneAt) {
      say({ phase: 'done', text: `${short(made.title)} is cleared today` })
      return
    }
    engine.act({ type: 'recipe/run', id: r.id, day, start: r.start })
  }
  // Gaming mode: one key turns every other shortcut off, so a game gets Alt+G and the rest, and on again.
  const toggleGaming = () => {
    const on = !engine.state.settings.gaming
    engine.dispatch({ type: 'settings/update', patch: { gaming: on } })
    const key = (a: string) => (process.platform === 'darwin' ? a.replace('Alt', 'Option') : a)
    say({ phase: 'done', text: on ? `Gaming mode: shortcuts off. ${key(engine.state.settings.hotkeys.gaming)} turns them on.` : 'Gaming mode off: shortcuts on' })
  }
  let applied: Settings | null = null
  let appliedRecipes = ''
  const applySettings = (s: Settings) => {
    overlay.setScale(s.hudScale)
    overlay.setTextSize(s.text.pet)
    const recipes = JSON.stringify(recipeKeys(engine.state))
    if (applied && JSON.stringify(applied.hotkeys) === JSON.stringify(s.hotkeys) && applied.openAtLogin === s.openAtLogin && applied.gaming === s.gaming && recipes === appliedRecipes) return
    if (!applied || JSON.stringify(applied.hotkeys) !== JSON.stringify(s.hotkeys) || applied.gaming !== s.gaming || recipes !== appliedRecipes) {
      appliedRecipes = recipes
      // In gaming mode only the gaming key is held; every other combo goes to the game.
      const keys = s.gaming ? { ...Object.fromEntries(Object.keys(s.hotkeys).map((k) => [k, ''])), gaming: s.hotkeys.gaming } as Settings['hotkeys'] : s.hotkeys
      const failed = registerHotkeys(keys, {
        plus: () => {
          command('plus')
          if (overlay.mode !== 'plus') armsOn()
        },
        capture: () => command('capture'),
        find: () => command('find'),
        deck: () => command('deck'),
        pause: togglePause,
        skipRest: () => engine.act({ type: 'desk/skipRest' }),
        hide: () => overlay.toggleVisible(),
        switch: () => command('switcher'),
        move: () => command('move'),
        // macOS: the drawer is the shell's own window beside the pet. Elsewhere the overlay draws it.
        drawer: () => (process.platform === 'darwin' ? overlay.toggleDrawer() : command('drawer')),
        // The switch log, the same way: a window of its own under the pet on a Mac.
        switchLog: () => (process.platform === 'darwin' ? overlay.toggleSwitchLog() : command('switchLog')),
        clear: clearDesk,
        schedule: () => command('schedule'),
        scheduled: goScheduled,
        gaming: toggleGaming,
      }, s.gaming ? [] : recipeKeys(engine.state).map((r) => ({ key: r.key, run: () => runKeyRecipe(r.id) })))
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

  // Daily recipes: each enabled one makes its entry once a day, from its time on, on the days
  // it names. Any computer may; the entry's id is the recipe and the day, so a merge keeps one.
  const runRecipes = () => {
    const st = engine.state
    const cal = st.settings.calendar
    if (!cal.tz) return
    const now = Date.now()
    const day = dayKey(now, cal.tz)
    const minutes = wallClock(now, cal.tz).minutes
    for (const r of st.recipes) {
      if (!r.enabled || r.when.kind !== 'daily' || minutes < r.when.at) continue
      const id = `recipe:${r.id}:${day}`
      if (st.entries.some((e) => e.id === id) || st.trash.some((e) => e.id === id)) continue
      if (!recipeRunsOn(cal, st.calendar.workMarks, r.when, now)) continue
      engine.dispatch({ type: 'recipe/run', id: r.id, day })
    }
  }
  setTimeout(runRecipes, 15_000)
  setInterval(runRecipes, 60_000)

  // Auto switch: a prompt you type an AI is Alt+Q, onto your recent task while it thinks. Nothing
  // is remembered; the next prompt or Alt+Q switches again (aiswitch.ts).
  let promptSwitchAt = 0
  // The hooks' prompts of the last half minute, for the Claude app's Stop button to pair with.
  const heard: AgentPrompt[] = []
  const onPrompt = (e: AgentPrompt) => {
    const step = promptStep(engine.state, e, Date.now() - promptSwitchAt)
    // A prompt a beat after a streamer's death switched the desk would take it back to the stream.
    const g = step.act ? stream.grace(step.act) : null
    log.info('[agents]', `${e.app} prompt${e.manual ? '' : ' (not typed)'}: ${g?.drop ? 'a death switched a moment ago' : step.why}`)
    if (g?.drop) kept({ cause: 'ai', via: `${AGENT_NAME[e.app]} prompt let go: a death had just switched you` })
    if (!step.act || g?.drop) return
    promptSwitchAt = auto.at = Date.now()
    const where = e.app === 'browser' ? 'in a browser side panel' : e.app.endsWith('-web') ? 'in the browser' : e.app.endsWith('-app') ? 'in its desktop app' : 'through its hook'
    engine.act(step.act, { cause: 'ai', via: `${AGENT_NAME[e.app]} prompt`, detail: where })
    say({ phase: 'done', text: `${AGENT_NAME[e.app]} prompt: on ${short(deskTitle(onDeskId(engine.state)))}` })
  }
  const stopAgents = watchAgents((e) => {
    heard.push(e)
    while (heard.length && Date.now() - heard[0].at > 30_000) heard.shift()
    if (!HOOK_OF[e.app]) return onPrompt(e)
    // The Claude app's Stop button: wait for Claude Code's hook, which knows whether you typed it.
    setTimeout(() => {
      const h = pairedHook(e, heard)
      if (h) log.info('[agents]', `${e.app} prompt: left to its hook (${h.manual ? 'typed' : 'not typed'})`)
      else onPrompt(e)
    }, PAIR_WAIT_MS)
  }, stream.onStream)

  // An instruction from Alt+N: the clerk reads it into steps; what the permissions allow is done
  // now (the box offers Undo), the rest waits for Apply in the box.
  ipcMain.handle(IPC.instruct, async (_e, text: string): Promise<InstructionPlan> => {
    const none = (say: string): InstructionPlan => ({ kind: 'none', say, steps: [], calendarAsk: null, refused: [] })
    const st = engine.state
    const now = Date.now()
    const line = stripInstruction(String(text ?? '')).slice(0, 500)
    if (!line) return none('Nothing to do')
    let answer: { text: string; model: string } | null
    try {
      answer = await clerk.instruct(INSTRUCT_SYSTEM, `${instructContext(st, now)}\n\nInstruction: ${line}`)
    } catch (err) {
      log.warn('[clerk] instruction:', err instanceof Error ? err.message : String(err))
      return none('The clerk could not be reached. Try again in a moment.')
    }
    if (!answer) return none('The clerk needs an AI key for instructions. Add one in Settings, AI clerk.')
    const raw = parseInstruction(answer.text)
    if (!raw) return none('The clerk could not read that. Say it another way?')
    const plan = permit(resolveInstruction(raw, engine.state, now, () => randomUUID()), engine.state.settings.clerk.allow)
    for (const step of plan.steps) if (step.status === 'done') for (const a of step.actions) engine.act(a)
    log.info('[clerk]', `instruction (${answer.model}): ${plan.kind}, ${plan.steps.map((x) => `${x.status} ${x.says}`).join('; ') || 'no steps'}${plan.calendarAsk ? `; calendar: ${plan.calendarAsk}` : ''}`)
    return { ...plan, model: answer.model }
  })

  // Set once the last push is done, so the quit that follows does not wait for it again.
  let flushed = false
  const updates = installUpdates(dataDir)
  updates.beforeInstall = async () => {
    engine.stop()
    await sync.flush()
    flushed = true
  }
  // An update put off with Later on a Mac goes in now, before anything is on screen. Nothing has
  // run yet, so there is nothing to save: stopping the engine here would stamp a heartbeat now
  // and count the hours the app was closed as desk time.
  if (updates.atLaunch) {
    updates.beforeInstall = null
    void updates.install()
    return
  }
  // "There's a new update, want it?" Asked once per version, never over a running focus block
  // and never over an open panel: it waits for the block to stop and the deck (or the What
  // changed card, or the Plus menu) to close. On a Mac the prompt is app-modal and the overlay
  // floats above everything, so a prompt shown under an open deck froze both; while it is up the
  // overlay also yields, so a panel opened meanwhile (a hotkey) still sits under it. Later leaves
  // it for the next launch.
  let offered: string | null = null
  const offerUpdate = async () => {
    const version = updates.ready()
    if (!version || version === offered || dialogOpen) return
    const { status, block } = engine.state.desk
    if (status === 'running' && block?.kind === 'focus') return
    if (overlay.mode !== 'field') return
    offered = version
    dialogOpen = true
    try {
      const options: MessageBoxOptions = {
        type: 'info',
        title: 'Mayorly update',
        message: `Mayorly ${version} is ready`,
        detail: 'Update now? Mayorly restarts and comes straight back.',
        buttons: ['Update now', 'Later'],
        defaultId: 0,
        cancelId: 1,
        noLink: true,
      }
      // A menu bar app is not frontmost by itself, and off macOS only a dialog the overlay owns stays above it.
      if (process.platform === 'darwin') app.focus({ steal: true })
      const { response } = await (process.platform === 'darwin' ? underMacDialog(() => dialog.showMessageBox(options)) : dialog.showMessageBox(overlay.win, options))
      if (response === 0) await updates.install()
    } finally {
      dialogOpen = false
    }
  }
  onFieldMode = () => void offerUpdate()
  updates.onReady(() => void offerUpdate())
  engine.on(() => void offerUpdate())
  const tray = createTray(engine, overlay, { command, togglePause, dataDir, updates })
  // A right click on the tomato: the tray's menu, Quit included, where the pointer is.
  ipcMain.on(IPC.petMenu, () => tray.popup(overlay.win))
  overlay.load()
  // The first launch opens the deck, which starts on the shelf and says what the keys are.
  if (engine.fresh) overlay.win.webContents.once('did-finish-load', () => setTimeout(() => command('deck'), 1200))
  // A save that could not be read: say which backup stood in, where the user will see it.
  if (engine.restoredFrom) overlay.win.webContents.once('did-finish-load', () => setTimeout(() => say({ phase: 'done', text: `The save could not be read. Restored from ${engine.restoredFrom}; the original is parked beside it.` }), 2500))
  engine.start()
  stream.start()
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
    // Opening things and capturing are what a link may do; clearing an entry or switching the
    // desk is not, since any page can open a link.
    if (what === 'capture' && text) void captureLine(text)
    else if (what === 'capture' || what === 'deck' || what === 'plus') command(what)
    else if (what === 'pause') togglePause()
  }
  // The portable Windows exe unpacks to a fresh temp folder each run, so registering it would
  // point every mayorly:// link at a path that is gone by the next launch.
  if (app.isPackaged && !process.env.PORTABLE_EXECUTABLE_DIR) app.setAsDefaultProtocolClient('mayorly')
  onUrl = handleUrl
  for (const u of queuedUrls.splice(0)) handleUrl(u)
  for (const a of process.argv) if (a.startsWith('mayorly://')) handleUrl(a)
  // Another copy was started and refused itself; a mayorly:// link it carried is still followed.
  app.on('second-instance', (_e, argv) => {
    const u = argv.find((a) => a.startsWith('mayorly://'))
    if (u) handleUrl(u)
    else say({ phase: 'done', text: 'Mayorly is already running: this one' })
  })
  // macOS: opening the app again from Finder or Launchpad arrives here, not as a second instance.
  app.on('activate', () => command('deck'))
  app.on('before-quit', (e) => {
    engine.stop()
    stream.stop()
    stopAgents()
    if (flushed || sync.current().phase === 'off') return
    // One bounded push so the last seconds of desk time reach the server.
    e.preventDefault()
    flushed = true
    void sync.flush().finally(() => app.quit())
  })
  app.on('will-quit', () => globalShortcut.unregisterAll())
  // Windows: the user logs out or shuts down; the save is flushed like a quit.
  ;(app as unknown as NodeJS.EventEmitter).on('session-end', () => engine.stop())
  // The HUD lives in the tray; closing its window is not quitting.
  app.on('window-all-closed', () => {})
}
