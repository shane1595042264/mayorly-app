import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Seal } from '../../main/seal'
import { sealedClerkStore } from '../../main/ai/store'
import { AiClerk } from './service'
import { TRIALS } from './tuning'

// The clerk proposing a ledger, and the trial that sets how sure it must be, against a fake model.

vi.mock('electron', () => ({ safeStorage: {} }))
const dirs: string[] = []
afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

const reply = (text: string) => Response.json({ candidates: [{ content: { parts: [{ text }] } }] })

async function setup(answer: (body: string) => string | Response) {
  const dir = mkdtempSync(join(tmpdir(), 'mayorly-ai-test-'))
  dirs.push(dir)
  const clerk = new AiClerk(sealedClerkStore(dir, new Seal(dir, true)), () => {})
  let checking = true
  const bodies: string[] = []
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: { body?: unknown }) => {
    if (url.includes('/models?')) return Response.json({ models: [{ name: 'models/gemini-3.1-flash-lite', supportedGenerationMethods: ['generateContent'] }] })
    if (checking) return reply('ok')
    const body = String(init?.body ?? '')
    bodies.push(body)
    const r = answer(body)
    return typeof r === 'string' ? reply(r) : r
  }))
  await clerk.addKey(`AQ.${'dummy_'.repeat(8)}`)
  checking = false
  clerk.pace = { gapMs: 0, retryMs: 0 }
  return { clerk, bodies }
}

describe('a proposed ledger', () => {
  const ledgers = [{ id: 'l1', code: 'CAR', name: 'Career', criterion: 'Job applications' }, { id: 'l2', code: 'FIT', name: 'Fitness', criterion: 'Workouts' }] as never

  it('comes back tidied, with the closest ledger as the filing', async () => {
    const { clerk, bodies } = await setup(() => '{"ledgerCode":"NEW","confidence":0.91,"title":"repot the monstera","estimateMin":null,"newLedger":{"name":"\\"plants\\"","criterion":"Houseplants."},"fallbackCode":"FIT"}')
    const f = await clerk.fileEntry('repot the monstera', ledgers, [], { newLedgers: true })
    expect(f).toMatchObject({ ledgerId: 'l2', confidence: 'unsure', newLedger: { name: 'Plants', criterion: 'Houseplants.', confidence: 0.91 } })
    expect(bodies[0]).toContain('LEISURE or NEW')
  })

  it('is not asked for, nor taken, when new ledgers are off', async () => {
    const { clerk, bodies } = await setup(() => '{"ledgerCode":"NEW","confidence":0.91,"title":"repot the monstera","estimateMin":null,"newLedger":{"name":"Plants","criterion":""}}')
    const f = await clerk.fileEntry('repot the monstera', ledgers)
    expect(f?.newLedger).toBeUndefined()
    expect(bodies[0]).toContain('Never invent a ledger')
  })
})

describe('tuning by trial', () => {
  // A model that is sure of the right new ledgers and half sure of one wrong one.
  const model = (body: string) => {
    const t = TRIALS.find((x) => body.includes(`Line: ${x.line}`))!
    if (t.wantsNew) return `{"ledgerCode":"NEW","confidence":0.9,"title":"x","estimateMin":null,"newLedger":{"name":"Other","criterion":""},"fallbackCode":"LGL"}`
    if (t === TRIALS[0]) return `{"ledgerCode":"NEW","confidence":0.6,"title":"x","estimateMin":null,"newLedger":{"name":"Housing","criterion":""},"fallbackCode":"LGL"}`
    return '{"ledgerCode":"LGL","confidence":0.8,"title":"x","estimateMin":null}'
  }

  it('keeps the level that gets every trial right, and logs each one', async () => {
    const { clerk, bodies } = await setup(model)
    const lines: string[] = []
    clerk.onTuned = (l) => lines.push(...l)
    const pub = await clerk.calibrate()
    expect(bodies).toHaveLength(TRIALS.length)
    expect(pub.tuning).toMatchObject({ model: 'gemini-3.1-flash-lite', correct: TRIALS.length, total: TRIALS.length })
    expect(pub.tuning!.threshold).toBeGreaterThan(0.6)
    expect(pub.tuning!.threshold).toBeLessThanOrEqual(0.9)
    expect(clerk.tuned()?.threshold).toBe(pub.tuning!.threshold)
    expect(lines[0]).toMatch(/^tuned gemini-3\.1-flash-lite: starts a ledger at \d+% sure, 24 of 24 trial lines right$/)
    expect(lines).toHaveLength(TRIALS.length + 1)
    expect(pub.tuningNow).toBe(false)
  })

  it('keeps the level it had when too few lines are answered', async () => {
    const { clerk } = await setup(() => 'not json')
    const lines: string[] = []
    clerk.onTuned = (l) => lines.push(...l)
    const pub = await clerk.calibrate()
    expect(pub.tuning).toBeNull()
    expect(lines[0]).toMatch(/level unchanged/)
  })
})

