import { describe, expect, it } from 'vitest'
import {
  type Action, type HudEvent, type MayorlyState,
  balance, blockView, clock, dayStats, deriveCode, firstRunState, formatSuperset, objectives,
  parseSuperset, prefixClerk, reduce, tokensForSitting, tokensForTomato,
} from './index'

const MIN = 60_000
const T0 = new Date('2026-10-09T09:00:00').getTime()

function world(seed?: (s: MayorlyState) => void) {
  let n = 0
  const newId = () => `id${++n}`
  let now = T0
  let state = firstRunState(now, newId)
  seed?.(state)
  const events: HudEvent[] = []
  const w = {
    get s() { return state },
    get now() { return now },
    events,
    do(action: Action) {
      const r = reduce(state, action, { now, newId, random: () => 0.5 })
      state = r.state
      events.push(...r.events)
      return r
    },
    /** Move the clock forward, ticking every second like the main process heartbeat. */
    wait(ms: number) {
      const end = now + ms
      while (now < end) {
        now = Math.min(end, now + 1000)
        w.do({ type: 'desk/tick' })
      }
    },
    ledger(code: string) { return state.ledgers.find((l) => l.code === code)! },
    entry(title: string) { return state.entries.find((e) => e.title === title)! },
  }
  return w
}

describe('token economy', () => {
  it('pays 12 per tomato, 18 each once a sitting reaches 3', () => {
    expect([1, 2, 3, 4].map(tokensForTomato)).toEqual([12, 12, 30, 18])
    expect(tokensForSitting(1)).toBe(12)
    expect(tokensForSitting(2)).toBe(24)
    expect(tokensForSitting(3)).toBe(54)
    expect(tokensForSitting(5)).toBe(90)
  })
})

describe('clerk', () => {
  const s = firstRunState(T0, () => Math.random().toString())
  it('files by prefix, by tag, or leaves it in the tray', () => {
    expect(prefixClerk.file('legal: read the lease ~30', s.ledgers)).toMatchObject({
      title: 'read the lease', ledgerId: s.ledgers[0].id, estimateMin: 30,
    })
    expect(prefixClerk.file('drill footwork #dnc ~1h', s.ledgers)).toMatchObject({
      title: 'drill footwork', ledgerId: s.ledgers[1].id, estimateMin: 60,
    })
    const tray = prefixClerk.file('buy milk', s.ledgers)
    expect(tray.ledgerId).toBeNull()
    expect(tray.log).toMatch(/^tray 'buy milk'/)
  })
  it('does not treat an unknown prefix as a ledger', () => {
    expect(prefixClerk.file('note: call mom', s.ledgers)).toMatchObject({ title: 'note: call mom', ledgerId: null })
  })
  it('derives unique callsigns', () => {
    expect(deriveCode('Legal', [])).toBe('LGL')
    expect(deriveCode('Dance', [])).toBe('DNC')
    expect(deriveCode('Legal', ['LGL'])).toBe('LG2')
  })
})

describe('ledger shelf', () => {
  it('caps at nine and says so', () => {
    const w = world()
    for (let i = 0; i < 8; i++) w.do({ type: 'ledger/create', name: `Ledger ${i}`, criterion: '', glyph: 'book' })
    expect(w.s.ledgers).toHaveLength(9)
    expect(w.events.at(-1)).toMatchObject({ type: 'notice', text: 'Shelf is full: 9 ledgers' })
  })
  it('sends entries back to the tray when a ledger is removed', () => {
    const w = world()
    w.do({ type: 'entry/capture', text: 'legal: sign it' })
    w.do({ type: 'ledger/delete', id: w.ledger('LGL').id })
    expect(w.entry('sign it').ledgerId).toBeNull()
    expect(w.s.supersets[0].slots).toHaveLength(2)
  })
})

