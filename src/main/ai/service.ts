import { randomUUID } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { safeStorage } from 'electron'
import type { Filing, Ledger } from '@core/index'
import type { AiKeyPublic, AiPublic } from '../../shared/bridge'
import { costMicroUsd, rankModels } from './catalog'
import { AI_PROVIDERS, PROVIDER_LABEL, detectProvider, keyHint, type AiProvider } from './detect'
import { ProviderError, generate, listModels } from './providers'

// The AI clerk. Keys are the user's own, one per provider, sealed with the OS
// keychain in ai.bin beside the state file; they never sync and never leave the
// machine except to call that provider. Adding a key proves it the shanejli.com
// way: detect the provider from its shape, list its models, then spend one
// token on the cheapest until one answers. Filing an entry is one small call.

interface KeyRecord extends AiKeyPublic {
  key: string
}

interface UsageEvent {
  at: number
  provider: AiProvider
  model: string
  feature: 'validate' | 'file'
  inputTokens: number
  outputTokens: number
  costMicroUsd: number
}

interface Saved {
  keys: KeyRecord[]
  preferredProvider: AiProvider | null
  usage: UsageEvent[]
}

const MAX_PROBES = 4
const USAGE_KEEP = 500
const FILE_TIMEOUT_MS = 9_000

export class KeyCheckError extends Error {
  constructor(readonly code: 'unknown_provider' | 'auth' | 'quota' | 'no_models' | 'unreachable', message: string) {
    super(message)
    this.name = 'KeyCheckError'
  }
}

export class AiClerk {
  private readonly file: string
  private data: Saved = { keys: [], preferredProvider: null, usage: [] }

  constructor(dir: string, private readonly onChange: (pub: AiPublic) => void) {
    this.file = join(dir, 'ai.bin')
    this.load()
  }

  enabled(): boolean {
    return this.data.keys.some((k) => k.status === 'ok')
  }

  public(): AiPublic {
    const since = Date.now() - 30 * 86_400_000
    const recent = this.data.usage.filter((u) => u.at >= since)
    return {
      keys: this.data.keys.map(({ key: _k, ...pub }) => pub),
      preferredProvider: this.data.preferredProvider,
      providers: PROVIDER_LABEL,
      usage: {
        days: 30,
        calls: recent.filter((u) => u.feature === 'file').length,
        costMicroUsd: recent.reduce((n, u) => n + u.costMicroUsd, 0),
      },
    }
  }

  async addKey(raw: string): Promise<AiPublic> {
    const key = raw.trim()
    const d = detectProvider(key)
    if (!d.provider) throw new KeyCheckError('unknown_provider', d.reason)
    const { models, defaultModel } = await this.checkKey(d.provider, key)
    const now = Date.now()
    const existing = this.data.keys.find((k) => k.provider === d.provider)
    const record: KeyRecord = {
      id: existing?.id ?? randomUUID(),
      provider: d.provider,
      key,
      keyHint: keyHint(key),
      models,
      defaultModel,
      preferredModel: existing?.preferredModel && models.includes(existing.preferredModel) ? existing.preferredModel : null,
      status: 'ok',
      lastError: null,
      lastCheckedAt: now,
      createdAt: existing?.createdAt ?? now,
    }
    this.data.keys = [...this.data.keys.filter((k) => k.provider !== d.provider), record]
    this.save()
    return this.public()
  }

  async recheckKey(id: string): Promise<AiPublic> {
    const k = this.data.keys.find((x) => x.id === id)
    if (!k) return this.public()
    try {
      const { models, defaultModel } = await this.checkKey(k.provider, k.key)
      Object.assign(k, { models, defaultModel, preferredModel: k.preferredModel && models.includes(k.preferredModel) ? k.preferredModel : null, status: 'ok', lastError: null, lastCheckedAt: Date.now() })
    } catch (err) {
      Object.assign(k, { status: 'failing', lastError: err instanceof Error ? err.message : 'Check failed', lastCheckedAt: Date.now() })
    }
    this.save()
    return this.public()
  }

