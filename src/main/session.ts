import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { safeStorage } from 'electron'
import type { Session } from './auth'

// The session token on disk, encrypted with the OS keychain (Keychain on macOS, DPAPI on
// Windows). When the keychain is not available the token stays in memory for this run and
// nothing is written: a token in the clear on disk is worse than signing in again.

export class SessionStore {
  private readonly file: string

  constructor(dir: string) {
    this.file = join(dir, 'session.bin')
  }

  load(): Session | null {
    try {
      if (!existsSync(this.file)) return null
      const raw = readFileSync(this.file)
      if (!safeStorage.isEncryptionAvailable()) return null
      const s = JSON.parse(safeStorage.decryptString(raw)) as Session
      return s && typeof s.token === 'string' && s.user ? s : null
    } catch (err) {
      console.error('[session] could not read the saved sign-in:', err)
      return null
    }
  }

  save(s: Session) {
    if (!safeStorage.isEncryptionAvailable()) {
      console.warn('[session] the keychain is not available; the sign-in is kept for this run only')
      return
    }
    writeFileSync(this.file, safeStorage.encryptString(JSON.stringify(s)))
  }

  clear() {
    try {
      if (existsSync(this.file)) unlinkSync(this.file)
    } catch (err) {
      console.error('[session] could not remove the saved sign-in:', err)
    }
  }
}
