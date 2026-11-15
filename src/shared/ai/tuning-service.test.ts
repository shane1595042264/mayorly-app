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
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

const reply = (text: string) => Response.json({ candidates: [{ content: { parts: [{ text }] } }] })

async function setup(answer: (body: string) => string) {
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
    return reply(answer(body))
  }))
  await clerk.addKey(`AQ.${'dummy_'.repeat(8)}`)
  checking = false
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
