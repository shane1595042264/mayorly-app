import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS } from '../core/seed'
import { horizonEndFor, startOfDayIn, wallClock, windowsFor, zonedEpoch } from './windows'

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
