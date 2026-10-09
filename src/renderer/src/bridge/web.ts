import {
  firstRunState, migrate, reduce, SLEEP_GAP_MS,
  type Action, type HudEvent, type MayorlyState,
} from '@core/index'
import type { Bridge, Command, UiMode } from '../../../shared/bridge'
import { demoState } from './demo'

// The same engine the main process runs, inside the page. Lets the HUD run in a
// plain browser for development and screenshots. Persists to localStorage.

const KEY = 'mayorly.web.v1'

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
  }

  if (state.desk.status === 'running' && !demo) dispatch({ type: 'desk/pause' })
  setInterval(() => {
    const now = Date.now()
    if (now - lastBeat > SLEEP_GAP_MS && state.desk.status === 'running') dispatch({ type: 'desk/pause', at: lastBeat })
    lastBeat = now
    dispatch({ type: 'desk/tick' })
  }, 1000)

  // Browsers have no global hotkeys, so the same combos work while the tab has focus.
  window.addEventListener('keydown', (e) => {
    if (!e.altKey || e.ctrlKey || e.metaKey) return
    const hk = state.settings.hotkeys
    const combo = `Alt+${e.shiftKey ? 'Shift+' : ''}${e.key.length === 1 ? e.key.toUpperCase() : e.key}`
    const map: Record<string, Command | 'pause'> = { [hk.plus]: 'plus', [hk.capture]: 'capture', [hk.deck]: 'deck', [hk.pause]: 'pause' }
    const cmd = map[combo]
    if (!cmd) return
    e.preventDefault()
    if (cmd === 'pause') {
      const st = state.desk.status
      dispatch(st === 'running' ? { type: 'desk/pause' } : { type: 'desk/resume' })
    } else cmdSubs.forEach((f) => f(cmd))
  })

  const sub = <T,>(set: Set<(v: T) => void>, fn: (v: T) => void) => {
    set.add(fn)
    return () => void set.delete(fn)
  }

  return {
    kind: 'web',
    getState: async () => state,
    dispatch,
    onState: (fn) => sub(stateSubs, fn),
    onEvents: (fn) => sub(eventSubs, fn),
    onCommand: (fn) => sub(cmdSubs, fn),
    setMode: (_mode: UiMode) => {},
    setHit: () => {},
    onHotkeyFailures: () => () => {},
  }
}

