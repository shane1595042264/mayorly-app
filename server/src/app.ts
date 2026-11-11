import { createCipheriv, createDecipheriv, createHash, hkdfSync, randomBytes, randomInt } from 'node:crypto'
import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { pool } from './db.js'
import { buildFeed } from './feed.js'
import { issueToken, requireAuth, revokeAll, signInWithGoogle, userById, type AuthVars } from './auth.js'

// Routes. The server keeps no rules of the product: it stores one state document
// per account and tells a client when its copy is stale. Last writer wins, by
// revision: a PUT must carry the revision it was based on.

/** The whole state is one JSON document; a year of heavy use is about a megabyte. */
const STATE_LIMIT = 8 * 1024 * 1024

export const app = new Hono<{ Variables: AuthVars }>()

// No CORS on purpose: the clients are desktop apps calling from their main process. A browser
// page cannot use this API until an origin is allowed here by name.

// Sign-in attempts per address. Every credential is verified against Google anyway; this keeps
// a flood off that key set and off the users table.
const RATE_WINDOW_MS = 10 * 60_000
const RATE_MAX = 30
const attempts = new Map<string, { n: number; at: number }>()
/** Feed reads per address: a subscriber reads every few hours, a guesser would need millions. */
const FEED_MAX = 120
const feedReads = new Map<string, { n: number; at: number }>()
function limited(ip: string, table = attempts, max = RATE_MAX): boolean {
  const now = Date.now()
  if (table.size > 10_000) for (const [k, v] of table) if (now - v.at > RATE_WINDOW_MS) table.delete(k)
  const a = table.get(ip)
  if (!a || now - a.at > RATE_WINDOW_MS) {
    table.set(ip, { n: 1, at: now })
    return false
  }
  a.n++
  return a.n > max
}
const addressOf = (c: { req: { header: (n: string) => string | undefined } }) => c.req.header('x-forwarded-for')?.split(',')[0]?.trim() || c.req.header('x-real-ip') || 'local'

app.get('/health', async (c) => {
  await pool.query('SELECT 1')
  return c.json({ ok: true })
})

app.post('/auth/google', bodyLimit({ maxSize: 16 * 1024 }), async (c) => {
  if (limited(addressOf(c))) return c.json({ error: 'Too many sign-in attempts. Try again in a few minutes.' }, 429)
  const body = await c.req.json().catch(() => null) as { credential?: unknown } | null
  const credential = body?.credential
  if (typeof credential !== 'string' || credential.length > 8192) return c.json({ error: 'credential required' }, 400)
  const r = await signInWithGoogle(credential)
  if (!r.ok) return c.json({ error: r.error }, r.status)
  return c.json({ token: r.token, user: r.user })
})

app.get('/auth/me', requireAuth, async (c) => {
  const user = await userById(c.get('userId'))
  return c.json({ user })
})

/** A fresh 30 days for a session that is still good: the app asks before its token runs out. */
app.post('/auth/refresh', requireAuth, async (c) => {
  return c.json({ token: await issueToken(c.get('userId'), c.get('tokenVersion')) })
})

/** Every session of the account, this one included. */
app.post('/auth/signout-all', requireAuth, async (c) => {
  await revokeAll(c.get('userId'))
  return c.json({ ok: true })
})

/** The account and everything under it (the state document cascades). The token stops working at once. */
app.delete('/account', requireAuth, async (c) => {
  await pool.query('DELETE FROM users WHERE id = $1', [c.get('userId')])
  return c.json({ ok: true })
})

// Linking a phone. Google refuses sign-in inside an app's web view, and a native Google client
// would need its own registration, so a phone signs in through a computer that already is: the
// computer asks for a short code, the phone sends it back, and the phone gets its own session.
// The code is eight letters from an alphabet without look-alikes (about 40 bits), lives ten
// minutes, is spent on first use, and only its hash is stored. Claims are rate limited per address.

const LINK_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
const LINK_TTL_MS = 10 * 60_000
const linkClaims = new Map<string, { n: number; at: number }>()
const hashCode = (code: string) => createHash('sha256').update(code).digest('hex')
/** What a person types: case and spaces and dashes do not matter. */
const normalCode = (raw: string) => raw.toUpperCase().replace(/[^A-Z0-9]/g, '')

