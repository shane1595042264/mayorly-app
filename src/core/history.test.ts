import { describe, expect, it } from 'vitest'
import { emptyState, migrate } from './seed'
import { reduce, type Action } from './reducer'
import { completionHistory, entryActivity } from './history'
import { mergeStates } from './merge'

describe('entry history', () => {
  it('keeps notes, checklist snapshots and every interval across clear, reopen and reload', () => {
    let s = emptyState(), now = 1000, id = 0
    const act = (a: Action) => { s = reduce(s, a, { now: now++, newId: () => `id${++id}`, random: () => 0.5 }).state }
    act({ type: 'entry/capture', text: 'Practice a turn' })
    const entry = s.entries[0].id
    act({ type: 'entry/note', id: entry, text: 'First attempt' })
    act({ type: 'entry/subtask-add', id: entry, text: 'Warm up' })
    const subId = s.entries[0].subtasks![0].id
    act({ type: 'entry/subtask-toggle', id: entry, subId })
    act({ type: 'desk/deploy', mode: 'blitz', entryId: entry })
    now += 32 * 60_000
    act({ type: 'entry/complete', id: entry })
    const old = structuredClone(s)
    act({ type: 'entry/reopen', id: entry })
    act({ type: 'entry/note', id: entry, text: 'Second attempt' })
    act({ type: 'entry/subtask-edit', id: entry, subId, text: 'Cool down' })
    act({ type: 'desk/deploy', mode: 'blitz', entryId: entry })
    now += 5000
    act({ type: 'entry/complete', id: entry })
    s = migrate(JSON.parse(JSON.stringify(s)))!
    const history = completionHistory(s, s.entries[0])
    expect(history.map(h => h.kind)).toEqual(['cleared', 'reopened', 'cleared'])
    expect(history.at(-1)?.snapshot).toMatchObject({ notes: 'First attempt', subtasks: [{ text: 'Warm up', done: true }] })
    expect(history[0].snapshot?.notes).toBe('Second attempt')
    expect(entryActivity(s, s.entries[0]).filter(h => h.kind === 'focus')).toHaveLength(2)
    expect(mergeStates(s, old, null).entries[0].history).toHaveLength(3)
  })

  it('keeps a legacy zero-tomato completion when reopened, and sync cannot erase a newer reopen', () => {
    const s = emptyState()
    s.entries.push({ id: 'e', title: 'A quick task', ledgerId: null, createdAt: 1, doneAt: 100, estimateMin: null, order: 0, tomatoes: 0, notes: 'Keep this' })
    const result = reduce(s, { type: 'entry/reopen', id: 'e' }, { now: 200, newId: () => 'reopen', random: () => 0.5 }).state
    expect(completionHistory(result, result.entries[0]).map(h => h.kind)).toEqual(['reopened', 'cleared'])
    const merged = mergeStates(result, s, null)
    expect(merged.entries[0].doneAt).toBeNull()
    expect(merged.entries[0].notes).toBe('Keep this')
  })
})
