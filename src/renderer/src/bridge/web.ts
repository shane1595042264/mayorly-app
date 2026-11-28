import {
  firstRunState, migrate, randomTask, reduce, restSession, scheduledNow, SLEEP_GAP_MS, switchToAction,
  type Action, type HudEvent, type MayorlyState,
} from '@core/index'
import type { Bridge, Command, Effect, Layout, UiMode } from '../../../shared/bridge'
import { deskSeen, impactFor, previewImpact, type Impact } from '../../../shared/impact'
import { clampAnchor, cornerAnchor, homeAnchor, sideOf, type Point } from '../../../shared/pet'
import { BUILD } from '../../../shared/build'
import { machineZone, replanAction } from '../../../shared/windows'
import { SWITCH_LOG_MAX, switchRecord, type SwitchRecord } from '../../../shared/switchlog'
import { permit, resolveInstruction, type InstructionPlan } from '../../../shared/instruct'
import { physicalKey } from '../lib/keys'
import { demoState } from './demo'

// The same engine the main process runs, inside the page. Lets the HUD run in a
// plain browser for development and screenshots. Persists to localStorage.

const KEY = 'mayorly.web.v1'
const SEEN = 'mayorly.web.seen'
function readSeen(): string | null {
  try {
    return localStorage.getItem(SEEN)
  } catch {
    return null
  }
}
const NO_AI = { keys: [], preferredProvider: null, providers: { gemini: 'Google Gemini', openai: 'OpenAI', anthropic: 'Anthropic Claude', xai: 'xAI Grok' }, usage: { days: 30, calls: 0, costMicroUsd: 0 }, sync: { phase: 'off' as const, at: null, message: null } }

/** ?demo&clerk: a stand-in key, so the capture box sends instructions to the clerk's demo reading. */
const DEMO_KEY = { id: 'demo', provider: 'gemini' as const, keyHint: 'demo', models: ['demo'], defaultModel: 'demo', preferredModel: null, status: 'ok' as const, lastError: null, lastCheckedAt: 0, createdAt: 0 }

