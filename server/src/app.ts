import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { cors } from 'hono/cors'
import { pool } from './db.js'
import { requireAuth, signInWithGoogle, userById, type AuthVars } from './auth.js'

// Routes. The server keeps no rules of the product: it stores one state document
// per account and tells a client when its copy is stale. Last writer wins, by
// revision: a PUT must carry the revision it was based on.

/** The whole state is one JSON document; a year of heavy use is about a megabyte. */
const STATE_LIMIT = 8 * 1024 * 1024

export const app = new Hono<{ Variables: AuthVars }>()

app.use('*', cors({ origin: '*', allowHeaders: ['Authorization', 'Content-Type'], allowMethods: ['GET', 'PUT', 'POST', 'OPTIONS'] }))

app.get('/health', async (c) => {
  await pool.query('SELECT 1')
  return c.json({ ok: true })
})

app.post('/auth/google', bodyLimit({ maxSize: 16 * 1024 }), async (c) => {
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
    const { rows } = await client.query<StateRow>('SELECT revision, state, updated_at, device FROM states WHERE user_id = $1 FOR UPDATE', [userId])
    const cur = rows[0]
    const curRev = cur?.revision ?? 0
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
