import { spawn, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { accessSync, constants, createWriteStream, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { app, net } from 'electron'
import { BUILD } from '../shared/build'
import { log } from './log'
import { parseFeed, pickZip, shouldOffer, type MacFeed } from './macfeed'
import type { Updates } from './updates'

// Updates for a Mac build without a Developer ID. Squirrel refuses those, so this does what it
// would: read the release feed, download the zip for this Mac, check its sha512 against the
// feed, unpack it, check the app inside is Mayorly and its signature holds, and keep it ready.
// Installing is a small shell script that waits for this process to exit, puts the new bundle
// where the old one was, and opens it. The asking (Update now or Later, never over a running
// focus block) is the shell's, as on Windows. Later installs on the next launch, not on quit:
// ship:mac quits the app too, and two installs racing for one bundle could leave neither. A
// build installed meanwhile is newer than the release, so the staged one is simply dropped.

const REPO = 'shane1595042264/mayorly-app'
const FEED = `https://github.com/${REPO}/releases/latest/download/mayorly-mac.yml`
const CHECK_AFTER_MS = 30_000
const CHECK_EVERY_MS = 30 * 60_000

/** The running bundle: …/Mayorly.app, three levels above Contents/MacOS/Mayorly. */
export const bundlePath = () => resolve(process.execPath, '../../..')

/** Whether this build carries a Developer ID signature, which electron-updater can handle itself. */
export function signedWithDeveloperId(): boolean {
  const r = spawnSync('codesign', ['-dv', '--verbose=2', bundlePath()], { encoding: 'utf8' })
  return /Authority=Developer ID Application/.test(`${r.stderr}${r.stdout}`)
}

// Waits for the app to exit, copies the new bundle in beside the old, swaps them, and opens the
// result. Every step is logged to update.log in the data folder; a failure keeps the old app.
const SWAP = `
pid=$1; new=$2; dest=$3; out=$4
exec >>"$out" 2>&1
say() { echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) $*"; }
reopen() { open "$dest"; exit "$1"; }
say "waiting for $pid to quit"
i=0
while kill -0 "$pid" 2>/dev/null; do
  i=$((i+1)); [ $i -gt 300 ] && { say "the app did not quit in a minute; not updating"; exit 1; }
  sleep 0.2
done
tmp="$dest.updating"; old="$dest.previous"
rm -rf "$tmp" "$old"
ditto "$new" "$tmp" || { say "copy failed; keeping the old app"; rm -rf "$tmp"; reopen 1; }
xattr -dr com.apple.quarantine "$tmp" 2>/dev/null
mv "$dest" "$old" || { say "could not move the old app; keeping it"; rm -rf "$tmp"; reopen 1; }
if mv "$tmp" "$dest"; then rm -rf "$old"; say "installed $new"; else mv "$old" "$dest"; say "swap failed; old app restored"; fi
reopen 0
`

export function installMacUpdates(dataDir: string): Updates {
  const root = join(dataDir, 'updates')
  let ready: string | null = null
  let staged: string | null = null
  let busy = false
  let installing = false
  const subs = new Set<(version: string) => void>()

  const swap = () => {
    if (!staged || installing) return
    installing = true
    log.info('[updates] installing', ready)
    const child = spawn('/bin/sh', ['-c', SWAP, 'mayorly-update', String(process.pid), staged, bundlePath(), join(dataDir, 'logs', 'update.log')], { detached: true, stdio: 'ignore' })
    child.unref()
  }

  const updates: Updates = {
    ready: () => ready,
    onReady: (fn) => void subs.add(fn),
    beforeInstall: null,
    install: async () => {
      if (!staged) return
      await updates.beforeInstall?.()
      swap()
      app.quit()
    },
  }

  // Somewhere this process can replace itself: not a disk image, not a translocated copy.
  const bundle = bundlePath()
  try {
    if (!bundle.endsWith('.app') || bundle.startsWith('/Volumes/') || bundle.includes('/AppTranslocation/')) throw new Error(`runs from ${bundle}`)
    accessSync(dirname(bundle), constants.W_OK)
    accessSync(bundle, constants.W_OK)
  } catch (err) {
    log.info('[updates] off:', err instanceof Error ? err.message : String(err))
    return updates
  }
  // What an earlier launch left: an update put off with Later is installed now, unless this
  // build is already newer; anything else there is the leftover of an install and goes.
  const meta = join(root, 'staged.json')
  try {
    const left = JSON.parse(readFileSync(meta, 'utf8')) as { feed: MacFeed; app: string }
    if (existsSync(left.app) && shouldOffer(left.feed, BUILD)) {
      staged = left.app
      ready = left.feed.version
      updates.atLaunch = true
      log.info('[updates] installing', ready, 'put off at the last launch')
      return updates
    }
  } catch {
    // Nothing staged.
  }
  rmSync(root, { recursive: true, force: true })

  const check = async () => {
    if (busy || staged) return
    busy = true
    try {
      const res = await net.fetch(FEED, { cache: 'no-store' })
      if (!res.ok) {
        if (res.status !== 404) console.warn('[updates] feed', res.status)
        return
      }
      const feed = parseFeed(await res.text())
      if (!feed || !shouldOffer(feed, BUILD)) return
      const file = pickZip(feed, process.arch)
      if (!file) return
      log.info('[updates] downloading', feed.version)
      const dir = join(root, feed.version)
      rmSync(root, { recursive: true, force: true })
      mkdirSync(dir, { recursive: true })
      const zip = join(dir, file.url)
      const got = await net.fetch(`https://github.com/${REPO}/releases/download/v${feed.version}/${file.url}`, { cache: 'no-store' })
      if (!got.ok || !got.body) throw new Error(`download ${got.status}`)
      const hash = createHash('sha512')
      let size = 0
      const tap = new Transform({
        transform(chunk: Buffer, _enc, done) {
          hash.update(chunk)
          size += chunk.length
          done(null, chunk)
        },
      })
      await pipeline(Readable.fromWeb(got.body as import('node:stream/web').ReadableStream), tap, createWriteStream(zip))
      if (hash.digest('base64') !== file.sha512 || (file.size && size !== file.size)) throw new Error('the download does not match the feed')
      if (spawnSync('ditto', ['-x', '-k', zip, dir]).status !== 0) throw new Error('could not unpack the zip')
      rmSync(zip, { force: true })
      const appDir = join(dir, 'Mayorly.app')
      if (!existsSync(appDir)) throw new Error('no Mayorly.app in the zip')
      const id = spawnSync('codesign', ['-dv', appDir], { encoding: 'utf8' })
      if (!/Identifier=app\.mayorly\b/.test(`${id.stderr}${id.stdout}`)) throw new Error('the app in the zip is not Mayorly')
      if (spawnSync('codesign', ['--verify', '--deep', '--strict', appDir]).status !== 0) throw new Error('the app in the zip fails its signature check')
      staged = appDir
      ready = feed.version
      writeFileSync(meta, JSON.stringify({ feed, app: appDir }))
      log.info('[updates] ready', feed.version)
      for (const fn of subs) fn(feed.version)
    } catch (err) {
      console.warn('[updates]', err instanceof Error ? err.message : String(err))
      rmSync(root, { recursive: true, force: true })
    } finally {
      busy = false
    }
  }

  setTimeout(() => void check(), CHECK_AFTER_MS)
  setInterval(() => void check(), CHECK_EVERY_MS)
  return updates
}
