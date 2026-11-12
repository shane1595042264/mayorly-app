import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Action, MayorlyState } from '@core/index'
import { makeCapture, RETRY_AFTER_MS } from './capture'
import type { AiClerk } from './ai/service'

// A clerk whose model is busy: the line still lands in the tray, and is tried again later.

afterEach(() => vi.useRealTimers())

function world() {
  const state = { entries: [] as { id: string; title: string; ledgerId: string | null; doneAt: number | null }[], ledgers: [{ id: 'l1', name: 'Applications', code: 'CAR' }], houseRules: [] } as unknown as MayorlyState
  const run = (a: Action) => {
    if (a.type === 'entry/capture') state.entries.push({ id: `e${state.entries.length + 1}`, title: a.text, ledgerId: null, doneAt: null } as never)
    if (a.type === 'entry/file') state.entries.find((e) => e.id === a.id)!.ledgerId = a.ledgerId
  }
  return { state, engine: { state, act: run, dispatch: run } }
}

const busy = () => Promise.reject(new Error('This model is currently experiencing high demand.'))
const filed = (id: string) => new Map([[id, { ledgerId: 'l1', estimateMin: null, log: 'filed', model: 'm', confidence: 'sure' as const }]])

describe('a line the clerk could not file', () => {
  it('lands in the tray and is filed on a later try', async () => {
    vi.useFakeTimers()
    const { state, engine } = world()
    const fileMany = vi.fn().mockImplementationOnce(busy).mockImplementationOnce(busy).mockImplementation(async () => filed('e1'))
    const clerk = { enabled: () => true, fileEntry: vi.fn(busy), fileMany } as unknown as AiClerk
    const said: string[] = []
    const { captureLine } = makeCapture(engine, clerk, (n) => said.push(n.text))
    await captureLine('prep for JBATA phone interview')
    expect(state.entries[0].ledgerId).toBeNull()
    expect(fileMany).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(RETRY_AFTER_MS[0])
    expect(fileMany).toHaveBeenCalledTimes(1)
    expect(state.entries[0].ledgerId).toBeNull()
    await vi.advanceTimersByTimeAsync(RETRY_AFTER_MS[1])
    expect(fileMany).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(RETRY_AFTER_MS[2])
    expect(state.entries[0].ledgerId).toBe('l1')
    expect(said.at(-1)).toBe("'prep for JBATA phone interview' went to Applications")
    await vi.advanceTimersByTimeAsync(RETRY_AFTER_MS[3] * 2)
    expect(fileMany).toHaveBeenCalledTimes(3)
  })

  it('is left alone once a person has filed it', async () => {
    vi.useFakeTimers()
    const { state, engine } = world()
    const fileMany = vi.fn(async () => filed('e1'))
    const clerk = { enabled: () => true, fileEntry: vi.fn(busy), fileMany } as unknown as AiClerk
    const { captureLine } = makeCapture(engine, clerk, () => {})
    await captureLine('prep for JBATA phone interview')
    state.entries[0].ledgerId = 'l2'
    await vi.advanceTimersByTimeAsync(RETRY_AFTER_MS[0])
    expect(fileMany).not.toHaveBeenCalled()
  })
})
