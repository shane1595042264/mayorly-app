import ical, { type CalendarResponse, type VEvent } from 'node-ical'
import type { ExternalEvent } from '@core/index'

// Parsed ICS into outside events: one per occurrence inside the window, recurring series
// expanded, exceptions honoured, titles kept or replaced by "Busy" as the feed asks. Pure,
// so it can be tested with a string; the fetching lives in feeds.ts.

export function parseIcs(text: string): CalendarResponse {
  return ical.sync.parseICS(text)
}

export function expandIcs(data: CalendarResponse, feedId: string, lo: number, hi: number, titles: boolean): ExternalEvent[] {
  const out: ExternalEvent[] = []
  const push = (uid: string, start: number, end: number, ev: VEvent) => {
    if (!(end > start) || end <= lo || start >= hi) return
    out.push({
      id: `${feedId}:${uid}:${start}`,
      feedId,
      title: titles ? String(ev.summary ?? 'Busy').slice(0, 120) || 'Busy' : 'Busy',
      start,
      end,
      allDay: ev.datetype === 'date',
      free: String(ev.transparency ?? '').toUpperCase() === 'TRANSPARENT',
    })
  }
  for (const item of Object.values(data)) {
    if (!item || item.type !== 'VEVENT') continue
    const ev = item as VEvent
    if (!(ev.start instanceof Date)) continue
    const start = ev.start.getTime()
    const end = ev.end instanceof Date ? ev.end.getTime() : start + (ev.datetype === 'date' ? 86_400_000 : 3_600_000)
    const dur = Math.max(0, end - start)
    const uid = String(ev.uid ?? start)
    if (!ev.rrule) {
      push(uid, start, end, ev)
      continue
    }
    const exdates = new Set(Object.values(ev.exdate ?? {}).map((d) => (d instanceof Date ? d.getTime() : NaN)))
    const overrides = ev.recurrences ?? {}
    let dates: Date[] = []
    try {
      dates = ev.rrule.between(new Date(lo - dur), new Date(hi), true)
    } catch {
      dates = []
    }
    for (const d of dates) {
      const t = d.getTime()
      if (exdates.has(t)) continue
      const key = d.toISOString().slice(0, 10)
      const o = overrides[key] as VEvent | undefined
      if (o && o.start instanceof Date) {
        const os = o.start.getTime()
        const oe = o.end instanceof Date ? o.end.getTime() : os + dur
        push(uid, os, oe, o)
      } else push(uid, t, t + dur, ev)
    }
    // Exceptions whose date moved out of the series' own dates still count once.
    for (const [key, o] of Object.entries(overrides)) {
      const ov = o as VEvent
      if (!(ov.start instanceof Date)) continue
      const os = ov.start.getTime()
      if (dates.some((d) => d.toISOString().slice(0, 10) === key)) continue
      push(uid, os, ov.end instanceof Date ? ov.end.getTime() : os + dur, ov)
    }
  }
  // One occurrence per id, sorted.
  const seen = new Set<string>()
  return out.filter((x) => (seen.has(x.id) ? false : (seen.add(x.id), true))).sort((a, b) => a.start - b.start).slice(0, 500)
}
