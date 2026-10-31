import type { CalendarSettings, Interval } from '../core/model'

// Work hours as absolute intervals, expanded in the calendar's own zone with Intl, so two
// machines in different places agree on the same windows. Outside core on purpose: core
// knows epochs, not wall clocks. A missing or unknown zone falls back to this machine's.

const DAY = 86_400_000

function zoneOf(tz: string): string {
  try {
    return new Intl.DateTimeFormat('en-US', { timeZone: tz || undefined }).resolvedOptions().timeZone
  } catch {
    return Intl.DateTimeFormat().resolvedOptions().timeZone
  }
}

/** Year, month, day, weekday and minutes since midnight of an epoch, in a zone. */
export function wallClock(t: number, tz: string): { y: number; m: number; d: number; weekday: number; minutes: number } {
  const f = new Intl.DateTimeFormat('en-US', { timeZone: zoneOf(tz), hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', weekday: 'short' })
  const parts = Object.fromEntries(f.formatToParts(t).filter((p) => p.type !== 'literal').map((p) => [p.type, p.value]))
  const weekday = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(parts.weekday)
  return { y: Number(parts.year), m: Number(parts.month), d: Number(parts.day), weekday, minutes: Number(parts.hour) * 60 + Number(parts.minute) }
}

/** Wall time to epoch: use the earlier occurrence of a repeated time, and move gaps forward. */
export function zonedEpoch(tz: string, y: number, m: number, d: number, minutes: number): number {
  const want = Date.UTC(y, m - 1, d) + minutes * 60_000
  const wallEpoch = (t: number) => {
    const w = wallClock(t, tz)
    return Date.UTC(w.y, w.m - 1, w.d) + w.minutes * 60_000
  }
  // Offsets on both sides of a transition give both candidates. A missing midnight must
  // resolve to the first instant of the new day, not the previous evening.
  const offsets = new Set([-DAY, 0, DAY].map((delta) => wallEpoch(want + delta) - (want + delta)))
  const candidates = [...offsets].map((offset) => want - offset).sort((a, b) => a - b)
  return candidates.find((t) => wallEpoch(t) === want)
    ?? candidates.find((t) => wallEpoch(t) > want)
    ?? candidates[candidates.length - 1]
}

/** Midnight of the day `t` falls in, in the zone. */
export function startOfDayIn(t: number, tz: string): number {
  const w = wallClock(t, tz)
  return zonedEpoch(tz, w.y, w.m, w.d, 0)
}

/** The windows from the day of `from` through `days` days, absolute, sorted; the planner clips them to its horizon. */
export function windowsFor(cal: CalendarSettings, from: number, days: number): Interval[] {
  const out: Interval[] = []
  let day = startOfDayIn(from, cal.tz)
  for (let i = 0; i < days + 1; i++) {
    const w = wallClock(day + DAY / 2, cal.tz)
    for (const h of cal.hours[w.weekday] ?? []) {
      const start = zonedEpoch(cal.tz, w.y, w.m, w.d, h.start)
      const end = zonedEpoch(cal.tz, w.y, w.m, w.d, h.end)
      if (end > start) out.push({ start, end })
    }
    day = startOfDayIn(day + DAY + DAY / 2, cal.tz)
  }
  return out.sort((a, b) => a.start - b.start)
}

/** Where the plan ends: the end of the last of `horizonDays` days, today the first. */
export function horizonEndFor(cal: CalendarSettings, now: number): number {
  const days = Math.max(1, Math.round(cal.horizonDays) || 1)
  let day = startOfDayIn(now, cal.tz)
  for (let i = 0; i < days; i++) day = startOfDayIn(day + DAY + DAY / 2, cal.tz)
  return day
}

export function machineZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone
}
