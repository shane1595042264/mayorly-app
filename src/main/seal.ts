import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { safeStorage } from 'electron'

// How secrets rest on disk: the sign-in (session.bin) and the AI keys (ai.bin).
//
// Windows and Linux: Electron's safeStorage (DPAPI, the keyring), which never asks.
// macOS: safeStorage is the keychain, and the keychain ties its Always Allow to a partition
// list that, for an app without an Apple team identifier, holds one cdhash per build. A
// self-signed certificate cannot carry a team identifier, so every ship asked for the login
// password again. There the seal is a per-machine key in the data folder (seal.key, 0600) with
// AES-256-GCM: the same reach as the state file beside it, and never a prompt. Files the
// keychain sealed before are opened one last time, which may ask once, and resealed.

const MAGIC = Buffer.from('MYS1')
const IV = 12
const TAG = 16

export class Seal {
  private key: Buffer | null = null

  constructor(
    private readonly dir: string,
    /** True on macOS: the local key. Elsewhere safeStorage. */
    private readonly local = process.platform === 'darwin',
  ) {}

  /** Whether anything can be sealed at all. On a Mac always; elsewhere when the OS store is up. */
  available(): boolean {
    return this.local || safeStorage.isEncryptionAvailable()
  }

  seal(text: string): Buffer {
    if (!this.local) return safeStorage.encryptString(text)
    const key = this.loadKey()
    const iv = randomBytes(IV)
    const c = createCipheriv('aes-256-gcm', key, iv)
    const ct = Buffer.concat([c.update(text, 'utf8'), c.final()])
    return Buffer.concat([MAGIC, iv, c.getAuthTag(), ct])
  }

  /** The text, and whether to write it again: it came through the keychain and should move to the local seal. */
  open(raw: Buffer): { text: string; reseal: boolean } | null {
    if (raw.length > MAGIC.length + IV + TAG && raw.subarray(0, MAGIC.length).equals(MAGIC)) {
      const key = this.loadKey()
      const iv = raw.subarray(MAGIC.length, MAGIC.length + IV)
      const tag = raw.subarray(MAGIC.length + IV, MAGIC.length + IV + TAG)
      const ct = raw.subarray(MAGIC.length + IV + TAG)
      const d = createDecipheriv('aes-256-gcm', key, iv)
      d.setAuthTag(tag)
      return { text: Buffer.concat([d.update(ct), d.final()]).toString('utf8'), reseal: false }
    }
    if (!safeStorage.isEncryptionAvailable()) return null
    return { text: safeStorage.decryptString(raw), reseal: this.local }
  }

  private loadKey(): Buffer {
    if (this.key) return this.key
    const file = join(this.dir, 'seal.key')
    if (existsSync(file)) {
      const k = readFileSync(file)
      if (k.length === 32) return (this.key = k)
    }
    const k = randomBytes(32)
    writeFileSync(file, k, { mode: 0o600 })
    try {
      chmodSync(file, 0o600)
    } catch {
      // Not every file system has modes.
    }
    return (this.key = k)
  }
}
