import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'
import { autoUpdater } from 'electron-updater'
import { log } from './log'
import { installMacUpdates, signedWithDeveloperId } from './macupdate'

// Updates for the direct-download build: every push to main publishes a GitHub release, checked
// after launch and every half hour, downloaded quietly, installed when the user says so. The
// shell does the asking. The Mac App Store build updates through the store, and a Mac build
// without a Developer ID signature, which Squirrel refuses, updates through macupdate.ts.
// Failures are logged, never shown.

export interface Updates {
  /** The version downloaded and waiting, or null. */
  ready: () => string | null
  onReady: (fn: (version: string) => void) => void
  /** Set by the shell: what has to happen before the app goes down. */
  beforeInstall: (() => Promise<void>) | null
  install: () => Promise<void>
  /** An update put off at the last launch, to install before this one gets going (Mac). */
  atLaunch?: boolean
}

const CHECK_AFTER_MS = 30_000
const CHECK_EVERY_MS = 30 * 60_000

export function installUpdates(dataDir: string): Updates {
  let ready: string | null = null
  const subs = new Set<(version: string) => void>()
  const updates: Updates = {
    ready: () => ready,
    onReady: (fn) => void subs.add(fn),
    beforeInstall: null,
    install: async () => {
      await updates.beforeInstall?.()
      // Silent, and back up afterwards: the installer's own pages are for a first install.
      autoUpdater.quitAndInstall(true, true)
    },
  }
  // The portable Windows exe is packed from the same folder as the installer and so carries the
  // feed; left alone it would download the setup and run it on quit. Portable means portable.
  if (!app.isPackaged || process.mas || process.env.PORTABLE_EXECUTABLE_DIR) return updates
  // A Mac build without a Developer ID (every build until the certificate exists, and every
  // ship:mac) updates itself from the same releases: see macupdate.ts.
  if (process.platform === 'darwin' && !signedWithDeveloperId()) return installMacUpdates(dataDir)
  // A build installed by ship:mac carries no app-update.yml: there is no feed to ask.
  if (!existsSync(join(process.resourcesPath, 'app-update.yml'))) return updates
  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true
  autoUpdater.logger = null
  autoUpdater.on('error', (err) => console.warn('[updates]', err.message))
  autoUpdater.on('update-available', (info) => log.info('[updates] downloading', info.version))
  autoUpdater.on('update-downloaded', (info) => {
    log.info('[updates] ready', info.version)
    ready = info.version
    for (const fn of subs) fn(info.version)
  })
  const check = () => autoUpdater.checkForUpdates().catch((err: unknown) => console.warn('[updates]', err instanceof Error ? err.message : String(err)))
  setTimeout(() => void check(), CHECK_AFTER_MS)
  setInterval(() => void check(), CHECK_EVERY_MS)
  return updates
}