app.post('/auth/link', requireAuth, async (c) => {
  const userId = c.get('userId')
  const code = Array.from({ length: 8 }, () => LINK_ALPHABET[randomInt(LINK_ALPHABET.length)]).join('')
  const expiresAt = new Date(Date.now() + LINK_TTL_MS)
  // One live code per account: asking again replaces the last one.
  await pool.query('DELETE FROM link_codes WHERE user_id = $1 OR expires_at < now()', [userId])
  await pool.query('INSERT INTO link_codes (code_hash, user_id, expires_at) VALUES ($1, $2, $3)', [hashCode(code), userId, expiresAt])
  return c.json({ code, expiresAt: expiresAt.toISOString() })
})

app.post('/auth/link/claim', bodyLimit({ maxSize: 4 * 1024 }), async (c) => {
  if (limited(addressOf(c), linkClaims, 20)) return c.json({ error: 'Too many tries. Wait a few minutes.' }, 429)
  const body = await c.req.json().catch(() => null) as { code?: unknown } | null
  const code = typeof body?.code === 'string' ? normalCode(body.code) : ''
  if (code.length !== 8) return c.json({ error: 'That code is eight letters and numbers.' }, 400)
  const { rows } = await pool.query<{ user_id: string; token_version: number }>(
    `UPDATE link_codes l SET used_at = now() FROM users u
     WHERE l.code_hash = $1 AND l.used_at IS NULL AND l.expires_at > now() AND u.id = l.user_id
     RETURNING l.user_id, u.token_version`,
    [hashCode(code)],
  )
  const row = rows[0]
  if (!row) return c.json({ error: 'That code is wrong or has run out. Make a new one on your computer.' }, 400)
  const user = await userById(row.user_id)
  if (!user) return c.json({ error: 'That account no longer exists.' }, 400)
  return c.json({ token: await issueToken(row.user_id, row.token_version), user })
})

interface StateRow { revision: number; state: unknown; updated_at: Date; device: string | null }

app.get('/sync/state', requireAuth, async (c) => {
  const { rows } = await pool.query<StateRow>('SELECT revision, state, updated_at, device FROM states WHERE user_id = $1', [c.get('userId')])
  const row = rows[0]
  if (!row) return c.json({ revision: 0, state: null, updatedAt: null, device: null })
  // A client that already has this revision gets a short answer.
  const have = Number(c.req.query('have') ?? -1)
  if (have === row.revision) return c.json({ revision: row.revision, state: undefined, updatedAt: row.updated_at, device: row.device, unchanged: true })
  return c.json({ revision: row.revision, state: row.state, updatedAt: row.updated_at, device: row.device })
})

app.put('/sync/state', requireAuth, bodyLimit({ maxSize: STATE_LIMIT }), async (c) => {
  const body = await c.req.json().catch(() => null) as { baseRevision?: unknown; state?: unknown; device?: unknown } | null
  if (!body || typeof body.baseRevision !== 'number' || !body.state || typeof body.state !== 'object') return c.json({ error: 'baseRevision and state required' }, 400)
  const device = typeof body.device === 'string' ? body.device.slice(0, 80) : null
  const userId = c.get('userId')
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    // The user row is locked first: a FOR UPDATE on a states row that does not exist yet locks
    // nothing, and two first writes would both pass the revision check.
    await client.query('SELECT 1 FROM users WHERE id = $1 FOR UPDATE', [userId])
    const { rows } = await client.query<StateRow>('SELECT revision, state, updated_at, device FROM states WHERE user_id = $1 FOR UPDATE', [userId])
    const cur = rows[0]
    const curRev = cur?.revision ?? 0
    // A client on an older build must not replace a document a newer one wrote.
    const curSchema = (cur?.state as { schema?: unknown } | undefined)?.schema
    const newSchema = (body.state as { schema?: unknown }).schema
    if (typeof curSchema === 'number' && typeof newSchema === 'number' && newSchema < curSchema) {
      await client.query('ROLLBACK')
      return c.json({ error: 'older-schema', revision: curRev, state: cur?.state ?? null, updatedAt: cur?.updated_at ?? null, device: cur?.device ?? null }, 409)
    }
    if (curRev !== body.baseRevision) {
      await client.query('ROLLBACK')
      // Stale: here is the document that won. The client takes it, then pushes again.
      return c.json({ error: 'stale', revision: curRev, state: cur?.state ?? null, updatedAt: cur?.updated_at ?? null, device: cur?.device ?? null }, 409)
    }
    const next = curRev + 1
    await client.query(
      `INSERT INTO states (user_id, revision, state, device, updated_at) VALUES ($1, $2, $3, $4, now())
       ON CONFLICT (user_id) DO UPDATE SET revision = EXCLUDED.revision, state = EXCLUDED.state, device = EXCLUDED.device, updated_at = now()`,
      [userId, next, JSON.stringify(body.state), device],
    )
    await client.query('COMMIT')
    return c.json({ revision: next, updatedAt: new Date().toISOString() })
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {})
    throw err
  } finally {
    client.release()
  }
})

