import { describe, expect, it } from 'vitest'
import { expandIcs, parseIcs } from './ics'

const ICS = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//test//EN
BEGIN:VEVENT
UID:one@test
DTSTART:20260105T140000Z
DTEND:20260105T150000Z
SUMMARY:Dentist
END:VEVENT
BEGIN:VEVENT
UID:standup@test
DTSTART:20260105T100000Z
DTEND:20260105T101500Z
RRULE:FREQ=DAILY;COUNT=5
EXDATE:20260107T100000Z
SUMMARY:Standup
END:VEVENT
BEGIN:VEVENT
UID:holiday@test
DTSTART;VALUE=DATE:20260106
DTEND;VALUE=DATE:20260107
SUMMARY:Holiday
END:VEVENT
BEGIN:VEVENT
UID:focus@test
DTSTART:20260105T160000Z
DTEND:20260105T170000Z
TRANSP:TRANSPARENT
SUMMARY:Reading
END:VEVENT
END:VCALENDAR
`

describe('outside calendars', () => {
  it('expands a series, honours an exception, marks all-day and free, and can keep titles out', () => {
    const lo = Date.UTC(2026, 0, 4)
    const hi = Date.UTC(2026, 0, 12)
    const events = expandIcs(parseIcs(ICS), 'g1', lo, hi, true)
    const standups = events.filter((e) => e.title === 'Standup')
    expect(standups).toHaveLength(4)
    expect(standups.map((e) => new Date(e.start).toISOString().slice(0, 10))).toEqual(['2026-01-05', '2026-01-06', '2026-01-08', '2026-01-09'])
    expect(events.find((e) => e.title === 'Holiday')?.allDay).toBe(true)
    expect(events.find((e) => e.title === 'Reading')?.free).toBe(true)
    expect(events.find((e) => e.title === 'Dentist')).toMatchObject({ feedId: 'g1', start: Date.UTC(2026, 0, 5, 14), end: Date.UTC(2026, 0, 5, 15), allDay: false, free: false })
    expect(events.every((e) => e.id.startsWith('g1:'))).toBe(true)
    const quiet = expandIcs(parseIcs(ICS), 'g1', lo, hi, false)
    expect(new Set(quiet.map((e) => e.title))).toEqual(new Set(['Busy']))
  })
})
