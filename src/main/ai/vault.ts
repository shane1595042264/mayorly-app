import { createCipheriv, createDecipheriv, createHmac, randomBytes, scrypt } from 'node:crypto'
import type { AiProvider } from '../../shared/bridge'
import { AI_PROVIDERS } from './detect'

// The key vault's cryptography, pure and testable. AI keys sync between a user's computers
// sealed with a key made from their sync passphrase, which never leaves the computer: the
// server holds blobs it cannot open. scrypt turns the passphrase and the vault's salt into 64
// bytes: the first half seals (AES-256-GCM), the second names (HMAC-SHA256). A key's name is
// the HMAC of the key itself, so the same key typed on two computers is one row on the server,
// and without the passphrase the name says nothing about the key.

export interface Kdf {
  name: 'scrypt'
  N: number
  r: number
  p: number
}

/** About a third of a second and 128 MB per guess: a stolen vault is slow to attack. */
export const KDF: Kdf = { name: 'scrypt', N: 2 ** 17, r: 8, p: 1 }
export const PASSPHRASE_MIN = 10
const CHECK = 'mayorly key vault v1'

export interface VaultKeys {
  enc: Buffer
  id: Buffer
}

/** The vault as the server keeps it. */
export interface VaultInfo {
  salt: string
  kdf: Kdf
  check: string
}

/** One key as the server keeps it. Live while addedAt is later than deletedAt. */
export interface VaultItem {
  id: string
  blob: string
  addedAt: number
  deletedAt: number | null
}

export const newSalt = () => randomBytes(16).toString('base64url')

/**
 * Settings from the server are checked before use: a server that sent weak ones would make
 * the passphrase cheap to guess, huge ones would hang the app.
 */
export function kdfOk(k: unknown): k is Kdf {
  const v = k as Partial<Kdf> | null
  return !!v && v.name === 'scrypt' && Number.isInteger(v.N) && v.N! >= 2 ** 15 && v.N! <= 2 ** 20 && (v.N! & (v.N! - 1)) === 0
    && Number.isInteger(v.r) && v.r! >= 8 && v.r! <= 16 && Number.isInteger(v.p) && v.p! >= 1 && v.p! <= 4
}

/** The passphrase as typed, in one Unicode form so the same words make the same key on any keyboard. */
const normal = (passphrase: string) => passphrase.normalize('NFKC')

export function deriveKeys(passphrase: string, salt: string, kdf: Kdf): Promise<VaultKeys> {
  return new Promise((resolve, reject) => {
    scrypt(normal(passphrase), Buffer.from(salt, 'base64url'), 64, { N: kdf.N, r: kdf.r, p: kdf.p, maxmem: 256 * kdf.N * kdf.r + 1024 * 1024 }, (err, out) => {
      if (err) reject(err)
      else resolve({ enc: out.subarray(0, 32), id: out.subarray(32, 64) })
    })
  })
}

/** Nonce, ciphertext and tag in one base64url string. */
export function seal(keys: VaultKeys, text: string): string {
  const iv = randomBytes(12)
  const c = createCipheriv('aes-256-gcm', keys.enc, iv)
  const body = Buffer.concat([c.update(text, 'utf8'), c.final()])
  return Buffer.concat([iv, body, c.getAuthTag()]).toString('base64url')
}

/** Null for a blob sealed with another key, or changed on the way. */
export function open(keys: VaultKeys, blob: string): string | null {
  try {
    const raw = Buffer.from(blob, 'base64url')
    if (raw.length < 12 + 16) return null
    const d = createDecipheriv('aes-256-gcm', keys.enc, raw.subarray(0, 12))
    d.setAuthTag(raw.subarray(raw.length - 16))
    return Buffer.concat([d.update(raw.subarray(12, raw.length - 16)), d.final()]).toString('utf8')
  } catch {
    return null
  }
}

export const makeCheck = (keys: VaultKeys) => seal(keys, CHECK)
export const checks = (keys: VaultKeys, check: string) => open(keys, check) === CHECK

