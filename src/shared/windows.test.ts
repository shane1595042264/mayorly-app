import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS } from '../core/seed'
import type { CalendarSettings } from '../core/model'
import { usFederalHolidays, usHolidayOn } from './holidays'
import { dayKey, horizonEndFor, startOfDayIn, wallClock, windowsFor, workOn, workWindowsFor, zonedEpoch } from './windows'

const HOUR = 3_600_000
const calendar = (tz: string, horizonDays = 1) => ({ ...DEFAULT_SETTINGS.calendar, tz, horizonDays })

describe('calendar day boundaries', () => {
  it('ends at midnight after the last day, counting today first', () => {
    const now = Date.parse('2026-10-30T20:00:00Z')
    expect(horizonEndFor(calendar('America/Chicago'), now)).toBe(Date.parse('2026-10-31T05:00:00Z'))
    expect(horizonEndFor(calendar('America/Chicago', 2), now)).toBe(Date.parse('2026-11-01T05:00:00Z'))
    expect(horizonEndFor(calendar('America/Chicago', 7), now)).toBe(Date.parse('2026-11-06T06:00:00Z'))
  })

  it.each([
    ['2026-03-08T17:00:00Z', 23],
    ['2026-11-01T18:00:00Z', 25],
  ])('counts a Chicago DST day by its wall date: %s', (iso, hours) => {
    const now = Date.parse(iso)
    expect(horizonEndFor(calendar('America/Chicago'), now) - startOfDayIn(now, 'America/Chicago')).toBe(hours * HOUR)
  })

  it.each([
    ['America/Santiago', '2026-09-05T16:00:00Z', '2026-09-06T04:00:00Z'],
    ['America/Havana', '2026-03-07T17:00:00Z', '2026-03-08T05:00:00Z'],
  ])('keeps the last evening hour when midnight is skipped in %s', (tz, iso, end) => {
    const now = Date.parse(iso)
    const cal = { ...calendar(tz), hours: Array.from({ length: 7 }, () => [{ start: 18 * 60, end: 24 * 60 }]) }
    const horizon = horizonEndFor(cal, now)
    expect(horizon).toBe(Date.parse(end))
    expect(windowsFor(cal, now, 1)[0].end).toBe(horizon)
    expect(windowsFor(cal, now, 1)[0].end - windowsFor(cal, now, 1)[0].start).toBe(6 * HOUR)
    expect(wallClock(horizon, tz).minutes).toBe(60)
    expect(wallClock(horizon - 60_000, tz).minutes).toBe(1439)
  })

  it('uses the earlier repeated time and moves a missing time forward', () => {
    expect(zonedEpoch('America/Chicago', 2026, 11, 1, 90)).toBe(Date.parse('2026-11-01T06:30:00Z'))
    expect(zonedEpoch('America/Chicago', 2026, 3, 8, 150)).toBe(Date.parse('2026-03-08T08:30:00Z'))
  })
})

describe('work time', () => {
  const cal = (over: Partial<CalendarSettings['work']> = {}): CalendarSettings => ({
    ...DEFAULT_SETTINGS.calendar,
    tz: 'America/Chicago',
    work: { hours: [[], ...Array.from({ length: 5 }, () => [{ start: 7 * 60, end: 16 * 60 }]), []], ledgerIds: [], usHolidays: true, ...over },
  })
  // Monday 2026-11-23, noon in Chicago; that week has Thanksgiving on Thursday.
  const monday = Date.parse('2026-11-23T18:00:00Z')
  const days = (xs: { start: number }[]) => xs.map((x) => dayKey(x.start, 'America/Chicago'))

  it('is the schedule on workdays, not on a US federal holiday or a day marked off', () => {
    const w = workWindowsFor(cal(), [{ day: '2026-11-24', off: true, at: 1 }], monday, 6)
    expect(days(w)).toEqual(['2026-11-23', '2026-11-25', '2026-11-27'])
    expect(w[0]).toEqual({ start: Date.parse('2026-11-23T13:00:00Z'), end: Date.parse('2026-11-23T22:00:00Z') })
    expect(workOn(cal(), [], Date.parse('2026-11-26T18:00:00Z'))).toMatchObject({ holiday: 'Thanksgiving Day', off: true, hours: [] })
  })

  it('comes back on a holiday you put back on, and holidays can be ignored', () => {
    expect(days(workWindowsFor(cal(), [{ day: '2026-11-26', off: false, at: 1 }], monday, 4))).toContain('2026-11-26')
    expect(days(workWindowsFor(cal({ usHolidays: false }), [], monday, 4))).toContain('2026-11-26')
  })

  it('is nothing without a schedule', () => {
    expect(workWindowsFor({ ...cal(), work: { hours: [[], [], [], [], [], [], []], ledgerIds: [], usHolidays: true } }, [], monday, 6)).toEqual([])
  })
})

describe('US federal holidays', () => {
  it('are observed off the weekend', () => {
    expect(usFederalHolidays(2026).map((h) => h.day)).toEqual(['2026-01-01', '2026-01-19', '2026-02-16', '2026-05-25', '2026-06-19', '2026-07-03', '2026-09-07', '2026-10-12', '2026-11-11', '2026-11-26', '2026-12-25'])
    // New Year's Day 2028 is a Saturday, observed on Friday 31 December 2027.
    expect(usHolidayOn('2027-12-31')).toBe("New Year's Day")
    expect(usHolidayOn('2026-11-27')).toBeNull()
  })
})
