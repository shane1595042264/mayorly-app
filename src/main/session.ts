import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { safeStorage } from 'electron'
import type { Session } from './auth'

// The session token on disk, encrypted with the OS keychain (Keychain on macOS,
// DPAPI on Windows) when that is available, which it is on both.

export class SessionStore {
  private readonly file: string

  constructor(dir: string) {
    this.file = join(dir, 'session.bin')
  }

  load(): Session | null {
    try {
      if (!existsSync(this.file)) return null
      const raw = readFileSync(this.file)
      const text = safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(raw) : raw.toString('utf8')
      const s = JSON.parse(text) as Session
      return s && typeof s.token === 'string' && s.user ? s : null
    } catch (err) {
      console.error('[session] could not read the saved sign-in:', err)
      return null
    }
  }

  save(s: Session) {
    const text = JSON.stringify(s)
    writeFileSync(this.file, safeStorage.isEncryptionAvailable() ? safeStorage.encryptString(text) : Buffer.from(text, 'utf8'))
  }

  clear() {
    try {
      if (existsSync(this.file)) unlinkSync(this.file)
    } catch (err) {
      console.error('[session] could not remove the saved sign-in:', err)
    }
  }
}
