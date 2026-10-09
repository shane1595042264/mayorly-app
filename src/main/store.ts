import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { firstRunState, migrate, type MayorlyState } from '@core/index'

// Local-first: one JSON file in the user's AppData, written atomically.
// The spec's long-term target is SQLite; everything goes through this module
// so swapping the backend touches nothing else.

interface Saved {
  lastBeat: number | null
  state: MayorlyState
}

export class Store {
  readonly file: string
  private timer: NodeJS.Timeout | null = null
  private pending: Saved | null = null

  constructor(readonly dir: string) {
    mkdirSync(dir, { recursive: true })
    this.file = join(dir, 'mayorly.json')
  }

  load(newId: () => string): Saved {
    if (!existsSync(this.file)) return { lastBeat: null, state: firstRunState(Date.now(), newId) }
    try {
      const raw = JSON.parse(readFileSync(this.file, 'utf8')) as Partial<Saved>
      const state = migrate(raw.state)
      if (!state) throw new Error('unrecognised schema')
      return { lastBeat: raw.lastBeat ?? null, state }
    } catch (err) {
      // Never overwrite something we could not read. Park it beside the new file.
      const parked = join(this.dir, `mayorly.unreadable-${Date.now()}.json`)
      renameSync(this.file, parked)
      console.error(`[store] could not read save, moved to ${parked}:`, err)
      return { lastBeat: null, state: firstRunState(Date.now(), newId) }
    }
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
    writeFileSync(tmp, JSON.stringify(this.pending))
    renameSync(tmp, this.file)
    this.pending = null
  }
}
