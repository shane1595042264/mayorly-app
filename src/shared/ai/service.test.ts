import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Seal } from '../../main/seal'
import { sealedClerkStore } from '../../main/ai/store'
import { AiClerk } from './service'

vi.mock('electron', () => ({ safeStorage: {} }))
const dirs: string[] = []
afterEach(() => {
  vi.unstubAllGlobals()
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('checking a clerk key', () => {
  it.each([true, false])('only accepts a model with an actual answer (fallback answers: %s)', async (answers) => {
    const dir = mkdtempSync(join(tmpdir(), 'mayorly-ai-test-'))
    dirs.push(dir)
    const clerk = new AiClerk(sealedClerkStore(dir, new Seal(dir, true)), () => {})
    const attempted: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.includes('/models?')) return Response.json({ models: ['gemini-3.5-flash-lite', 'gemini-3.1-flash-lite'].map(id => ({ name: `models/${id}`, supportedGenerationMethods: ['generateContent'] })) })
      const model = new URL(url).pathname.split('/').at(-1)!.split(':')[0]
      attempted.push(model)
      return Response.json({ candidates: [{ content: { parts: model === 'gemini-3.1-flash-lite' && answers ? [{ text: 'ok' }] : [{ thought: true, text: 'Thinking without an answer.' }] } }] })
    }))
    const result = clerk.addKey(`AQ.${'dummy_'.repeat(8)}`)
    if (answers) {
      const pub = await result
      expect(pub.keys[0]).toMatchObject({ provider: 'gemini', defaultModel: 'gemini-3.1-flash-lite', status: 'ok' })
    } else {
      await expect(result).rejects.toMatchObject({ code: 'no_models' })
      expect(clerk.public().keys).toEqual([])
    }
    expect(attempted).toEqual(['gemini-3.5-flash-lite', 'gemini-3.1-flash-lite'])
  })
})

describe('filing when a model is busy', () => {
  const ledgers = [{ id: 'l1', code: 'CAR', name: 'Applications', criterion: 'Job applications and interview prep' }] as never
  const setup = async (busy: (model: string) => boolean) => {
    const dir = mkdtempSync(join(tmpdir(), 'mayorly-ai-test-'))
    dirs.push(dir)
    const clerk = new AiClerk(sealedClerkStore(dir, new Seal(dir, true)), () => {})
    let checking = true
    const asked: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.includes('/models?')) return Response.json({ models: ['gemini-3.5-flash-lite', 'gemini-3.1-flash-lite'].map(id => ({ name: `models/${id}`, supportedGenerationMethods: ['generateContent'] })) })
      const model = new URL(url).pathname.split('/').at(-1)!.split(':')[0]
      if (checking) return Response.json({ candidates: [{ content: { parts: [{ text: 'ok' }] } }] })
      asked.push(model)
      if (busy(model)) return Response.json({ error: { code: 503, message: 'This model is currently experiencing high demand. Please try again later.' } }, { status: 503 })
      return Response.json({ candidates: [{ content: { parts: [{ text: '{"ledgerCode":"CAR","confidence":0.9,"title":"prep for JBATA phone interview","estimateMin":null}' }] } }] })
    }))
    await clerk.addKey(`AQ.${'dummy_'.repeat(8)}`)
    checking = false
    return { clerk, asked }
  }

  it('hands a busy model over to the next one', async () => {
    const { clerk, asked } = await setup((m) => m === 'gemini-3.5-flash-lite')
    const f = await clerk.fileEntry('prep for JBATA phone interview', ledgers)
    expect(f).toMatchObject({ ledgerId: 'l1', model: 'gemini-3.1-flash-lite' })
    expect(asked).toEqual(['gemini-3.5-flash-lite', 'gemini-3.1-flash-lite'])
    expect(clerk.public().keys[0].status).toBe('ok')
  })

  it('says so when no model answers, rather than looking undecided', async () => {
    const { clerk } = await setup(() => true)
    await expect(clerk.fileEntry('prep for JBATA phone interview', ledgers)).rejects.toThrow(/high demand/)
    await expect(clerk.fileMany([{ id: 'e1', title: 'prep for JBATA phone interview' }], ledgers)).rejects.toThrow(/high demand/)
  })
})
