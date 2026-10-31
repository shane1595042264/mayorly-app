import { describe, expect, it } from 'vitest'
import { reduce, sampleState } from '@core/index'
import { describeForClerk } from './arrange'

describe('the plan described to the clerk', () => {
  it('includes the chosen mode, assumed length and events beyond the first week', () => {
    const now = Date.parse('2026-10-30T15:00:00Z')
    let n = 0
    const ctx = { now, newId: () => `id${++n}`, random: () => 0.5 }
    let s = sampleState(now, ctx.newId)
    s = reduce(s, { type: 'settings/update', patch: { calendar: { ...s.settings.calendar, tz: 'UTC', horizonDays: 14, mode: 'rotate', defaultMin: 45 } } }, ctx).state
    s = reduce(s, { type: 'entry/capture', text: 'legal: Read the lease' }, ctx).state
    s = reduce(s, { type: 'calendar/event-add', title: 'Second week appointment', start: now + 10 * 86_400_000, end: now + 10 * 86_400_000 + 3_600_000 }, ctx).state
    const text = describeForClerk(s, now)
    expect(text).toContain('Plan: Rotate, 14 days including today, until 2026-11-13 00:00 (exclusive)')
    expect(text).toContain('no estimate (default 45m)')
    expect(text).toContain('Second week appointment')
    expect(text).toContain('Fixed events in the planning range (cannot be moved)')
  })
})
