import { switchBack, switchSession, type Action, type MayorlyState } from '../core/index'

// An AI prompt is a switch. You type Claude, Gemini, Codex or ChatGPT a prompt, and the desk
// does what Alt+Q does: onto your recent task, so the wait goes to something else. Nothing is
// remembered and the answer does nothing; the next prompt switches again, as a second Alt+Q would,
// and so does Alt+Q itself. A restart has nothing to lose. Pure: the shell feeds it prompts and
// applies what it returns.

/**
 * Where a prompt came from. claude, gemini, codex: the command-line tools' hooks. *-app: the desktop
 * apps and *-web: their sites, both seen by the Windows watcher (ai-watch.ps1), which also names
 * `browser` for an AI in a browser's side panel; the Chrome extension reports chatgpt-web and gemini-web.
 */
export type AgentApp = 'claude' | 'gemini' | 'codex' | 'claude-app' | 'chatgpt-app' | 'gemini-app' | 'claude-web' | 'chatgpt-web' | 'gemini-web' | 'browser'

export const AGENT_APPS: readonly AgentApp[] = ['claude', 'gemini', 'codex', 'claude-app', 'chatgpt-app', 'gemini-app', 'claude-web', 'chatgpt-web', 'gemini-web', 'browser']

export const AGENT_NAME: Record<AgentApp, string> = {
  claude: 'Claude', gemini: 'Gemini', codex: 'Codex', 'claude-app': 'Claude', 'chatgpt-app': 'ChatGPT', 'gemini-app': 'Gemini',
  'claude-web': 'Claude', 'chatgpt-web': 'ChatGPT', 'gemini-web': 'Gemini', browser: 'The AI',
}

/**
 * One prompt can be seen twice (a Claude Code prompt in the desktop app reaches its hook and shows
 * the app's Stop button); a second switch would undo the first, so prompts this close to the last
 * switch are the same one.
 */
export const PROMPT_ECHO_MS = 5000

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

/**
 * The apps whose Stop button is read on the screen but whose prompts also come through a hook: the
 * Claude app runs Claude Code sessions, whose hook says whether you typed the prompt (a background
 * task finishing or a schedule restarts a session too). Its Stop button waits PAIR_WAIT_MS for the
 * hook; when the hook spoke within PAIR_MS of it, the hook decides, and the Stop button is the same
 * prompt. Plain Claude chat has no hook, so its Stop button decides alone.
 */
export const HOOK_OF: Partial<Record<AgentApp, AgentApp>> = { 'claude-app': 'claude' }
export const PAIR_MS = 3000
export const PAIR_WAIT_MS = 2000

/** The hook's word on the same prompt as this Stop button, if it spoke; null when there is none. */
export function pairedHook(e: AgentPrompt, heard: AgentPrompt[]): AgentPrompt | null {
  const hook = HOOK_OF[e.app]
  if (!hook) return null
  return heard.find((h) => h.app === hook && Math.abs(h.at - e.at) <= PAIR_MS) ?? null
}

/** `sinceSwitchMs`: how long ago a prompt last switched the desk, Infinity if never. */
export function promptStep(s: MayorlyState, e: AgentPrompt, sinceSwitchMs = Infinity): PromptStep {
  if (!s.settings.autoSwitch.aiPrompt) return { act: null, why: 'the rule is off' }
  if (!e.manual) return { act: null, why: 'not typed by you' }
  if (sinceSwitchMs < PROMPT_ECHO_MS) return { act: null, why: 'the same prompt, seen twice' }
  if (s.desk.status === 'idle' || !s.desk.block) return { act: null, why: 'the desk is idle' }
  if (s.desk.block.kind === 'rest') return { act: null, why: 'resting' }
  if (!switchBack(s) && !switchSession(s)) return { act: null, why: 'no recent task to switch to' }
  return { act: { type: 'desk/switch' }, why: 'switched' }
}
