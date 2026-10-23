import Anthropic from '@anthropic-ai/sdk'
import type { AiProvider } from './detect'

// The four providers behind one shape: list the key's models, and answer one
// prompt. Anthropic goes through its SDK; the others through their HTTP APIs.
// Every call has a deadline and every failure becomes a ProviderError with a
// kind the key check and the settings page can act on.

const TIMEOUT_MS = 20_000

export type ProviderErrorKind = 'auth' | 'quota' | 'model' | 'rate' | 'other'

export class ProviderError extends Error {
  constructor(readonly kind: ProviderErrorKind, readonly status: number, message: string) {
    super(message)
    this.name = 'ProviderError'
  }
}

export interface GenerateInput {
  system: string
  prompt: string
  maxTokens: number
}

export interface GenerateResult {
  text: string
  inputTokens: number
  outputTokens: number
}

function classify(status: number, message: string): ProviderErrorKind {
  const m = message.toLowerCase()
  if (status === 401 || status === 403 || m.includes('api key not valid') || m.includes('invalid api key') || m.includes('incorrect api key') || m.includes('invalid x-api-key')) return 'auth'
  if (status === 402 || m.includes('credit balance') || m.includes('insufficient_quota') || m.includes('exceeded your current quota') || m.includes('billing')) return 'quota'
  if (status === 404 || m.includes('no longer available') || m.includes('does not exist') || m.includes('not found') || m.includes('not supported for generatecontent')) return 'model'
  if (status === 429) return 'rate'
  return 'other'
}

function providerMessage(body: unknown, fallback: string): string {
  const b = body as { error?: { message?: string } | string; message?: string } | null
  const msg = (typeof b?.error === 'string' ? b.error : b?.error?.message) ?? b?.message ?? fallback
  return String(msg).replace(/\s+/g, ' ').slice(0, 300)
}

async function call(url: string, init: RequestInit): Promise<unknown> {
  let res: Response
  try {
    res = await fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) })
  } catch (err) {
    throw new ProviderError('other', 0, `Could not reach the provider: ${(err as Error).message}`)
  }
  const text = await res.text()
  let body: unknown = null
  try {
    body = text ? JSON.parse(text) : null
  } catch {
    body = text
  }
  if (!res.ok) {
    const message = providerMessage(body, `HTTP ${res.status}`)
    throw new ProviderError(classify(res.status, message), res.status, message)
  }
  return body
}

const bearer = (key: string) => ({ Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' })
const geminiHeaders = (key: string) => ({ 'x-goog-api-key': key, 'Content-Type': 'application/json' })
const anthropic = (key: string) => new Anthropic({ apiKey: key, timeout: TIMEOUT_MS, maxRetries: 1 })

/** The SDK's typed errors, mapped to the same kinds as the HTTP providers. */
async function viaSdk<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn()
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) throw new ProviderError('auth', err.status ?? 401, err.message)
    if (err instanceof Anthropic.NotFoundError) throw new ProviderError('model', 404, err.message)
    if (err instanceof Anthropic.RateLimitError) throw new ProviderError('rate', 429, err.message)
    if (err instanceof Anthropic.APIError) throw new ProviderError(classify(err.status ?? 0, err.message), err.status ?? 0, err.message)
    throw new ProviderError('other', 0, err instanceof Error ? err.message : String(err))
  }
}

export async function listModels(provider: AiProvider, key: string): Promise<string[]> {
  switch (provider) {
    case 'openai': {
      const b = (await call('https://api.openai.com/v1/models', { headers: bearer(key) })) as { data?: { id: string }[] }
      return (b.data ?? []).map((m) => m.id)
    }
    case 'xai': {
      const b = (await call('https://api.x.ai/v1/models', { headers: bearer(key) })) as { data?: { id: string }[] }
      return (b.data ?? []).map((m) => m.id)
    }
    case 'anthropic':
      return viaSdk(async () => {
        const ids: string[] = []
        for await (const m of anthropic(key).models.list({ limit: 100 })) ids.push(m.id)
        return ids
      })
    case 'gemini': {
      const b = (await call('https://generativelanguage.googleapis.com/v1beta/models?pageSize=200', { headers: geminiHeaders(key) })) as {
        models?: { name: string; supportedGenerationMethods?: string[] }[]
      }
      return (b.models ?? []).filter((m) => m.supportedGenerationMethods?.includes('generateContent')).map((m) => m.name.replace(/^models\//, ''))
    }
  }
}

/** Reasoning models spend hidden tokens before the visible answer. */
const isReasoning = (provider: AiProvider, model: string) =>
  (provider === 'openai' && /^(gpt-5|o\d)/.test(model)) || (provider === 'xai' && model.includes('grok-3-mini'))

export async function generate(provider: AiProvider, key: string, model: string, input: GenerateInput): Promise<GenerateResult> {
  switch (provider) {
    case 'openai':
    case 'xai': {
      const reasoning = isReasoning(provider, model)
      const url = provider === 'openai' ? 'https://api.openai.com/v1/chat/completions' : 'https://api.x.ai/v1/chat/completions'
      const b = (await call(url, {
        method: 'POST',
        headers: bearer(key),
        body: JSON.stringify({
          model,
          messages: [{ role: 'system', content: input.system }, { role: 'user', content: input.prompt }],
          ...(provider === 'openai' ? { max_completion_tokens: input.maxTokens + (reasoning ? 1024 : 0) } : { max_tokens: input.maxTokens + (reasoning ? 1024 : 0) }),
          ...(reasoning ? { reasoning_effort: 'low' } : {}),
        }),
      })) as { choices?: { message?: { content?: string } }[]; usage?: { prompt_tokens?: number; completion_tokens?: number } }
      return { text: b.choices?.[0]?.message?.content ?? '', inputTokens: b.usage?.prompt_tokens ?? 0, outputTokens: b.usage?.completion_tokens ?? 0 }
    }
    case 'anthropic':
      return viaSdk(async () => {
        const r = await anthropic(key).messages.create({
          model,
          max_tokens: input.maxTokens,
          system: input.system,
          messages: [{ role: 'user', content: input.prompt }],
        })
        const text = r.content.map((c) => (c.type === 'text' ? c.text : '')).join('')
        return { text, inputTokens: r.usage.input_tokens, outputTokens: r.usage.output_tokens }
      })
    case 'gemini': {
      const b = (await call(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
        method: 'POST',
        headers: geminiHeaders(key),
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: input.system }] },
          contents: [{ role: 'user', parts: [{ text: input.prompt }] }],
          generationConfig: { maxOutputTokens: input.maxTokens + 1024, thinkingConfig: { thinkingBudget: 0 } },
        }),
      })) as { candidates?: { content?: { parts?: { text?: string }[] } }[]; usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number } }
      return {
        text: (b.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? '').join(''),
        inputTokens: b.usageMetadata?.promptTokenCount ?? 0,
        outputTokens: b.usageMetadata?.candidatesTokenCount ?? 0,
      }
    }
  }
}
