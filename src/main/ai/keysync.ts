import type { AiKeySync } from '../../shared/bridge'
import type { AiClerk } from './service'
import { checks, deriveKeys, incoming, KDF, kdfOk, makeCheck, newSalt, outgoing, PASSPHRASE_MIN, type Kdf, type VaultInfo, type VaultItem, type VaultKeys } from './vault'

// AI keys between a user's computers. The passphrase is typed on each computer once; the keys
// made from it are sealed in ai.bin with the API keys themselves, and the passphrase is never
// stored or sent. Each sync sends every key this computer has and every removal it has not told
// the server yet, takes the merged list back, and adds or drops keys here to match. The server
// merges by the key's HMAC name, so a key on two computers is one key.

const EVERY_MS = 5 * 60_000
const TIMEOUT_MS = 15_000

/** What ai.bin keeps once this computer has the passphrase. */
export interface VaultSecret {
  salt: string
  kdf: Kdf
  check: string
  enc: string
  id: string
}

class HttpError extends Error {
  constructor(readonly status: number, readonly body: Record<string, unknown>) {
    super(status === 401 ? 'Signed out by the server. Sign in again.' : `The sync server answered ${status}. Try again in a minute.`)
  }
}

export class KeySync {
  private token: string | null = null
  private timer: ReturnType<typeof setInterval> | null = null
  private running: Promise<void> | null = null
  private again = false
  private keys: VaultKeys | null = null

  constructor(private readonly apiUrl: string, private readonly clerk: AiClerk) {
    const s = clerk.vaultSecret()
    if (s) this.keys = { enc: Buffer.from(s.enc, 'base64'), id: Buffer.from(s.id, 'base64') }
    clerk.onKeysChanged = () => void this.sync()
    this.set({ phase: 'off', at: null, message: null })
  }

  /** A sign-in or sign-out. Signing out forgets the passphrase's keys: another account has another vault. */
  setSession(token: string | null) {
    this.token = this.apiUrl ? token : null
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    if (!this.token) {
      this.forget()
      this.set({ phase: 'off', at: null, message: null })
      return
    }
    this.set({ phase: 'checking', at: null, message: null })
    void this.sync()
    this.timer = setInterval(() => void this.sync(), EVERY_MS)
  }

  /** The session was renewed: same account, new token. */
  setToken(token: string) {
    if (this.token) this.token = token
  }

  /** The first computer chooses the passphrase. */
  async setup(passphrase: string) {
    if (passphrase.normalize('NFKC').length < PASSPHRASE_MIN) throw new Error(`Use at least ${PASSPHRASE_MIN} characters. A few words are easy to remember.`)
    const { vault } = await this.call<{ vault: VaultInfo | null }>('GET', '/vault')
    if (vault) {
      this.set({ phase: 'locked', at: null, message: null })
      throw new Error('Another computer already set a sync passphrase. Enter that one.')
    }
    const salt = newSalt()
    const keys = await deriveKeys(passphrase, salt, KDF)
    const check = makeCheck(keys)
    try {
      await this.call('POST', '/vault', { salt, kdf: KDF, check })
    } catch (err) {
      if (err instanceof HttpError && err.status === 409) {
        this.set({ phase: 'locked', at: null, message: null })
        throw new Error('Another computer set a sync passphrase just now. Enter that one.')
      }
      throw err
    }
    this.remember(keys, { salt, kdf: KDF, check })
    await this.sync()
  }

  /** Every other computer types the same passphrase. */
  async unlock(passphrase: string) {
    const { vault } = await this.call<{ vault: VaultInfo | null }>('GET', '/vault')
    if (!vault) {
      this.set({ phase: 'none', at: null, message: null })
      throw new Error('No sync passphrase is set yet. Choose one here.')
    }
    if (!kdfOk(vault.kdf)) throw new Error('The server sent settings this app will not use.')
    const keys = await deriveKeys(passphrase, vault.salt, vault.kdf)
    if (!checks(keys, vault.check)) throw new Error('That passphrase does not match the one set on your other computer.')
    this.remember(keys, vault)
    await this.sync()
  }