export function createWebBridge(): Bridge {
  const newId = () => crypto.randomUUID()
  // ?demo seeds sample data, ?fresh starts from first run, ?art is the art bench with no HUD on it.
  // None of them touches storage.
  const params = new URLSearchParams(location.search)
  const demo = params.has('demo')
  const scratch = demo || params.has('fresh') || params.has('art')
  const demoClerk = scratch && params.has('clerk')
  let state: MayorlyState = demo
    ? demoState(Date.now(), newId)
    : (!scratch && load()) || firstRunState(Date.now(), newId)
  let lastBeat = Date.now()
  const stateSubs = new Set<(s: MayorlyState) => void>()
  const eventSubs = new Set<(e: HudEvent[]) => void>()
  const cmdSubs = new Set<(c: Command) => void>()
  const effectSubs = new Set<(e: Effect) => void>()
  /** A moment hitting this page's screen: the page finds its own tomato and corners (hud/Impact.tsx). */
  const playImpact = (impact: Impact) => {
    const e: Effect = { kind: 'impact', impact, origin: null, reach: null, sweep: null, walls: null, at: Date.now(), words: state.settings.impact.words }
    effectSubs.forEach((f) => f(e))
  }

  function load(): MayorlyState | null {
    try {
      const raw = localStorage.getItem(KEY)
      return raw ? migrate(JSON.parse(raw)) : null
    } catch {
      return null
    }
  }
  function save() {
    if (scratch) return
    try {
      localStorage.setItem(KEY, JSON.stringify(state))
    } catch {
      /* storage unavailable: run in memory */
    }
  }

  // The switch log, in-page: the same record main keeps, for the browser build and its checks.
  const switches: SwitchRecord[] = []
  const switchSubs = new Set<(r: SwitchRecord) => void>()
  function dispatch(action: Action) {
    const now = Date.now()
    const r = reduce(state, action, { now, newId, random: Math.random, device: 'web' })
    const changed = r.state !== state
    const rec = changed ? switchRecord(state, r.state, action, r.events, undefined, now, newId()) : null
    const before = deskSeen(state)
    state = r.state
    if (rec) {
      switches.unshift(rec)
      switches.splice(SWITCH_LOG_MAX)
      switchSubs.forEach((f) => f(rec))
    }
    if (changed) {
      save()
      stateSubs.forEach((f) => f(state))
    }
    if (r.events.length) eventSubs.forEach((f) => f(r.events))
    const hit = impactFor(r.events, before, state, 'web')
    if (hit && !state.settings.gaming) playImpact(hit)
    if (action.type !== 'schedule/replan' && action.type !== 'desk/tick' && /^(entry\/|calendar\/|settings\/update|ledger\/delete)/.test(action.type)) replanSoon()
  }

  // The planner, in-page: the same trigger main's replanner gives the app.
  let replanTimer: ReturnType<typeof setTimeout> | null = null
  function replan() {
    replanTimer = null
    const cal = state.settings.calendar
    if (!cal.tz) {
      dispatch({ type: 'settings/update', patch: { calendar: { ...cal, tz: machineZone() } } })
      return
    }
    const now = Date.now()
    dispatch(replanAction(state, now))
  }
  function replanSoon() {
    if (replanTimer) clearTimeout(replanTimer)
    replanTimer = setTimeout(replan, 250)
  }
  setInterval(replan, 60_000)
  setTimeout(replan, 300)

  if (state.desk.status === 'running' && !demo) dispatch({ type: 'desk/pause' })
  setInterval(() => {
    const now = Date.now()
    if (now - lastBeat > SLEEP_GAP_MS && state.desk.status === 'running') dispatch({ type: 'desk/pause', at: lastBeat })
    lastBeat = now
    dispatch({ type: 'desk/tick' })
  }, 1000)

  // ?demo and ?fresh: a handle for driving the HUD from the console or a screenshot script.
  if (scratch) (window as unknown as { __mayorly?: unknown }).__mayorly = { dispatch, state: () => state }

  // Browsers have no global hotkeys, so the same combos work while the tab has focus; not while
  // Settings listens for a new one (`holdHotkeys`).
  let hotkeysHeld = false
  window.addEventListener('keydown', (e) => {
    if (hotkeysHeld) return
    // Tips and force mode: Ctrl+Alt with a key, by its position (Option composes another character on a Mac).
    if (e.ctrlKey && e.altKey && !e.metaKey) {
      const k = e.code === 'Period' ? '.' : e.code === 'Comma' ? ',' : physicalKey(e)
      const combo = `Ctrl+Alt+${e.shiftKey ? 'Shift+' : ''}${k.length === 1 ? k.toUpperCase() : k}`
      const { tips: tipsKey, tipsForce } = state.settings.hotkeys
      if (combo !== tipsKey && combo !== tipsForce) return
      e.preventDefault()
      const t = state.settings.tips
      dispatch({ type: 'settings/update', patch: { tips: combo === tipsKey ? { ...t, on: !t.on } : { ...t, force: !t.force } } })
      return
    }
    if (!e.altKey || e.ctrlKey || e.metaKey) return
    const hk = state.settings.hotkeys
    // By key position: with Option held, macOS reports the composed character, not the letter.
    const k = physicalKey(e)
    const combo = `Alt+${e.shiftKey ? 'Shift+' : ''}${k.length === 1 ? k.toUpperCase() : k}`
    const map: Record<string, Command | 'pause' | 'skipRest' | 'clear' | 'hide' | 'scheduled' | 'gaming'> = {
      [hk.plus]: 'plus', [hk.capture]: 'capture', [hk.find]: 'find', [hk.deck]: 'deck', [hk.drawer]: 'drawer', [hk.pause]: 'pause', [hk.move]: 'move', [hk.switch]: 'switcher', [hk.clear]: 'clear', [hk.hide]: 'hide',
      [hk.skipRest]: 'skipRest', [hk.schedule]: 'schedule', [hk.scheduled]: 'scheduled', [hk.gaming]: 'gaming', [hk.switchLog]: 'switchLog',
    }
    const cmd = map[combo]
    if (!cmd) return
    // Gaming mode: only its own key, as on the desktop.
    if (state.settings.gaming && cmd !== 'gaming') return
    e.preventDefault()
    if (cmd === 'gaming') dispatch({ type: 'settings/update', patch: { gaming: !state.settings.gaming } })
    else if (cmd === 'pause') {
      const st = state.desk.status
      dispatch(st === 'running' ? { type: 'desk/pause' } : { type: 'desk/resume' })
    } else if (cmd === 'skipRest') dispatch({ type: 'desk/skipRest' })
    else if (cmd === 'clear') {
      const block = state.desk.block
      const couch = block?.kind === 'leisure' ? block.leisureId : block?.kind === 'rest' ? restSession(state)?.block.leisureId : null
      if (couch) dispatch({ type: 'leisure/clear', id: couch })
      else if (block?.entryId) dispatch({ type: 'entry/complete', id: block.entryId })
    } else if (cmd === 'hide') {
      // A browser tab has nothing to hide behind.
    } else if (cmd === 'scheduled') {
      const at = scheduledNow(state, Date.now())
      const entry = at ? state.entries.find((x) => x.id === at.entryId) : randomTask(state, Math.random())
      const act = entry ? switchToAction(state, { kind: 'entry', entry }) : null
      if (act) dispatch(act)
    } else cmdSubs.forEach((f) => f(cmd))
  })

  const sub = <T,>(set: Set<(v: T) => void>, fn: (v: T) => void) => {
    set.add(fn)
    return () => void set.delete(fn)
  }

  // The tab stands in for the Windows overlay: the window is the work area and the pet
  // goes anywhere in it. Until it is moved it sits at home on the side the settings name.
  let anchor: Point | null = null
  const layoutSubs = new Set<(l: Layout) => void>()
  const area = () => ({ x: 0, y: 0, width: window.innerWidth, height: window.innerHeight })
  const layout = (): Layout => {
    const a = anchor ? clampAnchor(anchor, area(), state.settings.hudScale) : homeAnchor(area(), state.settings.hudScale, state.settings.hudSide)
    return { compact: false, side: sideOf(area(), a), dragging: false, pet: a }
  }
  const place = (a: Point) => {
    anchor = clampAnchor(a, area(), state.settings.hudScale)
    const l = layout()
    layoutSubs.forEach((f) => f(l))
    if (state.settings.hudSide !== l.side) dispatch({ type: 'settings/update', patch: { hudSide: l.side } })
  }
  window.addEventListener('resize', () => {
    const l = layout()
    layoutSubs.forEach((f) => f(l))
  })

  return {
    kind: 'web',
    alarms: {
      pick: async () => null,
      save: async () => { throw new Error('Upload custom sounds in the desktop app.') },
      read: async () => null,
    },
    getState: async () => state,
    dispatch: async (a: Action) => dispatch(a),
    onState: (fn) => sub(stateSubs, fn),
    onEvents: (fn) => sub(eventSubs, fn),
    onCommand: (fn) => sub(cmdSubs, fn),
    setMode: (_mode: UiMode) => {},
    setHit: () => {},
    onHit: () => () => {},
    // A browser tab has no tray; its own context menu is fine.
    petMenu: () => {},
    setCaption: () => {},
    onCaption: () => () => {},
    getLayout: async () => layout(),
    onLayout: (fn) => sub(layoutSubs, fn),
    // The sample data has an account, so the parts of Settings that need one can be seen.
    accountsAvailable: async () => demo,
    getAccount: async () => (demo ? { email: 'you@example.com', name: 'You', avatarUrl: null } : null),
    signIn: async () => { throw new Error('Sign in from the desktop app') },
    signOut: async () => {},
    deleteAccount: async () => {},
    signOutEverywhere: async () => {},
    linkPhone: async () => ({ code: 'K7QX4M2P', expiresAt: new Date(Date.now() + 600_000).toISOString() }),
    log: (level, message) => console[level](message),
    getInfo: async () => ({ version: BUILD.version, platform: 'web', arch: '', dataDir: 'this browser', packaged: false, commit: BUILD.commit, builtAt: BUILD.builtAt, device: 'web' }),
    getBuild: async () => BUILD,
    // ?demo&notes or ?fresh&notes shows the card; a real preview shows it once per build like the app.
    whatsNew: async () => (scratch ? params.has('notes') : readSeen() !== BUILD.commit),
    seenBuild: () => {
      if (scratch) return
      try {
        localStorage.setItem(SEEN, BUILD.commit)
      } catch {
        /* storage unavailable */
      }
    },
    exportState: async () => {
      // A browser can still hand the state over: as a download.
      const blob = new Blob([JSON.stringify({ app: 'mayorly', exportedAt: new Date().toISOString(), state }, null, 2)], { type: 'application/json' })
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      a.download = `Mayorly-${new Date().toISOString().slice(0, 10)}.json`
      a.click()
      setTimeout(() => URL.revokeObjectURL(a.href), 10_000)
      return a.download
    },
    importState: async () => ({ ok: false, message: 'Import from the desktop app.' }),
    onAccount: () => () => {},
    onSync: () => () => {},
    ai: {
      get: async () => (demoClerk ? { ...NO_AI, keys: [DEMO_KEY] } : NO_AI),
      calibrate: async () => NO_AI,
      instruct: async (text: string): Promise<InstructionPlan> => {
        if (!demoClerk) return { kind: 'none', say: 'Instructions need the desktop app and an AI key.', steps: [], calendarAsk: null, refused: [] }
        // ?demo&clerk: two instructions read the way the clerk would, so the box can be seen at work.
        const code = state.ledgers[0]?.code
        const raw = /work/i.test(text)
          ? { kind: 'ops', say: 'work hours set', ops: [{ op: 'work', days: [1, 2, 3, 4, 5], start: '07:00', end: '16:00', ledgers: code ? [code] : null }] }
          : { kind: 'ops', say: 'recipe made', ops: [{ op: 'recipe', name: 'CWILL every workday', when: { kind: 'daily', days: 'workdays', at: '06:00', holidays: false }, line: `${code ?? 'PRO'}: CWILL {date}`, estimateMin: null }] }
        const plan = permit(resolveInstruction(raw, state, Date.now(), newId), state.settings.clerk.allow)
        for (const st of plan.steps) if (st.status === 'done') for (const a of st.actions) dispatch(a)
        return plan
      },
      addKey: async () => { throw new Error('AI keys live in the desktop app') },
      removeKey: async () => NO_AI,
      recheckKey: async () => NO_AI,
      setPreferredModel: async () => NO_AI,
      setPreferredProvider: async () => NO_AI,
      syncSetup: async () => { throw new Error('Key sync lives in the desktop app') },
      syncUnlock: async () => { throw new Error('Key sync lives in the desktop app') },
      syncReset: async () => NO_AI,
      sweepTray: async () => {},
      pickGlyph: async () => null,
      // The preview has no clerk; ?demo shows a sample proposal so the card can be seen.
      arrange: async (request: string) =>
        demo
          ? { id: 'demo', say: `clerk: arranged '${request.slice(0, 40)}'`, ask: null, lines: [{ text: 'Review lease renewal clause 7: estimate 90m', ok: true }, { text: 'Footwork drills, three sets: at 2026-10-31 15:00 for 60m', ok: true }, { text: 'Dentist: moved', ok: false, reason: 'yours, not the clerk\'s to move' }], moved: 3, newLate: 0, asks: [{ ref: 'the resume', options: [{ id: 'x', title: 'Tailor resume for the next posting' }, { id: 'y', title: 'Send two follow-up emails' }] }] }
          : null,
      applyArrangement: async () => true,
      discardArrangement: () => {},
    },
    onAi: () => () => {},
    calendar: {
      addSource: async () => ({ ok: false, message: 'Outside calendars are read by the desktop app.' }),
      removeSource: async () => {},
      refreshSources: async () => {},
      feed: async (op) => (demo && op !== 'drop' ? 'https://api.mayorly.example/cal/demo-token-demo-token-demo-tok.ics' : null),
    },
    onClerk: () => () => {},
    // The preview has no AI clerk; the question after a correction is the shell's own fallback line.
    onClerkAsk: (fn) => {
      const h = (evs: HudEvent[]) => {
        for (const e of evs) {
          if (e.type !== 'clerk-wonders') continue
          const to = state.ledgers.find((l) => l.id === e.ledgerId)?.name ?? 'the tray'
          fn({ entryId: e.entryId, ruleId: e.ruleId, title: e.title, question: e.reason === 'moved' ? `What makes "${e.title}" ${to}?` : `Noted. What is "${e.title}" about?` })
        }
      }
      eventSubs.add(h)
      return () => void eventSubs.delete(h)
    },
    setMoving: () => {},
    nudge: (dx, dy) => {
      const a = layout().pet!
      place({ x: a.x + dx, y: a.y + dy })
    },
    snap: (corner) => place(cornerAnchor(area(), corner, state.settings.hudScale)),
    placePet: (x, y) => place({ x, y }),
    setPetHeld: () => {},
    onEffect: (fn) => sub(effectSubs, fn),
    effectDone: () => {},
    previewImpact: (moment, style) => {
      if (style !== 'off') playImpact(previewImpact(moment, style, state))
    },
    closeDrawer: () => {},
    switchLog: {
      get: async () => switches.slice(),
      onAdd: (fn) => {
        switchSubs.add(fn)
        return () => switchSubs.delete(fn)
      },
      close: () => {},
    },
    onHotkeyFailures: () => () => {},
    holdHotkeys: (on) => {
      hotkeysHeld = on
    },
  }
}

