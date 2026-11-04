import { describe, expect, it } from 'vitest'
import { detectProvider } from './detect'

describe('pasted AI keys', () => {
  it.each([32, 48, 96])('recognizes a Gemini authorization key with a %i-character body', (length) => {
    const key = `AQ.${'aB09_-'.repeat(16).slice(0, length)}`
    expect(detectProvider(` \n${key}\t`)).toEqual({ provider: 'gemini' })
  })

  it('still recognizes legacy Gemini keys', () => {
    expect(detectProvider(`AIza${'a'.repeat(35)}`)).toEqual({ provider: 'gemini' })
  })

  it.each([
    ['sk-ant-', 'anthropic'], ['sk-proj-', 'openai'], ['xai-', 'xai'],
  ])('keeps routing %s keys to %s', (prefix, provider) => {
    expect(detectProvider(prefix + 'a'.repeat(40))).toEqual({ provider })
  })

  it.each([
    'AQ.short', `AQ.${'a'.repeat(20)} bad`, `AQ.${'a'.repeat(20)}!`,
    `AQx${'a'.repeat(30)}`, `AIza${'a'.repeat(34)}`, `gsk_${'a'.repeat(40)}`,
  ])('rejects a malformed or unsupported key without echoing it (%#)', (key) => {
    const result = detectProvider(key)
    expect(result.provider).toBeNull()
    if (result.provider === null) expect(result.reason).not.toContain(key)
  })
})
