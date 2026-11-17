import { describe, expect, it } from 'vitest'
import { migrate, reduce, sampleState, type Action, type MayorlyState } from './index'

// Ledgers the clerk starts are its own: it may fold them into another later. Yours are locked,
// and editing one it started makes it yours.

const T0 = new Date('2026-11-15T09:00:00').getTime()

function world() {
  let n = 0
  const newId = () => `id${++n}`
  let state = sampleState(T0, newId)
  const w = {
    get s(): MayorlyState { return state },
    do(action: Action) {
      state = reduce(state, action, { now: T0, newId, random: () => 0.5, device: 'here' }).state
    },
    ledger(name: string) { return state.ledgers.find((l) => l.name === name)! },
  }
  return w
}

describe('a ledger the clerk starts', () => {
  it('is not hand-written, and the log says so', () => {
    const w = world()
    w.do({ type: 'ledger/create', name: 'Plants', criterion: 'Watering, repotting.', glyph: 'plant', byClerk: true, log: '(clerk, m, 92% sure)' })
    const plants = w.ledger('Plants')
    expect(plants.handWritten).toBe(false)
    expect(w.s.clerkLog.at(-1)?.text).toBe(`new ledger Plants (${plants.code}) (clerk, m, 92% sure)`)
  })

  it('becomes yours once you edit it', () => {
    const w = world()
    w.do({ type: 'ledger/create', name: 'Plants', criterion: '', glyph: 'plant', byClerk: true })
    w.do({ type: 'ledger/update', id: w.ledger('Plants').id, patch: { criterion: 'Houseplants.' } })
    expect(w.ledger('Plants').handWritten).toBe(true)
  })

  it('and one you make is hand-written', () => {
    const w = world()
    w.do({ type: 'ledger/create', name: 'Garden', criterion: '', glyph: 'plant' })
    expect(w.ledger('Garden').handWritten).toBe(true)
  })
})

describe('folding a ledger into another', () => {
  it('moves its entries, the desk and the plan, then takes it off the shelf', () => {
    const w = world()
    w.do({ type: 'ledger/create', name: 'Plants', criterion: '', glyph: 'plant', byClerk: true })
    w.do({ type: 'ledger/create', name: 'Garden', criterion: '', glyph: 'plant' })
    const plants = w.ledger('Plants')
    const garden = w.ledger('Garden')
    w.do({ type: 'entry/capture', text: 'water the ferns', filing: { title: 'water the ferns', ledgerId: plants.id, estimateMin: null, log: 'filed', model: 'm', confidence: 'sure' } })
    const ferns = w.s.entries.find((e) => e.title === 'water the ferns')!
    expect(ferns.ledgerId).toBe(plants.id)
    w.do({ type: 'desk/deploy', mode: 'pomodoro', entryId: ferns.id })
    expect(w.s.desk.block?.ledgerId).toBe(plants.id)

    w.do({ type: 'ledger/merge', from: plants.id, into: garden.id, log: 'folded Plants into Garden (clerk, 90% sure)' })
    expect(w.s.ledgers.some((l) => l.id === plants.id)).toBe(false)
    expect(w.s.entries.find((e) => e.id === ferns.id)?.ledgerId).toBe(garden.id)
    expect(w.s.entries.find((e) => e.id === ferns.id)?.clerkFiled?.ledgerId ?? garden.id).toBe(garden.id)
    expect(w.s.desk.block?.ledgerId).toBe(garden.id)
    expect(w.s.clerkLog.at(-1)?.text).toBe('folded Plants into Garden (clerk, 90% sure)')
  })

  it('refuses a hand-written ledger, and a ledger into itself', () => {
    const w = world()
    const legal = w.s.ledgers[0]
    const other = w.s.ledgers[1]
    const before = w.s.ledgers.length
    w.do({ type: 'ledger/merge', from: legal.id, into: other.id })
    expect(w.s.ledgers).toHaveLength(before)
    w.do({ type: 'ledger/create', name: 'Plants', criterion: '', glyph: 'plant', byClerk: true })
    const plants = w.ledger('Plants')
    w.do({ type: 'ledger/merge', from: plants.id, into: plants.id })
    expect(w.s.ledgers.some((l) => l.id === plants.id)).toBe(true)
  })
})

describe('the clerk settings', () => {
  it('start on, at the tuned level, and are clamped', () => {
    const w = world()
    expect(w.s.settings.clerk).toEqual({ allow: { settings: 'ask', recipes: 'ask' }, createLedgers: true, consolidate: true, minConfidence: null })
    w.do({ type: 'settings/update', patch: { clerk: { allow: { settings: 'ask', recipes: 'ask' }, createLedgers: false, consolidate: true, minConfidence: 1.4 } } })
    expect(w.s.settings.clerk).toEqual({ allow: { settings: 'ask', recipes: 'ask' }, createLedgers: false, consolidate: true, minConfidence: 0.99 })
    w.do({ type: 'settings/update', patch: { clerk: { allow: { settings: 'ask', recipes: 'ask' }, createLedgers: true, consolidate: false, minConfidence: 0.1 } } })
    expect(w.s.settings.clerk.minConfidence).toBe(0.5)
    w.do({ type: 'settings/update', patch: { clerk: { allow: { settings: 'ask', recipes: 'ask' }, createLedgers: true, consolidate: false, minConfidence: null } } })
    expect(w.s.settings.clerk.minConfidence).toBeNull()
  })

  it('are filled in for a save from before them, and kept from one after', () => {
    const w = world()
    const old = JSON.parse(JSON.stringify(w.s)) as { settings: { clerk?: unknown } }
    delete old.settings.clerk
    expect(migrate(old)?.settings.clerk).toEqual({ allow: { settings: 'ask', recipes: 'ask' }, createLedgers: true, consolidate: true, minConfidence: null })
    const set = { ...old, settings: { ...old.settings, clerk: { createLedgers: false, consolidate: false, minConfidence: 0.8 } } }
    expect(migrate(set)?.settings.clerk).toEqual({ allow: { settings: 'ask', recipes: 'ask' }, createLedgers: false, consolidate: false, minConfidence: 0.8 })
  })
})
