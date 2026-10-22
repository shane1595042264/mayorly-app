import type { MayorlyState } from '@core/index'
import type { SyncStatus } from '../shared/bridge'
import type { Engine } from './engine'

// Keeps the account's state document on mayorly-api equal to this machine's.
// Last writer wins by revision: a push carries the revision it was based on, and
// a 409 means another machine wrote first; its document replaces this copy
// (through the reducer, which keeps this machine's own settings) and that is that.
// A running desk pushes every PUSH_MIN_MS; everything else a few seconds after it
// changes. Other machines' changes are picked up on launch and every POLL_MS.

/** Wait this long after a change before pushing, so a burst of edits is one push. */
const PUSH_DEBOUNCE_MS = 2_500
/** Never push more often than this; the heartbeat changes state every second while a block runs. */
const PUSH_MIN_MS = 20_000
const POLL_MS = 60_000

export class Sync {
  private token: string | null = null
  private revision = 0
  private synced = ''
  private pushTimer: NodeJS.Timeout | null = null
  private pollTimer: NodeJS.Timeout | null = null
  private lastPush = 0
  private busy = false
  private status: SyncStatus = { phase: 'off', at: null, revision: 0 }

  constructor(
    private readonly engine: Engine,
    private readonly apiUrl: string,
    private readonly device: string,
    private readonly onStatus: (s: SyncStatus) => void,
  ) {
    engine.on((state) => this.changed(state))
  }

  current(): SyncStatus {
    return this.status
  }

  /** A sign-in or sign-out. */
  setSession(token: string | null) {
    this.token = token
    this.revision = 0
    this.synced = ''
    if (this.pollTimer) clearInterval(this.pollTimer)
    this.pollTimer = null
    if (!token) {
      this.set({ phase: 'off', at: null, revision: 0 })
      return
    }
    this.set({ phase: 'syncing', at: null, revision: 0 })
    void this.pull()
    this.pollTimer = setInterval(() => void this.pull(), POLL_MS)
  }

  /** Push whatever is pending now, within a bound; for quitting. */
  async flush(timeoutMs = 3_000) {
    if (!this.token) return
    if (this.pushTimer) clearTimeout(this.pushTimer)
    this.pushTimer = null
    await Promise.race([this.push(true), new Promise((r) => setTimeout(r, timeoutMs))])
  }

  private set(s: SyncStatus) {
    this.status = s
    this.onStatus(s)
  }

  private changed(state: MayorlyState) {
    if (!this.token || JSON.stringify(state) === this.synced) return
    if (this.pushTimer) return
    const wait = Math.max(PUSH_DEBOUNCE_MS, this.lastPush + PUSH_MIN_MS - Date.now())
    this.pushTimer = setTimeout(() => {
      this.pushTimer = null
      void this.push(false)
    }, wait)
  }

  private headers() {
    return { Authorization: `Bearer ${this.token}`, 'Content-Type': 'application/json' }
  }

  private async pull() {
    if (!this.token || this.busy) return
    this.busy = true
    try {
      const res = await fetch(`${this.apiUrl}/sync/state?have=${this.revision}`, { headers: this.headers() })
      if (res.status === 401) return this.signedOut()
      if (!res.ok) throw new Error(`pull ${res.status}`)
      const data = (await res.json()) as { revision: number; state: unknown; unchanged?: boolean }
      if (data.unchanged) return this.ok()
      if (data.state === null) {
        // A fresh account: this machine's copy becomes the document.
        this.revision = 0
        this.busy = false
        return this.push(true)
      }
      if (data.revision > this.revision) this.take(data.revision, data.state)
      this.ok()
    } catch (err) {
      this.fail(err)
    } finally {
      this.busy = false
    }
  }

  private async push(force: boolean) {
    if (!this.token || this.busy) {
      if (!force) this.changed(this.engine.state)
      return
    }
    const body = JSON.stringify(this.engine.state)
    if (!force && body === this.synced) return
    this.busy = true
    this.set({ ...this.status, phase: 'syncing' })
    try {
      const res = await fetch(`${this.apiUrl}/sync/state`, {
        method: 'PUT',
        headers: this.headers(),
        body: JSON.stringify({ baseRevision: this.revision, state: this.engine.state, device: this.device }),
      })
      if (res.status === 401) return this.signedOut()
      if (res.status === 409) {
        const data = (await res.json()) as { revision: number; state: unknown }
        if (data.state) this.take(data.revision, data.state)
        else this.revision = data.revision
        return this.ok()
      }
      if (!res.ok) throw new Error(`push ${res.status}`)
      const data = (await res.json()) as { revision: number }
      this.revision = data.revision
      this.synced = body
      this.lastPush = Date.now()
      this.ok()
    } catch (err) {
      this.fail(err)
    } finally {
      this.busy = false
    }
  }

  /** The server's document wins: through the reducer, so this machine's settings stay. */
  private take(revision: number, state: unknown) {
    this.revision = revision
    this.engine.dispatch({ type: 'sync/replace', state })
    this.synced = JSON.stringify(this.engine.state)
  }

  private ok() {
    this.set({ phase: 'idle', at: Date.now(), revision: this.revision })
  }

  private fail(err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[sync]', message)
    this.set({ phase: 'error', at: this.status.at, revision: this.revision, message })
  }

  private signedOut() {
    this.set({ phase: 'error', at: this.status.at, revision: this.revision, message: 'Signed out by the server. Sign in again.' })
    this.onExpired?.()
  }

  /** Set by the shell: the saved session is no longer valid. */
  onExpired: (() => void) | null = null
}
