import { describe, expect, it } from 'vitest'
import { parseSuperset, reduce, sampleState, type Action, type HudEvent, type MayorlyState } from '../core/index'
import { deskEnd, endLabel, switchRecord, switchRecordOf, type SwitchRecord, type SwitchWhy } from './switchlog'

const now = Date.parse('2026-11-22T18:00:00Z')

function desk() {
  let n = 0
  let t = now
  const ctx = () => ({ now: t, newId: () => `id${++n}`, random: () => 0.5, device: 'here' })
  let s: MayorlyState = sampleState(now, () => `id${++n}`)
  s = { ...s, tokens: [...s.tokens, { id: 'seed', at: now, amount: 40, reason: 'tomato', sittingId: null } as never] }
  const log: SwitchRecord[] = []
  /** One step as the engine runs it, the record kept when the task on the desk changed. */
  const act = (a: Action, why?: SwitchWhy) => {
    const before = s
    const r = reduce(s, a, ctx())
    s = r.state
    const rec = switchRecord(before, s, a, r.events as HudEvent[], why, t, `r${log.length}`)
    if (rec) log.push(rec)
    return rec
  }
  const wait = (ms: number) => {
    t += ms
    return act({ type: 'desk/tick' })
  }
  act({ type: 'entry/capture', text: 'legal: alpha', start: true })
  act({ type: 'leisure/add', title: 'Stream watch' })
  const stream = s.leisure.find((l) => l.title === 'Stream watch')!.id
  return { get s() { return s }, act, wait, log, stream }
}

describe('the switch log', () => {
  it('names the task on the desk, its ledger first, the one behind a rest included', () => {
    const d = desk()
    expect(endLabel(deskEnd(d.s))).toBe(`${d.s.ledgers.find((l) => l.id === d.s.entries.find((e) => e.title === 'alpha')!.ledgerId)!.code} alpha`)
    d.act({ type: 'desk/skip' })
    expect(d.s.desk.block?.kind).toBe('rest')
    expect(deskEnd(d.s)?.title).toBe('alpha')
  })

  it('keeps a switch with what moved it: you by default, the call site when it says', () => {
    const d = desk()
    const r = d.act({ type: 'desk/select', leisureId: d.stream })
    expect(r).toMatchObject({ cause: 'you', via: 'Picked', from: { title: 'alpha', kind: 'entry' }, to: { title: 'Stream watch', kind: 'couch' }, status: 'running' })
    const death = d.act({ type: 'desk/switch' }, { cause: 'stream', via: 'Streamer died on twitch (rule: Kai\'sa dies)', detail: 'world 12/39 bar 18/60' })
    expect(death).toMatchObject({ cause: 'stream', from: { title: 'Stream watch' }, to: { title: 'alpha' }, detail: 'world 12/39 bar 18/60' })
    const prompt = d.act({ type: 'desk/switch' }, { cause: 'ai', via: 'Claude prompt' })
    expect(prompt).toMatchObject({ cause: 'ai', via: 'Claude prompt', to: { title: 'Stream watch' } })
  })

  it('keeps nothing when the task stays: a rest, a pause, a note, a ledger renamed', () => {
    const d = desk()
    expect(d.act({ type: 'desk/pause' })).toBeNull()
    expect(d.act({ type: 'desk/resume' })).toBeNull()
    expect(d.act({ type: 'desk/skip' })).toBeNull()
    const ledgerId = d.s.ledgers[0].id
    expect(d.act({ type: 'ledger/update', id: ledgerId, patch: { name: 'Renamed' } } as Action)).toBeNull()
  })

  it('says the timer moved it, with the superset slot it went to', () => {
    const d = desk()
    const ss = parseSuperset(`${d.s.ledgers[0].code} 20, ${d.s.ledgers[1].code} 20`, d.s.ledgers, () => 'ss1')
    if (!ss.ok) throw new Error(ss.error)
    d.act({ type: 'superset/save', superset: ss.superset })
    d.act({ type: 'desk/deploy', mode: 'superset', supersetId: 'ss1' })
    const before = d.log.length
    // Twenty minutes of the first slot and its rest: the desk moves on to the second slot by itself.
    for (let i = 0; i < 40 && d.log.length === before; i++) d.wait(60_000)
    const r = d.log[d.log.length - 1]
    expect(d.log.length).toBeGreaterThan(before)
    expect(r).toMatchObject({ cause: 'timer', via: 'Superset: the next slot' })
    expect(r.detail).toMatch(/^slot 2 of 2, round 1$/)
  })

  it('reads a record back from the file, and refuses what is not one', () => {
    const d = desk()
    const r = d.act({ type: 'desk/select', leisureId: d.stream })!
    expect(switchRecordOf(JSON.parse(JSON.stringify(r)))).toEqual(r)
    expect(switchRecordOf({ id: 'x' })).toBeNull()
    expect(switchRecordOf('nonsense')).toBeNull()
  })
})
