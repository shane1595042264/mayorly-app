import { describe, expect, it } from 'vitest'
import { emptyState, migrate, reduce, sanitiseAlarms, type AlarmChoice } from './index'

describe('alarm choices', () => {
  it('gives older saves the existing cue for both transitions', () => {
    const old = JSON.parse(JSON.stringify(emptyState()))
    delete old.settings.alarms
    expect(migrate(old)?.settings.alarms).toEqual({ work: { tone: 'classic' }, rest: { tone: 'classic' } })
  })
  it('keeps separate work and break choices on this device during sync', () => {
    const s = emptyState()
    s.settings.alarms = { work: { tone: 'bell' }, rest: { tone: 'gentle' } }
    const other = emptyState()
    const result = reduce(s, { type: 'sync/replace', state: other }, { now: 0, newId: () => 'id', random: () => 0.5 })
    expect(result.state.settings.alarms).toEqual(s.settings.alarms)
  })
  it('rejects unknown sounds and custom paths while preserving a valid local upload', () => {
    expect(sanitiseAlarms({ work: { tone: 'custom', customId: '../file' }, rest: { tone: 'unknown' } as unknown as AlarmChoice })).toEqual({ work: { tone: 'classic' }, rest: { tone: 'classic' } })
    const work: AlarmChoice = { tone: 'custom', customId: '00000000-0000-0000-0000-000000000000', customName: 'My bell.wav' }
    expect(sanitiseAlarms({ work }).work).toEqual(work)
  })
})
