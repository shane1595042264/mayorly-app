// US federal holidays, by rule, on the day they are observed: one on a Saturday is kept the
// Friday before, one on a Sunday the Monday after (5 U.S.C. 6103). Days are YYYY-MM-DD.

export interface Holiday {
  day: string
  name: string
}

const pad = (n: number) => String(n).padStart(2, '0')
const key = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`
const weekdayOf = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d)).getUTCDay()

/** The day of the month of the nth weekday (0 Sunday) in a month; n -1 is the last. */
function nth(y: number, m: number, weekday: number, n: number): number {
  if (n > 0) {
    const first = weekdayOf(y, m, 1)
    return 1 + ((weekday - first + 7) % 7) + (n - 1) * 7
  }
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate()
  const last = weekdayOf(y, m, days)
  return days - ((last - weekday + 7) % 7)
}

/** A fixed date moved off the weekend. */
function observed(y: number, m: number, d: number): string {
  const w = weekdayOf(y, m, d)
  const t = Date.UTC(y, m - 1, d) + (w === 6 ? -1 : w === 0 ? 1 : 0) * 86_400_000
  const x = new Date(t)
  return key(x.getUTCFullYear(), x.getUTCMonth() + 1, x.getUTCDate())
}

const cache = new Map<number, Holiday[]>()

/** The holidays of a year, as observed. New Year's Day of the next year can be observed on December 31 of this one; `usHolidayOn` looks there too. */
export function usFederalHolidays(y: number): Holiday[] {
  const had = cache.get(y)
  if (had) return had
  const list: Holiday[] = [
    { day: observed(y, 1, 1), name: "New Year's Day" },
    { day: key(y, 1, nth(y, 1, 1, 3)), name: 'Martin Luther King Jr. Day' },
    { day: key(y, 2, nth(y, 2, 1, 3)), name: "Washington's Birthday" },
    { day: key(y, 5, nth(y, 5, 1, -1)), name: 'Memorial Day' },
    { day: observed(y, 6, 19), name: 'Juneteenth' },
    { day: observed(y, 7, 4), name: 'Independence Day' },
    { day: key(y, 9, nth(y, 9, 1, 1)), name: 'Labor Day' },
    { day: key(y, 10, nth(y, 10, 1, 2)), name: 'Columbus Day' },
    { day: observed(y, 11, 11), name: 'Veterans Day' },
    { day: key(y, 11, nth(y, 11, 4, 4)), name: 'Thanksgiving Day' },
    { day: observed(y, 12, 25), name: 'Christmas Day' },
  ]
  cache.set(y, list)
  return list
}

/** The holiday observed on a day, or null. */
export function usHolidayOn(day: string): string | null {
  const y = Number(day.slice(0, 4))
  if (!Number.isFinite(y)) return null
  for (const h of [...usFederalHolidays(y), ...usFederalHolidays(y + 1)]) if (h.day === day) return h.name
  return null
}
