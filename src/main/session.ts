import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Session } from './auth'
import type { Seal } from './seal'

// The session token on disk, sealed (see seal.ts: the OS store, or the local key on a Mac).
// When nothing can seal it the token stays in memory for this run and nothing is written:
// a token in the clear on disk is worse than signing in again.

export class SessionStore {
  private readonly file: string

  constructor(dir: string, private readonly seal: Seal) {
    this.file = join(dir, 'session.bin')
  }

  load(): Session | null {
    try {
      if (!existsSync(this.file)) return null
      const opened = this.seal.open(readFileSync(this.file))
      if (!opened) return null
      const s = JSON.parse(opened.text) as Session
      const ok = s && typeof s.token === 'string' && s.user ? s : null
      if (ok && opened.reseal) this.save(ok)
      return ok
    } catch (err) {
      console.error('[session] could not read the saved sign-in:', err)
      return null
    }
  }

  save(s: Session) {
    if (!this.seal.available()) {
      console.warn('[session] nothing to seal with; the sign-in is kept for this run only')
      return
    }
    writeFileSync(this.file, this.seal.seal(JSON.stringify(s)))
  }

  clear() {
    try {
      if (existsSync(this.file)) unlinkSync(this.file)
    } catch (err) {
      console.error('[session] could not remove the saved sign-in:', err)
    }
  }
}
