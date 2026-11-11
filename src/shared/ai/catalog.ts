// Which of a key's models can file an entry, what each costs, and which is cheapest.
// A provider's model list mixes in speech, image and embedding models; isTextModel
// keeps what answers a text prompt. Prices are list prices in USD per million
// tokens where known; an unknown model is priced by its tier word and marked so.
// The clerk's job is tiny (a line in, a line of JSON out), so cheapest first is right.

import type { AiProvider } from './detect'

export interface Price {
  input: number
  output: number
  known: boolean
}

const NON_TEXT = /embed|tts|transcribe|whisper|audio|realtime|speech|image|imagen|veo|lyria|sora|dall-?e|moderation|robotics|computer-use|deep-research|omni|nano-banana|search|aqa|gemma|learnlm|codex|instruct/i

export function isTextModel(provider: AiProvider, id: string): boolean {
  if (NON_TEXT.test(id)) return false
  switch (provider) {
    case 'openai': return /^(gpt-|o\d|chatgpt-)/.test(id)
    case 'anthropic': return id.startsWith('claude-')
    case 'gemini': return id.startsWith('gemini-')
    case 'xai': return id.startsWith('grok-')
  }
}

// Longest matching prefix wins, so "gpt-4.1-mini" beats "gpt-4.1".
const KNOWN: Record<AiProvider, [prefix: string, input: number, output: number][]> = {
  openai: [
    ['gpt-5-nano', 0.05, 0.4], ['gpt-5-mini', 0.25, 2], ['gpt-5', 1.25, 10],
    ['gpt-4.1-nano', 0.1, 0.4], ['gpt-4.1-mini', 0.4, 1.6], ['gpt-4.1', 2, 8],
    ['gpt-4o-mini', 0.15, 0.6], ['gpt-4o', 2.5, 10], ['o4-mini', 1.1, 4.4], ['o3-mini', 1.1, 4.4], ['o3', 2, 8],
  ],
  anthropic: [
    ['claude-haiku-5-5', 0.1, 0.5], ['claude-haiku-4-5', 1, 5], ['claude-3-5-haiku', 0.8, 4], ['claude-3-haiku', 0.25, 1.25],
    ['claude-sonnet-5-5', 2, 10], ['claude-sonnet-5', 2, 10], ['claude-sonnet-4-6', 3, 15], ['claude-sonnet-4', 3, 15],
    ['claude-opus-5-5', 4, 20], ['claude-opus-5', 5, 25], ['claude-opus-4', 5, 25], ['claude-fable-5', 10, 50],
  ],
  gemini: [
    ['gemini-2.0-flash-lite', 0.075, 0.3], ['gemini-2.0-flash', 0.1, 0.4], ['gemini-2.5-flash-lite', 0.1, 0.4],
    ['gemini-2.5-flash', 0.3, 2.5], ['gemini-2.5-pro', 1.25, 10],
  ],
  xai: [
    ['grok-4-1-fast', 0.2, 0.5], ['grok-4-fast', 0.2, 0.5], ['grok-code-fast', 0.2, 1.5], ['grok-3-mini', 0.3, 0.5], ['grok-3', 3, 15], ['grok-4', 3, 15],
  ],
}

function tierPrice(provider: AiProvider, id: string): [number, number] {
  const s = id.toLowerCase()
  switch (provider) {
    case 'gemini': return s.includes('lite') ? [0.1, 0.4] : s.includes('flash') ? [0.3, 2.5] : s.includes('pro') ? [1.25, 10] : [1, 8]
    case 'openai': return s.includes('nano') ? [0.05, 0.4] : s.includes('mini') ? [0.25, 2] : /^o\d/.test(s) ? [2, 8] : [1.25, 10]
    case 'anthropic': return s.includes('haiku') ? [1, 5] : s.includes('opus') ? [5, 25] : s.includes('fable') ? [10, 50] : [3, 15]
    case 'xai': return s.includes('mini') || s.includes('fast') ? [0.2, 0.5] : [3, 15]
  }
}

export function priceOf(provider: AiProvider, id: string): Price {
  let best: [string, number, number] | undefined
  for (const row of KNOWN[provider]) if (id.startsWith(row[0]) && (!best || row[0].length > best[0].length)) best = row
  if (best) return { input: best[1], output: best[2], known: true }
  const [input, output] = tierPrice(provider, id)
  return { input, output, known: false }
}

/** Cost of one call in millionths of a dollar. */
export function costMicroUsd(provider: AiProvider, model: string, inputTokens: number, outputTokens: number): number {
  const p = priceOf(provider, model)
  return Math.round(p.input * inputTokens + p.output * outputTokens)
}

const blended = (p: Price) => p.input * 0.75 + p.output * 0.25
const versionOf = (id: string) => {
  const m = id.match(/(\d+(?:[.-]\d+)?)/)
  return m ? Number(m[1].replace('-', '.')) : 0
}
const UNSTABLE = /preview|exp|experimental|-\d{2}-\d{2,4}$/i

/** Text models, cheapest first; ties go to stable over preview, then the newer generation. */
export function rankModels(provider: AiProvider, ids: string[]): string[] {
  return [...new Set(ids)]
    .filter((id) => isTextModel(provider, id))
    .map((id) => ({ id, cost: blended(priceOf(provider, id)), unstable: UNSTABLE.test(id), version: versionOf(id) }))
    .sort((a, b) => a.cost - b.cost || Number(a.unstable) - Number(b.unstable) || b.version - a.version || a.id.localeCompare(b.id))
    .map((m) => m.id)
}
