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

/** The epoch of a wall-clock moment in a zone, found by correcting a UTC guess twice (enough across any DST change). */
export function zonedEpoch(tz: string, y: number, m: number, d: number, minutes: number): number {
  let guess = Date.UTC(y, m - 1, d, 0, 0) + minutes * 60_000
  for (let i = 0; i < 2; i++) {
    const w = wallClock(guess, tz)
    const have = Date.UTC(w.y, w.m - 1, w.d, 0, 0) + w.minutes * 60_000
    const want = Date.UTC(y, m - 1, d, 0, 0) + minutes * 60_000
    guess += want - have
  }
  return guess
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

export function machineZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone
}
