import { describe, expect, it } from 'vitest'
import { DEFAULT_HOTKEYS, emptyState, findEntries, migrate, type Entry, type Ledger, type MayorlyState, type Segment, type Sitting } from './index'

const entry = (id: string, title: string, order: number, more: Partial<Entry> = {}) =>
  ({ id, title, order, ledgerId: null, estimateMin: null, doneAt: null, createdAt: 0, tomatoes: 0, ...more }) as Entry

const withEntries = (entries: Entry[], ledgers: Ledger[] = []): MayorlyState => ({ ...emptyState(), entries, ledgers })
const titles = (es: Entry[]) => es.map((e) => e.title)

describe('finding a task', () => {
  const legal = { id: 'l', name: 'Legal', code: 'LAW' } as Ledger
  const s = withEntries(
    [
      entry('a', 'reply to the landlord', 1, { ledgerId: 'l' }),
      entry('b', 'Report the bug', 2),
      entry('c', 'write the quarterly report', 3),
      entry('d', 'prepare taxes', 4, { ledgerId: 'l' }),
      entry('e', 'report on last year', 5, { doneAt: 10 }),
    ],
    [legal],
  )

  it('with no search, shows the top of the flow', () => {
    expect(titles(findEntries(s, '  '))).toEqual(['reply to the landlord', 'Report the bug', 'write the quarterly report', 'prepare taxes'])
  })

  it('puts a title that starts with the search first, and ignores case', () => {
    expect(titles(findEntries(s, 'REP'))).toEqual(['reply to the landlord', 'Report the bug', 'write the quarterly report', 'prepare taxes'])
    expect(titles(findEntries(s, 'report'))[0]).toBe('Report the bug')
  })

  it('needs every word, in any order', () => {
    expect(titles(findEntries(s, 'landlord reply'))).toEqual(['reply to the landlord'])
    expect(findEntries(s, 'landlord taxes')).toEqual([])
  })

  it('finds tasks by their ledger, after title matches', () => {
    expect(titles(findEntries(s, 'law'))).toEqual(['reply to the landlord', 'prepare taxes'])
    const mixed = withEntries([entry('x', 'taxes', 1, { ledgerId: 'l' }), entry('y', 'legal review', 2)], [legal])
    expect(titles(findEntries(mixed, 'legal'))).toEqual(['legal review', 'taxes'])
  })

  it('leaves out finished tasks and stops at the limit', () => {
    expect(titles(findEntries(s, 'last year'))).toEqual([])
    expect(findEntries(s, '', 2)).toHaveLength(2)
  })

  it('has a default key, and an older save gains it', () => {
    expect(DEFAULT_HOTKEYS.find).toBe('Alt+F')
    const old = { ...emptyState(), settings: { ...emptyState().settings, hotkeys: { plus: 'Alt+T' } } }
    expect(migrate(old)?.settings.hotkeys).toMatchObject({ plus: 'Alt+T', find: 'Alt+F' })
  })
})

describe('focus time comes from the intervals', () => {
  const sitting = (id: string, focusMs: number) => ({ id, startedAt: 0, endedAt: null, tomatoMs: 1800000, focusMs, tomatoes: 0, ledgerTomatoes: {}, tokens: 0 }) as Sitting
  const seg = (id: string, sittingId: string, start: number, end: number | null, kind = 'focus') => ({ id, sittingId, start, end, kind, entryId: null, ledgerId: null }) as Segment

  it('corrects a total that was inflated, on load', () => {
    const s = migrate({ ...emptyState(), sittings: [sitting('s', 5_205_931)], segments: [seg('a', 's', 0, 1_000), seg('b', 's', 2_000, 2_500), seg('r', 's', 3_000, 9_000, 'rest'), seg('o', 's', 10_000, null)] })
    expect(s?.sittings[0].focusMs).toBe(1_500)
  })

  it('leaves a sitting with no intervals alone', () => {
    expect(migrate({ ...emptyState(), sittings: [sitting('s', 700)] })?.sittings[0].focusMs).toBe(700)
  })
})
