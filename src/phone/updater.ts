import { useSyncExternalStore } from 'react'
import { CapacitorHttp, WebView } from '@capacitor/core'
import { Directory, Filesystem } from '@capacitor/filesystem'
import { unzipSync } from 'fflate'
import { BUILD } from '../shared/build'
import { native } from './platform'

// Updates to the phone's web layer, without a reinstall. Every push to main publishes the
// built web layer with the desktop release (mayorly-phone.zip and its manifest). The app reads
// the manifest after launch and every half hour on screen, downloads a newer bundle, checks its
// sha256, unpacks it where Capacitor serves live bundles from, and switches to it the next time
// it launches or comes back after a while away. A switch is a trial: the new bundle must boot
// and say so (markBooted) before it is kept; a bundle that never boots is dropped at the next
// launch, which comes up on the last good one. A bundle built for other native plugins (shell)
// waits for an app install. A new app install starts from its own built-in bundle again.

const REPO = 'shane1595042264/mayorly-app'
const MANIFEST = `https://github.com/${REPO}/releases/latest/download/mayorly-phone.json`
/** Capacitor iOS serves a persisted bundle from Library/NoCloud/ionic_built_snapshots/<name>. */
const SNAPSHOTS = 'NoCloud/ionic_built_snapshots'
const KEY = 'mayorly.ota'
const CHECK_EVERY_MS = 30 * 60_000
/** Away this long, coming back is a fine moment to switch. */
const AWAY_MS = 60_000

export const SHELL: string = __PHONE_SHELL__

interface Manifest {
  version: string
  commit: string
  shell: string
  file: string
  sha256: string
  builtAt: number
}

interface Staged {
  commit: string
  version: string
  path: string
  /** The native shell it was built for, and when: checked again at launch against this install. */
  shell?: string
  builtAt?: number
}

interface Ota {
  staged?: Staged
  trial?: Staged
  bad: string[]
}

export type UpdatePhase = 'off' | 'idle' | 'checking' | 'downloading' | 'ready' | 'current' | 'install' | 'error'
interface View {
  phase: UpdatePhase
  version?: string
  message?: string
  at?: number
}

let view: View = { phase: native ? 'idle' : 'off' }
const subs = new Set<() => void>()
const set = (v: View) => {
  view = v
  subs.forEach((f) => f())
}
export const useUpdates = () => useSyncExternalStore((f) => {
  subs.add(f)
  return () => subs.delete(f)
}, () => view)

const mine = BUILD.commit.replace(/\+$/, '')

function load(): Ota {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<Ota>
    return { staged: raw.staged, trial: raw.trial, bad: Array.isArray(raw.bad) ? raw.bad.slice(-20) : [] }
  } catch {
    return { bad: [] }
  }
}
const save = (o: Ota) => {
  try {
    localStorage.setItem(KEY, JSON.stringify(o))
  } catch {
    // Storage refused: the next launch simply checks again.
  }
}

/**
 * At launch, before anything renders: a bundle staged by the last session goes in now.
 * Returns true when the page is about to reload into it.
 */
export function applyStagedAtLaunch(): boolean {
  if (!native) return false
  const o = load()
  if (!o.staged || o.trial) return false
  // Downloaded under an earlier install, or older than the bundle this install came with: it
  // would roll the app back, so it goes.
  if (o.staged.shell !== SHELL || (o.staged.builtAt ?? 0) <= BUILD.builtAt) {
    delete o.staged
    save(o)
    return false
  }
  void apply(o)
  return true
}

async function apply(o: Ota) {
  const staged = o.staged
  if (!staged) return
  o.trial = staged
  delete o.staged
  save(o)
  // This session only; persisted once the new bundle has booted.
  await WebView.setServerBasePath({ path: staged.path })
}

