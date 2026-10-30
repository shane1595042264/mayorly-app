import {
  firstRunState, migrate, reduce, SLEEP_GAP_MS,
  type Action, type HudEvent, type MayorlyState,
} from '@core/index'
import type { Bridge, Command, UiMode } from '../../../shared/bridge'
import { BUILD } from '../../../shared/build'
import { machineZone, windowsFor } from '../../../shared/windows'
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
const NO_AI = { keys: [], preferredProvider: null, providers: { gemini: 'Google Gemini', openai: 'OpenAI', anthropic: 'Anthropic Claude', xai: 'xAI Grok' }, usage: { days: 30, calls: 0, costMicroUsd: 0 } }

export function createWebBridge(): Bridge {
  const newId = () => crypto.randomUUID()
  // ?demo seeds sample data, ?fresh starts from first run. Neither touches storage.
  const params = new URLSearchParams(location.search)
  const demo = params.has('demo')
  const scratch = demo || params.has('fresh')
  let state: MayorlyState = demo
    ? demoState(Date.now(), newId)
    : (!scratch && load()) || firstRunState(Date.now(), newId)
  let lastBeat = Date.now()
  const stateSubs = new Set<(s: MayorlyState) => void>()
  const eventSubs = new Set<(e: HudEvent[]) => void>()
  const cmdSubs = new Set<(c: Command) => void>()

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

  function dispatch(action: Action) {
    const r = reduce(state, action, { now: Date.now(), newId, random: Math.random })
    const changed = r.state !== state
    state = r.state
    if (changed) {
      save()
      stateSubs.forEach((f) => f(state))
    }
    if (r.events.length) eventSubs.forEach((f) => f(r.events))
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
    dispatch({ type: 'schedule/replan', windows: windowsFor(cal, now, cal.horizonDays + 1), horizonEnd: now + cal.horizonDays * 86_400_000 })
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

  // Browsers have no global hotkeys, so the same combos work while the tab has focus.
  window.addEventListener('keydown', (e) => {
    if (!e.altKey || e.ctrlKey || e.metaKey) return
    const hk = state.settings.hotkeys
    // By key position: with Option held, macOS reports the composed character, not the letter.
    const k = physicalKey(e)
    const combo = `Alt+${e.shiftKey ? 'Shift+' : ''}${k.length === 1 ? k.toUpperCase() : k}`
    const map: Record<string, Command | 'pause' | 'switch' | 'clear' | 'hide'> = {
      [hk.plus]: 'plus', [hk.capture]: 'capture', [hk.deck]: 'deck', [hk.drawer]: 'drawer', [hk.pause]: 'pause', [hk.move]: 'move', [hk.switch]: 'switch', [hk.clear]: 'clear', [hk.hide]: 'hide',
    }
    const cmd = map[combo]
    if (!cmd) return
    e.preventDefault()
    if (cmd === 'pause') {
      const st = state.desk.status
      dispatch(st === 'running' ? { type: 'desk/pause' } : { type: 'desk/resume' })
    } else if (cmd === 'switch') dispatch({ type: 'desk/switch' })
    else if (cmd === 'clear') {
      const id = state.desk.block?.entryId
      if (id) dispatch({ type: 'entry/complete', id })
    } else if (cmd === 'hide') {
      // A browser tab has nothing to hide behind.
    } else cmdSubs.forEach((f) => f(cmd))
  })

  const sub = <T,>(set: Set<(v: T) => void>, fn: (v: T) => void) => {
    set.add(fn)
    return () => void set.delete(fn)
  }

  return {
    kind: 'web',
    getState: async () => state,
    dispatch: async (a: Action) => dispatch(a),
    onState: (fn) => sub(stateSubs, fn),
    onEvents: (fn) => sub(eventSubs, fn),
    onCommand: (fn) => sub(cmdSubs, fn),
    setMode: (_mode: UiMode) => {},
    setHit: () => {},
    setCaption: () => {},
    onCaption: () => () => {},
    getLayout: async () => ({ compact: false, side: 'right' as const, dragging: false }),
    onLayout: () => () => {},
    // The sample data has an account, so the parts of Settings that need one can be seen.
    accountsAvailable: async () => demo,
    getAccount: async () => (demo ? { email: 'you@example.com', name: 'You', avatarUrl: null } : null),
    signIn: async () => { throw new Error('Sign in from the desktop app') },
    signOut: async () => {},
    deleteAccount: async () => {},
    signOutEverywhere: async () => {},
    log: (level, message) => console[level](message),
    getInfo: async () => ({ version: BUILD.version, platform: 'web', arch: '', dataDir: 'this browser', packaged: false, commit: BUILD.commit, builtAt: BUILD.builtAt }),
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
      get: async () => NO_AI,
      addKey: async () => { throw new Error('AI keys live in the desktop app') },
      removeKey: async () => NO_AI,
      recheckKey: async () => NO_AI,
      setPreferredModel: async () => NO_AI,
      setPreferredProvider: async () => NO_AI,
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
    nudge: () => {},
    snap: () => {},
    onEffect: () => () => {},
    effectDone: () => {},
    closeDrawer: () => {},
    onHotkeyFailures: () => () => {},
  }
}

