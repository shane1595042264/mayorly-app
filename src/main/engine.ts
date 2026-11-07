import { randomUUID } from 'node:crypto'
import { reduce, SLEEP_GAP_MS, type Action, type HudEvent, type MayorlyState } from '@core/index'
import type { Store } from './store'

// The main process owns the one true state. Windows (and, later, the local sync
// API for mods) send actions in and receive snapshots out, so no client is special.

type Listener = (state: MayorlyState, events: HudEvent[]) => void
type ActionListener = (action: Action, changed: boolean) => void

/** This computer as the desk knows it: an id kept beside the save, and its host name. */
export interface Device {
  id: string
  name: string
}

export class Engine {
  state: MayorlyState
  /** The first launch on this machine: nothing saved yet. */
  readonly fresh: boolean
  /** The save could not be read and this backup stood in. */
  readonly restoredFrom: string | null
  private lastBeat: number | null
  private listeners = new Set<Listener>()
  private actionListeners = new Set<ActionListener>()
  private beat: NodeJS.Timeout | null = null
  private lastPersistedBeat = 0

  constructor(private store: Store, private device: Device) {
    const saved = store.load(randomUUID)
    this.state = saved.state
    this.fresh = !!saved.fresh
    this.restoredFrom = saved.restoredFrom ?? null
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

  /** A backup of the save as it is, named for why: before a sync or an import replaces the state. */
  snapshot(reason: string) {
    this.store.save(this.state, this.lastBeat)
    this.store.backup(reason)
  }

  on(fn: Listener): () => void {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  /** Every action that ran, with whether it changed the state. The replanner listens here. */
  onAction(fn: ActionListener): () => void {
    this.actionListeners.add(fn)
    return () => this.actionListeners.delete(fn)
  }

  /** Something the app does on its own: a tick, a replan, a sync, the clerk's filing, a pause for sleep. */
  dispatch(action: Action) {
    this.run([action], action)
  }

  /**
   * Something a person did on this computer. It becomes the active device first, in the same
   * step, so the desk runs here and the other computers hold it when they hear.
   */
  act(action: Action) {
    this.run([{ type: 'desk/claim', name: this.device.name }, action], action)
  }

  private run(actions: Action[], action: Action) {
    const ctx = { now: Date.now(), newId: randomUUID, random: Math.random, device: this.device.id }
    const before = this.state
    const events: HudEvent[] = []
    for (const a of actions) {
      const r = reduce(this.state, a, ctx)
      this.state = r.state
      events.push(...r.events)
    }
    const changed = this.state !== before
    if (changed) this.store.save(this.state, this.lastBeat)
    if (changed || events.length) for (const fn of this.listeners) fn(this.state, events)
    for (const fn of this.actionListeners) fn(action, changed)
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
