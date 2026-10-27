import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { pool } from './db.js'
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
function limited(ip: string): boolean {
  const now = Date.now()
  if (attempts.size > 10_000) for (const [k, v] of attempts) if (now - v.at > RATE_WINDOW_MS) attempts.delete(k)
  const a = attempts.get(ip)
  if (!a || now - a.at > RATE_WINDOW_MS) {
    attempts.set(ip, { n: 1, at: now })
    return false
  }
  a.n++
  return a.n > RATE_MAX
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

app.onError((err, c) => {
  console.error('[api]', err)
  return c.json({ error: 'Server error' }, 500)
})