describe('a key turned away for a rate limit', () => {
  const limited = () => Response.json({ error: { code: 429, message: 'You exceeded your current quota, please check your plan and billing details.', status: 'RESOURCE_EXHAUSTED' } }, { status: 429 })

  it('is checked again once it has rested, and works again', async () => {
    let refuse = true
    const { clerk } = await setup((body) => (body.includes('Line:') && refuse ? limited() : '{"ledgerCode":"CAR","confidence":0.9,"title":"x","estimateMin":null}'))
    await expect(clerk.fileEntry('apply to Stripe', [{ id: 'l1', code: 'CAR', name: 'Career', criterion: '' }] as never)).rejects.toThrow()
    expect(clerk.public().keys[0].status).toBe('failing')
    refuse = false
    await clerk.heal()
    expect(clerk.public().keys[0].status).toBe('failing')
    await clerk.heal(true)
    expect(clerk.public().keys[0].status).toBe('ok')
  })

  it('rests a day when refused for anything else, and is then tried again', async () => {
    let refuse = true
    const denied = () => Response.json({ error: { code: 400, message: 'API key not valid. Please pass a valid API key.', status: 'INVALID_ARGUMENT' } }, { status: 400 })
    const { clerk } = await setup(() => (refuse ? denied() : '{"ledgerCode":"CAR","confidence":0.9,"title":"x","estimateMin":null}'))
    await expect(clerk.fileEntry('apply to Stripe', [{ id: 'l1', code: 'CAR', name: 'Career', criterion: '' }] as never)).rejects.toThrow()
    const k = clerk.public().keys[0]
    expect(k.status).toBe('failing')
    expect(k.retryAt! - k.lastCheckedAt).toBe(24 * 3_600_000)
    refuse = false
    // A fresh launch cuts only a rate limit's rest short.
    expect(await clerk.heal(true)).toBe(0)
    expect(clerk.public().keys[0].status).toBe('failing')
    const later = k.retryAt! + 1
    vi.spyOn(Date, 'now').mockReturnValue(later)
    expect(await clerk.heal()).toBe(1)
    expect(clerk.public().keys[0]).toMatchObject({ status: 'ok', retryAt: null })
  })

  it('rests another day when still refused after its day', async () => {
    const denied = () => Response.json({ error: { code: 400, message: 'API key not valid. Please pass a valid API key.', status: 'INVALID_ARGUMENT' } }, { status: 400 })
    const { clerk } = await setup(() => denied())
    await expect(clerk.fileEntry('apply to Stripe', [{ id: 'l1', code: 'CAR', name: 'Career', criterion: '' }] as never)).rejects.toThrow()
    const first = clerk.public().keys[0].retryAt!
    vi.spyOn(Date, 'now').mockReturnValue(first + 1)
    expect(await clerk.heal()).toBe(0)
    expect(clerk.public().keys[0]).toMatchObject({ status: 'failing', retryAt: first + 1 + 24 * 3_600_000 })
  })

  it('does not cost the trial a line: it waits, heals the key and tries the line again', async () => {
    let refused = 0
    const { clerk } = await setup((body) => {
      if (!body.includes('Line:')) return 'ok'
      if (body.includes(`Line: ${TRIALS[3].line}`) && refused++ === 0) return limited()
      const t = TRIALS.find((x) => body.includes(`Line: ${x.line}`))!
      return t.wantsNew
        ? '{"ledgerCode":"NEW","confidence":0.9,"title":"x","estimateMin":null,"newLedger":{"name":"Other","criterion":""},"fallbackCode":"LGL"}'
        : '{"ledgerCode":"LGL","confidence":0.8,"title":"x","estimateMin":null}'
    })
    const pub = await clerk.calibrate()
    expect(refused).toBe(2)
    expect(pub.tuning).toMatchObject({ correct: TRIALS.length, total: TRIALS.length })
    expect(pub.keys[0].status).toBe('ok')
  })
})