// The key vault: the user's AI keys, sealed on their computers before they arrive. The server
// keeps blobs it cannot open under ids it cannot reverse, and merges by id: every distinct key
// any computer sent is kept once, and a removal wins over an add that happened before it.

const VAULT_ID_RE = /^[A-Za-z0-9_-]{16,64}$/
const VAULT_TEXT_MAX = 4096
const VAULT_ITEMS_MAX = 200

interface VaultRow { salt: string; kdf: unknown; check_blob: string }
interface ItemRow { id: string; blob: string; added_at: string; deleted_at: string | null }
const vaultOut = (v: VaultRow) => ({ salt: v.salt, kdf: v.kdf, check: v.check_blob })
const itemOut = (r: ItemRow) => ({ id: r.id, blob: r.blob, addedAt: Number(r.added_at), deletedAt: r.deleted_at === null ? null : Number(r.deleted_at) })
const short = (v: unknown, max = VAULT_TEXT_MAX): v is string => typeof v === 'string' && v.length > 0 && v.length <= max

async function vaultOf(userId: string) {
  const { rows } = await pool.query<VaultRow>('SELECT salt, kdf, check_blob FROM key_vaults WHERE user_id = $1', [userId])
  return rows[0] ?? null
}

app.get('/vault', requireAuth, async (c) => {
  const userId = c.get('userId')
  const vault = await vaultOf(userId)
  if (!vault) return c.json({ vault: null, items: [] })
  const { rows } = await pool.query<ItemRow>('SELECT id, blob, added_at, deleted_at FROM vault_items WHERE user_id = $1', [userId])
  return c.json({ vault: vaultOut(vault), items: rows.map(itemOut) })
})

/** The first computer to set a passphrase makes the vault; a second gets the one that won. */
app.post('/vault', requireAuth, bodyLimit({ maxSize: 16 * 1024 }), async (c) => {
  const body = await c.req.json().catch(() => null) as { salt?: unknown; kdf?: unknown; check?: unknown } | null
  if (!body || !short(body.salt, 128) || !short(body.check) || !body.kdf || typeof body.kdf !== 'object' || JSON.stringify(body.kdf).length > 512) {
    return c.json({ error: 'salt, kdf and check required' }, 400)
  }
  const userId = c.get('userId')
  const { rows } = await pool.query<VaultRow>(
    `INSERT INTO key_vaults (user_id, salt, kdf, check_blob) VALUES ($1, $2, $3, $4)
     ON CONFLICT (user_id) DO NOTHING RETURNING salt, kdf, check_blob`,
    [userId, body.salt, JSON.stringify(body.kdf), body.check],
  )
  if (rows[0]) return c.json({ vault: vaultOut(rows[0]) })
  const existing = await vaultOf(userId)
  return c.json({ error: 'exists', vault: existing ? vaultOut(existing) : null }, 409)
})

// The vault's keys held by the server, so no device asks for a passphrase. A device that has the
// keys sends them once; the server checks they open this vault's check, then keeps them sealed
// under a key made from its own secret (HKDF of ESCROW_SECRET, else JWT_SECRET). Any signed-in
// device of the account gets them back. This trades the end-to-end promise for no passphrase:
// whoever runs the server could open the AI keys. The vault's own check still says which vault
// the keys are for, so keys for a vault made again elsewhere are refused.

const ESCROW_KEY = hkdfSync('sha256', process.env.ESCROW_SECRET ?? process.env.JWT_SECRET ?? 'dev-secret-change-in-production', 'mayorly', 'vault escrow v1', 32) as ArrayBuffer
const VAULT_CHECK = 'mayorly key vault v1'
const b64 = (s: string) => Buffer.from(s, 'base64')

