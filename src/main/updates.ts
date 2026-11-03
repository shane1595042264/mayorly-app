import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'
import { autoUpdater } from 'electron-updater'

// Updates for the direct-download build: GitHub releases, checked after launch and every six
// hours, downloaded quietly, installed when the user says so from the menu bar. The Mac App
// Store build updates through the store, and a Mac build without a Developer ID signature
// cannot be updated at all (Squirrel refuses it), so failures here are logged, never shown.

export interface Updates {
  /** The version downloaded and waiting, or null. */
  ready: () => string | null
  onReady: (fn: (version: string) => void) => void
  install: () => void
}

const CHECK_AFTER_MS = 30_000
const CHECK_EVERY_MS = 6 * 3_600_000

export function installUpdates(): Updates {
  let ready: string | null = null
  const subs = new Set<(version: string) => void>()
  const updates: Updates = {
    ready: () => ready,
    onReady: (fn) => void subs.add(fn),
    install: () => autoUpdater.quitAndInstall(),
  }
  // The portable Windows exe is packed from the same folder as the installer and so carries the
  // feed; left alone it would download the setup and run it on quit. Portable means portable.
  if (!app.isPackaged || process.mas || process.env.PORTABLE_EXECUTABLE_DIR) return updates
  // A build installed by ship:mac carries no app-update.yml: there is no feed to ask.
  if (!existsSync(join(process.resourcesPath, 'app-update.yml'))) return updates
  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true
  autoUpdater.logger = null
  autoUpdater.on('error', (err) => console.warn('[updates]', err.message))
  autoUpdater.on('update-downloaded', (info) => {
    ready = info.version
    for (const fn of subs) fn(info.version)
  })
  const check = () => autoUpdater.checkForUpdates().catch((err: unknown) => console.warn('[updates]', err instanceof Error ? err.message : String(err)))
  setTimeout(() => void check(), CHECK_AFTER_MS)
  setInterval(() => void check(), CHECK_EVERY_MS)
  return updates
}
