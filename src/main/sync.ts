import { createHash, randomUUID } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { MayorlyState } from '@core/index'
import type { SyncStatus } from '../shared/bridge'
import type { Engine } from './engine'

// Keeps the account's document on mayorly-api and this machine's state equal without losing
// work on either side. The server holds the latest copy and a revision; a push carries the
// revision it was based on, and a 409 means another machine wrote first. What happens then
// depends on whether this machine changed anything since it last matched the server, which a
// hash of the state as last pushed or taken says (kept in sync.json beside the save): nothing
// changed, the server's copy is taken; something changed, the reducer merges the two and the
// merge is pushed. A document this build cannot read blocks syncing until the app is updated,
// instead of being overwritten. A failed push is retried with a growing wait, and the session
// is renewed before it runs out.

/** Wait this long after a change before pushing, so a burst of edits is one push. */
const PUSH_DEBOUNCE_MS = 2_500
/** Never push more often than this; the heartbeat changes state while a block runs. */
const PUSH_MIN_MS = 20_000
const POLL_MS = 60_000
const RETRY_MS = [30_000, 60_000, 120_000, 300_000]
/** The server issues 30-day sessions; renew when less than this is left. */
const REFRESH_WITHIN_MS = 10 * 24 * 3_600_000

interface Mark {
  revision: number
  /** When this machine last matched the server. */
  syncedAt: number | null
  /** The state as it was then. */
  hash: string | null
  /** A name for this machine on the server: platform and a random tag, never the hostname. */
  device: string
}

const hashOf = (state: MayorlyState) => createHash('sha1').update(JSON.stringify(state)).digest('hex')

/** The seconds-since-epoch expiry inside a JWT, or null. */
function expiryOf(token: string): number | null {
  try {
    const payload = JSON.parse(Buffer.from(token.split('.')[1] ?? '', 'base64url').toString('utf8')) as { exp?: number }
    return typeof payload.exp === 'number' ? payload.exp : null
  } catch {
    return null
  }
}

export class Sync {
  private token: string | null = null
  private mark: Mark
  private syncedState: MayorlyState | null = null
  private pushTimer: NodeJS.Timeout | null = null
  private pollTimer: NodeJS.Timeout | null = null
  private retryTimer: NodeJS.Timeout | null = null
  private retries = 0
  private busy = false
  private pushAgain = false
  private blocked = false
  private status: SyncStatus = { phase: 'off', at: null, revision: 0 }
  private readonly file: string
  /** Set by the shell: the saved session is no longer valid. */
  onExpired: (() => void) | null = null
  /** Set by the shell: the session was renewed; save this token. */
  onRefreshed: ((token: string) => void) | null = null

  constructor(
    private readonly engine: Engine,
    private readonly apiUrl: string,
    dataDir: string,
    private readonly onStatus: (s: SyncStatus) => void,
  ) {
    this.file = join(dataDir, 'sync.json')
    this.mark = this.loadMark()
    engine.on((state) => this.changed(state))
  }

  current(): SyncStatus {
    return this.status
  }

  /** A sign-in or sign-out. */
  setSession(token: string | null) {
    this.token = token
    this.syncedState = null
    this.blocked = false
    this.clearTimers()
    if (!token) {
      // The next sign-in may be another account: nothing of this one's mark carries over.
      this.mark = { ...this.mark, revision: 0, syncedAt: null, hash: null }
      this.saveMark()
      this.set({ phase: 'off', at: null, revision: 0 })
      return
    }
    this.set({ phase: 'syncing', at: null, revision: this.mark.revision })
    void this.refreshIfNeeded().then(() => this.pull())
    this.pollTimer = setInterval(() => {
      void this.refreshIfNeeded()
      void this.pull()
    }, POLL_MS)
  }

  /** Push whatever is pending now, within a bound; for quitting. */
  async flush(timeoutMs = 3_000) {
    if (!this.token || this.blocked) return
    if (this.pushTimer) clearTimeout(this.pushTimer)
    this.pushTimer = null
    const until = Date.now() + timeoutMs
    while (this.busy && Date.now() < until) await new Promise((r) => setTimeout(r, 50))
    await Promise.race([this.push(true), new Promise((r) => setTimeout(r, Math.max(0, until - Date.now())))])
  }

  private set(s: SyncStatus) {
    this.status = s
    this.onStatus(s)
  }

  private changed(state: MayorlyState) {
    if (!this.token || this.blocked || state === this.syncedState || this.pushTimer) return
    const wait = Math.max(PUSH_DEBOUNCE_MS, this.status.at ? this.status.at + PUSH_MIN_MS - Date.now() : 0)
    this.pushTimer = setTimeout(() => {
      this.pushTimer = null
      void this.push(false)
    }, wait)
  }

  private headers() {
    return { Authorization: `Bearer ${this.token}`, 'Content-Type': 'application/json' }
  }

  private async pull() {
    if (!this.token || this.busy || this.blocked) return
    this.busy = true
    try {
      const res = await fetch(`${this.apiUrl}/sync/state?have=${this.mark.revision}`, { headers: this.headers() })
      if (res.status === 401) return this.signedOut()
      if (!res.ok) throw new Error(`pull ${res.status}`)
      const data = (await res.json()) as { revision: number; state: unknown; unchanged?: boolean }
      if (data.unchanged) return this.ok()
      if (data.state === null) {
        // A fresh account: this machine's copy becomes the document.
        this.mark.revision = 0
        this.pushAgain = true
        return this.ok()
      }
      if (data.revision > this.mark.revision && this.adopt(data.revision, data.state) === 'merged') this.pushAgain = true
      if (!this.blocked) this.ok()
    } catch (err) {
      this.fail(err)
    } finally {
      this.busy = false
      this.after()
    }
  }