describe('pomodoro', () => {
  it('runs focus then rest, mints a tomato, and keeps going', () => {
    const w = world()
    w.do({ type: 'entry/capture', text: 'career: tailor resume' })
    w.do({ type: 'desk/deploy', mode: 'pomodoro' })
    expect(w.s.desk.block).toMatchObject({ kind: 'focus', label: 'Career' })
    w.wait(25 * MIN)
    expect(w.s.desk.block).toMatchObject({ kind: 'rest', label: 'Rest' })
    expect(balance(w.s)).toBe(12)
    w.wait(5 * MIN)
    expect(w.s.desk.block?.kind).toBe('focus')
    expect(w.s.desk.block?.entryId).toBe(w.entry('tailor resume').id)
  })
  it('deploys on a ledger with no entries as ledger time', () => {
    const w = world()
    w.do({ type: 'entry/capture', text: 'legal: unrelated' })
    w.do({ type: 'desk/deploy', mode: 'pomodoro', ledgerId: w.ledger('DNC').id })
    expect(w.s.desk.block).toMatchObject({ ledgerId: w.ledger('DNC').id, entryId: null, label: 'Dance' })
    w.wait(30 * MIN)
    expect(w.s.desk.block).toMatchObject({ kind: 'focus', ledgerId: w.ledger('DNC').id })
  })
  it('stays in the ledger when the entry is cleared', () => {
    const w = world()
    w.do({ type: 'entry/capture', text: 'legal: one' })
    w.do({ type: 'entry/capture', text: 'career: other' })
    w.do({ type: 'desk/deploy', mode: 'pomodoro' })
    w.do({ type: 'entry/complete', id: w.entry('one').id })
    expect(w.s.desk.block).toMatchObject({ ledgerId: w.ledger('LGL').id, entryId: null })
  })
  it('takes a long rest every fourth focus', () => {
    const w = world()
    w.do({ type: 'desk/deploy', mode: 'pomodoro' })
    w.wait(4 * 25 * MIN + 3 * 5 * MIN)
    expect(w.s.desk.block).toMatchObject({ kind: 'rest', label: 'Long rest', durationMs: 15 * MIN })
    expect(balance(w.s)).toBe(18 * 4)
  })
  it('pausing banks block time and pays nothing while paused', () => {
    const w = world()
    w.do({ type: 'desk/deploy', mode: 'pomodoro' })
    w.wait(10 * MIN)
    w.do({ type: 'desk/pause' })
    w.wait(60 * MIN)
    expect(balance(w.s)).toBe(0)
    w.do({ type: 'desk/resume' })
    expect(blockView(w.s, w.now)!.remainingMs).toBe(15 * MIN)
    w.wait(15 * MIN)
    expect(balance(w.s)).toBe(12)
  })
})

describe('superset rotation', () => {
  it('rotates ledgers with rests between, then a round rest', () => {
    const w = world()
    w.do({ type: 'desk/deploy', mode: 'superset', supersetId: w.s.supersets[0].id })
    const seen: string[] = []
    const label = () => `${w.s.desk.block!.kind}:${w.s.desk.block!.label}`
    seen.push(label())
    for (const ms of [25, 5, 25, 5, 25]) {
      w.wait(ms * MIN)
      seen.push(label())
    }
    expect(seen).toEqual([
      'focus:Legal', 'rest:Rest', 'focus:Dance', 'rest:Rest', 'focus:Career', 'rest:Round rest',
    ])
    expect(w.s.desk.plan?.round).toBe(2)
  })
  it('finishes after the last round and pays the long-grind bonus', () => {
    const w = world()
    w.do({ type: 'desk/deploy', mode: 'superset', supersetId: w.s.supersets[0].id })
    // 3 rounds: 9 focus blocks, 6 rests, 2 round rests.
    w.wait(9 * 25 * MIN + 6 * 5 * MIN + 2 * 15 * MIN)
    expect(w.s.desk.status).toBe('idle')
    const end = w.events.find((e) => e.type === 'sitting-end')
    expect(end).toMatchObject({ reason: 'complete', tomatoes: 9, tokens: 9 * 18 })
  })
  it('pulls the next entry from the same ledger when one is cleared mid-block', () => {
    const w = world()
    w.do({ type: 'entry/capture', text: 'legal: one' })
    w.do({ type: 'entry/capture', text: 'legal: two' })
    w.do({ type: 'desk/deploy', mode: 'superset', supersetId: w.s.supersets[0].id })
    expect(w.s.desk.block?.entryId).toBe(w.entry('one').id)
    w.wait(3 * MIN)
    w.do({ type: 'entry/complete', id: w.entry('one').id })
    expect(w.s.desk.block?.entryId).toBe(w.entry('two').id)
    expect(blockView(w.s, w.now)!.remainingMs).toBe(22 * MIN)
  })
  it('shows objectives with the active slot', () => {
    const w = world()
    w.do({ type: 'desk/deploy', mode: 'superset', supersetId: w.s.supersets[0].id })
    w.wait(31 * MIN)
    expect(objectives(w.s)!.slots.map((o) => `${o.letter}${o.code}:${o.state}`)).toEqual([
      'ALGL:done', 'BDNC:active', 'CCAR:queued',
    ])
  })
})

