import { onDeskId, switchBack, switchSession, type Action, type MayorlyState } from '../core/index'

// A break while an AI works. You send Claude Code, Gemini, Codex or ChatGPT a prompt; the desk
// does what Alt+Q does, onto the task you were on before, so the wait is spent on something
// else; when that AI has answered, the desk comes back, unless you have moved on meanwhile.
// Pure: the shell feeds it events and applies the step it returns.

export type AgentApp = 'claude' | 'gemini' | 'codex' | 'chatgpt-web' | 'gemini-web'

export const AGENT_APPS: readonly AgentApp[] = ['claude', 'gemini', 'codex', 'chatgpt-web', 'gemini-web']

export const AGENT_NAME: Record<AgentApp, string> = { claude: 'Claude', gemini: 'Gemini', codex: 'Codex', 'chatgpt-web': 'ChatGPT', 'gemini-web': 'Gemini' }

export interface AgentEvent {
  at: number
  app: AgentApp
  /** prompt: you sent it one; done: it has answered. */
  event: 'prompt' | 'done'
  /** The AI's own session, or a browser tab: a break waits on the sessions that started it. */
  session: string
  /** Typed by a person; a scheduled task or a background notice is not. */
  manual: boolean
}

/** A break in progress: the task it left, the one it went to, and the AI sessions still working. */
export interface AiBreak {
  from: string | null
  to: string | null
  waiting: string[]
}

export interface BreakStep {
  brk: AiBreak | null
  /** What to do to the desk: the quick switch, or nothing. */
  act: Action | null
  /** Why, in a few words, for the log. */
  why: string
}

export const agentKey = (e: Pick<AgentEvent, 'app' | 'session'>) => `${e.app}:${e.session}`

export function breakStep(s: MayorlyState, brk: AiBreak | null, e: AgentEvent): BreakStep {
  const rules = s.settings.autoSwitch
  const key = agentKey(e)
  const desk = onDeskId(s)
  if (e.event === 'prompt') {
    if (!rules.aiBreak) return { brk, act: null, why: 'the rule is off' }
    if (!e.manual) return { brk, act: null, why: 'not typed by you' }
    if (s.desk.status === 'idle' || !s.desk.block) return { brk, act: null, why: 'the desk is idle' }
    if (s.desk.block.kind === 'rest') return { brk, act: null, why: 'resting' }
    // Already on the break: another prompt joins it rather than switching back.
    if (brk && desk !== null && desk === brk.to) return { brk: { ...brk, waiting: [...new Set([...brk.waiting, key])] }, act: null, why: 'already on a break' }
    if (!switchBack(s) && !switchSession(s)) return { brk: null, act: null, why: 'no last task to switch to' }
    return { brk: { from: desk, to: null, waiting: [key] }, act: { type: 'desk/switch' }, why: 'break' }
  }
  if (!brk || !brk.waiting.includes(key)) return { brk, act: null, why: 'not part of a break' }
  const waiting = brk.waiting.filter((k) => k !== key)
  if (waiting.length) return { brk: { ...brk, waiting }, act: null, why: 'others still working' }
  if (!rules.aiReturn) return { brk: null, act: null, why: 'coming back is off' }
  if (desk === null || desk !== brk.to) return { brk: null, act: null, why: 'you moved on' }
  return { brk: null, act: { type: 'desk/switch' }, why: 'back' }
}
