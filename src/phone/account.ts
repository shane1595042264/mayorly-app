import { useSyncExternalStore } from 'react'
import type { Account, SyncStatus } from '../shared/bridge'
import { SyncClient, type SyncMark } from '../shared/sync-client'
import type { PhoneEngine } from './engine'
import { googleIdToken } from './google'
import { API_URL, hash, platformName, readJson, removeFile, writeJson } from './platform'

// The phone's account: Google sign-in through iOS's sheet (google.ts), or a one-time code made
// on a computer (Settings, Account, Link a phone); then the same sync loop the desktop runs. The token lives in the app's
// Library folder, which iOS encrypts while the phone is locked; there is nothing else secret here.

const SESSION = 'session.json'
const MARK = 'sync.json'

interface Session {
  token: string
  user: Account
}

interface View {
  account: Account | null
  sync: SyncStatus
}

let view: View = { account: null, sync: { phase: 'off', at: null, revision: 0 } }
const subs = new Set<() => void>()
const set = (patch: Partial<View>) => {
  view = { ...view, ...patch }
  subs.forEach((f) => f())
}

let client: SyncClient | null = null
let session: Session | null = null

/** Who else needs the session: the key vault rides the same sign-in. renewed: same account, new token. */
type TokenListener = (token: string | null, renewed: boolean) => void
const tokenListeners = new Set<TokenListener>()
export function onSessionToken(fn: TokenListener) {
  tokenListeners.add(fn)
  fn(session?.token ?? null, false)
}
const tellToken = (token: string | null, renewed = false) => tokenListeners.forEach((f) => f(token, renewed))

export const accountsAvailable = !!API_URL

export async function startAccount(engine: PhoneEngine): Promise<void> {
  if (!accountsAvailable || engine.scratch) return
  const mark = await readJson<SyncMark>(MARK)
  session = await readJson<Session>(SESSION)
  client = new SyncClient(engine, API_URL, {
    hash,
    loadMark: () => mark,
    saveMark: (m) => void writeJson(MARK, m).catch(() => {}),
    newDevice: () => `${platformName}-${crypto.randomUUID().slice(0, 8)}`,
  }, (sync) => set({ sync }))
  client.onExpired = () => void signOut()
  client.onRefreshed = (token) => {
    if (!session) return
    session = { ...session, token }
    void writeJson(SESSION, session)
    tellToken(token, true)
  }
  engine.onForeground = (front) => {
    if (front) client?.poke()
    else void client?.flush()
  }
  if (session) {
    set({ account: session.user })
    client.setSession(session.token)
  }
}

/** A sign-in the server accepted: the session is kept and syncing starts. */
async function signInWith(path: string, body: unknown): Promise<void> {
  if (!client) throw new Error('This build has no sync server.')
  const res = await fetch(`${API_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const data = (await res.json().catch(() => ({}))) as { token?: string; user?: Account; error?: string }
  if (!res.ok || !data.token || !data.user) throw new Error(data.error ?? `The server answered ${res.status}`)
  session = { token: data.token, user: { email: data.user.email, name: data.user.name, avatarUrl: data.user.avatarUrl } }
  await writeJson(SESSION, session)
  set({ account: session.user })
  client.setSession(session.token)
  tellToken(session.token)
}

/** Google, in iOS's sign-in sheet. */
export async function signInWithGoogle(): Promise<void> {
  await signInWith('/auth/google', { credential: await googleIdToken() })
}

/** The code from the computer, as typed: case, spaces and dashes do not matter. */
export async function linkWithCode(code: string): Promise<void> {
  await signInWith('/auth/link/claim', { code })
}

export async function signOut(): Promise<void> {
  session = null
  await removeFile(SESSION)
  client?.setSession(null)
  set({ account: null })
  tellToken(null)
}

export function useAccount(): View {
  return useSyncExternalStore((f) => {
    subs.add(f)
    return () => subs.delete(f)
  }, () => view)
}
