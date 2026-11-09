import { describe, expect, it } from 'vitest'
import { DEFAULT_HOTKEYS, firstRunState, migrate } from './seed'
import { DEVICE_SETTINGS, isDeviceOnly } from './reducer'
import { clampScale, dragScale } from '../shared/pet'
import {
  plannedMs,
  type Action, type HudEvent, type MayorlyState,
  balance, blockView, clock, dayStats, deriveCode, entryTomatoes, sampleState, formatSuperset, objectives, switchTarget,
  findTasks, onDeskId, recentTasks, switchToAction, mergeStates, parseSuperset, prefixClerk, reduce, tokensForSitting, tokensForTomato,
} from './index'

const MIN = 60_000
const T0 = new Date('2026-10-09T09:00:00').getTime()

function world(seed?: (s: MayorlyState) => void, prefix = '') {
  let n = 0
  const newId = () => `${prefix}id${++n}`
  let now = T0
  let state = sampleState(now, newId)
  seed?.(state)
  const events: HudEvent[] = []
  const w = {
    get s() { return state },
    get now() { return now },
    events,
    do(action: Action) {
      const r = reduce(state, action, { now, newId, random: () => 0.5, device: prefix || 'here' })
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
  it('pays one token per tomato, no bonus for long sittings', () => {
    expect([1, 2, 3, 4].map(tokensForTomato)).toEqual([1, 1, 1, 1])
    expect(tokensForSitting(1)).toBe(1)
    expect(tokensForSitting(3)).toBe(3)
    expect(tokensForSitting(5)).toBe(5)
  })
})

describe('clerk', () => {
  const s = sampleState(T0, () => Math.random().toString())
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
    // The tomato grew on the entry; it pays when the entry is cleared.
    expect(balance(w.s)).toBe(0)
    expect(w.entry('tailor resume').tomatoes).toBe(1)
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
    expect(balance(w.s)).toBe(4)
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
    expect(balance(w.s)).toBe(1)
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
  it('finishes after the last round and pays a token a tomato', () => {
    const w = world()
    w.do({ type: 'desk/deploy', mode: 'superset', supersetId: w.s.supersets[0].id })
    // 3 rounds: 9 focus blocks, 6 rests, 2 round rests.
    w.wait(9 * 25 * MIN + 6 * 5 * MIN + 2 * 15 * MIN)
    expect(w.s.desk.status).toBe('idle')
    const end = w.events.find((e) => e.type === 'sitting-end')
    expect(end).toMatchObject({ reason: 'complete', tomatoes: 9, tokens: 9 })
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
  it('a swap you ask for resumes a desk on hold, the clock where it was; an automatic one does not', () => {
    const w = world()
    w.do({ type: 'entry/capture', text: 'legal: a' })
    w.do({ type: 'entry/capture', text: 'dance: b' })
    w.do({ type: 'desk/deploy', mode: 'pomodoro', entryId: w.entry('a').id })
    w.wait(15 * MIN)
    w.do({ type: 'desk/pause' })
    w.wait(3 * MIN)
    w.do({ type: 'desk/swap', entryId: w.entry('b').id })
    expect(w.s.desk.status).toBe('running')
    expect(blockView(w.s, w.now)?.remainingMs).toBe(10 * MIN)
    // Option+Q back while on hold resumes too.
    w.do({ type: 'desk/pause' })
    w.do({ type: 'desk/switch' })
    expect(w.s.desk.status).toBe('running')
    expect(w.s.desk.block?.entryId).toBe(w.entry('a').id)
    // Clearing the entry while on hold moves the desk on but leaves the hold.
    w.do({ type: 'desk/pause' })
    w.do({ type: 'entry/complete', id: w.entry('a').id })
    expect(w.s.desk.status).toBe('paused')
  })

  it('redeploying parks the running session for the quick switch; its tomato is kept', () => {
    const w = world()
    w.do({ type: 'desk/deploy', mode: 'pomodoro' })
    w.wait(40 * MIN)
    w.do({ type: 'desk/deploy', mode: 'superset', supersetId: w.s.supersets[0].id })
    expect(w.s.sittings).toHaveLength(2)
    expect(w.s.sittings[0].tomatoes).toBe(1)
    expect(w.s.desk.holster?.plan.mode).toBe('pomodoro')
    expect(w.s.desk.plan?.mode).toBe('superset')
  })
})

describe('superset syntax', () => {
  it('parses slots and options', () => {
    let k = 0
    const s = sampleState(T0, () => `L${++k}`)
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
    const s = sampleState(T0, () => `L${++k}`)
    expect(parseSuperset('legal 25, cooking 20', s.ledgers, () => 'y')).toEqual({ ok: false, error: 'No ledger called "cooking"' })
  })
})

describe('capture and start', () => {
  it('puts the new entry on the desk: a pomodoro when idle, a swap with the clock kept while a block runs, a resume on hold', () => {
    const w = world()
    w.do({ type: 'entry/capture', text: 'legal: a', start: true })
    expect(w.s.desk.status).toBe('running')
    expect(w.s.desk.plan?.mode).toBe('pomodoro')
    expect(w.s.desk.block?.entryId).toBe(w.entry('a').id)
    w.wait(7 * MIN)
    w.do({ type: 'entry/capture', text: 'dance: b', start: true })
    expect(w.s.desk.block?.entryId).toBe(w.entry('b').id)
    expect(blockView(w.s, w.now)?.remainingMs).toBe(18 * MIN)
    expect(w.s.sittings).toHaveLength(1)
    w.do({ type: 'desk/pause' })
    w.do({ type: 'entry/capture', text: 'career: c', start: true })
    expect(w.s.desk.status).toBe('running')
    expect(w.s.desk.block?.entryId).toBe(w.entry('c').id)
  })

  it('the clerk filing it afterwards takes the desk along to the ledger', () => {
    const w = world()
    w.do({ type: 'entry/capture', text: 'a plain line', start: true })
    const e = w.entry('a plain line')
    expect(e.ledgerId).toBeNull()
    expect(w.s.desk.block?.entryId).toBe(e.id)
    w.do({ type: 'entry/file', id: e.id, ledgerId: w.ledger('LGL').id, estimateMin: null, log: 'filed by the clerk' })
    expect(w.s.desk.block?.ledgerId).toBe(w.ledger('LGL').id)
    expect(w.s.desk.block?.label).toBe('Legal')
  })
})

describe('the calendar', () => {
  const windows = (w: typeof world extends (...a: never[]) => infer R ? R : never) => [{ start: w.now, end: w.now + 8 * 60 * MIN }, { start: w.now + 24 * 60 * MIN, end: w.now + 32 * 60 * MIN }]
  const replan = (w: ReturnType<typeof world>) => w.do({ type: 'schedule/replan', windows: windows(w), horizonEnd: w.now + 14 * 24 * 60 * MIN })

  it('plans entries with estimates into the windows, and a quiet replan returns the same state', () => {
    const w = world()
    w.do({ type: 'entry/capture', text: 'legal: a ~90' })
    w.do({ type: 'entry/capture', text: 'dance: b ~30' })
    replan(w)
    const blocks = w.s.calendar.blocks
    expect(blocks.map((b) => [b.entryId === w.entry('a').id ? 'a' : 'b', (b.end - b.start) / MIN])).toEqual([['a', 90], ['b', 30]])
    expect(blocks[0].id).toBe(`${w.entry('a').id}#1`)
    expect(blocks[1].start).toBe(blocks[0].end + 5 * MIN)
    const before = w.s
    replan(w)
    expect(w.s).toBe(before)
  })

  it('a pin is busy to the planner and credit to its entry; a cleared entry leaves the calendar', () => {
    const w = world()
    w.do({ type: 'entry/capture', text: 'legal: a ~90' })
    const a = w.entry('a')
    w.do({ type: 'calendar/event-add', title: '', start: w.now + 60 * MIN, end: w.now + 120 * MIN, entryId: a.id })
    expect(w.s.calendar.events[0].title).toBe('a')
    replan(w)
    const mine = w.s.calendar.blocks.filter((b) => b.entryId === a.id)
    expect(mine.map((b) => (b.end - b.start) / MIN)).toEqual([30])
    expect(mine[0].start).toBe(w.now)
    w.do({ type: 'calendar/event-add', title: 'Dentist', start: w.now + 3 * 60 * MIN, end: w.now + 4 * 60 * MIN })
    w.do({ type: 'entry/complete', id: a.id })
    expect(w.s.calendar.blocks).toEqual([])
    expect(w.s.calendar.events.map((e) => [e.title, e.entryId])).toEqual([['a', null], ['Dentist', null]])
  })

  it('refuses a backwards event, an empty one, and a stale pin; editing bumps the sequence', () => {
    const w = world()
    w.do({ type: 'calendar/event-add', title: 'x', start: w.now + MIN, end: w.now })
    w.do({ type: 'calendar/event-add', title: '   ', start: w.now, end: w.now + MIN })
    expect(w.s.calendar.events).toHaveLength(0)
    w.do({ type: 'calendar/event-add', title: 'Standup', start: w.now, end: w.now + 30 * MIN })
    const id = w.s.calendar.events[0].id
    w.do({ type: 'calendar/event-update', id, patch: { start: w.now + 10 * MIN, end: w.now + 40 * MIN } })
    expect(w.s.calendar.events[0].seq).toBe(1)
    w.do({ type: 'calendar/event-update', id, patch: { title: 'Standup, moved' } })
    expect(w.s.calendar.events[0].seq).toBe(1)
    w.do({ type: 'calendar/event-delete', id })
    expect(w.s.calendar.events).toHaveLength(0)
  })

  it('a block can be pinned, and the due and not-before knobs are checked', () => {
    const w = world()
    w.do({ type: 'entry/capture', text: 'legal: a ~60' })
    const a = w.entry('a')
    w.do({ type: 'entry/update', id: a.id, patch: { due: w.now + 2 * 60 * MIN, notBefore: w.now + 3 * 60 * MIN } })
    expect(w.entry('a').due).toBe(w.now + 2 * 60 * MIN)
    expect(w.entry('a').notBefore).toBeNull()
    replan(w)
    const b = w.s.calendar.blocks[0]
    w.do({ type: 'calendar/pin', blockId: b.id })
    expect(w.s.calendar.events[0]).toMatchObject({ entryId: a.id, start: b.start, end: b.end, origin: 'user' })
    replan(w)
    expect(w.s.calendar.blocks).toEqual([])
  })

  it('an entry without an estimate is placed at the default length and marked assumed; the range may be one day', () => {
    const w = world()
    w.do({ type: 'entry/capture', text: 'legal: no number' })
    w.do({ type: 'entry/capture', text: 'legal: with ~50' })
    replan(w)
    const a = w.s.calendar.blocks.find((b) => b.entryId === w.entry('no number').id)!
    const b = w.s.calendar.blocks.find((b) => b.entryId === w.entry('with').id)!
    expect(a.assumed).toBe(true)
    expect(a.end - a.start).toBe(w.s.settings.calendar.defaultMin * MIN)
    expect(b.assumed).toBe(false)
    w.do({ type: 'settings/update', patch: { calendar: { ...w.s.settings.calendar, horizonDays: 1, defaultMin: 45, mode: 'rotate' } } })
    expect(w.s.settings.calendar).toMatchObject({ horizonDays: 1, defaultMin: 45, mode: 'rotate' })
    w.do({ type: 'settings/update', patch: { calendar: { ...w.s.settings.calendar, mode: 'sideways' as never, horizonDays: -3 } } })
    expect(w.s.settings.calendar).toMatchObject({ horizonDays: 1, mode: 'done' })
  })

  it('an assumed length remains on the plan after more than that much desk time', () => {
    const w = world()
    w.do({ type: 'settings/update', patch: { focusMin: 60 } })
    w.do({ type: 'entry/capture', text: 'legal: ongoing', start: true })
    const id = w.entry('ongoing').id
    replan(w)
    w.wait(35 * MIN)
    replan(w)
    const blocks = w.s.calendar.blocks.filter((b) => b.entryId === id)
    expect(blocks.length).toBeGreaterThan(0)
    expect(blocks.every((b) => b.assumed)).toBe(true)
    expect(blocks.reduce((sum, b) => sum + b.end - b.start, 0)).toBe(30 * MIN)
    expect(w.entry('ongoing').doneAt).toBeNull()
    w.do({ type: 'entry/complete', id })
    replan(w)
    expect(w.s.calendar.blocks.some((b) => b.entryId === id)).toBe(false)
  })

  it('changing mode reorders future blocks without resetting feed sequences or moving events', () => {
    const w = world()
    for (const text of ['legal: a ~30', 'legal: b ~30', 'dance: c ~30']) w.do({ type: 'entry/capture', text })
    w.do({ type: 'calendar/event-add', title: 'Appointment', start: w.now + 180 * MIN, end: w.now + 210 * MIN })
    replan(w)
    const ids = ['a', 'b', 'c'].map((title) => w.entry(title).id)
    expect(w.s.calendar.blocks.map((b) => b.entryId)).toEqual(ids)
    const before = new Map(w.s.calendar.blocks.map((b) => [b.id, b]))
    const fixed = structuredClone(w.s.calendar.events)
    w.do({ type: 'settings/update', patch: { calendar: { ...w.s.settings.calendar, mode: 'rotate' } } })
    replan(w)
    expect(w.s.calendar.blocks.map((b) => b.entryId)).toEqual([ids[0], ids[2], ids[1]])
    for (const b of w.s.calendar.blocks) {
      const old = before.get(b.id)!
      expect(b.seq).toBe(old.seq + Number(old.start !== b.start || old.end !== b.end))
    }
    expect(w.s.calendar.events).toEqual(fixed)
    expect(w.s.calendar.plannedMode).toBe('rotate')
    const stable = w.s
    replan(w)
    expect(w.s).toBe(stable)
  })

  it.each(['sync/replace', 'sync/merge'] as const)('%s preserves planner controls stripped by an older build, and accepts current ones', (type) => {
    const w = world()
    w.do({ type: 'settings/update', patch: { calendar: { ...w.s.settings.calendar, mode: 'rotate', defaultMin: 45, horizonDays: 1 } } })
    const old = structuredClone(w.s)
    const oldCalendar = old.settings.calendar as Partial<typeof old.settings.calendar>
    delete oldCalendar.mode
    delete oldCalendar.defaultMin
    oldCalendar.horizonDays = 7
    oldCalendar.breakMin = 10
    old.calendar.plannedMode = 'rotate'
    old.calendar.plannedAt = w.now
    w.do(type === 'sync/merge' ? { type, state: old, syncedAt: null } : { type, state: old })
    expect(w.s.settings.calendar).toMatchObject({ mode: 'rotate', defaultMin: 45, horizonDays: 1, breakMin: 10 })
    expect(w.s.calendar.plannedMode).toBe('done')
    const current = structuredClone(w.s)
    current.settings.calendar = { ...current.settings.calendar, mode: 'done', defaultMin: 60, horizonDays: 2 }
    w.do(type === 'sync/merge' ? { type, state: current, syncedAt: null } : { type, state: current })
    expect(w.s.settings.calendar).toMatchObject({ mode: 'done', defaultMin: 60, horizonDays: 2 })
  })

  it('a mode change keeps the block already in progress', () => {
    const w = world()
    for (const text of ['legal: a ~60', 'legal: b ~30', 'dance: c ~30']) w.do({ type: 'entry/capture', text })
    replan(w)
    const current = w.s.calendar.blocks[0]
    w.wait(10 * MIN)
    w.do({ type: 'settings/update', patch: { calendar: { ...w.s.settings.calendar, mode: 'rotate' } } })
    replan(w)
    expect(w.s.calendar.blocks[0]).toMatchObject({ entryId: current.entryId, start: w.now, end: current.end })
  })

  it('a block dragged to another time pins there, never before now, and planned time is summed', () => {
    const w = world()
    w.do({ type: 'entry/capture', text: 'legal: a ~60' })
    replan(w)
    const b = w.s.calendar.blocks[0]
    expect(plannedMs(w.s, w.now, w.now + 24 * 60 * MIN)).toBe(60 * MIN)
    w.do({ type: 'calendar/pin', blockId: b.id, start: w.now - 30 * MIN, end: w.now + 30 * MIN })
    expect(w.s.calendar.events[0]).toMatchObject({ entryId: w.entry('a').id, start: w.now, end: w.now + 30 * MIN })
    w.do({ type: 'calendar/event-delete', id: w.s.calendar.events[0].id })
    w.do({ type: 'calendar/pin', blockId: b.id, start: w.now + 5 * 60 * MIN, end: w.now + 4 * 60 * MIN })
    expect(w.s.calendar.events[0]).toMatchObject({ start: Math.max(b.start, w.now), end: b.end })
  })

  it('outside events are busy unless free or all-day, and a feed keeps titles out when told to', () => {
    const w = world()
    w.do({ type: 'calendar/feed-add', id: 'g1', label: 'Google', titles: false })
    w.do({ type: 'calendar/external', feedId: 'g1', fetchedAt: w.now, error: null, events: [
      { id: 'g1:u1:1', feedId: 'g1', title: 'Secret meeting', start: w.now, end: w.now + 60 * MIN, allDay: false, free: false },
      { id: 'g1:u2:1', feedId: 'g1', title: 'Holiday', start: w.now, end: w.now + 24 * 60 * MIN, allDay: true, free: false },
      { id: 'other:u3:1', feedId: 'g1', title: 'Not mine', start: w.now, end: w.now + 60 * MIN, allDay: false, free: false },
    ] })
    expect(w.s.calendar.external.map((x) => x.title)).toEqual(['Busy', 'Busy'])
    w.do({ type: 'entry/capture', text: 'legal: a ~30' })
    replan(w)
    expect(w.s.calendar.blocks[0].start).toBe(w.now + 60 * MIN)
    w.do({ type: 'calendar/feed-remove', id: 'g1' })
    expect(w.s.calendar.external).toEqual([])
  })

  it('calendar settings are sanitised and an old save loads with defaults', () => {
    const w = world()
    w.do({ type: 'settings/update', patch: { calendar: { tz: 'America/Chicago', hours: [[], [{ start: 600, end: 540 }, { start: 480, end: 720 }, { start: 700, end: 900 }], [], [], [], [], []], breakMin: 7, minChunkMin: 2, horizonDays: 99, spill: false, defaultMin: 1000, mode: 'rotate' } } })
    expect(w.s.settings.calendar).toEqual({ tz: 'America/Chicago', hours: [[], [{ start: 480, end: 900 }], [], [], [], [], []], breakMin: 5, minChunkMin: 5, horizonDays: 28, spill: false, defaultMin: 240, mode: 'rotate' })
    const old = JSON.parse(JSON.stringify(w.s)) as Record<string, unknown>
    delete old.calendar
    delete (old.settings as Record<string, unknown>).calendar
    const back = migrate(old)!
    expect(back.calendar.blocks).toEqual([])
    expect(back.settings.calendar.minChunkMin).toBe(25)
    expect(back.settings.calendar).toMatchObject({ defaultMin: 30, mode: 'done' })
  })
})

describe('the clerk arranging', () => {
  it('applies the commands it may, refuses the rest, and cannot reach a user event', () => {
    const w = world()
    w.do({ type: 'entry/capture', text: 'legal: a ~30' })
    w.do({ type: 'entry/capture', text: 'dance: b ~30' })
    const [a, b] = [w.entry('a'), w.entry('b')]
    w.do({ type: 'calendar/event-add', title: 'Dentist', start: w.now + 60 * MIN, end: w.now + 120 * MIN })
    const dentist = w.s.calendar.events[0]
    const r = w.do({ type: 'schedule/apply', log: 'clerk: arranged per request', commands: [
      { op: 'estimate', entryId: a.id, minutes: 90 },
      { op: 'due', entryId: b.id, at: w.now + 5 * 60 * MIN },
      { op: 'rush', entryId: b.id, on: true },
      { op: 'order', entryId: b.id, place: 'first' },
      { op: 'place', entryId: a.id, start: w.now + 70 * MIN, minutes: 30 },
      { op: 'place', entryId: a.id, start: w.now + 3 * 60 * MIN, minutes: 30 },
      { op: 'block', title: 'Dance, by request', start: w.now + 4 * 60 * MIN, minutes: 60 },
      { op: 'estimate', entryId: 'nope', minutes: 30 },
      { op: 'notBefore', entryId: a.id, at: w.now - 10 * 60 * MIN },
    ] })
    expect(r.state.entries.find((e) => e.id === a.id)?.estimateMin).toBe(90)
    expect(w.entry('b').due).toBe(w.now + 5 * 60 * MIN)
    expect(w.entry('b').rush).toBe(true)
    expect(w.entry('b').order).toBe(0)
    const pins = w.s.calendar.events.filter((e) => e.origin === 'clerk')
    expect(pins.map((p) => [p.entryId, p.start])).toEqual([[a.id, w.now + 3 * 60 * MIN], [null, w.now + 4 * 60 * MIN]])
    expect(w.s.calendar.events.find((e) => e.id === dentist.id)).toEqual(dentist)
    expect(w.s.clerkLog[w.s.clerkLog.length - 1].text).toBe('clerk: arranged per request, 3 refused')
    w.do({ type: 'schedule/apply', log: 'clerk: let the planner place a', commands: [{ op: 'unplace', entryId: a.id }] })
    expect(w.s.calendar.events.filter((e) => e.origin === 'clerk' && e.entryId === a.id)).toEqual([])
    expect(w.s.calendar.events.find((e) => e.id === dentist.id)).toEqual(dentist)
  })
})

describe('a ledger that does not pay', () => {
  it('grows and counts tomatoes, mints no coin on ledger time or at the harvest, and still charges nothing', () => {
    const w = world()
    w.do({ type: 'ledger/create', name: 'Professional Work', code: 'PRO', criterion: 'Hours someone pays for.', glyph: 'book', pays: false, theme: 'slate' })
    const pro = w.ledger('PRO')
    expect(pro.pays).toBe(false)
    expect(pro.theme).toBe('slate')
    // Ledger time: a tomato ripens, the record carries no coin.
    w.do({ type: 'desk/deploy', mode: 'pomodoro', ledgerId: pro.id })
    w.wait(25 * MIN + 1000)
    expect(balance(w.s)).toBe(0)
    expect(w.s.tokens).toHaveLength(1)
    expect(w.s.tokens[0].amount).toBe(0)
    expect(dayStats(w.s, new Date(T0).setHours(0, 0, 0, 0), w.now).tomatoes).toBe(1)
    w.do({ type: 'desk/standDown' })
    // An entry there: the crop is counted, not paid.
    w.do({ type: 'entry/capture', text: 'pro: the Tuesday shift' })
    const shift = w.entry('the Tuesday shift')
    w.do({ type: 'desk/deploy', mode: 'pomodoro', entryId: shift.id })
    w.wait(25 * MIN + 1000)
    expect(w.entry('the Tuesday shift').tomatoes).toBe(1)
    const r = w.do({ type: 'entry/complete', id: shift.id })
    const harvest = r.events.find((e) => e.type === 'harvest')
    expect(harvest && harvest.type === 'harvest' ? harvest.tokens : -1).toBe(0)
    expect(balance(w.s)).toBe(0)
    expect(dayStats(w.s, new Date(T0).setHours(0, 0, 0, 0), w.now).tomatoes).toBe(2)
    // Turned back on, the same ledger pays again.
    w.do({ type: 'ledger/update', id: pro.id, patch: { pays: true, theme: 'teal' } })
    expect(w.ledger('PRO').pays).toBe(true)
    expect(w.ledger('PRO').theme).toBe('teal')
  })

  it('a harvest counts every tomato in the day, not one per entry', () => {
    const w = world()
    w.do({ type: 'entry/capture', text: 'legal: a' })
    w.do({ type: 'desk/deploy', mode: 'pomodoro', entryId: w.entry('a').id })
    w.wait(2 * 30 * MIN + 1000)
    w.do({ type: 'entry/complete', id: w.entry('a').id })
    const today = dayStats(w.s, new Date(T0).setHours(0, 0, 0, 0), w.now)
    expect(today.tomatoes).toBe(2)
    expect(today.tokens).toBe(2)
  })
})

describe('the quick drawer', () => {
  it('keeps notes and a checklist under an entry, and edits a rule under a leisure item', () => {
    const w = world()
    w.do({ type: 'entry/capture', text: 'legal: a' })
    const a = w.entry('a')
    w.do({ type: 'entry/note', id: a.id, text: '  call before noon  ' })
    w.do({ type: 'entry/subtask-add', id: a.id, text: 'find the lease' })
    w.do({ type: 'entry/subtask-add', id: a.id, text: 'draft the letter' })
    const first = w.entry('a').subtasks![0]
    w.do({ type: 'entry/subtask-toggle', id: a.id, subId: first.id })
    w.do({ type: 'entry/subtask-edit', id: a.id, subId: first.id, text: 'find the lease (box 2)' })
    expect(w.entry('a').notes).toBe('call before noon')
    expect(w.entry('a').subtasks!.map((t) => [t.text, t.done])).toEqual([['find the lease (box 2)', true], ['draft the letter', false]])
    w.do({ type: 'entry/subtask-delete', id: a.id, subId: first.id })
    expect(w.entry('a').subtasks).toHaveLength(1)
    w.do({ type: 'entry/note', id: a.id, text: '   ' })
    expect(w.entry('a').notes).toBeUndefined()
    w.do({ type: 'leisure/add', title: 'twitch stream' })
    const it = w.s.leisure[0]
    w.do({ type: 'leisure/cue-add', id: it.id, text: 'one game' })
    w.do({ type: 'leisure/cue-edit', id: it.id, index: 0, text: 'one game, then the desk' })
    expect(w.s.leisure[0].cues).toEqual(['one game, then the desk'])
    expect(DEFAULT_HOTKEYS.drawer).toBe('Alt+Shift+R')
  })
})

describe('text size', () => {
  it('is per area, clamped, and stays with the machine', () => {
    const w = world()
    w.do({ type: 'settings/update', patch: { text: { pet: 1.3, deck: 9, plus: 0.1 } } })
    expect(w.s.settings.text).toEqual({ pet: 1.3, deck: 1.6, plus: 0.8 })
    expect(DEVICE_SETTINGS).toContain('text')
  })
})

describe('format', () => {
  it('formats clocks', () => {
    expect(clock(25 * MIN)).toBe('25:00')
    expect(clock(1)).toBe('00:01')
    expect(clock(62 * MIN)).toBe('1:02:00')
  })
})

describe('sync', () => {
  it('a synced state replaces entries and ledgers but keeps this machine\'s own settings', () => {
    const w = world()
    w.do({ type: 'settings/update', patch: { hotkeys: { ...w.s.settings.hotkeys, plus: 'Ctrl+Alt+T' }, hudScale: 1.3, focusMin: 30 } })
    const other = structuredClone(w.s)
    other.entries = [{ ...other.entries[0] ?? { id: 'x', title: 'from the other machine', ledgerId: null, estimateMin: null, createdAt: T0, doneAt: null, order: 0 }, title: 'from the other machine' } as never]
    other.settings = { ...other.settings, hotkeys: { ...other.settings.hotkeys, plus: 'Alt+T' }, hudScale: 0.8, focusMin: 50 }
    w.do({ type: 'sync/replace', state: other })
    expect(w.s.entries.map((e) => e.title)).toEqual(['from the other machine'])
    expect(w.s.settings.hotkeys.plus).toBe('Ctrl+Alt+T')
    expect(w.s.settings.hudScale).toBe(1.3)
    expect(w.s.settings.focusMin).toBe(50)
  })

  it('a desk running on the other machine arrives paused', () => {
    const w = world()
    const other = structuredClone(w.s)
    const r = reduce(other, { type: 'desk/deploy', mode: 'pomodoro', ledgerId: other.ledgers[0].id }, { now: T0, newId: () => 'o1', random: () => 0.5, device: 'here' })
    expect(r.state.desk.status).toBe('running')
    w.do({ type: 'sync/replace', state: r.state })
    expect(w.s.desk.status).toBe('paused')
  })

  it('garbage from the server is ignored', () => {
    const w = world()
    const before = w.s
    w.do({ type: 'sync/replace', state: { nope: true } })
    expect(w.s).toBe(before)
  })
})

describe('the AI clerk', () => {
  it('a filing that names a real ledger is used as given', () => {
    const w = world()
    const dnc = w.ledger('DNC')
    w.do({ type: 'entry/capture', text: 'practice the footwork combo for 20', filing: { title: 'practice the footwork combo', ledgerId: dnc.id, estimateMin: 20, log: "filed 'practice the footwork combo' -> DNC (clerk, test)" } })
    const e = w.entry('practice the footwork combo')
    expect(e.ledgerId).toBe(dnc.id)
    expect(e.estimateMin).toBe(20)
    expect(w.s.clerkLog.at(-1)?.text).toContain('clerk, test')
  })

  it('a filing that names a ledger that does not exist falls back to the prefix clerk', () => {
    const w = world()
    w.do({ type: 'entry/capture', text: 'legal: reply to the landlord', filing: { title: 'reply to the landlord', ledgerId: 'nope', estimateMin: null, log: 'bad' } })
    expect(w.entry('reply to the landlord').ledgerId).toBe(w.ledger('LGL').id)
  })
})

describe('the tray sweep', () => {
  it('entry/file moves a tray entry into a ledger and logs it', () => {
    const w = world()
    w.do({ type: 'entry/capture', text: 'apply for 10 jobs' })
    const e = w.entry('apply for 10 jobs')
    expect(e.ledgerId).toBeNull()
    w.do({ type: 'entry/file', id: e.id, ledgerId: w.ledger('CAR').id, estimateMin: 90, log: "filed 'apply for 10 jobs' -> CAR (clerk, test)" })
    expect(w.entry('apply for 10 jobs').ledgerId).toBe(w.ledger('CAR').id)
    expect(w.entry('apply for 10 jobs').estimateMin).toBe(90)
    expect(w.s.clerkLog.at(-1)?.text).toContain('-> CAR')
  })

  it('entry/file ignores unknown ledgers and cleared entries', () => {
    const w = world()
    w.do({ type: 'entry/capture', text: 'book a haircut' })
    const e = w.entry('book a haircut')
    w.do({ type: 'entry/file', id: e.id, ledgerId: 'nope', estimateMin: null, log: 'x' })
    expect(w.entry('book a haircut').ledgerId).toBeNull()
  })
})

describe('house rules', () => {
  it('moving an entry the clerk filed teaches a rule naming both ledgers', () => {
    const w = world()
    const car = w.ledger('CAR'), dnc = w.ledger('DNC')
    w.do({ type: 'entry/capture', text: 'battle prep drills', filing: { title: 'battle prep drills', ledgerId: car.id, estimateMin: null, log: 'x', model: 'test' } })
    const e = w.entry('battle prep drills')
    expect(e.clerkFiled?.ledgerId).toBe(car.id)
    w.do({ type: 'entry/update', id: e.id, patch: { ledgerId: dnc.id } })
    expect(w.s.houseRules).toHaveLength(1)
    expect(w.s.houseRules[0].text).toBe('Entries like "battle prep drills" go to Dance, not Career.')
    expect(w.entry('battle prep drills').clerkFiled).toBeUndefined()
    // Moving it again is the user's own business, not a correction of the clerk.
    w.do({ type: 'entry/update', id: e.id, patch: { ledgerId: car.id } })
    expect(w.s.houseRules).toHaveLength(1)
  })

  it('an entry filed by prefix teaches nothing when moved', () => {
    const w = world()
    w.do({ type: 'entry/capture', text: 'career: tailor resume' })
    w.do({ type: 'entry/update', id: w.entry('tailor resume').id, patch: { ledgerId: w.ledger('LGL').id } })
    expect(w.s.houseRules).toHaveLength(0)
  })

  it('rules can be written, edited and removed by hand', () => {
    const w = world()
    w.do({ type: 'rule/add', text: 'Anything about visas is Legal.' })
    const id = w.s.houseRules[0].id
    w.do({ type: 'rule/update', id, text: 'Anything about visas or forms is Legal.' })
    expect(w.s.houseRules[0].text).toContain('forms')
    w.do({ type: 'rule/delete', id })
    expect(w.s.houseRules).toHaveLength(0)
  })
})

describe('an unsure clerk', () => {
  it('keeps its guess and its doubt until the user moves or confirms the entry', () => {
    const w = world()
    const car = w.ledger('CAR')
    w.do({ type: 'entry/capture', text: 'oct 26 on page', filing: { title: 'oct 26 on page', ledgerId: car.id, estimateMin: null, log: 'x', model: 'test', confidence: 'unsure' } })
    const e = w.entry('oct 26 on page')
    expect(e.ledgerId).toBe(car.id)
    expect(e.clerkFiled?.confidence).toBe('unsure')
    w.do({ type: 'entry/confirm', id: e.id })
    expect(w.entry('oct 26 on page').clerkFiled?.confidence).toBe('sure')
    expect(w.s.houseRules).toHaveLength(0)
  })
})

describe('explaining to the clerk', () => {
  it('a move raises the question and the answer lands in the learned rule', () => {
    const w = world()
    const car = w.ledger('CAR'), dnc = w.ledger('DNC')
    w.do({ type: 'entry/capture', text: 'on page sprint review', filing: { title: 'on page sprint review', ledgerId: dnc.id, estimateMin: null, log: 'x', model: 'test' } })
    const e = w.entry('on page sprint review')
    const r = w.do({ type: 'entry/update', id: e.id, patch: { ledgerId: car.id } })
    const q = r.events.find((x) => x.type === 'clerk-wonders')
    expect(q && q.type === 'clerk-wonders' && q.reason).toBe('moved')
    w.do({ type: 'rule/explain', entryId: e.id, ruleId: q && q.type === 'clerk-wonders' ? q.ruleId : null, text: 'On Page is the company I work for.' })
    expect(w.s.houseRules[0].text).toBe('Entries like "on page sprint review" go to Career, not Dance. On Page is the company I work for.')
  })

  it('a confirmation with an answer writes a new rule', () => {
    const w = world()
    const lgl = w.ledger('LGL')
    w.do({ type: 'entry/capture', text: 'oct 26 on page', filing: { title: 'oct 26 on page', ledgerId: lgl.id, estimateMin: null, log: 'x', model: 'test', confidence: 'unsure' } })
    const e = w.entry('oct 26 on page')
    const r = w.do({ type: 'entry/confirm', id: e.id })
    expect(r.events.some((x) => x.type === 'clerk-wonders' && x.reason === 'confirmed')).toBe(true)
    w.do({ type: 'rule/explain', entryId: e.id, ruleId: null, text: 'the contract deadline' })
    expect(w.s.houseRules[0].text).toBe('"oct 26 on page" belongs in Legal: the contract deadline')
  })
})

describe('the couch', () => {
  function rich() {
    const w = world()
    w.do({ type: 'desk/deploy', mode: 'pomodoro', ledgerId: w.ledger('CAR').id })
    w.wait(3 * 25 * MIN + 10 * MIN + 5000)
    w.do({ type: 'desk/standDown' })
    return w
  }

  it('a completed leisure block costs one token, rests are free, a block left early is free, nothing is earned', () => {
    const w = rich()
    const before = balance(w.s)
    expect(before).toBe(3)
    w.do({ type: 'leisure/add', title: 'civilization 6' })
    const civ = w.s.leisure[0]
    w.do({ type: 'desk/deploy', mode: 'couch', leisureId: civ.id })
    expect(w.s.desk.block?.kind).toBe('leisure')
    expect(w.s.desk.block?.durationMs).toBe(25 * MIN)
    // Nothing is taken until the block completes.
    expect(balance(w.s)).toBe(before)
    w.wait(25 * MIN + 1000)
    expect(w.s.desk.block?.kind).toBe('rest')
    expect(balance(w.s)).toBe(before - 1)
    w.wait(5 * MIN + 1000)
    expect(w.s.desk.block?.kind).toBe('leisure')
    expect(balance(w.s)).toBe(before - 1)
    const tomatoes = w.s.tokens.filter((t) => t.reason === 'tomato').length
    w.do({ type: 'desk/standDown' })
    expect(w.s.tokens.filter((t) => t.reason === 'tomato').length).toBe(tomatoes)
    // A block left early costs nothing.
    expect(balance(w.s)).toBe(before - 1)
    expect(w.s.desk.status).toBe('idle')
  })

  it('the couch ends on its own when the tokens run out', () => {
    const w = rich()
    w.do({ type: 'leisure/add', title: 'young sheldon' })
    w.do({ type: 'desk/deploy', mode: 'couch', leisureId: w.s.leisure[0].id })
    w.wait(3 * 25 * MIN + 2 * 5 * MIN + 15 * MIN + 5000)
    expect(balance(w.s)).toBe(0)
    expect(w.s.desk.status).toBe('idle')
  })

  it('cannot be started with no tokens', () => {
    const w = world()
    w.do({ type: 'leisure/add', title: 'slay the spire 2' })
    const r = w.do({ type: 'desk/deploy', mode: 'couch', leisureId: w.s.leisure[0].id })
    expect(w.s.desk.status).toBe('idle')
    expect(r.events.some((e) => e.type === 'notice' && e.text.startsWith('No coins'))).toBe(true)
  })

  it('the clerk sends entertainment to the couch list, not the flow', () => {
    const w = world()
    w.do({ type: 'entry/capture', text: 'play civilization 6', filing: { title: 'play civilization 6', ledgerId: null, estimateMin: null, log: 'x', model: 'test', leisure: true } })
    expect(w.s.entries.map((e) => e.title)).not.toContain('play civilization 6')
    expect(w.s.leisure.map((x) => x.title)).toContain('play civilization 6')
    w.do({ type: 'entry/capture', text: 'stream watch 2026' })
    const e = w.entry('stream watch 2026')
    w.do({ type: 'entry/toLeisure', id: e.id })
    expect(w.s.entries.some((x) => x.id === e.id)).toBe(false)
    expect(w.s.leisure.map((x) => x.title)).toContain('stream watch 2026')
  })
})

describe('the quick switch', () => {
  it('parks the task behind a rest, never the rest timer', () => {
    const w = world()
    for (const title of ['a', 'b']) w.do({ type: 'entry/capture', text: `legal: ${title}` })
    const a = w.entry('a').id, b = w.entry('b').id
    w.do({ type: 'desk/deploy', mode: 'pomodoro', entryId: a })
    w.wait(26 * MIN)
    expect(w.s.desk.block?.kind).toBe('rest')
    w.do({ type: 'desk/select', entryId: b })
    expect(w.s.desk.holster?.block).toMatchObject({ kind: 'focus', entryId: a })
    expect(switchTarget(w.s)).toBe('a')
    w.wait(2 * MIN)
    w.do({ type: 'desk/switch' })
    expect(w.s.desk.block).toMatchObject({ kind: 'focus', entryId: a })
    expect(blockView(w.s, w.now)?.remainingMs).toBe(25 * MIN)
    expect(w.entry('a').tomatoes).toBe(1)
    w.do({ type: 'desk/switch' })
    expect(w.s.desk.block?.entryId).toBe(b)
    expect(blockView(w.s, w.now)?.remainingMs).toBe(23 * MIN)
  })

  it('switches out of a rest to the previous real task in the same sitting', () => {
    const w = world()
    for (const title of ['a', 'b']) w.do({ type: 'entry/capture', text: `legal: ${title}` })
    w.do({ type: 'desk/deploy', mode: 'pomodoro', entryId: w.entry('a').id })
    w.do({ type: 'desk/swap', entryId: w.entry('b').id })
    w.wait(26 * MIN)
    expect(switchTarget(w.s)).toBe('a')
    w.do({ type: 'desk/switch' })
    expect(w.s.desk.block).toMatchObject({ kind: 'focus', entryId: w.entry('a').id })
    expect(switchTarget(w.s)).toBe('b')
    expect(w.s.desk.status).toBe('running')
    expect(w.s.sittings).toHaveLength(1)
    expect(blockView(w.s, w.now)?.remainingMs).toBe(25 * MIN)
  })

  it('returns to the last task from a rest when there is no other task', () => {
    const w = world()
    w.do({ type: 'entry/capture', text: 'legal: a' })
    w.do({ type: 'desk/deploy', mode: 'pomodoro', entryId: w.entry('a').id })
    w.wait(25 * MIN)
    expect(switchTarget(w.s)).toBe('a')
    w.do({ type: 'desk/switch' })
    expect(w.s.desk.block).toMatchObject({ kind: 'focus', entryId: w.entry('a').id })
    expect(blockView(w.s, w.now)?.remainingMs).toBe(25 * MIN)
  })

  it('remembers the last superset slot rather than the upcoming slot across a parked rest', () => {
    const w = world()
    w.do({ type: 'desk/deploy', mode: 'superset', supersetId: w.s.supersets[0].id })
    w.wait(26 * MIN)
    w.do({ type: 'entry/capture', text: 'career: detour', start: true })
    w.do({ type: 'desk/switch' })
    expect(w.s.desk.plan?.mode).toBe('superset')
    expect(w.s.desk.block).toMatchObject({ kind: 'focus', ledgerId: w.ledger('LGL').id, slotIndex: 0 })
    expect(w.s.desk.plan?.step).toBe(0)
    expect(w.s.desk.plan?.focusCount).toBe(1)
    w.do({ type: 'desk/skip' })
    w.do({ type: 'desk/skip' })
    expect(w.s.desk.block).toMatchObject({ kind: 'focus', ledgerId: w.ledger('DNC').id })
  })

  it('skips a couch rest without charging for it or replaying the completed leisure block', () => {
    const w = world()
    w.do({ type: 'desk/deploy', mode: 'pomodoro', ledgerId: w.ledger('CAR').id })
    w.wait(55 * MIN)
    w.do({ type: 'desk/standDown' })
    expect(balance(w.s)).toBe(2)
    w.do({ type: 'leisure/add', title: 'Stream watch' })
    const leisureId = w.s.leisure[0].id
    w.do({ type: 'desk/deploy', mode: 'couch', leisureId })
    w.wait(26 * MIN)
    expect(balance(w.s)).toBe(1)
    w.do({ type: 'entry/capture', text: 'legal: a', start: true })
    w.do({ type: 'desk/switch' })
    expect(w.s.desk.block).toMatchObject({ kind: 'leisure', leisureId, round: 2 })
    expect(blockView(w.s, w.now)?.remainingMs).toBe(25 * MIN)
    expect(balance(w.s)).toBe(1)
    w.wait(25 * MIN)
    expect(balance(w.s)).toBe(0)
    expect(new Set(w.s.tokens.filter(t => t.reason === 'leisure').map(t => t.id)).size).toBe(2)
  })

  it('resolves a rest parked by an older build from its recorded task', () => {
    const w = world()
    for (const title of ['a', 'b']) w.do({ type: 'entry/capture', text: `legal: ${title}` })
    w.do({ type: 'desk/deploy', mode: 'pomodoro', entryId: w.entry('a').id })
    w.wait(26 * MIN)
    const d = w.s.desk
    const oldHeld = { sittingId: d.sittingId!, plan: structuredClone(d.plan!), block: structuredClone(d.block!), bankMs: MIN }
    w.do({ type: 'desk/select', entryId: w.entry('b').id })
    w.s.desk.holster = oldHeld
    // JSON round-trip models a save loaded from before restTask existed.
    w.do({ type: 'sync/replace', state: JSON.parse(JSON.stringify(w.s)) })
    expect(switchTarget(w.s)).toBe('a')
    w.do({ type: 'desk/switch' })
    expect(w.s.desk.block).toMatchObject({ kind: 'focus', entryId: w.entry('a').id })
    expect(blockView(w.s, w.now)?.remainingMs).toBe(25 * MIN)
    expect(w.entry('a').tomatoes).toBe(1)
  })

  it('does not resurrect a cleared task behind a rest', () => {
    const w = world()
    w.do({ type: 'entry/capture', text: 'legal: a' })
    w.do({ type: 'desk/deploy', mode: 'pomodoro', entryId: w.entry('a').id })
    w.wait(25 * MIN)
    w.do({ type: 'entry/complete', id: w.entry('a').id })
    w.do({ type: 'desk/switch' })
    expect(w.s.desk.block).toMatchObject({ kind: 'focus', entryId: null, ledgerId: w.ledger('LGL').id })
    expect(balance(w.s)).toBe(1)
  })

  it('does not start another leisure block from rest when the last coin was spent', () => {
    const w = world()
    w.do({ type: 'desk/deploy', mode: 'pomodoro', ledgerId: w.ledger('CAR').id })
    w.wait(25 * MIN)
    w.do({ type: 'desk/standDown' })
    w.do({ type: 'leisure/add', title: 'Stream watch' })
    w.do({ type: 'desk/deploy', mode: 'couch', leisureId: w.s.leisure[0].id })
    w.wait(25 * MIN)
    expect(balance(w.s)).toBe(0)
    w.do({ type: 'desk/switch' })
    expect(w.s.desk.block?.kind).toBe('rest')
    w.do({ type: 'entry/capture', text: 'legal: a', start: true })
    w.do({ type: 'desk/switch' })
    expect(w.s.desk.block?.entryId).toBe(w.entry('a').id)
    expect(balance(w.s)).toBe(0)
  })

  it('resumes the same task from its rest without parking a second copy', () => {
    const w = world()
    w.do({ type: 'entry/capture', text: 'legal: a' })
    const id = w.entry('a').id
    w.do({ type: 'desk/deploy', mode: 'pomodoro', entryId: id })
    w.wait(25 * MIN)
    w.do({ type: 'desk/select', entryId: id })
    expect(w.s.desk.block).toMatchObject({ kind: 'focus', entryId: id })
    expect(w.s.sittings).toHaveLength(1)
    expect(w.s.desk.holster).toBeNull()
  })

  it('commits a final menu choice as one swap and resumes only that task', () => {
    const w = world()
    for (const title of ['a', 'b', 'c']) w.do({ type: 'entry/capture', text: `legal: ${title}` })
    w.do({ type: 'desk/deploy', mode: 'pomodoro', entryId: w.entry('a').id })
    w.wait(2 * MIN)
    w.do({ type: 'desk/pause' })
    // b was only a menu preview. The engine receives c when the menu closes.
    w.do({ type: 'desk/select', entryId: w.entry('c').id })
    expect(w.s.desk.status).toBe('running')
    expect(w.s.desk.block?.entryId).toBe(w.entry('c').id)
    expect(switchTarget(w.s)).toBe('a')
    expect(blockView(w.s, w.now)?.remainingMs).toBe(23 * MIN)
    expect(w.s.segments.some(x => x.entryId === w.entry('b').id)).toBe(false)
  })

  it('starts a final menu choice from idle and refuses a choice cleared while browsing', () => {
    const w = world()
    w.do({ type: 'entry/capture', text: 'legal: a' })
    const id = w.entry('a').id
    w.do({ type: 'desk/select', entryId: id })
    expect(w.s.desk.block?.entryId).toBe(id)
    expect(w.s.desk.status).toBe('running')
    w.do({ type: 'desk/standDown' })
    w.do({ type: 'entry/complete', id })
    w.do({ type: 'desk/select', entryId: id })
    expect(w.s.desk.status).toBe('idle')
  })

  it('selecting the current leisure item keeps its timer and the previous task', () => {
    const w = world()
    w.do({ type: 'desk/deploy', mode: 'pomodoro', ledgerId: w.ledger('CAR').id })
    w.wait(25 * MIN)
    w.do({ type: 'desk/skip' })
    const workId = w.s.desk.sittingId
    w.do({ type: 'leisure/add', title: 'Stream watch' })
    const leisureId = w.s.leisure[0].id
    w.do({ type: 'desk/deploy', mode: 'couch', leisureId })
    w.wait(3 * MIN)
    const sittingId = w.s.desk.sittingId
    w.do({ type: 'desk/pause' })
    w.do({ type: 'desk/deploy', mode: 'couch', leisureId })
    expect(w.s.desk.sittingId).toBe(sittingId)
    expect(w.s.desk.status).toBe('running')
    expect(blockView(w.s, w.now)?.remainingMs).toBe(22 * MIN)
    expect(w.s.desk.holster?.sittingId).toBe(workId)
    w.do({ type: 'desk/switch' })
    expect(w.s.desk.block?.kind).toBe('focus')
    expect(w.s.desk.sittingId).toBe(workId)
    expect(w.s.sittings.find(x => x.id === workId)?.endedAt).toBeNull()
  })

  it('selecting a parked task resumes its existing timer instead of starting another sitting', () => {
    const w = world()
    w.do({ type: 'entry/capture', text: 'legal: a' })
    w.do({ type: 'entry/capture', text: 'dance: b' })
    const a = w.entry('a').id, b = w.entry('b').id
    w.do({ type: 'desk/deploy', mode: 'pomodoro', entryId: a })
    w.wait(4 * MIN)
    const sittingId = w.s.desk.sittingId
    w.do({ type: 'desk/deploy', mode: 'pomodoro', entryId: b })
    w.wait(2 * MIN)
    w.do({ type: 'desk/deploy', mode: 'pomodoro', entryId: a })
    expect(w.s.desk.sittingId).toBe(sittingId)
    expect(w.s.sittings).toHaveLength(2)
    expect(blockView(w.s, w.now)?.remainingMs).toBe(21 * MIN)
    expect(switchTarget(w.s)).toBe('b')
    expect(w.s.sittings.every(x => x.endedAt === null)).toBe(true)
  })

  it('selecting the current focus task preserves its timer and swap-back entry', () => {
    const w = world()
    w.do({ type: 'entry/capture', text: 'legal: a' })
    w.do({ type: 'entry/capture', text: 'dance: b' })
    w.do({ type: 'desk/deploy', mode: 'pomodoro', entryId: w.entry('a').id })
    w.wait(2 * MIN)
    w.do({ type: 'desk/swap', entryId: w.entry('b').id })
    w.do({ type: 'desk/deploy', mode: 'pomodoro', entryId: w.entry('b').id })
    expect(blockView(w.s, w.now)?.remainingMs).toBe(23 * MIN)
    expect(switchTarget(w.s)).toBe('a')
    expect(w.s.sittings).toHaveLength(1)
  })

  it('does not switch to an older saved copy of the current task', () => {
    const w = world()
    w.do({ type: 'entry/capture', text: 'legal: a' })
    w.do({ type: 'desk/deploy', mode: 'pomodoro', entryId: w.entry('a').id })
    w.wait(2 * MIN)
    // Old builds could leave the same entry parked with a different clock.
    const d = w.s.desk
    d.holster = { sittingId: 'old-copy', plan: structuredClone(d.plan!), block: structuredClone(d.block!), bankMs: 10 * MIN }
    expect(switchTarget(w.s)).toBeNull()
    const r = w.do({ type: 'desk/switch' })
    expect(r.events.some(e => e.type === 'switch')).toBe(false)
    expect(blockView(w.s, w.now)?.remainingMs).toBe(23 * MIN)
  })

  it('parks the running session with its clock where it is and brings the other back where it was', () => {
    const w = world()
    w.do({ type: 'desk/deploy', mode: 'pomodoro', ledgerId: w.ledger('CAR').id })
    w.wait(3 * 25 * MIN + 2 * 5 * MIN + 15 * MIN + 5000)
    w.do({ type: 'desk/standDown' })
    expect(balance(w.s)).toBe(3)
    w.do({ type: 'entry/capture', text: 'career: read the book ~60' })
    const book = w.entry('read the book')
    w.do({ type: 'leisure/add', title: 'twitch stream' })
    const stream = w.s.leisure[0]
    // Reading first: 7 minutes in.
    w.do({ type: 'desk/deploy', mode: 'pomodoro', entryId: book.id })
    w.wait(7 * MIN)
    // On the couch: the reading session is parked at 7 minutes.
    w.do({ type: 'desk/deploy', mode: 'couch', leisureId: stream.id })
    expect(w.s.desk.block?.kind).toBe('leisure')
    expect(w.s.desk.holster?.block.entryId).toBe(book.id)
    expect(w.s.desk.holster?.bankMs).toBe(7 * MIN)
    expect(balance(w.s)).toBe(3)
    w.wait(3 * MIN)
    // Rookie dies: back to the book at 18 minutes left, the stream parked at 3 minutes in.
    const r = w.do({ type: 'desk/switch' })
    expect(r.events.some((e) => e.type === 'switch')).toBe(true)
    expect(w.s.desk.block?.entryId).toBe(book.id)
    expect(blockView(w.s, w.now)?.remainingMs).toBe(18 * MIN)
    expect(w.s.desk.holster?.block.kind).toBe('leisure')
    expect(w.s.desk.holster?.bankMs).toBe(3 * MIN)
    w.wait(2 * MIN)
    // And back: the stream resumes at 22 minutes left, no second token taken.
    w.do({ type: 'desk/switch' })
    expect(w.s.desk.block?.kind).toBe('leisure')
    expect(blockView(w.s, w.now)?.remainingMs).toBe(22 * MIN)
    expect(balance(w.s)).toBe(3)
    expect(w.s.desk.holster?.bankMs).toBe(9 * MIN)
    // Getting up returns the parked book, paused where it was.
    w.do({ type: 'desk/standDown' })
    expect(w.s.desk.status).toBe('paused')
    expect(w.s.desk.block?.entryId).toBe(book.id)
    expect(w.s.desk.bankMs).toBe(9 * MIN)
    expect(w.s.desk.holster).toBeNull()
  })

  it('with nothing parked the switch only says so', () => {
    const w = world()
    const r = w.do({ type: 'desk/switch' })
    expect(r.events.some((e) => e.type === 'notice')).toBe(true)
  })

  it('with nothing parked, goes back to the entry before the last swap, and only the last two count', () => {
    const w = world()
    w.do({ type: 'entry/capture', text: 'legal: a' })
    w.do({ type: 'entry/capture', text: 'dance: b' })
    w.do({ type: 'entry/capture', text: 'career: c' })
    const [a, b, c] = [w.entry('a'), w.entry('b'), w.entry('c')]
    w.do({ type: 'desk/deploy', mode: 'pomodoro', entryId: a.id })
    w.wait(2 * MIN)
    w.do({ type: 'desk/swap', entryId: b.id })
    w.wait(MIN)
    w.do({ type: 'desk/swap', entryId: c.id })
    expect(switchTarget(w.s)).toBe('b')
    // a dropped out: the switch goes to b, then back to c, never to a, all in one sitting.
    const r = w.do({ type: 'desk/switch' })
    expect(r.events.some((e) => e.type === 'switch')).toBe(true)
    expect(w.s.desk.block?.entryId).toBe(b.id)
    expect(switchTarget(w.s)).toBe('c')
    w.do({ type: 'desk/switch' })
    expect(w.s.desk.block?.entryId).toBe(c.id)
    expect(w.s.sittings).toHaveLength(1)
    expect(w.s.desk.holster).toBeNull()
    expect(blockView(w.s, w.now)?.remainingMs).toBe(22 * MIN)
  })

  it('a swap after a redeploy beats the parked session: only the last two places count', () => {
    const w = world()
    w.do({ type: 'entry/capture', text: 'legal: a' })
    w.do({ type: 'entry/capture', text: 'dance: b' })
    const [a, b] = [w.entry('a'), w.entry('b')]
    w.do({ type: 'desk/deploy', mode: 'pomodoro', ledgerId: w.ledger('CAR').id })
    w.wait(4 * MIN)
    // Deploying on a parks the Career session: the switch would bring it back.
    w.do({ type: 'desk/deploy', mode: 'pomodoro', entryId: a.id })
    expect(switchTarget(w.s)).toBe('Career')
    // A swap to b makes a the other half; Career is still parked but out of the switch.
    w.do({ type: 'desk/swap', entryId: b.id })
    expect(switchTarget(w.s)).toBe('a')
    w.do({ type: 'desk/switch' })
    expect(w.s.desk.block?.entryId).toBe(a.id)
    expect(w.s.desk.holster?.block.label).toBe('Career')
    // Standing down still returns the parked session, paused.
    w.do({ type: 'desk/standDown' })
    expect(w.s.desk.status).toBe('paused')
    expect(w.s.desk.block?.label).toBe('Career')
    expect(w.s.desk.bankMs).toBe(4 * MIN)
  })

  it('a cleared entry on the other side of the switch gives way to its ledger', () => {
    const w = world()
    w.do({ type: 'entry/capture', text: 'legal: a' })
    w.do({ type: 'entry/capture', text: 'dance: b' })
    const [a, b] = [w.entry('a'), w.entry('b')]
    w.do({ type: 'desk/deploy', mode: 'pomodoro', entryId: a.id })
    w.do({ type: 'desk/swap', entryId: b.id })
    w.do({ type: 'entry/complete', id: a.id })
    expect(switchTarget(w.s)).toBe('Legal')
    w.do({ type: 'desk/switch' })
    expect(w.s.desk.block?.ledgerId).toBe(w.ledger('LGL').id)
    expect(w.s.desk.block?.entryId).toBe(null)
  })

  it('counts the tomatoes grown on an entry, the one ripening as a fraction', () => {
    const w = world()
    w.do({ type: 'entry/capture', text: 'legal: a' })
    const a = w.entry('a')
    expect(entryTomatoes(w.s, a.id, w.now)).toBe(0)
    w.do({ type: 'desk/deploy', mode: 'pomodoro', entryId: a.id })
    w.wait(5 * MIN)
    expect(entryTomatoes(w.s, a.id, w.now)).toBeCloseTo(0.2, 5)
    w.wait(20 * MIN)
    expect(Math.floor(entryTomatoes(w.s, a.id, w.now))).toBe(1)
    expect(w.entry('a').tomatoes).toBe(1)
  })

  it('cues are plain words on a leisure item', () => {
    const w = world()
    w.do({ type: 'leisure/add', title: 'twitch stream' })
    const id = w.s.leisure[0].id
    w.do({ type: 'leisure/cue-add', id, text: 'rookie dies in game' })
    w.do({ type: 'leisure/cue-add', id, text: 'ad break' })
    expect(w.s.leisure[0].cues).toEqual(['rookie dies in game', 'ad break'])
    w.do({ type: 'leisure/cue-delete', id, index: 0 })
    expect(w.s.leisure[0].cues).toEqual(['ad break'])
  })

  it('the switch hotkey exists on an older save', () => {
    const w = world()
    const old = structuredClone(w.s) as unknown as { settings: { hotkeys: Record<string, string> }; leisure: unknown[] }
    delete old.settings.hotkeys.switch
    old.leisure = [{ id: 'l1', title: 'old item', createdAt: T0, archivedAt: null }]
    w.do({ type: 'sync/replace', state: old })
    expect(w.s.settings.hotkeys.switch).toBe('Alt+Q')
    expect(w.s.leisure[0].cues).toEqual([])
  })
})

describe('the harvest', () => {
  it('tomatoes grow on the entry and pay out when it is cleared', () => {
    const w = world()
    w.do({ type: 'entry/capture', text: 'career: write the report' })
    const e = w.entry('write the report')
    w.do({ type: 'desk/deploy', mode: 'pomodoro', entryId: e.id })
    const r = (() => { w.wait(25 * MIN); return w.events.filter((x) => x.type === 'tomato') })()
    expect(r.at(-1)).toMatchObject({ tokens: 0, entryId: e.id })
    expect(balance(w.s)).toBe(0)
    expect(w.entry('write the report').tomatoes).toBe(1)
    w.wait(5 * MIN + 25 * MIN)
    expect(w.entry('write the report').tomatoes).toBe(2)
    const res = w.do({ type: 'entry/complete', id: e.id })
    expect(res.events.find((x) => x.type === 'harvest')).toMatchObject({ tomatoes: 2, tokens: 2 })
    expect(balance(w.s)).toBe(2)
    expect(w.entry('write the report').tomatoes).toBe(0)
    expect(w.s.tokens.at(-1)?.reason).toBe('harvest')
  })

  it('ledger time with no entry pays as it goes', () => {
    const w = world()
    w.do({ type: 'desk/deploy', mode: 'pomodoro', ledgerId: w.ledger('DNC').id })
    w.wait(25 * MIN)
    expect(balance(w.s)).toBe(1)
  })

  it('a deleted entry forfeits its tomatoes', () => {
    const w = world()
    w.do({ type: 'entry/capture', text: 'legal: abandoned form' })
    const e = w.entry('abandoned form')
    w.do({ type: 'desk/deploy', mode: 'pomodoro', entryId: e.id })
    w.wait(25 * MIN)
    w.do({ type: 'entry/delete', id: e.id })
    expect(balance(w.s)).toBe(0)
  })

  it('an older save gets a tomato count on every entry', () => {
    const w = world()
    const old = structuredClone(w.s) as unknown as { entries: Record<string, unknown>[] }
    old.entries = [{ id: 'e1', title: 'old entry', ledgerId: null, estimateMin: null, order: 1, createdAt: T0, doneAt: null }]
    w.do({ type: 'sync/replace', state: old })
    expect(w.s.entries[0].tomatoes).toBe(0)
  })
})

describe('hotkeys', () => {
  it('defaults are distinct combos, so no key does two things', () => {
    const combos = Object.values(DEFAULT_HOTKEYS)
    expect(new Set(combos).size).toBe(combos.length)
    expect(DEFAULT_HOTKEYS.move).toBe('Alt+G')
  })
})

describe('keymap', () => {
  it('keys the user changed live in settings.keymap and travel with the account', () => {
    const w = world()
    w.do({ type: 'settings/update', patch: { keymap: { 'list.down': ['n', 'ArrowDown'] } } })
    expect(w.s.settings.keymap['list.down']).toEqual(['n', 'ArrowDown'])
    expect(w.s.settings.keymap['list.up']).toBeUndefined()
  })
})

describe('first run', () => {
  it('starts with an empty shelf and nothing in the flow', () => {
    const s = firstRunState(T0, () => 'x')
    expect(s.ledgers).toEqual([])
    expect(s.entries).toEqual([])
    expect(s.supersets).toEqual([])
  })
})

describe('the trash', () => {
  const DAY = 86_400_000
  it('a deleted entry waits in the trash with its time, and a restore brings it back with its tomatoes', () => {
    const w = world()
    w.do({ type: 'entry/capture', text: 'legal: draft the lease ~60' })
    const e = w.entry('draft the lease')
    w.do({ type: 'desk/deploy', mode: 'pomodoro', entryId: e.id })
    w.wait(26 * MIN)
    w.do({ type: 'desk/standDown' })
    expect(entryTomatoes(w.s, e.id, w.now)).toBeGreaterThanOrEqual(1)
    w.do({ type: 'entry/delete', id: e.id })
    expect(w.s.entries.some((x) => x.id === e.id)).toBe(false)
    expect(w.s.trash.map((t) => t.id)).toEqual([e.id])
    expect(w.s.trash[0].deletedAt).toBe(w.now)
    expect(w.s.calendar.blocks.some((b) => b.entryId === e.id)).toBe(false)
    w.do({ type: 'entry/restore', id: e.id })
    expect(w.s.trash).toEqual([])
    const back = w.entry('draft the lease')
    expect(back.ledgerId).toBe(e.ledgerId)
    expect(back.restoredAt).toBe(w.now)
    expect(entryTomatoes(w.s, back.id, w.now)).toBeGreaterThanOrEqual(1)
  })

  it('a restore lands in the tray when the ledger is gone, the trash drops and empties, and old items are purged', () => {
    const w = world()
    w.do({ type: 'entry/capture', text: 'legal: a' })
    w.do({ type: 'entry/capture', text: 'legal: b' })
    w.do({ type: 'entry/capture', text: 'legal: c' })
    const [a, b, c] = ['a', 'b', 'c'].map((t) => w.entry(t))
    w.do({ type: 'entry/delete', id: a.id })
    w.do({ type: 'entry/delete', id: b.id })
    w.do({ type: 'ledger/delete', id: a.ledgerId! })
    w.do({ type: 'entry/restore', id: a.id })
    expect(w.entry('a').ledgerId).toBeNull()
    w.do({ type: 'trash/drop', id: b.id })
    expect(w.s.trash).toEqual([])
    w.do({ type: 'entry/delete', id: c.id })
    const later = reduce(w.s, { type: 'entry/delete', id: w.entry('a').id }, { now: w.now + 31 * DAY, newId: () => 'x', random: () => 0.5, device: 'here' }).state
    expect(later.trash.map((t) => t.title)).toEqual(['a'])
    w.do({ type: 'trash/empty' })
    expect(w.s.trash).toEqual([])
  })

  it('a deletion elsewhere moves the entry to the trash here, and a restore after the last sync beats an older deletion', () => {
    const w = world()
    w.do({ type: 'entry/capture', text: 'legal: shared' })
    const e = w.entry('shared')
    const synced = w.now
    const here = w.s
    const there = reduce(here, { type: 'entry/delete', id: e.id }, { now: synced + 1000, newId: () => 'x', random: () => 0.5, device: 'here' }).state
    const merged = mergeStates(here, there, synced)
    expect(merged.entries.some((x) => x.id === e.id)).toBe(false)
    expect(merged.trash.map((t) => t.id)).toEqual([e.id])
    // Restored here after the deletion there: the restore is newer, so it is kept and the trash lets go.
    const restored = reduce(merged, { type: 'entry/restore', id: e.id }, { now: synced + 5000, newId: () => 'y', random: () => 0.5, device: 'here' }).state
    const again = mergeStates(restored, there, synced + 2000)
    expect(again.entries.some((x) => x.id === e.id)).toBe(true)
    expect(again.trash).toEqual([])
    // Deleted there after the restore here: the deletion is newer and wins.
    const deletedAgain = reduce(restored, { type: 'entry/delete', id: e.id }, { now: synced + 9000, newId: () => 'z', random: () => 0.5, device: 'here' }).state
    const third = mergeStates(restored, deletedAgain, synced + 2000)
    expect(third.entries.some((x) => x.id === e.id)).toBe(false)
    expect(third.trash.map((t) => t.id)).toEqual([e.id])
  })
})

describe('the active device', () => {
  // Two computers on one account. A person's action claims the desk first, as engine.act does.
  const two = () => {
    const mac = world(undefined, 'mac')
    const win = world(undefined, 'win')
    const act = (w: typeof mac, name: string, a: Action) => { w.do({ type: 'desk/claim', name }); w.do(a) }
    const wire = (w: typeof mac) => JSON.parse(JSON.stringify(w.s)) as unknown
    const focusMs = (w: typeof mac) => w.s.segments.filter((x) => x.kind === 'focus').reduce((n, x) => n + (x.end ?? w.now) - x.start, 0)
    act(mac, 'Mac', { type: 'settings/update', patch: { focusMin: 30 } })
    act(mac, 'Mac', { type: 'desk/deploy', mode: 'pomodoro', ledgerId: mac.s.ledgers[0].id })
    mac.wait(12 * MIN)
    win.wait(12 * MIN)
    // The other computer hears of it, holds it, and its copy goes back to the server.
    win.do({ type: 'sync/replace', state: wire(mac) })
    return { mac, win, act, wire, focusMs }
  }

  it('holds the desk on the other computer, and the active one ignores that copy', () => {
    const { mac, win, wire } = two()
    expect(win.s.desk).toMatchObject({ status: 'paused', device: { name: 'Mac' } })
    expect(blockView(win.s, win.now)?.remainingMs).toBe(18 * MIN)
    for (const type of ['sync/replace', 'sync/merge'] as const) {
      const r = reduce(mac.s, type === 'sync/merge' ? { type, state: wire(win), syncedAt: T0 } : { type, state: wire(win) }, { now: mac.now, newId: () => 'x', random: () => 0.5, device: 'mac' }).state
      expect(r.desk.status).toBe('running')
      expect(blockView(r, mac.now)?.remainingMs).toBe(18 * MIN)
      expect(r.segments.filter((x) => x.end === null)).toHaveLength(1)
    }
  })

  it('the active computer never takes an older copy of its own desk from the server', () => {
    // 2026-11-08: a rest ran out on the Mac, the desk moved to a focus block waiting to start,
    // and the next sync brought back the Mac's own push from mid-rest. Same claim on both, since
    // the clock advancing claims nothing; the tie went to the copy that was running.
    const mac = world(undefined, 'mac')
    const wire = () => JSON.parse(JSON.stringify(mac.s)) as unknown
    mac.do({ type: 'desk/claim', name: 'Mac' })
    mac.do({ type: 'settings/update', patch: { focusMin: 25, shortRestMin: 5, autoStartFocus: false, autoStartRest: true } })
    mac.do({ type: 'desk/claim', name: 'Mac' })
    mac.do({ type: 'desk/deploy', mode: 'pomodoro', ledgerId: mac.s.ledgers[0].id })
    mac.wait(25 * MIN + 1000)
    expect(mac.s.desk.block?.kind).toBe('rest')
    mac.wait(2 * MIN)
    const midRest = wire()
    mac.wait(3 * MIN + 1000)
    expect(mac.s.desk).toMatchObject({ status: 'ready', block: { kind: 'focus' } })
    const before = mac.s.desk
    for (const type of ['sync/replace', 'sync/merge'] as const) {
      const r = reduce(mac.s, type === 'sync/merge' ? { type, state: midRest, syncedAt: T0 } : { type, state: midRest }, { now: mac.now, newId: () => 'x', random: () => 0.5, device: 'mac' }).state
      expect(r.desk).toEqual(before)
      expect(r.segments.filter((x) => x.kind === 'rest' && x.end === null)).toHaveLength(0)
    }
    // A copy of the same desk on another computer still takes the newer state from the server.
    const winCtx = { now: mac.now, newId: () => 'y', random: () => 0.5, device: 'win' }
    const held = reduce(world(undefined, 'win').s, { type: 'sync/replace', state: midRest }, winCtx).state
    expect(held.desk).toMatchObject({ status: 'paused', block: { kind: 'rest' } })
    const other = reduce(held, { type: 'sync/replace', state: wire() }, winCtx).state
    expect(other.desk).toMatchObject({ status: 'ready', block: { kind: 'focus' } })
  })

  it('anything a person does on the other computer takes it over, the clock carried on', () => {
    const { mac, win, act, wire, focusMs } = two()
    mac.wait(5 * MIN)
    win.wait(5 * MIN)
    act(win, 'PC', { type: 'entry/capture', text: 'a note, nothing to do with the desk' })
    expect(win.s.desk).toMatchObject({ status: 'running', device: { name: 'PC' }, heldAt: null })
    expect(blockView(win.s, win.now)?.remainingMs).toBe(13 * MIN)
    // The Mac, which kept running until it heard, ends its run at the takeover and holds.
    mac.wait(MIN)
    win.wait(MIN)
    mac.do({ type: 'sync/merge', state: wire(win), syncedAt: T0 })
    expect(mac.s.desk).toMatchObject({ status: 'paused', device: { name: 'PC' } })
    expect(focusMs(mac)).toBe(18 * MIN)
    // The PC hears back from the Mac and loses nothing either: one 18 minute run, on two computers.
    win.do({ type: 'sync/merge', state: wire(mac), syncedAt: T0 })
    expect(win.s.desk.status).toBe('running')
    expect(blockView(win.s, win.now)?.remainingMs).toBe(12 * MIN)
    expect(focusMs(win)).toBe(18 * MIN)
  })
})

describe('sync merge', () => {
  const ctx = { now: T0 + 60 * MIN, newId: () => `m${Math.random()}`, random: () => 0.5, device: 'here' }
  it('keeps work this machine did since its last sync and takes the server\'s version of what both have', () => {
    const a = world()
    a.do({ type: 'entry/capture', text: 'legal: shared one' })
    const synced = structuredClone(a.s)
    const syncedAt = a.now
    // This machine, after the sync: a new entry.
    a.wait(1000)
    a.do({ type: 'entry/capture', text: 'legal: only here, new' })
    const shared = a.entry('shared one')
    // The server, meanwhile: the shared one renamed by another machine, and one more entry.
    const server = structuredClone(synced)
    server.entries[0].title = 'shared one, renamed'
    server.entries.push({ ...server.entries[0], id: 'srv', title: 'from the other machine', createdAt: syncedAt + 1 })
    const r = reduce(a.s, { type: 'sync/merge', state: server, syncedAt }, ctx)
    const titles = r.state.entries.map((e) => e.title)
    expect(titles).toContain('shared one, renamed')
    expect(titles).toContain('from the other machine')
    expect(titles).toContain('only here, new')
    expect(r.state.entries.find((e) => e.id === shared.id)?.title).toBe('shared one, renamed')
  })
  it('drops an entry only this machine has when it is older than the last sync: it was deleted elsewhere', () => {
    const a = world()
    a.do({ type: 'entry/capture', text: 'legal: deleted on the other machine' })
    const server = structuredClone(a.s)
    server.entries = []
    const r = reduce(a.s, { type: 'sync/merge', state: server, syncedAt: a.now + 1 }, ctx)
    expect(r.state.entries).toEqual([])
  })
  it('unions sittings and coins, so no machine\'s desk time is lost', () => {
    const a = world()
    a.do({ type: 'desk/deploy', mode: 'pomodoro' })
    a.wait(25 * MIN + 1000)
    a.do({ type: 'desk/standDown' })
    const b = world(undefined, 'b')
    b.do({ type: 'desk/deploy', mode: 'pomodoro' })
    b.wait(50 * MIN + 1000)
    b.do({ type: 'desk/standDown' })
    const r = reduce(a.s, { type: 'sync/merge', state: b.s, syncedAt: null }, { ...ctx, now: b.now })
    expect(r.state.sittings.length).toBe(2)
    expect(balance(r.state)).toBe(balance(a.s) + balance(b.s))
  })
  it('leaves the desk alone on the machine that is running it', () => {
    const a = world()
    a.do({ type: 'desk/deploy', mode: 'pomodoro' })
    a.wait(5 * MIN)
    const server = structuredClone(a.s)
    server.desk = { ...server.desk, status: 'paused' }
    const r = reduce(a.s, { type: 'sync/merge', state: server, syncedAt: a.now - 10 * MIN }, { ...ctx, now: a.now })
    expect(r.state.desk.status).toBe('running')
    expect(r.state.desk.sittingId).toBe(a.s.desk.sittingId)
  })
  it('refuses a document it cannot read and leaves the state untouched', () => {
    const a = world()
    const before = a.s
    const r = reduce(a.s, { type: 'sync/merge', state: { schema: 99 }, syncedAt: null }, ctx)
    expect(r.state).toBe(before)
  })
})

describe('skip rest shortcut', () => {
  it('returns to the current task, keeps swap history, and does not mint for the rest', () => {
    const w = world()
    for (const title of ['a', 'b']) w.do({ type: 'entry/capture', text: `legal: ${title}` })
    w.do({ type: 'desk/deploy', mode: 'pomodoro', entryId: w.entry('a').id })
    w.do({ type: 'desk/swap', entryId: w.entry('b').id })
    w.wait(26 * MIN)
    const sittingId = w.s.desk.sittingId
    const crop = w.entry('b').tomatoes
    const coins = balance(w.s)
    const previous = structuredClone(w.s.desk.previous)
    const r = w.do({ type: 'desk/skipRest' })
    expect(w.s.desk).toMatchObject({ status: 'running', sittingId, bankMs: 0, previous, block: { kind: 'focus', entryId: w.entry('b').id } })
    expect(w.s.desk.plan?.focusCount).toBe(1)
    expect(blockView(w.s, w.now)?.remainingMs).toBe(25 * MIN)
    expect(w.entry('b').tomatoes).toBe(crop)
    expect(balance(w.s)).toBe(coins)
    expect(w.s.segments.filter(s => s.end === null)).toHaveLength(1)
    expect(w.s.segments.at(-2)).toMatchObject({ kind: 'rest', end: w.now })
    expect(r.events).toEqual([expect.objectContaining({ type: 'block', started: true })])
    w.wait(MIN)
    const before = w.s
    expect(w.do({ type: 'desk/skipRest' })).toEqual({ state: before, events: [] })
    expect(w.s).toBe(before)
    expect(blockView(w.s, w.now)?.remainingMs).toBe(24 * MIN)
  })

  it.each(['paused', 'ready'] as const)('immediately starts work from a %s rest even with automatic focus off', (status) => {
    const w = world(s => { s.settings.autoStartRest = status !== 'ready'; s.settings.autoStartFocus = false })
    w.do({ type: 'entry/capture', text: 'legal: a' })
    w.do({ type: 'desk/deploy', mode: 'pomodoro', entryId: w.entry('a').id })
    w.wait(25 * MIN)
    if (status === 'paused') w.do({ type: 'desk/pause' })
    expect(w.s.desk.status).toBe(status)
    w.do({ type: 'desk/skipRest' })
    expect(w.s.desk).toMatchObject({ status: 'running', runStartedAt: w.now, block: { kind: 'focus', entryId: w.entry('a').id } })
  })

  it('returns to the same superset task rather than advancing to the next slot', () => {
    const w = world()
    w.do({ type: 'desk/deploy', mode: 'superset', supersetId: w.s.supersets[0].id })
    w.wait(26 * MIN)
    w.do({ type: 'desk/skipRest' })
    expect(w.s.desk.block).toMatchObject({ kind: 'focus', ledgerId: w.ledger('LGL').id, slotIndex: 0 })
    expect(w.s.desk.plan).toMatchObject({ mode: 'superset', step: 0, focusCount: 1 })
  })

  it('does nothing when idle or during held work', () => {
    const w = world()
    const idle = w.s
    expect(w.do({ type: 'desk/skipRest' }).state).toBe(idle)
    w.do({ type: 'desk/deploy', mode: 'pomodoro' })
    w.wait(MIN)
    w.do({ type: 'desk/pause' })
    const paused = w.s
    expect(w.do({ type: 'desk/skipRest' }).state).toBe(paused)
  })

  it('adds the shortcut to older saves and keeps a custom binding', () => {
    const old = world().s
    delete (old.settings.hotkeys as Partial<typeof old.settings.hotkeys>).skipRest
    const loaded = migrate(old)!
    expect(loaded.settings.hotkeys.skipRest).toBe('Alt+R')
    loaded.settings.hotkeys.skipRest = 'Alt+F8'
    expect(migrate(loaded)?.settings.hotkeys.skipRest).toBe('Alt+F8')
  })
})

describe('the couch works like the flow', () => {
  const rich = () => world((s) => { s.tokens.push({ id: 'seed', at: T0, amount: 5, reason: 'tomato', sittingId: null } as never) })

  it('takes couch: and leisure: as a prefix and #couch as a tag', () => {
    const { ledgers } = world().s
    for (const line of ['couch: play civ', 'Leisure: play civ', 'play civ #couch']) {
      expect(prefixClerk.file(line, ledgers)).toMatchObject({ title: 'play civ', ledgerId: null, leisure: true })
    }
  })

  it('leaves the words to a ledger that really has that name', () => {
    const couch = { ...world().s.ledgers[0], name: 'Couch', code: 'CCH' }
    expect(prefixClerk.file('couch: sofa repairs', [couch])).toMatchObject({ ledgerId: couch.id })
    expect(prefixClerk.file('couch: sofa repairs', [couch]).leisure).toBeUndefined()
  })

  it('files to the couch list, and Enter sits down with it for a coin', () => {
    const w = rich()
    w.do({ type: 'entry/capture', text: 'couch: young sheldon' })
    expect(w.s.leisure.filter((x) => x.title === 'young sheldon')).toHaveLength(1)
    expect(w.s.entries.map((e) => e.title)).not.toContain('young sheldon')
    expect(w.s.desk.status).toBe('idle')
    w.do({ type: 'entry/capture', text: 'couch: young sheldon', start: true })
    expect(w.s.leisure.filter((x) => x.title === 'young sheldon')).toHaveLength(1)
    expect(w.s.desk).toMatchObject({ status: 'running', block: { kind: 'leisure', label: 'young sheldon' } })
  })

  it('keeps the item when there is no coin to start it', () => {
    const w = world()
    w.do({ type: 'entry/capture', text: 'couch: young sheldon', start: true })
    expect(w.s.leisure.map((x) => x.title)).toContain('young sheldon')
    expect(w.s.desk.status).toBe('idle')
    expect(w.events.some((e) => e.type === 'notice' && e.text.startsWith('No coins'))).toBe(true)
  })

  it('moves a task just started to the couch when the clerk reads it as entertainment', () => {
    const w = rich()
    w.do({ type: 'entry/capture', text: 'play civ', start: true })
    const e = w.entry('play civ')
    expect(w.s.desk.block?.entryId).toBe(e.id)
    w.do({ type: 'entry/toLeisure', id: e.id, start: true })
    expect(w.s.entries.some((x) => x.id === e.id)).toBe(false)
    expect(w.s.desk).toMatchObject({ status: 'running', block: { kind: 'leisure', label: 'play civ' } })
  })

  it('gives a task swapped in over another its place back before the couch parks it', () => {
    const w = rich()
    w.do({ type: 'entry/capture', text: 'legal: real work' })
    const real = w.entry('real work')
    w.do({ type: 'desk/deploy', mode: 'pomodoro', entryId: real.id })
    w.wait(2 * MIN)
    w.do({ type: 'entry/capture', text: 'play civ', start: true })
    w.do({ type: 'entry/toLeisure', id: w.entry('play civ').id, start: true })
    expect(w.s.desk.block).toMatchObject({ kind: 'leisure', label: 'play civ' })
    expect(w.s.desk.holster?.block.entryId).toBe(real.id)
  })

  it('takes notes and a checklist like an entry does', () => {
    const w = world()
    w.do({ type: 'leisure/add', title: 'civ' })
    const id = w.s.leisure.find((x) => x.title === 'civ')!.id
    w.do({ type: 'entry/note', id, text: 'one game' })
    w.do({ type: 'entry/subtask-add', id, text: 'win' })
    const subId = w.s.leisure.find((x) => x.id === id)!.subtasks![0].id
    w.do({ type: 'entry/subtask-toggle', id, subId })
    expect(w.s.leisure.find((x) => x.id === id)).toMatchObject({ notes: 'one game', subtasks: [{ text: 'win', done: true }] })
  })

  it('is found by search, by title or by the word couch', () => {
    const w = world()
    w.do({ type: 'leisure/add', title: 'civilization 6' })
    const names = (q: string) => findTasks(w.s, q).map((x) => (x.kind === 'entry' ? x.entry.title : x.item.title))
    expect(names('civ')).toContain('civilization 6')
    expect(names('couch')).toContain('civilization 6')
  })
})

describe('resizing the tomato', () => {
  it('keeps the scale inside the range, in steps of five percent', () => {
    expect(clampScale(1.23)).toBe(1.25)
    expect(clampScale(0.1)).toBe(0.7)
    expect(clampScale(9)).toBe(1.6)
  })

  it('grows when the handle is pulled out and up, on either side', () => {
    // The handle's own path: half a tomato sideways and a whole one up is one unit of scale.
    expect(dragScale(1, -12, -24, 'right')).toBe(1.5)
    expect(dragScale(1, 12, -24, 'left')).toBe(1.5)
    expect(dragScale(1, 12, 24, 'right')).toBe(0.7)
    expect(dragScale(1, 0, 0, 'right')).toBe(1)
  })

  it('takes no claim on the desk, since the size belongs to this computer', () => {
    expect(isDeviceOnly({ type: 'settings/update', patch: { hudScale: 1.2 } })).toBe(true)
    expect(isDeviceOnly({ type: 'settings/update', patch: { hudScale: 1.2, focusMin: 30 } })).toBe(false)
    expect(isDeviceOnly({ type: 'desk/pause' })).toBe(false)
  })
})

describe('recent tasks', () => {
  const titles = (w: ReturnType<typeof world>) => recentTasks(w.s).map((x) => (x.kind === 'entry' ? x.entry.title : x.item.title))
  const three = () => {
    const w = world((s) => { s.tokens.push({ id: 'seed', at: T0, amount: 5, reason: 'tomato', sittingId: null } as never) })
    for (const t of ['a', 'b', 'c']) w.do({ type: 'entry/capture', text: `legal: ${t}` })
    const go = (t: string) => { w.do({ type: 'desk/select', entryId: w.entry(t).id, ledgerId: w.entry(t).ledgerId }); w.wait(MIN) }
    return { w, go }
  }

  it('lists what ran, newest first, each once', () => {
    const { w, go } = three()
    go('a'); go('b'); go('c'); go('a')
    expect(titles(w).slice(0, 3)).toEqual(['a', 'c', 'b'])
    expect(onDeskId(w.s)).toBe(w.entry('a').id)
  })

  it('leaves out a task once it is finished, and stops at the limit', () => {
    const { w, go } = three()
    go('a'); go('b'); go('c')
    w.do({ type: 'entry/complete', id: w.entry('b').id })
    expect(titles(w)).not.toContain('b')
    expect(recentTasks(w.s, 1)).toHaveLength(1)
  })

  it('includes the couch', () => {
    const { w, go } = three()
    go('a')
    w.do({ type: 'entry/capture', text: 'couch: civ', start: true })
    w.wait(MIN)
    expect(titles(w)[0]).toBe('civ')
  })

  it('puts them first in an empty search, and ahead of equal matches', () => {
    const { w, go } = three()
    go('c')
    const names = (q: string) => findTasks(w.s, q).map((x) => (x.kind === 'entry' ? x.entry.title : x.item.title))
    expect(names('')[0]).toBe('c')
    expect(names('legal')[0]).toBe('c')
  })

  it('goes back through the quick switch, so the clock returns, and picks anything older', () => {
    const { w, go } = three()
    go('a'); go('b'); go('c')
    const find = (t: string) => recentTasks(w.s).find((x) => x.kind === 'entry' && x.entry.title === t)!
    expect(switchToAction(w.s, find('c'))).toBeNull()
    expect(switchToAction(w.s, find('b'))).toEqual({ type: 'desk/switch' })
    expect(switchToAction(w.s, find('a'))).toMatchObject({ type: 'desk/select', entryId: w.entry('a').id })
  })
})
