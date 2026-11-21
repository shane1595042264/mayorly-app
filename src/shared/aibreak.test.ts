import { describe, expect, it } from 'vitest'
import { onDeskId, reduce, sampleState, type Action, type MayorlyState } from '../core/index'
import { breakStep, type AgentEvent, type AiBreak } from './aibreak'
import { eventOf } from '../main/agents'

const now = Date.parse('2026-11-21T15:00:00Z')

function desk() {
  let n = 0
  const ctx = { now, newId: () => `id${++n}`, random: () => 0.5, device: 'here' }
  let s: MayorlyState = sampleState(now, ctx.newId)
  const act = (a: Action) => (s = reduce(s, a, ctx).state)
  // On beta, having come from alpha: Alt+Q would go back to alpha.
  act({ type: 'entry/capture', text: 'legal: alpha', start: true })
  act({ type: 'entry/capture', text: 'dance: beta', start: true })
  const id = (t: string) => s.entries.find((e) => e.title === t)!.id
  return { get s() { return s }, act, id }
}

const ev = (event: 'prompt' | 'done', session = 's1', manual = true, app: AgentEvent['app'] = 'claude'): AgentEvent => ({ at: now, app, event, session, manual })

/** One event through the step, the switch applied, the break's `to` filled as the shell does. */
function run(d: ReturnType<typeof desk>, brk: AiBreak | null, e: AgentEvent): { brk: AiBreak | null; switched: boolean; why: string } {
  const step = breakStep(d.s, brk, e)
  let next = step.brk
  if (step.act) {
    d.act(step.act)
    if (e.event === 'prompt' && next) next = { ...next, to: onDeskId(d.s) }
  }
  return { brk: next, switched: !!step.act, why: step.why }
}

describe('the AI break', () => {
  it('goes to the last task on a typed prompt, stays there for more prompts, and comes back after the last answer', () => {
    const d = desk()
    expect(onDeskId(d.s)).toBe(d.id('beta'))
    let r = run(d, null, ev('prompt', 'claude-1'))
    expect(r.switched).toBe(true)
    expect(onDeskId(d.s)).toBe(d.id('alpha'))
    // A second AI while on the break: it joins, the desk stays.
    r = run(d, r.brk, ev('prompt', 'web-tab', true, 'chatgpt-web'))
    expect(r).toMatchObject({ switched: false, why: 'already on a break' })
    expect(onDeskId(d.s)).toBe(d.id('alpha'))
    r = run(d, r.brk, ev('done', 'claude-1'))
    expect(r).toMatchObject({ switched: false, why: 'others still working' })
    r = run(d, r.brk, ev('done', 'web-tab', true, 'chatgpt-web'))
    expect(r).toMatchObject({ switched: true, why: 'back', brk: null })
    expect(onDeskId(d.s)).toBe(d.id('beta'))
  })

  it('leaves the desk where you put it when you moved on during the break', () => {
    const d = desk()
    d.act({ type: 'entry/capture', text: 'legal: gamma' })
    let r = run(d, null, ev('prompt'))
    d.act({ type: 'desk/select', entryId: d.id('gamma'), ledgerId: d.s.entries.find((e) => e.title === 'gamma')!.ledgerId })
    r = run(d, r.brk, ev('done'))
    expect(r).toMatchObject({ switched: false, why: 'you moved on', brk: null })
    expect(onDeskId(d.s)).toBe(d.id('gamma'))
  })

  it('takes no break for a prompt you did not type, in a rest, from an idle desk, or with the rule off', () => {
    const d = desk()
    expect(run(d, null, ev('prompt', 's', false))).toMatchObject({ switched: false, why: 'not typed by you' })
    const off = desk()
    off.act({ type: 'settings/update', patch: { autoSwitch: { aiBreak: false, aiReturn: true } } })
    expect(run(off, null, ev('prompt'))).toMatchObject({ switched: false, why: 'the rule is off' })
    const idle = desk()
    idle.act({ type: 'desk/standDown' })
    expect(run(idle, null, ev('prompt'))).toMatchObject({ switched: false, why: 'the desk is idle' })
    const resting = desk()
    resting.act({ type: 'desk/skip' })
    expect(resting.s.desk.block?.kind).toBe('rest')
    expect(run(resting, null, ev('prompt'))).toMatchObject({ switched: false, why: 'resting' })
  })

  it('does not come back when coming back is off, and ignores answers it was not waiting for', () => {
    const d = desk()
    d.act({ type: 'settings/update', patch: { autoSwitch: { aiBreak: true, aiReturn: false } } })
    let r = run(d, null, ev('prompt', 'a'))
    expect(run(d, r.brk, ev('done', 'someone-else'))).toMatchObject({ switched: false, why: 'not part of a break' })
    r = run(d, r.brk, ev('done', 'a'))
    expect(r).toMatchObject({ switched: false, why: 'coming back is off', brk: null })
    expect(onDeskId(d.s)).toBe(d.id('alpha'))
  })
})

describe('a line from an AI hook', () => {
  it('is read when it names a known app and event, and refused otherwise', () => {
    expect(eventOf('{"at":1,"app":"gemini","event":"prompt","session":"x","manual":true}')).toEqual({ at: 1, app: 'gemini', event: 'prompt', session: 'x', manual: true })
    expect(eventOf('{"at":1,"app":"codex","event":"done","session":"x"}')?.manual).toBe(false)
    expect(eventOf('{"at":1,"app":"copilot","event":"prompt"}')).toBeNull()
    expect(eventOf('{"at":1,"app":"claude","event":"maybe"}')).toBeNull()
    expect(eventOf('not json')).toBeNull()
  })
})