function sealEscrow(text: string): string {
  const iv = randomBytes(12)
  const c = createCipheriv('aes-256-gcm', Buffer.from(ESCROW_KEY), iv)
  const body = Buffer.concat([c.update(text, 'utf8'), c.final()])
  return Buffer.concat([iv, body, c.getAuthTag()]).toString('base64url')
}
function openWith(key: Buffer, blob: string): string | null {
  try {
    const raw = Buffer.from(blob, 'base64url')
    if (raw.length < 28) return null
    const d = createDecipheriv('aes-256-gcm', key, raw.subarray(0, 12))
    d.setAuthTag(raw.subarray(raw.length - 16))
    return Buffer.concat([d.update(raw.subarray(12, raw.length - 16)), d.final()]).toString('utf8')
  } catch {
    return null
  }
}

app.get('/vault/escrow', requireAuth, async (c) => {
  const { rows } = await pool.query<{ blob: string }>('SELECT blob FROM vault_escrow WHERE user_id = $1', [c.get('userId')])
  const text = rows[0] ? openWith(Buffer.from(ESCROW_KEY), rows[0].blob) : null
  if (!text) return c.json({ keys: null })
  const keys = JSON.parse(text) as { enc: string; id: string }
  return c.json({ keys })
})

app.put('/vault/escrow', requireAuth, bodyLimit({ maxSize: 4 * 1024 }), async (c) => {
  const body = await c.req.json().catch(() => null) as { enc?: unknown; id?: unknown } | null
  if (!body || !short(body.enc, 128) || !short(body.id, 128)) return c.json({ error: 'enc and id required' }, 400)
  const enc = b64(body.enc as string)
  if (enc.length !== 32 || b64(body.id as string).length !== 32) return c.json({ error: 'bad keys' }, 400)
  const userId = c.get('userId')
  const vault = await vaultOf(userId)
  if (!vault) return c.json({ error: 'no vault' }, 409)
  // Only the keys that open this vault's check are kept: a device cannot plant someone else's.
  if (openWith(enc, vault.check_blob) !== VAULT_CHECK) return c.json({ error: 'keys do not open this vault' }, 409)
  await pool.query(
    `INSERT INTO vault_escrow (user_id, blob) VALUES ($1, $2) ON CONFLICT (user_id) DO UPDATE SET blob = EXCLUDED.blob, updated_at = now()`,
    [userId, sealEscrow(JSON.stringify({ enc: body.enc, id: body.id }))],
  )
  return c.json({ ok: true })
})

/** A forgotten passphrase: the vault and every key in it go. The keys on each computer stay there. */
app.delete('/vault', requireAuth, async (c) => {
  await pool.query('DELETE FROM key_vaults WHERE user_id = $1', [c.get('userId')])
  return c.json({ ok: true })
})

/**
 * Upsert by id. Each time only moves forward, so sending the same rows twice changes nothing
 * and the order two computers send them in does not matter. The check says which vault the
 * rows were sealed for: rows sealed for a vault that has since been reset are refused.
 */