/** The key's name on the server. */
export function keyId(keys: VaultKeys, provider: AiProvider, key: string): string {
  return createHmac('sha256', keys.id).update(`${provider}\n${key}`).digest('base64url').slice(0, 32)
}

export function sealKey(keys: VaultKeys, provider: AiProvider, key: string): string {
  return seal(keys, JSON.stringify({ provider, key }))
}

export function openKey(keys: VaultKeys, blob: string): { provider: AiProvider; key: string } | null {
  const text = open(keys, blob)
  if (!text) return null
  try {
    const j = JSON.parse(text) as { provider?: unknown; key?: unknown }
    if (typeof j.key !== 'string' || !j.key || !AI_PROVIDERS.includes(j.provider as AiProvider)) return null
    return { provider: j.provider as AiProvider, key: j.key }
  } catch {
    return null
  }
}

/** A key on this computer: added at a time, or removed at one and not yet told to the server. */
export interface LocalKey {
  provider: AiProvider
  key: string
  addedAt: number
}
export interface LocalRemoval {
  provider: AiProvider
  key: string
  at: number
}

/** Everything this computer knows, as rows to upsert. Sending them all every time is safe. */
export function outgoing(keys: VaultKeys, local: LocalKey[], removed: LocalRemoval[]): VaultItem[] {
  const rows = new Map<string, VaultItem>()
  for (const k of local) rows.set(keyId(keys, k.provider, k.key), { id: keyId(keys, k.provider, k.key), blob: sealKey(keys, k.provider, k.key), addedAt: k.addedAt, deletedAt: null })
  for (const r of removed) {
    const id = keyId(keys, r.provider, r.key)
    const row = rows.get(id)
    // An add of 0 never moves the server's add time, so a removal can only ever remove.
    rows.set(id, { id, blob: row?.blob ?? sealKey(keys, r.provider, r.key), addedAt: row?.addedAt ?? 0, deletedAt: r.at })
  }
  return [...rows.values()]
}

export const live = (it: Pick<VaultItem, 'addedAt' | 'deletedAt'>) => it.deletedAt === null || it.addedAt > it.deletedAt

/**
 * What the server's merged rows mean for this computer: keys to add (live there, missing
 * here) and keys to drop (removed there after this computer added them). Rows that do not
 * open with this vault's key are skipped.
 */
export function incoming(keys: VaultKeys, local: LocalKey[], rows: VaultItem[]): { add: LocalKey[]; drop: LocalKey[] } {
  const here = new Map(local.map((k) => [keyId(keys, k.provider, k.key), k]))
  const add: LocalKey[] = []
  const drop: LocalKey[] = []
  for (const row of rows) {
    const mine = here.get(row.id)
    if (live(row)) {
      if (mine) continue
      const k = openKey(keys, row.blob)
      if (k && keyId(keys, k.provider, k.key) === row.id) add.push({ ...k, addedAt: row.addedAt })
    } else if (mine && row.deletedAt !== null && row.deletedAt >= mine.addedAt) {
      drop.push(mine)
    }
  }
  return { add, drop }
}

/** The server's merge, for tests: the same rule as the upsert in server/src/app.ts. */
export function mergeRows(server: VaultItem[], sent: VaultItem[]): VaultItem[] {
  const out = new Map(server.map((r) => [r.id, { ...r }]))
  for (const s of sent) {
    const cur = out.get(s.id)
    if (!cur) {
      out.set(s.id, { ...s })
      continue
    }
    const newer = s.addedAt > cur.addedAt
    out.set(s.id, {
      id: s.id,
      blob: newer ? s.blob : cur.blob,
      addedAt: Math.max(cur.addedAt, s.addedAt),
      deletedAt: cur.deletedAt === null ? s.deletedAt : s.deletedAt === null ? cur.deletedAt : Math.max(cur.deletedAt, s.deletedAt),
    })
  }
  return [...out.values()]
}
