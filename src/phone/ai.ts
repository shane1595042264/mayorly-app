import { useSyncExternalStore } from 'react'
import type { AiPublic, ClerkNotice } from '../shared/bridge'
import { AiClerk, KeyCheckError } from '../shared/ai/service'
import { KeySync } from '../shared/ai/keysync'
import { makeCapture } from '../shared/capture'
import { onSessionToken } from './account'
import type { PhoneEngine } from './engine'
import { API_URL, readJson, writeJson } from './platform'

// The clerk on the phone: the same AiClerk, KeySync and capture as the computers. Keys come over
// from the computers through the key vault once the sync passphrase is typed here (the keys made
// from it are kept, never the passphrase), or are pasted here and go to the computers the same
// way. They live in ai.json in the app's Library folder, which iOS keeps encrypted while the
// phone is locked.

const FILE = 'ai.json'

interface View {
  ai: AiPublic | null
  notice: ClerkNotice | null
}
let view: View = { ai: null, notice: null }
const subs = new Set<() => void>()
const set = (patch: Partial<View>) => {
  view = { ...view, ...patch }
  subs.forEach((f) => f())
}
export const useClerk = () => useSyncExternalStore((f) => {
  subs.add(f)
  return () => subs.delete(f)
}, () => view)

let clerk: AiClerk | null = null
let keySync: KeySync | null = null
let capture: ReturnType<typeof makeCapture> | null = null

export async function startClerk(engine: PhoneEngine): Promise<void> {
  const saved = engine.scratch ? null : await readJson<{ text: string }>(FILE)
  clerk = new AiClerk({
    load: () => (saved?.text ? { text: saved.text } : null),
    available: () => !engine.scratch,
    save: (text) => void writeJson(FILE, { text }).catch((err) => console.error('[clerk] could not save the keys:', err)),
  }, (ai) => set({ ai }))
  keySync = new KeySync(API_URL, clerk)
  capture = makeCapture(engine, clerk, (notice) => set({ notice }))
  set({ ai: clerk.public() })
  onSessionToken((token, renewed) => (renewed ? keySync?.setToken(token!) : keySync?.setSession(token)))
}

/** A line typed or said into the inbox. With start, it goes on the desk at once. */
export async function captureLine(text: string, start = false): Promise<void> {
  if (!capture || !text.trim()) return
  await capture.captureLine(text.trim(), start)
}

export const sweepTray = () => capture?.sweepTray()
export const clerkEnabled = () => clerk?.enabled() ?? false

const plain = (err: unknown) => {
  const m = err instanceof KeyCheckError ? err.message : err instanceof Error ? err.message : String(err)
  return m.replace(/^Error: /, '')
}

export async function addKey(raw: string): Promise<void> {
  if (!clerk) return
  try {
    await clerk.addKey(raw)
  } catch (err) {
    throw new Error(plain(err))
  }
}
export const removeKey = (id: string) => clerk?.removeKey(id)
export const recheckKey = (id: string) => clerk?.recheckKey(id)

/** The sync passphrase set on a computer, typed here once: the computers' keys come over. */
export async function unlockKeys(passphrase: string): Promise<void> {
  if (!keySync) return
  try {
    await keySync.unlock(passphrase)
  } catch (err) {
    throw new Error(plain(err))
  }
}
/** No computer has set one yet: the phone chooses it. */
export async function setupKeys(passphrase: string): Promise<void> {
  if (!keySync) return
  try {
    await keySync.setup(passphrase)
  } catch (err) {
    throw new Error(plain(err))
  }
}
export const syncKeys = () => keySync?.sync()
export const clearNotice = () => set({ notice: null })
