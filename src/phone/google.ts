import { Capacitor, registerPlugin } from '@capacitor/core'

// Google sign-in on the phone, the way Google wants a native app to do it: the authorization
// code flow with PKCE, opened in iOS's own sign-in sheet (AuthSession.swift), with the iOS
// client's reversed id as the redirect scheme. Google answers with a code, the code becomes an
// ID token, and the token goes to mayorly-api's /auth/google exactly as the desktop's does. An
// iOS client has no secret; PKCE is what keeps the code safe.

/** The iOS OAuth client in the Mayorly Google Cloud project (bundle id app.mayorly). Public by design. */
export const IOS_CLIENT_ID = '278519450073-70amt9m33q4phhc6qq4h3t2m8emebb65.apps.googleusercontent.com'

interface AuthSession {
  start(options: { url: string; callbackScheme: string }): Promise<{ url: string }>
}
const AuthSession = registerPlugin<AuthSession>('AuthSession')

/** This install has the sign-in sheet (an older app over the air would not) and a client to use. */
export const googleAvailable = () => Capacitor.isPluginAvailable('AuthSession') && IOS_CLIENT_ID.endsWith('.apps.googleusercontent.com')

const b64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const random = (n: number) => b64url(crypto.getRandomValues(new Uint8Array(n)))

/** Google's ID token for the account the person picks. Throws 'cancelled' when they close the sheet. */
export async function googleIdToken(): Promise<string> {
  const scheme = `com.googleusercontent.apps.${IOS_CLIENT_ID.replace(/\.apps\.googleusercontent\.com$/, '')}`
  const redirect = `${scheme}:/oauth2redirect`
  const verifier = random(32)
  const challenge = b64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))))
  const state = random(16)
  const auth = new URL('https://accounts.google.com/o/oauth2/v2/auth')
  auth.search = new URLSearchParams({
    client_id: IOS_CLIENT_ID,
    redirect_uri: redirect,
    response_type: 'code',
    scope: 'openid email profile',
    code_challenge: challenge,
    code_challenge_method: 'S256',
    state,
    prompt: 'select_account',
  }).toString()

  let back: string
  try {
    back = (await AuthSession.start({ url: auth.toString(), callbackScheme: scheme })).url
  } catch (err) {
    if ((err as { code?: string }).code === 'CANCELLED') throw new Error('cancelled')
    throw err
  }
  const params = new URL(back).searchParams
  if (params.get('state') !== state) throw new Error('Sign-in did not complete')
  if (params.get('error')) throw new Error(params.get('error') === 'access_denied' ? 'cancelled' : 'Google refused the sign-in')
  const code = params.get('code')
  if (!code) throw new Error('Sign-in did not complete')

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ code, client_id: IOS_CLIENT_ID, redirect_uri: redirect, grant_type: 'authorization_code', code_verifier: verifier }).toString(),
  })
  const tokens = (await res.json().catch(() => ({}))) as { id_token?: string; error?: string }
  if (!res.ok || !tokens.id_token) throw new Error(`Google refused the sign-in (${tokens.error ?? res.status})`)
  return tokens.id_token
}
