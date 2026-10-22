import { createHash, randomBytes } from 'node:crypto'
import { createServer } from 'node:http'
import { shell } from 'electron'
import type { Account } from '../shared/bridge'
import { config } from './config'

// Google sign-in for a desktop app: the system browser does the consent, Google
// sends the code back to a one-shot loopback server here (PKCE), and the code is
// exchanged for an ID token, which mayorly-api turns into its own session token.
// The same contract as shanejli.com, with the browser swapped for the loopback.

export interface Session {
  token: string
  user: Account
}

const SCOPES = 'openid email profile'
const WAIT_MS = 5 * 60_000

const b64url = (b: Buffer) => b.toString('base64url')

function page(title: string, body: string) {
  return `<!doctype html><meta charset="utf-8"><title>${title}</title><body style="margin:0;display:grid;place-items:center;height:100vh;background:#0b0d0e;color:#edf0f1;font:16px/1.4 system-ui"><div style="text-align:center"><h1 style="font-weight:600;font-size:20px;margin:0 0 8px">${title}</h1><p style="color:#9aa0a3;margin:0">${body}</p></div>`
}

/** Opens the browser and resolves with the account once Google and the server agree. */
export async function signInWithGoogle(): Promise<Session> {
  if (!config.apiUrl || !config.googleClientId) throw new Error('Sign-in is not configured in this build')
  const verifier = b64url(randomBytes(32))
  const challenge = b64url(createHash('sha256').update(verifier).digest())
  const state = b64url(randomBytes(16))
  let redirectUri = ''

  const code = await new Promise<string>((resolve, reject) => {
    const server = createServer((req, res) => {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1')
      if (url.pathname !== '/callback') {
        res.writeHead(404).end()
        return
      }
      const err = url.searchParams.get('error')
      const got = url.searchParams.get('code')
      if (err || !got || url.searchParams.get('state') !== state) {
        res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' }).end(page('Sign-in did not complete', 'You can close this tab and try again from Mayorly.'))
        finish(new Error(err === 'access_denied' ? 'Sign-in was cancelled' : 'Sign-in did not complete'))
        return
      }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(page('Signed in to Mayorly', 'You can close this tab.'))
      finish(null, got)
    })
    const timer = setTimeout(() => finish(new Error('Sign-in timed out')), WAIT_MS)
    const finish = (e: Error | null, value?: string) => {
      clearTimeout(timer)
      server.close()
      if (e) reject(e)
      else resolve(value as string)
    }
    server.on('error', (e) => finish(e))
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address()
      const port = typeof addr === 'object' && addr ? addr.port : 0
      redirectUri = `http://127.0.0.1:${port}/callback`
      const auth = new URL('https://accounts.google.com/o/oauth2/v2/auth')
      auth.search = new URLSearchParams({
        client_id: config.googleClientId,
        redirect_uri: redirectUri,
        response_type: 'code',
        scope: SCOPES,
        code_challenge: challenge,
        code_challenge_method: 'S256',
        state,
        prompt: 'select_account',
      }).toString()
      void shell.openExternal(auth.toString())
    })
  })

  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: config.googleClientId,
      client_secret: config.googleClientSecret,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
      code_verifier: verifier,
    }),
  })
  const tokens = (await tokenRes.json().catch(() => ({}))) as { id_token?: string; error?: string }
  if (!tokenRes.ok || !tokens.id_token) throw new Error(`Google refused the sign-in (${tokens.error ?? tokenRes.status})`)

  const res = await fetch(`${config.apiUrl}/auth/google`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ credential: tokens.id_token }),
  })
  const data = (await res.json().catch(() => ({}))) as { token?: string; user?: Account & { id: string }; error?: string }
  if (!res.ok || !data.token || !data.user) throw new Error(data.error ?? `The sync server refused the sign-in (${res.status})`)
  return { token: data.token, user: { email: data.user.email, name: data.user.name, avatarUrl: data.user.avatarUrl } }
}
