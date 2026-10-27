import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { firstRunState, migrate, type MayorlyState } from '@core/index'

// Local-first: one JSON file in the user's app data folder (AppData on Windows,
// Application Support on macOS), written atomically. Beside it, backups/: one copy a
// day (14 kept) and one before anything that replaces the whole state (a sync, an
// import; 6 kept). A save that cannot be read falls back to the newest backup that can.
// The spec's long-term target is SQLite; everything goes through this module
// so swapping the backend touches nothing else.

interface Saved {
  lastBeat: number | null
  state: MayorlyState
  /** Set when the save could not be read and this came from a backup. */
  restoredFrom?: string
}

const DAILY_KEEP = 14
const EVENT_KEEP = 6

export class Store {
  readonly file: string
  readonly backups: string
  private timer: NodeJS.Timeout | null = null
  private pending: Saved | null = null

  constructor(readonly dir: string) {
    mkdirSync(dir, { recursive: true })
    this.file = join(dir, 'mayorly.json')
    this.backups = join(dir, 'backups')
  }

  load(newId: () => string): Saved {
    if (!existsSync(this.file)) return { lastBeat: null, state: firstRunState(Date.now(), newId) }
    try {
      return this.read(this.file)
    } catch (err) {
      // Never overwrite something we could not read. Park it beside the new file.
      const parked = join(this.dir, `mayorly.unreadable-${Date.now()}.json`)
      try {
        renameSync(this.file, parked)
      } catch {
        // Leave it; the next save goes through the temp file and rename anyway.
      }
      console.error(`[store] could not read save, moved to ${parked}:`, err)
      for (const name of this.list()) {
        try {
          const saved = this.read(join(this.backups, name))
          console.warn(`[store] restored from backup ${name}`)
          return { ...saved, restoredFrom: name }
        } catch {
          // Try the next one.
        }
      }
      return { lastBeat: null, state: firstRunState(Date.now(), newId) }
    }
  }

  private read(path: string): Saved {
    const raw = JSON.parse(readFileSync(path, 'utf8')) as Partial<Saved>
    const state = migrate(raw.state)
    if (!state) throw new Error('unrecognised schema')
    return { lastBeat: raw.lastBeat ?? null, state }
  }

  save(state: MayorlyState, lastBeat: number | null) {
    this.pending = { state, lastBeat }
    if (this.timer) return
    this.timer = setTimeout(() => this.flush(), 400)
  }

  flush() {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    if (!this.pending) return
    const tmp = `${this.file}.tmp`
    try {
      writeFileSync(tmp, JSON.stringify(this.pending))
      renameSync(tmp, this.file)
      this.pending = null
    } catch (err) {
      console.error('[store] could not save:', err)
      return
    }
    this.daily()
  }

  /** A copy of the save as it is now, before something replaces the whole state. */
  backup(reason: string) {
    this.flush()
    if (!existsSync(this.file)) return
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    this.copy(`mayorly-${reason}-${stamp}.json`)
    this.prune(`mayorly-${reason}-`, EVENT_KEEP)
  }

  /** Backups, newest first. */
  list(): string[] {
    try {
      return readdirSync(this.backups).filter((n) => n.startsWith('mayorly-') && n.endsWith('.json')).sort().reverse()
    } catch {
      return []
    }
  }

  /** One copy a day, at the first save of the day. */
  private daily() {
    const d = new Date()
    const day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    const name = `mayorly-day-${day}.json`
    if (existsSync(join(this.backups, name))) return
    this.copy(name)
    this.prune('mayorly-day-', DAILY_KEEP)
  }

  private copy(name: string) {
    try {
      mkdirSync(this.backups, { recursive: true })
      copyFileSync(this.file, join(this.backups, name))
    } catch (err) {
      console.error('[store] could not write backup:', err)
    }
  }

  private prune(prefix: string, keep: number) {
    const old = this.list().filter((n) => n.startsWith(prefix)).slice(keep)
    for (const n of old) {
      try {
        unlinkSync(join(this.backups, n))
      } catch {
        // Next time.
      }
    }
  }
}
