import { describe, expect, it } from 'vitest'
import { emptyState, migrate } from './seed'
import { reduce, type Action } from './reducer'
import { entryTomatoes } from './accounting'
import { entrySpentMs } from './planner'
import { balance } from './selectors'
import { mergeStates } from './merge'

const MIN = 60_000
function world() {
  let now = 1000000, id = 0
  let s = emptyState()
  s.settings.focusMin = 30
  const act = (a: Action) => {
    const r = reduce(s, a, { now, newId: () => `id${++id}`, random: () => 0.5 })
    s = r.state
    return r
  }
  act({ type: 'entry/capture', text: 'A' })
  act({ type: 'entry/capture', text: 'B' })
  const [a, b] = s.entries.map(e => e.id)
  return { get s() { return s }, get now() { return now }, a, b, act,
    advance: (minutes: number) => { now += minutes * MIN },
    crop: (entry: string) => entryTomatoes(s, entry, now),
    load: () => { s = migrate(JSON.parse(JSON.stringify(s)))! },
  }
}

describe('a save from the first Windows build', () => {
  it('does not pay a second time for entry time its coins already paid', () => {
    const w = world()
    w.act({ type: 'desk/deploy', mode: 'blitz', entryId: w.a })
    const start = w.now
    w.advance(90)
    w.act({ type: 'desk/pause' })
    expect(w.s.entries[0].tomatoes).toBe(3)
    // That build paid one coin the minute each tomato ripened: no count, no entry on the record.
    const sittingId = w.s.sittings[0].id
    for (const n of [1, 2, 3]) w.s.tokens.push({ id: `${sittingId}:${n}`, at: start + n * 30 * MIN, amount: 1, reason: 'tomato', sittingId })
    expect(balance(w.s)).toBe(3)
    w.load()
    expect(w.s.entries[0].tomatoes).toBe(0)
    expect(balance(w.s)).toBe(3)
    expect(w.s.tokens.map(t => t.reason)).toEqual(['harvest', 'harvest', 'harvest'])
    w.act({ type: 'entry/complete', id: w.a })
    expect(balance(w.s)).toBe(3)
    // Loading again changes nothing more.
    w.load()
    expect(balance(w.s)).toBe(3)
  })
})