  removeKey(id: string): AiPublic {
    this.data.keys = this.data.keys.filter((k) => k.id !== id)
    this.save()
    return this.public()
  }

  setPreferredModel(id: string, model: string | null): AiPublic {
    const k = this.data.keys.find((x) => x.id === id)
    if (k && (model === null || k.models.includes(model))) {
      k.preferredModel = model
      this.save()
    }
    return this.public()
  }

  setPreferredProvider(provider: AiProvider | null): AiPublic {
    this.data.preferredProvider = provider && AI_PROVIDERS.includes(provider) ? provider : null
    this.save()
    return this.public()
  }

  /**
   * Files one captured line. Null when no key works, the model answers nonsense,
   * or the call takes too long; the caller then files by prefix as before.
   */
  async fileEntry(text: string, ledgers: Ledger[], rules: string[] = []): Promise<Filing | null> {
    const k = this.pick()
    if (!k) return null
    const model = k.preferredModel ?? k.defaultModel
    const system = [
      'You are the clerk of Mayorly, a personal ledger system. The user typed one line into the capture tray.',
      'Decide which ledger it belongs to from the list, by each ledger\'s criterion. Never invent a ledger.',
      'Always pick the best-fitting ledger, even when the fit is poor; say so with the confidence field instead of leaving it out.',
      'Entertainment is not a ledger: games, shows, streams, films, scrolling, anything with no productive value gets ledgerCode LEISURE. Exercise, study and work are not entertainment.',
      'The house rules are the user\'s own corrections and come before the criteria.',
      `Reply with JSON only, no prose: {"ledgerCode": one of ${ledgers.map((l) => l.code).join(', ')}, LEISURE, "confidence": "sure" or "unsure", "title": string, "estimateMin": number or null}. ledgerCode is never null.`,
      'title: the entry as a short line in the user\'s own words, without the ledger name, tags such as #dance, or the time estimate.',
      'estimateMin: the minutes if the line states a duration (~20, 20 min, 1h), otherwise null.',
    ].join(' ')
    const prompt = `${ledgerList(ledgers)}${houseRules(rules)}\nLine: ${text}`
    try {
      const r = await Promise.race([
        generate(k.provider, k.key, model, { system, prompt, maxTokens: 160 }),
        new Promise<never>((_, reject) => setTimeout(() => reject(new ProviderError('other', 0, 'The clerk took too long')), FILE_TIMEOUT_MS)),
      ])
      this.record({ at: Date.now(), provider: k.provider, model, feature: 'file', inputTokens: r.inputTokens, outputTokens: r.outputTokens, costMicroUsd: costMicroUsd(k.provider, model, r.inputTokens, r.outputTokens) })
      const parsed = parseFiling(r.text)
      if (!parsed) return null
      const title = parsed.title.trim() || text.trim()
      const quoted = `'${title.length > 40 ? title.slice(0, 39) + '…' : title}'`
      if (parsed.ledgerCode?.toUpperCase() === 'LEISURE') {
        return { title, ledgerId: null, estimateMin: parsed.estimateMin, log: `couch ${quoted}: entertainment (clerk, ${model})`, model, confidence: parsed.confidence, leisure: true }
      }
      const named = parsed.ledgerCode ? ledgers.find((l) => l.code.toLowerCase() === parsed.ledgerCode!.toLowerCase()) ?? null : null
      const ledger = named ?? bestGuess(text, ledgers)
      const est = parsed.estimateMin ? ` est ${parsed.estimateMin}m` : ''
      const confidence = named ? parsed.confidence : 'unsure'
      return {
        title,
        ledgerId: ledger?.id ?? null,
        estimateMin: parsed.estimateMin,
        log: ledger ? `filed ${quoted} -> ${ledger.code} (clerk, ${model}${confidence === 'unsure' ? ', unsure' : ''})${est}` : `tray ${quoted}: clerk found no ledger (${model})${est}`,
        model,
        confidence,
      }
    } catch (err) {
      if (err instanceof ProviderError && (err.kind === 'auth' || err.kind === 'quota')) {
        Object.assign(k, { status: 'failing', lastError: err.message, lastCheckedAt: Date.now() })
        this.save()
      }
      console.error('[clerk]', err instanceof Error ? err.message : err)
      return null
    }
  }