  private async push(force: boolean) {
    if (!this.token || this.blocked) return
    if (this.busy) {
      this.pushAgain = this.pushAgain || force
      if (!force) this.changed(this.engine.state)
      return
    }
    const state = this.engine.state
    if (!force && state === this.syncedState) return
    this.busy = true
    this.set({ ...this.status, phase: 'syncing' })
    try {
      const res = await fetch(`${this.apiUrl}/sync/state`, {
        method: 'PUT',
        headers: this.headers(),
        body: JSON.stringify({ baseRevision: this.mark.revision, state, device: this.mark.device, schema: state.schema }),
      })
      if (res.status === 401) return this.signedOut()
      if (res.status === 409) {
        // Another machine wrote first. Its document and this one's work become one, and that is pushed.
        const data = (await res.json()) as { revision: number; state: unknown }
        if (data.state) {
          if (this.adopt(data.revision, data.state) === 'merged') this.pushAgain = true
        } else this.mark.revision = data.revision
        if (!this.blocked) this.ok()
        return
      }
      if (!res.ok) throw new Error(`push ${res.status}`)
      const data = (await res.json()) as { revision: number }
      this.mark.revision = data.revision
      this.remember(state)
      this.ok()
    } catch (err) {
      this.fail(err)
    } finally {
      this.busy = false
      this.after()
    }
  }

  /** Once a pull or push is done: the push it asked for. */
  private after() {
    if (!this.pushAgain || this.busy || this.blocked) return
    this.pushAgain = false
    setTimeout(() => void this.push(true), 0)
  }

  /**
   * The server's document arrives. Taken whole when this machine changed nothing since it last
   * matched the server; merged with this machine's work otherwise. Either way a copy of what
   * was here goes to backups first.
   */
  private adopt(revision: number, doc: unknown): 'taken' | 'merged' | 'blocked' {
    const local = this.engine.state
    const changedHere = this.mark.hash !== null ? hashOf(local) !== this.mark.hash : local.entries.length > 0 || local.sittings.length > 0 || local.ledgers.length > 0
    this.engine.snapshot('before-sync')
    this.engine.dispatch(changedHere ? { type: 'sync/merge', state: doc, syncedAt: this.mark.syncedAt } : { type: 'sync/replace', state: doc })
    if (this.engine.state === local) {
      // The reducer refused it: a document from a newer Mayorly. Nothing here may overwrite it.
      this.blocked = true
      this.set({ phase: 'error', at: this.status.at, revision: this.mark.revision, message: "This account's data comes from a newer Mayorly. Update to keep syncing." })
      return 'blocked'
    }
    this.mark.revision = revision
    if (changedHere) {
      this.saveMark()
      return 'merged'
    }
    this.remember(this.engine.state)
    return 'taken'
  }

  /** This machine matches the server as of now. */
  private remember(state: MayorlyState) {
    this.syncedState = state
    this.mark.hash = hashOf(state)
    this.mark.syncedAt = Date.now()
    this.saveMark()
  }

  /** Renew the session before it runs out, so a month of use never ends in a silent sign-out. */
  private async refreshIfNeeded() {
    if (!this.token) return
    const exp = expiryOf(this.token)
    if (exp === null || exp * 1000 - Date.now() > REFRESH_WITHIN_MS) return
    try {
      const res = await fetch(`${this.apiUrl}/auth/refresh`, { method: 'POST', headers: this.headers() })
      if (res.status === 401) return this.signedOut()
      if (!res.ok) return
      const data = (await res.json()) as { token?: string }
      if (typeof data.token === 'string') {
        this.token = data.token
        this.onRefreshed?.(data.token)
      }
    } catch (err) {
      console.warn('[sync] could not renew the session:', err instanceof Error ? err.message : String(err))
    }
  }

  private ok() {
    this.retries = 0
    if (this.retryTimer) clearTimeout(this.retryTimer)
    this.retryTimer = null
    this.set({ phase: 'idle', at: Date.now(), revision: this.mark.revision })
  }

  private fail(err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[sync]', message)
    this.set({ phase: 'error', at: this.status.at, revision: this.mark.revision, message })
    if (this.retryTimer) return
    const wait = RETRY_MS[Math.min(this.retries++, RETRY_MS.length - 1)]
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null
      void this.pull().then(() => this.push(false))
    }, wait)
  }

  private signedOut() {
    this.set({ phase: 'error', at: this.status.at, revision: this.mark.revision, message: 'Signed out by the server. Sign in again.' })
    this.onExpired?.()
  }

  private clearTimers() {
    for (const t of [this.pushTimer, this.pollTimer, this.retryTimer]) if (t) clearTimeout(t)
    this.pushTimer = this.pollTimer = this.retryTimer = null
    this.retries = 0
    this.pushAgain = false
  }

  private loadMark(): Mark {
    const fresh: Mark = { revision: 0, syncedAt: null, hash: null, device: `${process.platform}-${randomUUID().slice(0, 8)}` }
    try {
      if (!existsSync(this.file)) return fresh
      const raw = JSON.parse(readFileSync(this.file, 'utf8')) as Partial<Mark>
      return {
        revision: typeof raw.revision === 'number' ? raw.revision : 0,
        syncedAt: typeof raw.syncedAt === 'number' ? raw.syncedAt : null,
        hash: typeof raw.hash === 'string' ? raw.hash : null,
        device: typeof raw.device === 'string' ? raw.device : fresh.device,
      }
    } catch {
      return fresh
    }
  }

  private saveMark() {
    try {
      writeFileSync(this.file, JSON.stringify(this.mark))
    } catch (err) {
      console.error('[sync] could not save the sync mark:', err)
    }
  }
}