describe('tomatoes belong to the time on each task', () => {
  it('keeps fractions across switches and never gives B the tomato started on A', () => {
    const w = world()
    w.act({ type: 'desk/deploy', mode: 'blitz', entryId: w.a })
    w.advance(29)
    w.act({ type: 'desk/swap', entryId: w.b })
    w.advance(3)
    w.act({ type: 'desk/tick' })
    expect(w.crop(w.a)).toBeCloseTo(29 / 30)
    expect(w.crop(w.b)).toBeCloseTo(3 / 30)
    expect(w.s.entries.map(e => e.tomatoes)).toEqual([0, 0])
    w.act({ type: 'desk/switch' })
    w.advance(3)
    w.act({ type: 'desk/pause' })
    expect(entrySpentMs(w.s, w.a, w.now)).toBe(32 * MIN)
    expect(w.crop(w.a)).toBeCloseTo(32 / 30)
    expect(w.s.entries[0].tomatoes).toBe(1)
    w.advance(200)
    expect(w.crop(w.a)).toBeCloseTo(32 / 30)
  })

  it('settles a boundary on switch and on clear without waiting for a heartbeat', () => {
    const w = world()
    w.act({ type: 'desk/deploy', mode: 'blitz', entryId: w.a })
    w.advance(30)
    w.act({ type: 'desk/swap', entryId: w.b })
    expect(w.s.entries[0].tomatoes).toBe(1)
    w.advance(60)
    const cleared = w.act({ type: 'entry/complete', id: w.b })
    expect(cleared.events.find(e => e.type === 'harvest')).toMatchObject({ tomatoes: 2, tokens: 2 })
    expect(balance(w.s)).toBe(2)
    w.act({ type: 'entry/complete', id: w.b })
    expect(balance(w.s)).toBe(2)
    w.act({ type: 'entry/complete', id: w.a })
    expect(balance(w.s)).toBe(3)
  })

  it('adds partial work across sittings, parking and a save/reload', () => {
    const w = world()
    w.act({ type: 'desk/deploy', mode: 'blitz', entryId: w.a })
    w.advance(17)
    w.act({ type: 'desk/deploy', mode: 'blitz', entryId: w.b })
    w.advance(10)
    w.act({ type: 'desk/switch' })
    w.advance(15)
    w.act({ type: 'desk/standDown' })
    w.load()
    w.act({ type: 'desk/deploy', mode: 'blitz', entryId: w.a })
    w.advance(75)
    w.act({ type: 'desk/pause' })
    expect(entrySpentMs(w.s, w.a, w.now)).toBe(107 * MIN)
    expect(w.crop(w.a)).toBeCloseTo(107 / 30)
    expect(w.s.entries[0].tomatoes).toBe(3)
  })

  it('repairs stale entry counts from intervals without changing previously paid coins', () => {
    const w = world()
    w.act({ type: 'desk/deploy', mode: 'blitz', entryId: w.a })
    w.advance(107)
    w.act({ type: 'desk/pause' })
    w.s.entries[0].tomatoes = 5
    const coins = structuredClone(w.s.tokens)
    w.load()
    expect(w.s.entries[0].tomatoes).toBe(3)
    expect(w.s.tokens).toEqual(coins)
    w.act({ type: 'entry/complete', id: w.a })
    expect(balance(w.s)).toBe(3)
    w.act({ type: 'entry/reopen', id: w.a })
    w.act({ type: 'desk/deploy', mode: 'blitz', entryId: w.a })
    w.advance(13)
    w.act({ type: 'entry/complete', id: w.a })
    expect(balance(w.s)).toBe(4)
    w.load()
    w.act({ type: 'entry/reopen', id: w.a })
    w.act({ type: 'entry/complete', id: w.a })
    expect(balance(w.s)).toBe(4)
  })

  it('keeps the tomato length of each sitting when focus settings change', () => {
    const w = world()
    w.act({ type: 'desk/deploy', mode: 'blitz', entryId: w.a })
    w.advance(15)
    w.act({ type: 'desk/standDown' })
    w.act({ type: 'settings/update', patch: { focusMin: 20 } })
    w.act({ type: 'desk/deploy', mode: 'blitz', entryId: w.a })
    w.advance(10)
    w.act({ type: 'entry/complete', id: w.a })
    expect(w.crop(w.a)).toBe(1)
    expect(balance(w.s)).toBe(1)
  })

  it('does not mint a deleted task or borrow its remainder for ledger time', () => {
    const w = world()
    w.act({ type: 'desk/deploy', mode: 'blitz', entryId: w.a })
    w.advance(29)
    w.act({ type: 'entry/delete', id: w.a })
    w.advance(1)
    w.act({ type: 'desk/tick' })
    expect(balance(w.s)).toBe(0)
    w.advance(29)
    w.act({ type: 'desk/tick' })
    expect(balance(w.s)).toBe(1)
    w.load()
    w.act({ type: 'desk/tick' })
    expect(balance(w.s)).toBe(1)
  })

  it('merges distinct work intervals and pays their crop only once', () => {
    const w = world()
    w.act({ type: 'desk/deploy', mode: 'blitz', entryId: w.a })
    w.advance(20)
    w.act({ type: 'desk/pause' })
    const remote = structuredClone(w.s)
    remote.segments[0].id = 'remote-segment'
    remote.segments[0].start += 60 * MIN
    remote.segments[0].end! += 60 * MIN
    const merged = mergeStates(w.s, remote, null)
    expect(merged.entries[0].tomatoes).toBe(1)
    expect(entryTomatoes(merged, w.a, w.now)).toBeCloseTo(40 / 30)
    expect(mergeStates(merged, remote, null).entries[0].tomatoes).toBe(1)
  })

  it('does not replay a legacy ledger payment made during an open segment', () => {
    const w = world()
    w.act({ type: 'entry/delete', id: w.a })
    w.act({ type: 'entry/delete', id: w.b })
    w.act({ type: 'desk/deploy', mode: 'pomodoro' })
    w.s.desk.block!.durationMs = null
    w.advance(30)
    w.act({ type: 'desk/tick' })
    delete w.s.sittings[0].ledgerTomatoes
    w.load()
    w.act({ type: 'desk/tick' })
    expect(balance(w.s)).toBe(1)
  })
})
