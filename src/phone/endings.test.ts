import { describe, expect, it } from 'vitest'
import { firstRunState, reduce, type Action, type MayorlyState } from '@core/index'
import { endings } from './endings'

const MIN = 60_000
const T0 = new Date('2026-11-11T09:00:00').getTime()

function desk(patch: Partial<MayorlyState['settings']> = {}) {
  let n = 0
  const ctx = { now: T0, newId: () => `id-${n++}`, random: () => 0.5, device: 'phone' }
  let s = firstRunState(T0, ctx.newId)
  const run = (a: Action) => (s = reduce(s, a, ctx).state)
  run({ type: 'settings/update', patch: { focusMin: 25, shortRestMin: 5, longRestMin: 15, longRestEvery: 4, ...patch } })
  run({ type: 'ledger/create', name: 'Legal', criterion: 'Anything with a lawyer', glyph: 'scales' })
  run({ type: 'entry/add', title: 'Draft the cover letter', ledgerId: s.ledgers[0].id, estimateMin: null })
  run({ type: 'desk/deploy', mode: 'pomodoro', entryId: s.entries[0].id })
  return s
}

describe('block ends on the phone', () => {
  it('rings at the end of focus and of the rest after it, at the real times', () => {
    const s = desk({ autoStartRest: true, autoStartFocus: true })
    const list = endings(s, T0, 'phone')
    expect(list[0]).toEqual({ at: T0 + 25 * MIN, title: 'Focus done', body: 'Rest 5 min.' })
    expect(list[1]).toEqual({ at: T0 + 30 * MIN, title: 'Rest over', body: 'Back to Draft the cover letter.' })
  })

  it('stops at a block that waits to be started', () => {
    const s = desk({ autoStartRest: false })
    const list = endings(s, T0, 'phone')
    expect(list).toHaveLength(1)
    expect(list[0].body).toBe('Start the rest when you are ready.')
  })

  it('has nothing to ring for a paused desk, and leaves out what already passed', () => {
    let s = desk()
    s = reduce(s, { type: 'desk/pause' }, { now: T0 + MIN, newId: () => 'x', random: () => 0.5, device: 'phone' }).state
    expect(endings(s, T0 + MIN, 'phone')).toEqual([])
    const running = desk({ autoStartRest: true, autoStartFocus: true })
    expect(endings(running, T0 + 26 * MIN, 'phone')[0].at).toBe(T0 + 30 * MIN)
  })
})
