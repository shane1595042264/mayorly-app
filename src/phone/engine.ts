import { App as CapApp } from '@capacitor/app'
import { firstRunState, migrate, reduce, type Action, type HudEvent, type MayorlyState } from '@core/index'
import { horizonEndFor, machineZone, windowsFor } from '../shared/windows'
import type { SyncEngine } from '../shared/sync-client'
import { demoState } from '../renderer/src/bridge/demo'
import { deviceName, readJson, writeJson } from './platform'

// The phone's engine: the same reducer as the desktop, the state in a file, a heartbeat while
// the app is on screen. One rule differs on purpose. The desktop pauses a block it could not
// watch (the machine slept, the app was closed), because time it could not see is not desk
// time. A phone is locked in a pocket for most of every block, and the person still means the
// timer to run; so the phone never pauses on its own, and when it comes back the tick replays
// every block end at the moment it fell (the reducer chains them), and the local notifications
// in notify.ts have rung each one meanwhile.

type Listener = (state: MayorlyState) => void
type EventListener = (events: HudEvent[]) => void

const STATE = 'state.json'
const DEVICE = 'device.json'
const SAVE_DEBOUNCE_MS = 400
/** Actions after which the plan is worth working out again, as the desktop's replanner does. */
const REPLANS = /^(entry\/|calendar\/|settings\/update|ledger\/delete|sync\/)/

export class PhoneEngine implements SyncEngine {
  private listeners = new Set<Listener>()
  private eventListeners = new Set<EventListener>()
  private saveTimer: ReturnType<typeof setTimeout> | null = null
  private replanTimer: ReturnType<typeof setTimeout> | null = null
  /** Called when the app goes to the background or comes back. */
  onForeground: ((front: boolean) => void) | null = null

  private constructor(
    public state: MayorlyState,
    readonly deviceId: string,
    /** ?demo and ?fresh in a browser: nothing is written. */
    readonly scratch: boolean,
    readonly fresh: boolean,
  ) {}

  static async boot(): Promise<PhoneEngine> {
    const params = new URLSearchParams(location.search)
    const demo = params.has('demo')
    const scratch = demo || params.has('fresh')
    const newId = () => crypto.randomUUID()
    if (scratch) return new PhoneEngine(demo ? demoState(Date.now(), newId) : firstRunState(Date.now(), newId), 'phone-demo', true, !demo)
    let device = (await readJson<{ id?: string }>(DEVICE))?.id
    if (typeof device !== 'string' || !device) {
      device = `phone-${newId()}`
      await writeJson(DEVICE, { id: device })
    }
    const saved = migrate(await readJson(STATE))
    return new PhoneEngine(saved ?? firstRunState(Date.now(), newId), device, false, !saved)
  }

  on(fn: Listener): () => void {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  onEvents(fn: EventListener): () => void {
    this.eventListeners.add(fn)
    return () => this.eventListeners.delete(fn)
  }

  /** Something the app does on its own: a tick, a replan, a sync. */
  dispatch(action: Action) {
    this.run([action], action)
  }

  /** Something the person did here: the phone becomes the device that runs the desk, in the same step. */
  act(action: Action) {
    this.run([{ type: 'desk/claim', name: deviceName }, action], action)
  }

  snapshot(reason: string) {
    if (!this.scratch) void writeJson(`backup-${reason}.json`, this.state).catch(() => {})
  }

  start() {
    this.tick()
    setInterval(() => {
      if (document.visibilityState === 'visible') this.tick()
    }, 1000)
    setInterval(() => this.replan(), 60_000)
    this.replan()
    const front = (on: boolean) => {
      if (on) this.tick()
      else this.saveNow()
      this.onForeground?.(on)
    }
    void CapApp.addListener('appStateChange', ({ isActive }) => front(isActive)).catch(() => {})
    document.addEventListener('visibilitychange', () => front(document.visibilityState === 'visible'))
  }

  /** Write the state now: going to the background, where the app may be ended without notice. */
  saveNow() {
    if (this.saveTimer) clearTimeout(this.saveTimer)
    this.saveTimer = null
    if (!this.scratch) void writeJson(STATE, this.state).catch((err) => console.error('[engine] could not save:', err))
  }

  private tick() {
    this.dispatch({ type: 'desk/tick' })
  }

  private run(actions: Action[], action: Action) {
    const ctx = { now: Date.now(), newId: () => crypto.randomUUID(), random: Math.random, device: this.deviceId }
    const before = this.state
    const events: HudEvent[] = []
    for (const a of actions) {
      const r = reduce(this.state, a, ctx)
      this.state = r.state
      events.push(...r.events)
    }
    if (this.state !== before) {
      this.saveSoon()
      for (const fn of this.listeners) fn(this.state)
    }
    if (events.length) for (const fn of this.eventListeners) fn(events)
    if (action.type !== 'schedule/replan' && REPLANS.test(action.type)) this.replanSoon()
  }

  private saveSoon() {
    if (this.scratch || this.saveTimer) return
    this.saveTimer = setTimeout(() => this.saveNow(), SAVE_DEBOUNCE_MS)
  }

  private replanSoon() {
    if (this.replanTimer) clearTimeout(this.replanTimer)
    this.replanTimer = setTimeout(() => this.replan(), 250)
  }

  /** The planner, as the desktop's replanner runs it: once a minute and after anything that moves it. */
  private replan() {
    this.replanTimer = null
    const cal = this.state.settings.calendar
    if (!cal.tz) {
      this.dispatch({ type: 'settings/update', patch: { calendar: { ...cal, tz: machineZone() } } })
      return
    }
    const now = Date.now()
    this.dispatch({ type: 'schedule/replan', windows: windowsFor(cal, now, cal.horizonDays + 1), horizonEnd: horizonEndFor(cal, now) })
  }
}
