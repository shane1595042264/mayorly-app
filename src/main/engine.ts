import { randomUUID } from 'node:crypto'
import { reduce, SLEEP_GAP_MS, type Action, type HudEvent, type MayorlyState } from '@core/index'
import type { Store } from './store'

// The main process owns the one true state. Windows (and, later, the local sync
// API for mods) send actions in and receive snapshots out, so no client is special.

type Listener = (state: MayorlyState, events: HudEvent[]) => void

export class Engine {
  state: MayorlyState
  private lastBeat: number | null
  private listeners = new Set<Listener>()
  private beat: NodeJS.Timeout | null = null
  private lastPersistedBeat = 0

  constructor(private store: Store) {
    const saved = store.load(randomUUID)
    this.state = saved.state
    this.lastBeat = saved.lastBeat
    // The app was closed or crashed mid-block. Pause where the last heartbeat
    // landed: time the app could not see is not desk time.
    if (this.state.desk.status === 'running') {
      this.dispatch({ type: 'desk/pause', at: this.lastBeat ?? Date.now() })
    }
  }

  start() {
    this.beat = setInterval(() => this.heartbeat(), 1000)
  }

  stop() {
    if (this.beat) clearInterval(this.beat)
    this.store.save(this.state, this.lastBeat)
    this.store.flush()
  }

  on(fn: Listener): () => void {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  dispatch(action: Action) {
    const r = reduce(this.state, action, { now: Date.now(), newId: randomUUID, random: Math.random })
    const changed = r.state !== this.state
    this.state = r.state
    if (changed) this.store.save(this.state, this.lastBeat)
    if (changed || r.events.length) for (const fn of this.listeners) fn(this.state, r.events)
  }

  private heartbeat() {
    const now = Date.now()
    // A long gap means the machine slept. Pause at the last beat so sleep never mints tomatoes.
    if (this.lastBeat !== null && now - this.lastBeat > SLEEP_GAP_MS && this.state.desk.status === 'running') {
      this.dispatch({ type: 'desk/pause', at: this.lastBeat })
    }
    this.lastBeat = now
    this.dispatch({ type: 'desk/tick' })
    if (now - this.lastPersistedBeat > 15_000 && this.state.desk.status === 'running') {
      this.lastPersistedBeat = now
      this.store.save(this.state, now)
    }
  }
}