  /**
   * Files several existing tray entries in one call. Titles are kept as they are;
   * only the ledger and a missing estimate come back. Entries the model leaves out
   * or answers nonsense for stay where they are.
   */
  async fileMany(entries: { id: string; title: string }[], ledgers: Ledger[], rules: string[] = []): Promise<Map<string, { ledgerId: string | null; estimateMin: number | null; log: string; model: string; confidence: 'sure' | 'unsure'; leisure?: boolean }>> {
    const out = new Map<string, { ledgerId: string | null; estimateMin: number | null; log: string; model: string; confidence: 'sure' | 'unsure'; leisure?: boolean }>()
    const k = this.pick()
    if (!k || entries.length === 0) return out
    const model = k.preferredModel ?? k.defaultModel
    const system = [
      'You are the clerk of Mayorly, a personal ledger system. Here are entries waiting in the tray, each with a number.',
      'For each, decide which ledger it belongs to by each ledger\'s criterion. Never invent a ledger.',
      'Always pick the best-fitting ledger, even when the fit is poor; say so with the confidence field instead of leaving it out.',
      'Entertainment is not a ledger: games, shows, streams, films, scrolling, anything with no productive value gets ledgerCode LEISURE. Exercise, study and work are not entertainment.',
      'The house rules are the user\'s own corrections and come before the criteria.',
      `Reply with JSON only, no prose and no wrapper object: an array of {"n": number, "ledgerCode": one of ${ledgers.map((l) => l.code).join(', ')}, LEISURE, "confidence": "sure" or "unsure", "estimateMin": number or null}, one per entry. ledgerCode is never null.`,
      'estimateMin: the minutes if the entry states a duration, otherwise null. ledgerCode: null when no ledger fits.',
    ].join(' ')
    const prompt = `${ledgerList(ledgers)}${houseRules(rules)}\nEntries:\n${entries.map((e, i) => `- ${i + 1}: ${e.title}`).join('\n')}`
    try {
      const r = await Promise.race([
        generate(k.provider, k.key, model, { system, prompt, maxTokens: 200 + 40 * entries.length }),
        new Promise<never>((_, reject) => setTimeout(() => reject(new ProviderError('other', 0, 'The clerk took too long')), FILE_TIMEOUT_MS * 2)),
      ])
      this.record({ at: Date.now(), provider: k.provider, model, feature: 'file', inputTokens: r.inputTokens, outputTokens: r.outputTokens, costMicroUsd: costMicroUsd(k.provider, model, r.inputTokens, r.outputTokens) })
      if (process.env.MAYORLY_DEBUG) console.error('[clerk] sweep answer:', r.text.slice(0, 600))
      const rows = parseRows(r.text)
      if (!rows) {
        console.error('[clerk] the sweep answer had no usable JSON:', r.text.slice(0, 200))
        return out
      }
      for (const row of rows) {
        const n = typeof row.n === 'number' ? row.n : typeof row.n === 'string' ? Number(row.n) : NaN
        const entry = entries[n - 1]
        if (!entry) continue
        const code = typeof row.ledgerCode === 'string' ? row.ledgerCode : null
        if (code?.toUpperCase() === 'LEISURE') {
          out.set(entry.id, { ledgerId: null, estimateMin: null, log: `couch '${entry.title.length > 40 ? entry.title.slice(0, 39) + '…' : entry.title}': entertainment (clerk, ${model}, from the tray)`, model, confidence: 'sure', leisure: true })
          continue
        }
        const named = code ? ledgers.find((l) => l.code.toLowerCase() === code.toLowerCase()) ?? null : null
        const ledger = named ?? bestGuess(entry.title, ledgers)
        if (!ledger) continue
        const est = typeof row.estimateMin === 'number' && row.estimateMin > 0 ? Math.round(row.estimateMin) : null
        const confidence = named && String(row.confidence).toLowerCase() !== 'unsure' ? 'sure' : 'unsure'
        const quoted = `'${entry.title.length > 40 ? entry.title.slice(0, 39) + '…' : entry.title}'`
        out.set(entry.id, { ledgerId: ledger.id, estimateMin: est, log: `filed ${quoted} -> ${ledger.code} (clerk, ${model}, from the tray${confidence === 'unsure' ? ', unsure' : ''})${est ? ` est ${est}m` : ''}`, model, confidence })
      }
      return out
    } catch (err) {
      if (err instanceof ProviderError && (err.kind === 'auth' || err.kind === 'quota')) {
        Object.assign(k, { status: 'failing', lastError: err.message, lastCheckedAt: Date.now() })
        this.save()
      }
      console.error('[clerk]', err instanceof Error ? err.message : err)
      return out
    }
  }