  /** A forgotten passphrase: the server's copy goes, the keys on every computer stay. */
  async reset() {
    await this.call('DELETE', '/vault')
    this.forget()
    this.set({ phase: 'none', at: null, message: null })
  }

  /** One sync at a time; a request while one runs makes one more afterwards. */
  sync(): Promise<void> {
    if (!this.token) return Promise.resolve()
    if (this.running) {
      this.again = true
      return this.running
    }
    this.running = (async () => {
      do {
        this.again = false
        await this.once()
      } while (this.again && this.token)
    })().finally(() => {
      this.running = null
    })
    return this.running
  }

  private async once() {
    try {
      const { vault, items } = await this.call<{ vault: VaultInfo | null; items: VaultItem[] }>('GET', '/vault')
      const secret = this.clerk.vaultSecret()
      if (!vault) {
        this.forget()
        this.set({ phase: 'none', at: null, message: null })
        return
      }
      if (!secret || !this.keys || secret.check !== vault.check) {
        // A vault this computer has no key for, or one made again after a reset elsewhere.
        this.forget()
        this.set({ phase: 'locked', at: null, message: null })
        return
      }
      const keys = this.keys
      const removed = this.clerk.pendingRemovals()
      const sent = outgoing(keys, this.clerk.localKeys(), removed)
      const have = new Map(items.map((r) => [r.id, r]))
      const news = sent.some((s) => {
        const cur = have.get(s.id)
        return !cur || s.addedAt > cur.addedAt || (s.deletedAt !== null && (cur.deletedAt === null || s.deletedAt > cur.deletedAt))
      })
      let merged = items
      if (news) {
        try {
          merged = (await this.call<{ items: VaultItem[] }>('POST', '/vault/items', { check: secret.check, items: sent })).items
        } catch (err) {
          if (err instanceof HttpError && err.status === 409) {
            this.forget()
            this.set({ phase: err.body.vault ? 'locked' : 'none', at: null, message: null })
            return
          }
          throw err
        }
      }
      // Read this computer again: a key removed while the request was out must not come back.
      const pending = this.clerk.pendingRemovals()
      const { add, drop } = incoming(keys, this.clerk.localKeys(), merged)
      const fresh = add.filter((k) => !pending.some((r) => r.provider === k.provider && r.key === k.key))
      this.clerk.applySync(fresh, drop, news ? removed : [])
      this.set({ phase: 'on', at: Date.now(), message: null })
    } catch (err) {
      const message = err instanceof HttpError ? err.message : 'Could not reach the sync server. Keys sync when it answers.'
      console.warn('[keysync]', err instanceof Error ? err.message : err)
      this.set({ ...this.clerk.keySync(), message })
    }
  }

  private remember(keys: VaultKeys, vault: VaultInfo) {
    this.keys = keys
    this.clerk.setVaultSecret({ salt: vault.salt, kdf: vault.kdf, check: vault.check, enc: keys.enc.toString('base64'), id: keys.id.toString('base64') })
  }

  private forget() {
    this.keys = null
    if (this.clerk.vaultSecret()) this.clerk.setVaultSecret(null)
  }

  private set(s: AiKeySync) {
    this.clerk.setKeySync(s)
  }

  private async call<T = Record<string, unknown>>(method: 'GET' | 'POST' | 'DELETE', path: string, body?: unknown): Promise<T> {
    if (!this.token) throw new Error('Sign in under Account to sync keys.')
    let res: Response
    try {
      res = await fetch(`${this.apiUrl}${path}`, {
        method,
        headers: { Authorization: `Bearer ${this.token}`, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      })
    } catch {
      throw new Error('Could not reach the sync server.')
    }
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>
    if (!res.ok) throw new HttpError(res.status, data)
    return data as T
  }
}
