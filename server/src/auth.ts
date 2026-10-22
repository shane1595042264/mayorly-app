import { createMiddleware } from 'hono/factory'
import { createRemoteJWKSet, jwtVerify, SignJWT } from 'jose'
import { pool } from './db.js'

// The same shape as shanejli.com: the client brings a Google ID token, the server
// verifies it against Google's live key set, finds or creates the user, and hands
// back its own 30-day JWT. Every other route takes that JWT as a bearer.

if (!process.env.JWT_SECRET && process.env.NODE_ENV === 'production') throw new Error('JWT_SECRET is required in production')
const JWT_SECRET = new TextEncoder().encode(process.env.JWT_SECRET ?? 'dev-secret-change-in-production')

/** Comma-separated: the desktop app's OAuth client, and any other client that may sign in. */
const AUDIENCES = (process.env.GOOGLE_CLIENT_IDS ?? '').split(',').map((s) => s.trim()).filter(Boolean)
const GOOGLE_JWKS = createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs'))

/** jose codes that mean the credential itself is bad; anything else is Google being unreachable. */
const INVALID = new Set([
  'ERR_JWS_SIGNATURE_VERIFICATION_FAILED', 'ERR_JWT_EXPIRED', 'ERR_JWT_CLAIM_VALIDATION_FAILED', 'ERR_JWT_INVALID',
  'ERR_JWS_INVALID', 'ERR_JWKS_NO_MATCHING_KEY', 'ERR_JWKS_MULTIPLE_MATCHING_KEYS', 'ERR_JOSE_ALG_NOT_ALLOWED',
  'ERR_JOSE_NOT_SUPPORTED', 'ERR_JWK_INVALID',
])

export interface User {
  id: string
  email: string
  name: string | null
  avatarUrl: string | null
}

export type GoogleResult = { ok: true; user: User; token: string } | { ok: false; status: 400 | 401 | 503; error: string }

export async function signInWithGoogle(credential: string): Promise<GoogleResult> {
  if (AUDIENCES.length === 0) return { ok: false, status: 503, error: 'Sign-in is not configured on this server' }
  let payload: Record<string, unknown>
  try {
    const r = await jwtVerify(credential, GOOGLE_JWKS, { issuer: ['https://accounts.google.com', 'accounts.google.com'], audience: AUDIENCES })
    payload = r.payload as Record<string, unknown>
  } catch (err) {
    const code = (err as { code?: string })?.code
    if (code && INVALID.has(code)) return { ok: false, status: 401, error: 'Invalid Google token' }
    console.error(`[auth] could not verify against Google's key set (code=${code ?? 'none'}):`, err)
    return { ok: false, status: 503, error: 'Could not reach Google to verify the sign-in. Try again.' }
  }
  const googleId = payload.sub as string | undefined
  const email = payload.email as string | undefined
  if (!googleId || !email) return { ok: false, status: 400, error: 'Invalid token payload' }
  const name = (payload.name as string | undefined) ?? null
  const avatarUrl = (payload.picture as string | undefined) ?? null

  const { rows } = await pool.query<{ id: string; email: string; name: string | null; avatar_url: string | null }>(
    `INSERT INTO users (google_id, email, name, avatar_url) VALUES ($1, $2, $3, $4)
     ON CONFLICT (google_id) DO UPDATE SET email = EXCLUDED.email, name = EXCLUDED.name, avatar_url = EXCLUDED.avatar_url, updated_at = now()
     RETURNING id, email, name, avatar_url`,
    [googleId, email, name, avatarUrl],
  )
  const row = rows[0]
  const user: User = { id: row.id, email: row.email, name: row.name, avatarUrl: row.avatar_url }
  const token = await new SignJWT({ userId: user.id, email: user.email })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('30d')
    .sign(JWT_SECRET)
  return { ok: true, user, token }
}

export async function userById(id: string): Promise<User | null> {
  const { rows } = await pool.query<{ id: string; email: string; name: string | null; avatar_url: string | null }>(
    'SELECT id, email, name, avatar_url FROM users WHERE id = $1', [id])
  const r = rows[0]
  return r ? { id: r.id, email: r.email, name: r.name, avatarUrl: r.avatar_url } : null
}

export type AuthVars = { userId: string }

export const requireAuth = createMiddleware<{ Variables: AuthVars }>(async (c, next) => {
  const header = c.req.header('Authorization')
  if (!header?.startsWith('Bearer ')) return c.json({ error: 'Authentication required' }, 401)
  try {
    const { payload } = await jwtVerify(header.slice(7).trim(), JWT_SECRET)
    const userId = payload.userId as string | undefined
    if (!userId) return c.json({ error: 'Authentication required' }, 401)
    c.set('userId', userId)
  } catch {
    return c.json({ error: 'Authentication required' }, 401)
  }
  await next()
})
