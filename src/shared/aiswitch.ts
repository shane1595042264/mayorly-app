import { switchBack, switchSession, type Action, type MayorlyState } from '../core/index'

// An AI prompt is a switch. You type Claude Code, Gemini, Codex or ChatGPT a prompt, and the desk
// does what Alt+Q does: onto your recent task, so the wait goes to something else. Nothing is
// remembered and the answer does nothing; the next prompt switches again, as a second Alt+Q would,
// and so does Alt+Q itself. A restart has nothing to lose. Pure: the shell feeds it prompts and
// applies what it returns.

export type AgentApp = 'claude' | 'gemini' | 'codex' | 'chatgpt-web' | 'gemini-web'

export const AGENT_APPS: readonly AgentApp[] = ['claude', 'gemini', 'codex', 'chatgpt-web', 'gemini-web']

export const AGENT_NAME: Record<AgentApp, string> = { claude: 'Claude', gemini: 'Gemini', codex: 'Codex', 'chatgpt-web': 'ChatGPT', 'gemini-web': 'Gemini' }

/** You sent an AI a prompt. */
export interface AgentPrompt {
  at: number
  app: AgentApp
  /** Typed by a person; a scheduled task or a background notice is not. */
  manual: boolean
}

export interface PromptStep {
  /** What to do to the desk: the quick switch, or nothing. */
  act: Action | null
  /** Why, in a few words, for the log. */
  why: string
}

export function promptStep(s: MayorlyState, e: AgentPrompt): PromptStep {
  if (!s.settings.autoSwitch.aiPrompt) return { act: null, why: 'the rule is off' }
  if (!e.manual) return { act: null, why: 'not typed by you' }
  if (s.desk.status === 'idle' || !s.desk.block) return { act: null, why: 'the desk is idle' }
  if (s.desk.block.kind === 'rest') return { act: null, why: 'resting' }
  if (!switchBack(s) && !switchSession(s)) return { act: null, why: 'no recent task to switch to' }
  return { act: { type: 'desk/switch' }, why: 'switched' }
}
