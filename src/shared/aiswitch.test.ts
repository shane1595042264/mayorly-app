import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { onDeskId, reduce, sampleState, type Action, type MayorlyState } from '../core/index'
import { promptStep, type AgentPrompt } from './aiswitch'
import { eventOf, HOOK } from '../main/agents'

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

const typed = (manual = true, app: AgentPrompt['app'] = 'claude'): AgentPrompt => ({ at: now, app, manual })

/** One prompt through the step, the switch applied as the shell does. */
function prompt(d: ReturnType<typeof desk>, e: AgentPrompt) {
  const step = promptStep(d.s, e)
  if (step.act) d.act(step.act)
  return { switched: !!step.act, why: step.why }
}

describe('an AI prompt', () => {
  it('is Alt+Q: each typed prompt switches to the recent task, from any AI, and nothing switches back on its own', () => {
    const d = desk()
    expect(onDeskId(d.s)).toBe(d.id('beta'))
    expect(prompt(d, typed())).toEqual({ switched: true, why: 'switched' })
    expect(onDeskId(d.s)).toBe(d.id('alpha'))
    // The next prompt, from another AI, switches again: back to beta.
    expect(prompt(d, typed(true, 'chatgpt-web'))).toEqual({ switched: true, why: 'switched' })
    expect(onDeskId(d.s)).toBe(d.id('beta'))
  })

  it('switches from wherever you went yourself, as Alt+Q would', () => {
    const d = desk()
    d.act({ type: 'entry/capture', text: 'legal: gamma' })
    prompt(d, typed())
    d.act({ type: 'desk/select', entryId: d.id('gamma'), ledgerId: d.s.entries.find((e) => e.title === 'gamma')!.ledgerId })
    expect(prompt(d, typed())).toMatchObject({ switched: true })
    expect(onDeskId(d.s)).toBe(d.id('alpha'))
  })

  it('does nothing for a prompt you did not type, in a rest, from an idle desk, or with the rule off', () => {
    const d = desk()
    expect(prompt(d, typed(false))).toEqual({ switched: false, why: 'not typed by you' })
    const off = desk()
    off.act({ type: 'settings/update', patch: { autoSwitch: { aiPrompt: false } } })
    expect(prompt(off, typed())).toEqual({ switched: false, why: 'the rule is off' })
    const idle = desk()
    idle.act({ type: 'desk/standDown' })
    expect(prompt(idle, typed())).toEqual({ switched: false, why: 'the desk is idle' })
    const resting = desk()
    resting.act({ type: 'desk/skip' })
    expect(resting.s.desk.block?.kind).toBe('rest')
    expect(prompt(resting, typed())).toEqual({ switched: false, why: 'resting' })
  })
})

describe('a line from an AI hook', () => {
  it('is read when it is a prompt from a known app, and refused otherwise', () => {
    expect(eventOf('{"at":1,"app":"gemini","event":"prompt","session":"x","manual":true}')).toEqual({ at: 1, app: 'gemini', manual: true })
    expect(eventOf('{"at":1,"app":"codex","event":"prompt"}')?.manual).toBe(false)
    // An answer from a hook set up for 0.1.69's way back: nothing to do.
    expect(eventOf('{"at":1,"app":"claude","event":"done","manual":true}')).toBeNull()
    expect(eventOf('{"at":1,"app":"copilot","event":"prompt"}')).toBeNull()
    expect(eventOf('not json')).toBeNull()
  })
})

/** The hook as Claude Code runs it: its payload on stdin, Claude Code's environment, a home of its own. */
function hookLine(payload: Record<string, unknown>, entrypoint: string) {
  const home = mkdtempSync(join(tmpdir(), 'mayorly-hook-'))
  try {
    const script = join(home, 'ai-hook.cjs')
    writeFileSync(script, HOOK)
    spawnSync(process.execPath, [script, 'claude', 'prompt'], {
      input: JSON.stringify(payload),
      env: { ...process.env, USERPROFILE: home, HOME: home, CLAUDE_CODE_ENTRYPOINT: entrypoint },
      encoding: 'utf8',
    })
    return eventOf(readFileSync(join(home, '.mayorly', 'ai.jsonl'), 'utf8').trim())
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
}

describe('the hook', () => {
  it('counts a prompt typed in the desktop app or the terminal, and not one a script, a schedule or a notice sent', () => {
    expect(hookLine({ session_id: 's', prompt: 'fix the drag' }, 'claude-desktop')?.manual).toBe(true)
    expect(hookLine({ session_id: 's', prompt: 'fix the drag' }, 'cli')?.manual).toBe(true)
    // claude -p from a scheduler: the hourly AUTHOK check and /jira-worker switched the desk on the hour.
    expect(hookLine({ session_id: 's', prompt: 'Reply with exactly: AUTHOK' }, 'sdk-cli')?.manual).toBe(false)
    expect(hookLine({ session_id: 's', prompt: '/jira-worker' }, 'sdk-ts')?.manual).toBe(false)
    expect(hookLine({ session_id: 's', prompt: 'done', origin: { kind: 'task-notification' } }, 'claude-desktop')?.manual).toBe(false)
    expect(hookLine({ session_id: 's', prompt: '<scheduled-task name="x">' }, 'claude-desktop')?.manual).toBe(false)
  })
})