describe('blitz flow', () => {
  it('times each entry against its estimate and rolls to the next when cleared', () => {
    const w = world()
    w.do({ type: 'entry/capture', text: 'legal: first ~10' })
    w.do({ type: 'entry/capture', text: 'career: second' })
    w.do({ type: 'desk/deploy', mode: 'blitz' })
    expect(w.s.desk.block?.durationMs).toBe(10 * MIN)
    w.wait(12 * MIN)
    const v = blockView(w.s, w.now)!
    expect(v.entry?.title).toBe('first')
    expect(v.overtimeMs).toBe(2 * MIN)
    w.do({ type: 'entry/complete', id: w.entry('first').id })
    expect(w.s.desk.block).toMatchObject({ entryId: w.entry('second').id, durationMs: null })
    w.do({ type: 'entry/complete', id: w.entry('second').id })
    expect(w.s.desk.status).toBe('idle')
    expect(w.events.at(-1)).toMatchObject({ type: 'sitting-end', reason: 'flow-clear' })
  })
})

describe('swap', () => {
  it('switches the entry without resetting the block clock', () => {
    const w = world()
    w.do({ type: 'entry/capture', text: 'legal: a' })
    w.do({ type: 'desk/deploy', mode: 'pomodoro' })
    w.wait(7 * MIN)
    w.do({ type: 'desk/swap', ledgerId: w.ledger('DNC').id })
    const v = blockView(w.s, w.now)!
    expect(v.block.label).toBe('Dance')
    expect(v.remainingMs).toBe(18 * MIN)
    const today = dayStats(w.s, new Date(T0).setHours(0, 0, 0, 0), w.now + 3 * MIN)
    const byCode = Object.fromEntries(today.byLedger.map((b) => [w.s.ledgers.find((l) => l.id === b.ledgerId)?.code, b.focusMs]))
    expect(byCode).toEqual({ LGL: 7 * MIN, DNC: 3 * MIN })
  })
  it('redeploying mid-sitting keeps banked focus toward the bonus', () => {
    const w = world()
    w.do({ type: 'desk/deploy', mode: 'pomodoro' })
    w.wait(40 * MIN)
    w.do({ type: 'desk/deploy', mode: 'superset', supersetId: w.s.supersets[0].id })
    expect(w.s.sittings).toHaveLength(1)
    expect(w.s.sittings[0].tomatoes).toBe(1)
  })
})

describe('superset syntax', () => {
  it('parses slots and options', () => {
    let k = 0
    const s = firstRunState(T0, () => `L${++k}`)
    let n = 0
    const r = parseSuperset('legal 25, dance 20 > career x2 rest 3 rr 10 shuffle', s.ledgers, () => `p${++n}`)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.superset).toMatchObject({ rounds: 2, restMin: 3, roundRestMin: 10, order: 'shuffle', name: 'LGL / DNC / CAR' })
    expect(r.superset.slots.map((sl) => sl.minutes)).toEqual([25, 20, 25])
    expect(formatSuperset(r.superset, s.ledgers, [])).toBe('lgl 25, dnc 20, car 25 x2 rest 3 rr 10 shuffle')
  })
  it('names the ledger it could not find', () => {
    let k = 0
    const s = firstRunState(T0, () => `L${++k}`)
    expect(parseSuperset('legal 25, cooking 20', s.ledgers, () => 'y')).toEqual({ ok: false, error: 'No ledger called "cooking"' })
  })
})

describe('format', () => {
  it('formats clocks', () => {
    expect(clock(25 * MIN)).toBe('25:00')
    expect(clock(1)).toBe('00:01')
    expect(clock(62 * MIN)).toBe('1:02:00')
  })
})
