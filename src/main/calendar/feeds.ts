import { randomUUID } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { powerMonitor } from 'electron'
import type { Engine } from '../engine'
import type { Seal } from '../seal'
import { expandIcs, parseIcs } from './ics'

// Outside calendars, read as busy time: the user's Google calendar through its secret
// address in iCal format. The addresses live in cal.bin beside the save, sealed like the AI
// keys, never in state and never synced; the events read from them do enter the state (as
// "Busy" when the feed keeps titles out) so the plan on another machine sees them too. Read
// at launch, every fifteen minutes, on waking and on request. Nothing is ever written back.

const EVERY_MS = 15 * 60_000
const DAY = 86_400_000
const FETCH_MS = 20_000

interface Source {
  id: string
  url: string
}

export class Feeds {
  private readonly file: string
  private sources: Source[] = []

  constructor(private readonly engine: Engine, private readonly seal: Seal, dataDir: string) {
    this.file = join(dataDir, 'cal.bin')
    this.load()
  }

  start() {
    setInterval(() => void this.refresh(), EVERY_MS)
    powerMonitor.on('resume', () => void this.refresh())
    setTimeout(() => void this.refresh(), 4_000)
  }

  /** Adds a source after one successful read, so a bad address never lands. */
  async add(url: string, label: string, titles: boolean): Promise<{ ok: boolean; message: string }> {
    const u = url.trim()
    if (!/^https:\/\/\S+$/i.test(u)) return { ok: false, message: 'Paste the https address of the calendar, the secret iCal one from Google Calendar settings.' }
    if (this.sources.some((s) => s.url === u)) return { ok: false, message: 'That calendar is already here.' }
    const read = await this.fetch(u)
    if ('error' in read) return { ok: false, message: read.error }
    const id = randomUUID()
    this.engine.dispatch({ type: 'calendar/feed-add', id, label: label.trim() || 'Google', titles })
    if (!this.engine.state.calendar.feeds.some((f) => f.id === id)) return { ok: false, message: 'Could not add it: eight calendars at most.' }
    this.sources.push({ id, url: u })
    this.save()
    this.apply(id, read.text)
    return { ok: true, message: `Read ${this.engine.state.calendar.external.filter((x) => x.feedId === id).length} events.` }
  }

  remove(id: string) {
    this.sources = this.sources.filter((s) => s.id !== id)
    this.save()
    this.engine.dispatch({ type: 'calendar/feed-remove', id })
  }

  async refresh(onlyId?: string) {
    // Sources whose feed is gone from the state (removed on another machine) are dropped here too.
    const live = new Set(this.engine.state.calendar.feeds.map((f) => f.id))
    const before = this.sources.length
    this.sources = this.sources.filter((s) => live.has(s.id))
    if (this.sources.length !== before) this.save()
    for (const s of this.sources) {
      if (onlyId && s.id !== onlyId) continue
      const read = await this.fetch(s.url)
      if ('error' in read) {
        const f = this.engine.state.calendar.feeds.find((x) => x.id === s.id)
        const kept = this.engine.state.calendar.external.filter((x) => x.feedId === s.id)
        this.engine.dispatch({ type: 'calendar/external', feedId: s.id, events: kept, fetchedAt: f?.lastFetchedAt ?? Date.now(), error: read.error })
      } else this.apply(s.id, read.text)
    }
  }

  private apply(id: string, text: string) {
    const f = this.engine.state.calendar.feeds.find((x) => x.id === id)
    if (!f) return
    const now = Date.now()
    const horizon = now + (this.engine.state.settings.calendar.horizonDays + 7) * DAY
    let events
    try {
      events = expandIcs(parseIcs(text), id, now - DAY, horizon, f.titles)
    } catch (err) {
      this.engine.dispatch({ type: 'calendar/external', feedId: id, events: this.engine.state.calendar.external.filter((x) => x.feedId === id), fetchedAt: f.lastFetchedAt ?? now, error: `Could not read that calendar: ${err instanceof Error ? err.message : String(err)}` })
      return
    }
    this.engine.dispatch({ type: 'calendar/external', feedId: id, events, fetchedAt: now, error: null })
  }

  private async fetch(url: string): Promise<{ text: string } | { error: string }> {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_MS), headers: { Accept: 'text/calendar, */*' } })
      if (res.status === 404 || res.status === 401 || res.status === 403 || res.status === 410) return { error: 'This address no longer works. Google may have reset it; paste the new one from Calendar settings.' }
      if (!res.ok) return { error: `The calendar answered ${res.status}; keeping the last read.` }
      const text = await res.text()
      if (!/BEGIN:VCALENDAR/i.test(text)) return { error: 'That address did not return a calendar.' }
      return { text }
    } catch (err) {
      return { error: `Could not reach the calendar (${err instanceof Error ? err.message : String(err)}); keeping the last read.` }
    }
  }

  private load() {
    try {
      if (!existsSync(this.file)) return
      const opened = this.seal.open(readFileSync(this.file))
      if (!opened) return
      const d = JSON.parse(opened.text) as { sources?: Source[] }
      this.sources = Array.isArray(d.sources) ? d.sources.filter((s) => s && typeof s.id === 'string' && typeof s.url === 'string') : []
      if (opened.reseal) this.save()
    } catch (err) {
      console.error('[calendar] could not read the calendar addresses:', err)
    }
  }

  private save() {
    try {
      if (!this.seal.available()) return
      writeFileSync(this.file, this.seal.seal(JSON.stringify({ sources: this.sources })))
    } catch (err) {
      console.error('[calendar] could not save the calendar addresses:', err)
    }
  }
}
