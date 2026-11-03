import { afterEach, describe, expect, it, vi } from 'vitest'
import { detectProvider } from './detect'
import { generate, listModels } from './providers'

afterEach(() => vi.unstubAllGlobals())

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
