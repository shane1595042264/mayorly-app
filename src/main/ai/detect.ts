// Which provider a pasted key belongs to, from its format alone, the same way
// shanejli.com does it. The settings field asks for nothing but the key, so this
// is the whole of the provider choice. Order matters: every Anthropic key also
// starts with "sk-", so "sk-ant-" is tested before the bare "sk-" of OpenAI.

export type AiProvider = 'gemini' | 'openai' | 'anthropic' | 'xai'

export const AI_PROVIDERS: readonly AiProvider[] = ['gemini', 'openai', 'anthropic', 'xai']

export const PROVIDER_LABEL: Record<AiProvider, string> = {
  gemini: 'Google Gemini',
  openai: 'OpenAI',
  anthropic: 'Anthropic Claude',
  xai: 'xAI Grok',
}

export type Detection = { provider: AiProvider } | { provider: null; reason: string }

const SUPPORTED = 'Supported keys: Google Gemini (AIza...), OpenAI (sk-...), Anthropic (sk-ant-...) and xAI Grok (xai-...).'

export function detectProvider(raw: string): Detection {
  const key = raw.trim()
  if (!key) return { provider: null, reason: 'Paste an API key.' }
  if (/\s/.test(key)) return { provider: null, reason: 'A key has no spaces in it. Paste only the key.' }
  if (key.length < 20) return { provider: null, reason: 'That is too short to be an API key.' }
  if (key.startsWith('sk-ant-admin')) return { provider: null, reason: 'That is an Anthropic Admin key, which cannot run models. Create a regular API key in the Anthropic console.' }
  if (key.startsWith('sk-ant-')) return { provider: 'anthropic' }
  if (key.startsWith('sk-or-')) return { provider: null, reason: `OpenRouter keys are not supported. ${SUPPORTED}` }
  if (key.startsWith('sk-admin-')) return { provider: null, reason: 'That is an OpenAI Admin key, which cannot run models. Create a project API key.' }
  if (key.startsWith('xai-')) return { provider: 'xai' }
  if (key.startsWith('gsk_')) return { provider: null, reason: 'That looks like a Groq key (gsk_). Groq is not supported; xAI Grok keys start with xai-.' }
  if (/^AIza[0-9A-Za-z_-]{35}$/.test(key)) return { provider: 'gemini' }
  if (key.startsWith('sk-')) return { provider: 'openai' }
  return { provider: null, reason: `Could not tell which provider this key is for. ${SUPPORTED}` }
}

/** The last four characters: enough to tell two keys apart, useless to anyone else. */
export const keyHint = (key: string) => key.trim().slice(-4)