  /**
   * One short, natural question about an entry the user just corrected or confirmed,
   * so the answer can sharpen the house rule. Null when no key works or the model is slow.
   */
  async askAbout(title: string, to: string, from: string | null, reason: 'moved' | 'confirmed'): Promise<string | null> {
    const k = this.pick()
    if (!k) return null
    const model = k.preferredModel ?? k.defaultModel
    const system = 'You are the clerk of Mayorly, a personal ledger system, and you file the user\'s entries. You were just corrected or confirmed. Ask the user one short, natural question, at most twelve words, about what the entry means or why it belongs there, so you file better next time. Plain words, no preamble, no quotation marks, just the question.'
    const prompt = reason === 'moved'
      ? `You filed "${title}" under ${from ?? 'the tray'}; the user moved it to ${to}.`
      : `You filed "${title}" under ${to} but were not sure; the user said it is right.`
    try {
      const r = await Promise.race([
        generate(k.provider, k.key, model, { system, prompt, maxTokens: 60 }),
        new Promise<never>((_, reject) => setTimeout(() => reject(new ProviderError('other', 0, 'slow')), 6_000)),
      ])
      this.record({ at: Date.now(), provider: k.provider, model, feature: 'file', inputTokens: r.inputTokens, outputTokens: r.outputTokens, costMicroUsd: costMicroUsd(k.provider, model, r.inputTokens, r.outputTokens) })
      const q = r.text.trim().split('\n')[0].replace(/^["'\s]+|["'\s]+$/g, '')
      return q && q.length <= 140 ? q : null
    } catch {
      return null
    }
  }

  // ---- internals ----

  private pick(): KeyRecord | null {
    const ok = this.data.keys.filter((k) => k.status === 'ok')
    return ok.find((k) => k.provider === this.data.preferredProvider) ?? ok[0] ?? null
  }

  private async checkKey(provider: AiProvider, key: string) {
    let listed: string[]
    try {
      listed = await listModels(provider, key)
    } catch (err) {
      if (err instanceof ProviderError && err.kind === 'auth') throw new KeyCheckError('auth', `The provider rejected this key: ${err.message}`)
      throw new KeyCheckError('unreachable', err instanceof Error ? err.message : 'Could not reach the provider')
    }
    const models = rankModels(provider, listed)
    if (models.length === 0) throw new KeyCheckError('no_models', 'This key cannot use any text model.')
    let last: ProviderError | null = null
    for (const model of models.slice(0, MAX_PROBES)) {
      try {
        const r = await generate(provider, key, model, { system: 'Reply with one word.', prompt: 'ok', maxTokens: 8 })
        this.record({ at: Date.now(), provider, model, feature: 'validate', inputTokens: r.inputTokens, outputTokens: r.outputTokens, costMicroUsd: costMicroUsd(provider, model, r.inputTokens, r.outputTokens) })
        return { models, defaultModel: model }
      } catch (err) {
        if (!(err instanceof ProviderError)) throw err
        last = err
        if (err.kind === 'auth') throw new KeyCheckError('auth', `The provider rejected this key: ${err.message}`)
        if (err.kind === 'quota') throw new KeyCheckError('quota', `The key is valid but the account cannot run models: ${err.message}`)
      }
    }
    throw new KeyCheckError('no_models', `None of the cheapest models answered${last ? `: ${last.message}` : '.'}`)
  }

  private record(u: UsageEvent) {
    this.data.usage = [...this.data.usage.slice(-(USAGE_KEEP - 1)), u]
    this.save()
  }

  private load() {
    try {
      if (!existsSync(this.file)) return
      const raw = readFileSync(this.file)
      const text = safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(raw) : raw.toString('utf8')
      const d = JSON.parse(text) as Partial<Saved>
      this.data = { keys: Array.isArray(d.keys) ? d.keys : [], preferredProvider: d.preferredProvider ?? null, usage: Array.isArray(d.usage) ? d.usage : [] }
    } catch (err) {
      console.error('[clerk] could not read the AI keys:', err)
    }
  }

  private save() {
    try {
      const text = JSON.stringify(this.data)
      writeFileSync(this.file, safeStorage.isEncryptionAvailable() ? safeStorage.encryptString(text) : Buffer.from(text, 'utf8'))
    } catch (err) {
      console.error('[clerk] could not save the AI keys:', err)
    }
    this.onChange(this.public())
  }
}

/**
 * When the model will not choose, the ledger whose name or criterion shares the most
 * words with the line, or the first ledger. Always reported as unsure: the point is
 * that nothing is left in the tray and the doubt is visible.
 */
function bestGuess(text: string, ledgers: Ledger[]): Ledger | null {
  if (ledgers.length === 0) return null
  const words = new Set(text.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2))
  let best = ledgers[0]
  let score = -1
  for (const l of ledgers) {
    const bag = `${l.name} ${l.criterion}`.toLowerCase().split(/[^a-z0-9]+/)
    const n = bag.filter((w) => w.length > 2 && words.has(w)).length
    if (n > score) {
      score = n
      best = l
    }
  }
  return best
}

const ledgerList = (ledgers: Ledger[]) => `Ledgers:\n${ledgers.map((l) => `- ${l.code}: ${l.name}. ${l.criterion}`).join('\n')}\n`
const houseRules = (rules: string[]) => (rules.length ? `\nHouse rules:\n${rules.map((r) => `- ${r}`).join('\n')}\n` : '')

/** The array of rows, whether it came bare, wrapped in an object, or fenced in markdown. */
function parseRows(text: string): { n?: unknown; ledgerCode?: unknown; estimateMin?: unknown; confidence?: unknown }[] | null {
  const body = text.replace(/```(?:json)?/gi, '').trim()
  const start = body.search(/[[{]/)
  if (start < 0) return null
  try {
    const j = JSON.parse(body.slice(start, Math.max(body.lastIndexOf(']'), body.lastIndexOf('}')) + 1)) as unknown
    if (Array.isArray(j)) return j as { n?: unknown }[]
    if (j && typeof j === 'object') {
      const inner = Object.values(j as Record<string, unknown>).find((v) => Array.isArray(v))
      if (inner) return inner as { n?: unknown }[]
    }
  } catch {
    /* fall through */
  }
  return null
}

function parseFiling(text: string): { ledgerCode: string | null; title: string; estimateMin: number | null; confidence: 'sure' | 'unsure' } | null {
  const m = text.match(/\{[\s\S]*\}/)
  if (!m) return null
  try {
    const j = JSON.parse(m[0]) as { ledgerCode?: unknown; title?: unknown; estimateMin?: unknown; confidence?: unknown }
    if (typeof j.title !== 'string') return null
    const est = typeof j.estimateMin === 'number' && j.estimateMin > 0 ? Math.round(j.estimateMin) : null
    return { ledgerCode: typeof j.ledgerCode === 'string' ? j.ledgerCode : null, title: j.title, estimateMin: est, confidence: String(j.confidence).toLowerCase() === 'unsure' ? 'unsure' : 'sure' }
  } catch {
    return null
  }
}
