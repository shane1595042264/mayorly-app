import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Action } from '@core/index'
import { horizonEndFor, windowsFor } from '../shared/windows'
import { Engine } from './engine'
import { Store } from './store'
import { Sync } from './sync'

// Two real computers, engine and sync loop, against a stand-in for mayorly-api with the clock
// faked. The bearer token says which computer is calling, so each write can be counted.

const MIN = 60_000
const dirs: string[] = []
let revision = 0
let doc: unknown = null
let writes: string[] = []

const answer = (status: number, body: unknown) => new Response(JSON.stringify(body), { status })

async function api(url: string, init?: RequestInit): Promise<Response> {
  if (init?.method !== 'PUT') {
    if (doc === null) return answer(200, { revision: 0, state: null })
    if (Number(new URL(url).searchParams.get('have')) === revision) return answer(200, { revision, unchanged: true })
    return answer(200, { revision, state: doc })
  }
  const body = JSON.parse(String(init.body)) as { baseRevision: number; state: unknown }
  if (body.baseRevision !== revision) return answer(409, { error: 'stale', revision, state: doc })
  revision++
  doc = body.state
  writes.push(String((init.headers as Record<string, string>).Authorization).replace('Bearer ', ''))
  return answer(200, { revision })
}

function computer(name: string) {
  const dir = mkdtempSync(join(tmpdir(), `mayorly-sync-${name}-`))
  dirs.push(dir)
  const engine = new Engine(new Store(dir), { id: name, name })
  const replan = () => {
    const cal = engine.state.settings.calendar
    const now = Date.now()
    engine.dispatch({ type: 'schedule/replan', windows: windowsFor(cal, now, cal.horizonDays + 1), horizonEnd: horizonEndFor(cal, now) })
  }
  // What installReplanner does, without Electron's power monitor.
  engine.onAction((a: Action) => {
    if (a.type.startsWith('sync/')) setTimeout(replan, 250)
  })
  setInterval(replan, MIN)
  const sync = new Sync(engine, 'http://api.test', dir, () => {})
  engine.start()
  sync.setSession(name)
  return { engine, sync, sitting: () => engine.state.sittings.at(-1)!, act: (a: Action) => engine.act(a) }
}

/** The focus time the interval log adds up to, the open interval left out. */
const logged = (c: ReturnType<typeof computer>) =>
  c.engine.state.segments.filter((x) => x.kind === 'focus' && x.end !== null && x.sittingId === c.sitting().id).reduce((n, x) => n + x.end! - x.start, 0)

const after = (ms: number) => vi.advanceTimersByTimeAsync(ms)
const count = (name: string) => writes.filter((w) => w === name).length

/** A Mac with work on it, then a PC signed in to the same account, both settled. */
async function twoComputers() {
  const mac = computer('mac')
  await after(5_000)
  mac.act({ type: 'settings/update', patch: { focusMin: 50, calendar: { ...mac.engine.state.settings.calendar, tz: 'UTC' } } })
  mac.act({ type: 'entry/capture', text: 'write the report ~180' })
  await after(30_000)
  const pc = computer('pc')
  await after(2 * MIN)
  return { mac, pc }
}

describe('two computers, one account', () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: Date.UTC(2026, 10, 9, 10, 0, 0) })
    vi.stubGlobal('fetch', api)
    revision = 0
    doc = null
    writes = []
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.clearAllTimers()
    vi.useRealTimers()
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
  })

  it('the computer watching a running block writes nothing, and focus time does not pile up', async () => {
    const { mac, pc } = await twoComputers()
    mac.act({ type: 'desk/deploy', mode: 'pomodoro', entryId: mac.engine.state.entries[0].id })
    await after(2 * MIN)
    expect(pc.engine.state.desk).toMatchObject({ status: 'paused', device: { id: 'mac' } })
    writes = []
    await after(30 * MIN)
    expect(count('pc')).toBe(0)
    expect(writes.length).toBeLessThanOrEqual(3)
    // The hold is the only thing the PC adds, and it is never counted twice.
    expect(pc.sitting().focusMs).toBeLessThanOrEqual(33 * MIN)
    expect(pc.sitting().focusMs).toBe(logged(pc))
    expect(mac.engine.state.desk.status).toBe('running')
  })

  it('a real change on the watching computer goes up once and leaves the running one intact', async () => {
    const { mac, pc } = await twoComputers()
    mac.act({ type: 'desk/deploy', mode: 'pomodoro', entryId: mac.engine.state.entries[0].id })
    await after(5 * MIN)
    writes = []
    // Filed by the clerk, say: it changes the state and claims nothing.
    pc.engine.dispatch({ type: 'entry/add', title: 'from the other computer', ledgerId: null, estimateMin: null })
    await after(5 * MIN)
    expect(count('pc')).toBe(1)
    expect(count('mac')).toBeLessThanOrEqual(2)
    const settled = writes.length
    await after(10 * MIN)
    expect(writes.length - settled).toBeLessThanOrEqual(1)
    expect(mac.engine.state.entries.map((e) => e.title)).toContain('from the other computer')
    expect(mac.engine.state.desk.status).toBe('running')
    mac.act({ type: 'desk/pause' })
    await after(2 * MIN)
    const ran = 20 * MIN
    expect(mac.sitting().focusMs).toBe(logged(mac))
    expect(mac.sitting().focusMs).toBeGreaterThanOrEqual(ran)
    expect(mac.sitting().focusMs).toBeLessThanOrEqual(ran + MIN)
  })

  it('taking over on the other computer settles, and each side ends where it should', async () => {
    const { mac, pc } = await twoComputers()
    mac.act({ type: 'desk/deploy', mode: 'pomodoro', entryId: mac.engine.state.entries[0].id })
    await after(5 * MIN)
    pc.act({ type: 'desk/resume' })
    expect(pc.engine.state.desk.status).toBe('running')
    await after(3 * MIN)
    expect(mac.engine.state.desk).toMatchObject({ status: 'paused', device: { id: 'pc' } })
    writes = []
    await after(10 * MIN)
    expect(count('mac')).toBe(0)
    expect(writes.length).toBeLessThanOrEqual(1)
  })

  it('with both computers idle the server hears next to nothing', async () => {
    const { pc } = await twoComputers()
    writes = []
    await after(60 * MIN)
    expect(count('pc')).toBe(0)
    expect(writes.length).toBeLessThanOrEqual(4)
    expect(pc.engine.state.desk.status).toBe('idle')
  })

  it('an edit still reaches the other computer within a poll', async () => {
    const { mac, pc } = await twoComputers()
    pc.act({ type: 'entry/add', title: 'typed on the pc', ledgerId: null, estimateMin: null })
    await after(2 * MIN)
    expect(mac.engine.state.entries.map((e) => e.title)).toContain('typed on the pc')
  })
})
