import { scryptAsync } from '@noble/hashes/scrypt.js'
import type { AiProvider } from '../bridge'
import { AI_PROVIDERS } from './detect'

// The key vault's cryptography, pure and testable. AI keys sync between a user's computers
// sealed with a key made from their sync passphrase, which never leaves the computer: the
// server holds blobs it cannot open. scrypt turns the passphrase and the vault's salt into 64
// bytes: the first half seals (AES-256-GCM), the second names (HMAC-SHA256). A key's name is
// the HMAC of the key itself, so the same key typed on two computers is one row on the server,
// and without the passphrase the name says nothing about the key.
//
// One implementation for every platform: WebCrypto for AES-GCM and HMAC (Node and every web view
// have it) and @noble/hashes for scrypt, which WebCrypto lacks. The bytes are the same as the
// first, Node-only version made (vault.fixture.json holds its output and the tests hold this to it),
// so a vault set up on any computer opens on the phone.

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
  enc: Uint8Array
  id: Uint8Array
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

const subtle = () => globalThis.crypto.subtle
const utf8 = new TextEncoder()
const fromUtf8 = new TextDecoder()

function b64url(bytes: Uint8Array): string {
  let s = ''
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
function fromB64(s: string): Uint8Array {
  const std = s.replace(/-/g, '+').replace(/_/g, '/')
  return Uint8Array.from(atob(std + '='.repeat((4 - (std.length % 4)) % 4)), (c) => c.charCodeAt(0))
}
/** Standard base64 with padding, as the keys are kept in ai.bin; fromBase64 reads either alphabet. */
export function toBase64(bytes: Uint8Array): string {
  const u = b64url(bytes).replace(/-/g, '+').replace(/_/g, '/')
  return u + '='.repeat((4 - (u.length % 4)) % 4)
}
export const fromBase64 = fromB64

export const newSalt = () => b64url(globalThis.crypto.getRandomValues(new Uint8Array(16)))

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

export async function deriveKeys(passphrase: string, salt: string, kdf: Kdf): Promise<VaultKeys> {
  const out = await scryptAsync(utf8.encode(normal(passphrase)), fromB64(salt), { N: kdf.N, r: kdf.r, p: kdf.p, dkLen: 64, maxmem: 256 * kdf.N * kdf.r + 1024 * 1024 })
  return { enc: out.slice(0, 32), id: out.slice(32, 64) }
}

const aes = (keys: VaultKeys) => subtle().importKey('raw', keys.enc as BufferSource, 'AES-GCM', false, ['encrypt', 'decrypt'])

/** Nonce, ciphertext and tag in one base64url string. */
export async function seal(keys: VaultKeys, text: string): Promise<string> {
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12))
  // WebCrypto returns the ciphertext with the 16-byte tag after it, as the first version wrote it.
  const body = new Uint8Array(await subtle().encrypt({ name: 'AES-GCM', iv }, await aes(keys), utf8.encode(text)))
  const out = new Uint8Array(12 + body.length)
  out.set(iv)
  out.set(body, 12)
  return b64url(out)
}

/** Null for a blob sealed with another key, or changed on the way. */
export async function open(keys: VaultKeys, blob: string): Promise<string | null> {
  try {
    const raw = fromB64(blob)
    if (raw.length < 12 + 16) return null
    const plain = await subtle().decrypt({ name: 'AES-GCM', iv: raw.slice(0, 12) }, await aes(keys), raw.slice(12))
    return fromUtf8.decode(plain)
  } catch {
    return null
  }
}

export const makeCheck = (keys: VaultKeys) => seal(keys, CHECK)
export const checks = async (keys: VaultKeys, check: string) => (await open(keys, check)) === CHECK

/** The key's name on the server. */
export async function keyId(keys: VaultKeys, provider: AiProvider, key: string): Promise<string> {
  const hmac = await subtle().importKey('raw', keys.id as BufferSource, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  return b64url(new Uint8Array(await subtle().sign('HMAC', hmac, utf8.encode(`${provider}\n${key}`)))).slice(0, 32)
}

export function sealKey(keys: VaultKeys, provider: AiProvider, key: string): Promise<string> {
  return seal(keys, JSON.stringify({ provider, key }))
}

export async function openKey(keys: VaultKeys, blob: string): Promise<{ provider: AiProvider; key: string } | null> {
  const text = await open(keys, blob)
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
export async function outgoing(keys: VaultKeys, local: LocalKey[], removed: LocalRemoval[]): Promise<VaultItem[]> {
  const rows = new Map<string, VaultItem>()
  for (const k of local) {
    const id = await keyId(keys, k.provider, k.key)
    rows.set(id, { id, blob: await sealKey(keys, k.provider, k.key), addedAt: k.addedAt, deletedAt: null })
  }
  for (const r of removed) {
    const id = await keyId(keys, r.provider, r.key)
    const row = rows.get(id)
    // An add of 0 never moves the server's add time, so a removal can only ever remove.
    rows.set(id, { id, blob: row?.blob ?? (await sealKey(keys, r.provider, r.key)), addedAt: row?.addedAt ?? 0, deletedAt: r.at })
  }
  return [...rows.values()]
}

export const live = (it: Pick<VaultItem, 'addedAt' | 'deletedAt'>) => it.deletedAt === null || it.addedAt > it.deletedAt

/**
 * What the server's merged rows mean for this computer: keys to add (live there, missing
 * here) and keys to drop (removed there after this computer added them). Rows that do not
 * open with this vault's key are skipped.
 */
export async function incoming(keys: VaultKeys, local: LocalKey[], rows: VaultItem[]): Promise<{ add: LocalKey[]; drop: LocalKey[] }> {
  const here = new Map<string, LocalKey>()
  for (const k of local) here.set(await keyId(keys, k.provider, k.key), k)
  const add: LocalKey[] = []
  const drop: LocalKey[] = []
  for (const row of rows) {
    const mine = here.get(row.id)
    if (live(row)) {
      if (mine) continue
      const k = await openKey(keys, row.blob)
      if (k && (await keyId(keys, k.provider, k.key)) === row.id) add.push({ ...k, addedAt: row.addedAt })
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
