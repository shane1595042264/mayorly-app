import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Seal } from '../seal'
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
    const clerk = new AiClerk(dir, new Seal(dir, true), () => {})
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
