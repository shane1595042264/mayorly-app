import { describe, expect, it, vi } from 'vitest'
import { reduce, sampleState, type Action, type Filing, type MayorlyState } from '@core/index'
import { FOLD_AFTER_MS, makeCapture } from './capture'
import type { AiClerk } from './ai/service'

// The clerk starting a ledger for a line nothing fits, and folding one it started, through the
// real reducer: only when the setting is on and it is sure enough.

const DAY = 24 * 3_600_000

function world(now = Date.now()) {
  let n = 0
  const newId = () => `id${++n}`
  let state = sampleState(now, newId)
  const run = (a: Action) => {
    state = reduce(state, a, { now, newId, random: () => 0.5, device: 'here' }).state
  }
  const engine = { get state(): MayorlyState { return state }, act: run, dispatch: run }
  return { engine, get s() { return state }, set now(t: number) { now = t } }
}

const proposing = (confidence: number, fallbackId: string | null) => async (text: string, ..._rest: unknown[]): Promise<Filing> => ({
  title: text,
  ledgerId: fallbackId,
  estimateMin: null,
  log: 'proposes',
  model: 'm',
  confidence: 'unsure',
  newLedger: { name: 'Plants', criterion: 'Houseplants: watering, repotting.', confidence },
})

function fakeClerk(over: Partial<Record<keyof AiClerk, unknown>> = {}) {
  return {
    enabled: () => true,
    tuned: () => null,
    fileMany: vi.fn(async () => new Map()),
    pickGlyph: vi.fn(async () => 'plant'),
    consolidate: vi.fn(async () => []),
    ...over,
  } as unknown as AiClerk
}

describe('the clerk starting a ledger', () => {
  it('starts one when it is surer than the level, and files the line there', async () => {
    const w = world()
    const fileEntry = vi.fn(proposing(0.9, w.s.ledgers[0].id))
    const said: string[] = []
    const { captureLine } = makeCapture(w.engine, fakeClerk({ fileEntry }), (m) => said.push(m.text))
    await captureLine('repot the monstera')
    expect(fileEntry.mock.calls[0][3]).toEqual({ newLedgers: true })
    const plants = w.s.ledgers.find((l) => l.name === 'Plants')
    expect(plants).toMatchObject({ handWritten: false, glyph: 'plant' })
    expect(w.s.entries.find((e) => e.title === 'repot the monstera')?.ledgerId).toBe(plants!.id)
    expect(said).toContain('Clerk started a ledger: Plants')
  })

  it('leaves the line in the closest ledger when it is less sure than the level', async () => {
    const w = world()
    const closest = w.s.ledgers[0]
    const { captureLine } = makeCapture(w.engine, fakeClerk({ fileEntry: proposing(0.7, closest.id) }), () => {})
    await captureLine('repot the monstera')
    expect(w.s.ledgers.some((l) => l.name === 'Plants')).toBe(false)
    expect(w.s.entries.find((e) => e.title === 'repot the monstera')?.ledgerId).toBe(closest.id)
  })

  it('goes by the tuned level, and by your own over it', async () => {
    const w = world()
    const { captureLine } = makeCapture(w.engine, fakeClerk({ fileEntry: proposing(0.9, null), tuned: () => ({ threshold: 0.95 }) }), () => {})
    await captureLine('repot the monstera')
    expect(w.s.ledgers.some((l) => l.name === 'Plants')).toBe(false)
    w.engine.act({ type: 'settings/update', patch: { clerk: { createLedgers: true, consolidate: true, minConfidence: 0.6 } } })
    await captureLine('water the ferns')
    expect(w.s.ledgers.some((l) => l.name === 'Plants')).toBe(true)
  })

  it('does not ask for new ledgers when the setting is off', async () => {
    const w = world()
    w.engine.act({ type: 'settings/update', patch: { clerk: { createLedgers: false, consolidate: true, minConfidence: null } } })
    const fileEntry = vi.fn(proposing(0.99, null))
    const { captureLine } = makeCapture(w.engine, fakeClerk({ fileEntry }), () => {})
    await captureLine('repot the monstera')
    expect(fileEntry.mock.calls[0][3]).toEqual({ newLedgers: false })
    expect(w.s.ledgers.some((l) => l.name === 'Plants')).toBe(false)
  })

  it('reuses a ledger of that name instead of starting a second', async () => {
    const w = world()
    const { captureLine } = makeCapture(w.engine, fakeClerk({ fileEntry: proposing(0.9, null) }), () => {})
    await captureLine('repot the monstera')
    await captureLine('water the ferns')
    expect(w.s.ledgers.filter((l) => l.name === 'Plants')).toHaveLength(1)
  })
})

describe('the clerk folding its own ledgers', () => {
  const setup = (age: number) => {
    const w = world(Date.now() - age)
    w.engine.dispatch({ type: 'ledger/create', name: 'Plants', criterion: '', glyph: 'plant', byClerk: true })
    w.engine.dispatch({ type: 'ledger/create', name: 'Home', criterion: 'The house and garden.', glyph: 'house' })
    const plants = w.s.ledgers.find((l) => l.name === 'Plants')!
    const home = w.s.ledgers.find((l) => l.name === 'Home')!
    w.engine.dispatch({ type: 'entry/capture', text: 'water the ferns', filing: { title: 'water the ferns', ledgerId: plants.id, estimateMin: null, log: 'filed' } })
    return { w, plants, home }
  }

  it('folds one older than a day when it is sure enough', async () => {
    const { w, plants, home } = setup(FOLD_AFTER_MS + DAY)
    const consolidate = vi.fn(async (..._args: unknown[]) => [{ from: plants.id, into: home.id, confidence: 0.92, reason: 'plants are home' }])
    const said: string[] = []
    await makeCapture(w.engine, fakeClerk({ consolidate }), (m) => said.push(m.text)).consolidate()
    expect([...(consolidate.mock.calls[0][1] as Set<string>)]).toEqual([plants.id])
    expect(w.s.ledgers.some((l) => l.id === plants.id)).toBe(false)
    expect(w.s.entries.find((e) => e.title === 'water the ferns')?.ledgerId).toBe(home.id)
    expect(said).toContain('Clerk folded Plants into Home')
  })

  it('keeps it when unsure, when it is new, or when the setting is off', async () => {
    const unsure = setup(FOLD_AFTER_MS + DAY)
    await makeCapture(unsure.w.engine, fakeClerk({ consolidate: async () => [{ from: unsure.plants.id, into: unsure.home.id, confidence: 0.6, reason: '' }] }), () => {}).consolidate()
    expect(unsure.w.s.ledgers.some((l) => l.id === unsure.plants.id)).toBe(true)

    const young = setup(DAY / 2)
    const asked = vi.fn(async () => [{ from: young.plants.id, into: young.home.id, confidence: 0.99, reason: '' }])
    await makeCapture(young.w.engine, fakeClerk({ consolidate: asked }), () => {}).consolidate()
    expect(asked).not.toHaveBeenCalled()

    const off = setup(FOLD_AFTER_MS + DAY)
    off.w.engine.act({ type: 'settings/update', patch: { clerk: { createLedgers: true, consolidate: false, minConfidence: null } } })
    const never = vi.fn(async () => [])
    await makeCapture(off.w.engine, fakeClerk({ consolidate: never }), () => {}).consolidate()
    expect(never).not.toHaveBeenCalled()
  })
})
