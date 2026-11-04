import { afterEach, describe, expect, it, vi } from 'vitest'
import { detectProvider } from './detect'
import { generate, listModels } from './providers'

afterEach(() => vi.unstubAllGlobals())

describe('Gemini generation settings', () => {
  it.each([
    ['gemini-3.5-flash-lite', { thinkingLevel: 'minimal' }],
    ['gemini-3.1-flash-lite-preview', { thinkingLevel: 'minimal' }],
    ['gemini-3.8-flash', { thinkingLevel: 'low' }],
    ['gemini-3.1-pro-preview', { thinkingLevel: 'low' }],
    ['gemini-4-argon', { thinkingLevel: 'low' }],
    ['gemini-2.5-flash-lite', { thinkingBudget: 0 }],
    ['gemini-2.5-flash', { thinkingBudget: 0 }],
    ['gemini-2.5-pro', { thinkingBudget: 128 }],
    ['gemini-2.0-flash', undefined],
    ['gemini-flash-lite-latest', undefined],
  ] as const)('uses supported thinking controls for %s', async (model, thinkingConfig) => {
    const fetch = vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(init.body as string)
      expect(body.generationConfig.thinkingConfig).toEqual(thinkingConfig)
      expect(body.generationConfig.maxOutputTokens).toBeGreaterThanOrEqual(160)
      return Response.json({ candidates: [{ content: { parts: [{ text: 'ok' }] } }] })
    })
    vi.stubGlobal('fetch', fetch)
    expect((await generate('gemini', 'dummy', model, { system: 'File the task.', prompt: 'Read a book', maxTokens: 160 })).text).toBe('ok')
  })

  it('passes only the answer to the clerk when Google returns thought parts', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({
      candidates: [{ content: { parts: [
        { thought: true, text: 'A thought summary.' },
        { text: '{"ledgerId":"legal",' }, { text: '"title":"Read the lease"}' },
      ] } }],
    })))
    const result = await generate('gemini', 'dummy', 'gemini-3.5-flash-lite', { system: 'File the task.', prompt: 'Read the lease', maxTokens: 160 })
    expect(JSON.parse(result.text)).toEqual({ ledgerId: 'legal', title: 'Read the lease' })
  })
})

describe('Gemini key validation requests', () => {
  it.each([
    ['authorization', `AQ.${'dummy_'.repeat(8)}`],
    ['standard', `AIza${'a'.repeat(35)}`],
  ])('uses an %s key unchanged in the Google header for listing and generation', async (_, key) => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(Response.json({ models: [
        { name: 'models/gemini-2.5-flash-lite', supportedGenerationMethods: ['generateContent'] },
        { name: 'models/text-embedding-004', supportedGenerationMethods: ['embedContent'] },
      ] }))
      .mockResolvedValueOnce(Response.json({
        candidates: [{ content: { parts: [{ text: 'ok' }] } }],
        usageMetadata: { promptTokenCount: 4, candidatesTokenCount: 1 },
      }))
    vi.stubGlobal('fetch', fetch)
    const detection = detectProvider(key)
    expect(detection.provider).toBe('gemini')
    if (!detection.provider) throw new Error('Key was not recognized')
    const models = await listModels(detection.provider, key)
    expect(models).toEqual(['gemini-2.5-flash-lite'])
    expect(await generate(detection.provider, key, models[0], {
      system: 'Reply with one word.', prompt: 'ok', maxTokens: 8,
    })).toEqual({ text: 'ok', inputTokens: 4, outputTokens: 1 })
    expect(fetch).toHaveBeenCalledTimes(2)
    for (const [url, init] of fetch.mock.calls) {
      expect(new URL(url).origin).toBe('https://generativelanguage.googleapis.com')
      expect(url).not.toContain(key)
      expect(init.headers['x-goog-api-key']).toBe(key)
      expect(init.headers.Authorization).toBeUndefined()
    }
  })
})