/** The app is on screen and working: a bundle on trial is kept, one that never got here is dropped. */
export function markBooted() {
  if (!native) return
  const o = load()
  if (o.trial) {
    if (o.trial.commit === mine) void WebView.persistServerBasePath().catch(() => {})
    else o.bad.push(o.trial.commit)
    delete o.trial
    save(o)
  }
  void prune(o)
  // Coming back after a while is a quiet moment to switch to a downloaded bundle.
  let hiddenAt = 0
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') hiddenAt = Date.now()
    else if (hiddenAt && Date.now() - hiddenAt > AWAY_MS) {
      const cur = load()
      if (cur.staged) void apply(cur)
      else void checkForUpdate()
    }
  })
  setInterval(() => {
    if (document.visibilityState === 'visible') void checkForUpdate()
  }, CHECK_EVERY_MS)
}

/** Snapshots that are neither running nor staged go. */
async function prune(o: Ota) {
  try {
    const keep = new Set([mine, o.staged?.commit].filter(Boolean))
    const dir = await Filesystem.readdir({ path: SNAPSHOTS, directory: Directory.Library })
    for (const f of dir.files) if (!keep.has(f.name.replace(/\.zip$/, ''))) await Filesystem.rmdir({ path: `${SNAPSHOTS}/${f.name}`, directory: Directory.Library, recursive: true }).catch(() => {})
  } catch {
    // No snapshots yet.
  }
}

const b64ToBytes = (b64: string) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
function bytesToB64(bytes: Uint8Array): string {
  let s = ''
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(s)
}
const hex = (buf: ArrayBuffer) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')

let busy = false

export async function checkForUpdate(): Promise<void> {
  if (!native || busy) return
  const o = load()
  if (o.staged) return set({ phase: 'ready', version: o.staged.version })
  busy = true
  set({ ...view, phase: 'checking' })
  try {
    const res = await CapacitorHttp.get({ url: MANIFEST, responseType: 'json' })
    if (res.status === 404) return set({ phase: 'current', at: Date.now() })
    if (res.status !== 200) throw new Error(`manifest ${res.status}`)
    const m = (typeof res.data === 'string' ? JSON.parse(res.data) : res.data) as Manifest
    if (!m?.commit || !m.file) throw new Error('the manifest is not one')
    if (m.commit === mine || mine.startsWith(m.commit) || o.bad.includes(m.commit) || m.builtAt <= BUILD.builtAt) return set({ phase: 'current', at: Date.now() })
    if (m.shell !== SHELL) return set({ phase: 'install', version: m.version, at: Date.now() })
    set({ phase: 'downloading', version: m.version })
    const zip = await CapacitorHttp.get({ url: `https://github.com/${REPO}/releases/download/v${m.version}/${m.file}`, responseType: 'arraybuffer' })
    if (zip.status !== 200 || typeof zip.data !== 'string') throw new Error(`download ${zip.status}`)
    const bytes = b64ToBytes(zip.data)
    if (hex(await crypto.subtle.digest('SHA-256', bytes)) !== m.sha256) throw new Error('the download does not match its manifest')
    const files = unzipSync(bytes)
    if (!files['index.html']) throw new Error('no index.html in the bundle')
    const root = `${SNAPSHOTS}/${m.commit}`
    await Filesystem.rmdir({ path: root, directory: Directory.Library, recursive: true }).catch(() => {})
    for (const [name, data] of Object.entries(files)) {
      if (name.endsWith('/')) continue
      await Filesystem.writeFile({ path: `${root}/${name}`, data: bytesToB64(data), directory: Directory.Library, recursive: true })
    }
    const uri = (await Filesystem.getUri({ path: root, directory: Directory.Library })).uri
    o.staged = { commit: m.commit, version: m.version, path: decodeURIComponent(uri.replace(/^file:\/\//, '')), shell: m.shell, builtAt: m.builtAt }
    save(o)
    set({ phase: 'ready', version: m.version, at: Date.now() })
  } catch (err) {
    set({ phase: 'error', message: err instanceof Error ? err.message : String(err), at: Date.now() })
  } finally {
    busy = false
  }
}

/** Settings: switch to the downloaded bundle now. */
export function restartIntoUpdate() {
  const o = load()
  if (o.staged) void apply(o)
}