app.post('/vault/items', requireAuth, bodyLimit({ maxSize: 512 * 1024 }), async (c) => {
  const body = await c.req.json().catch(() => null) as { check?: unknown; items?: unknown } | null
  if (!body || !short(body.check) || !Array.isArray(body.items) || body.items.length > VAULT_ITEMS_MAX) return c.json({ error: 'check and items required' }, 400)
  const ceiling = Date.now() + 60_000
  const time = (v: unknown) => (typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 ? Math.min(v, ceiling) : null)
  const items: { id: string; blob: string; addedAt: number; deletedAt: number | null }[] = []
  for (const raw of body.items as Record<string, unknown>[]) {
    const addedAt = time(raw?.addedAt)
    const deletedAt = raw?.deletedAt === null || raw?.deletedAt === undefined ? null : time(raw.deletedAt)
    if (!raw || typeof raw.id !== 'string' || !VAULT_ID_RE.test(raw.id) || !short(raw.blob) || addedAt === null || (raw.deletedAt != null && deletedAt === null)) {
      return c.json({ error: 'bad item' }, 400)
    }
    items.push({ id: raw.id, blob: raw.blob, addedAt, deletedAt })
  }
  const userId = c.get('userId')
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const { rows: vaults } = await client.query<VaultRow>('SELECT salt, kdf, check_blob FROM key_vaults WHERE user_id = $1 FOR UPDATE', [userId])
    const vault = vaults[0]
    if (!vault || vault.check_blob !== body.check) {
      await client.query('ROLLBACK')
      return c.json({ error: 'vault-changed', vault: vault ? vaultOut(vault) : null }, 409)
    }
    for (const it of items) {
      await client.query(
        `INSERT INTO vault_items (user_id, id, blob, added_at, deleted_at) VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (user_id, id) DO UPDATE SET
           blob = CASE WHEN EXCLUDED.added_at > vault_items.added_at THEN EXCLUDED.blob ELSE vault_items.blob END,
           added_at = GREATEST(vault_items.added_at, EXCLUDED.added_at),
           deleted_at = GREATEST(vault_items.deleted_at, EXCLUDED.deleted_at)`,
        [userId, it.id, it.blob, it.addedAt, it.deletedAt],
      )
    }
    const { rows } = await client.query<ItemRow>('SELECT id, blob, added_at, deleted_at FROM vault_items WHERE user_id = $1', [userId])
    if (rows.length > VAULT_ITEMS_MAX) {
      await client.query('ROLLBACK')
      return c.json({ error: 'too many keys' }, 413)
    }
    await client.query('COMMIT')
    return c.json({ items: rows.map(itemOut) })
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {})
    throw err
  } finally {
    client.release()
  }
})

// The plan as a calendar feed. The address carries a secret token in place of a sign-in,
// the way Google's own secret iCal address does: whoever has it can read the plan until it is
// rotated. One token per account, made on request, never derived from anything.

const FEED_TOKEN_RE = /^[A-Za-z0-9_-]{32}$/
const newFeedToken = () => randomBytes(24).toString('base64url')

app.get('/cal/feed', requireAuth, async (c) => {
  const { rows } = await pool.query<{ token: string }>('SELECT token FROM feed_tokens WHERE user_id = $1', [c.get('userId')])
  return c.json({ token: rows[0]?.token ?? null })
})

/** The account's feed token, made now if there is none. */
app.post('/cal/feed', requireAuth, async (c) => {
  const userId = c.get('userId')
  const { rows } = await pool.query<{ token: string }>(
    `INSERT INTO feed_tokens (user_id, token) VALUES ($1, $2)
     ON CONFLICT (user_id) DO UPDATE SET token = feed_tokens.token
     RETURNING token`,
    [userId, newFeedToken()],
  )
  return c.json({ token: rows[0].token })
})

/** A fresh token; the old address stops working at once. */
app.post('/cal/feed/rotate', requireAuth, async (c) => {
  const { rows } = await pool.query<{ token: string }>(
    `INSERT INTO feed_tokens (user_id, token, created_at) VALUES ($1, $2, now())
     ON CONFLICT (user_id) DO UPDATE SET token = EXCLUDED.token, created_at = now()
     RETURNING token`,
    [c.get('userId'), newFeedToken()],
  )
  return c.json({ token: rows[0].token })
})

app.delete('/cal/feed', requireAuth, async (c) => {
  await pool.query('DELETE FROM feed_tokens WHERE user_id = $1', [c.get('userId')])
  return c.json({ ok: true })
})

/** Public: the feed itself, by token. Unknown tokens and bad shapes answer alike. */
app.get('/cal/:file', async (c) => {
  if (limited(addressOf(c), feedReads, FEED_MAX)) return c.text('Too many requests', 429)
  const file = c.req.param('file')
  const token = file.endsWith('.ics') ? file.slice(0, -4) : ''
  if (!FEED_TOKEN_RE.test(token)) return c.text('Not found', 404)
  const { rows } = await pool.query<{ state: unknown }>(
    'SELECT s.state FROM feed_tokens f JOIN states s ON s.user_id = f.user_id WHERE f.token = $1', [token])
  const row = rows[0]
  if (!row) return c.text('Not found', 404)
  const body = buildFeed(row.state, new Date())
  c.header('Content-Type', 'text/calendar; charset=utf-8')
  c.header('Cache-Control', 'private, max-age=300')
  c.header('X-Robots-Tag', 'noindex')
  return c.body(body)
})

app.onError((err, c) => {
  console.error('[api]', err)
  return c.json({ error: 'Server error' }, 500)
})
