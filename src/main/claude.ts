import { closeSync, existsSync, mkdirSync, openSync, readFileSync, readSync, statSync, truncateSync, watchFile, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

// Claude Code prompts. A UserPromptSubmit hook in ~/.claude/settings.json runs CLAUDE_HOOK, which
// appends one line per prompt to CLAUDE_INBOX: the time, the project's folder and the session,
// never the prompt itself. Mayorly reads what is new every second and hands the latest prompt to
// the shell, which switches the desk to that project's task. The folder is in the home directory,
// not AppData, on purpose: the Claude desktop app is a packaged Windows app, and the AppData its
// hooks see is a private copy of their own.

export const CLAUDE_DIR = join(homedir(), '.mayorly')
export const CLAUDE_INBOX = join(CLAUDE_DIR, 'claude.jsonl')
export const CLAUDE_HOOK = join(CLAUDE_DIR, 'claude-hook.cjs')

/** The hook script. Written here at every launch, so it stays what this build expects. Prints nothing: a UserPromptSubmit hook's output would join the prompt. */
const SCRIPT = `// Mayorly: one line per Claude Code prompt, so the desk can follow the project you are working in.
// Only the project's folder, the session and the time are kept; never the prompt itself. Prints nothing.
const fs = require('fs')
const os = require('os')
const path = require('path')
let data = ''
process.stdin.setEncoding('utf8')
process.stdin.on('data', (c) => { data += c })
process.stdin.on('end', () => {
  try {
    const j = JSON.parse(data || '{}')
    const dir = path.join(os.homedir(), '.mayorly')
    fs.mkdirSync(dir, { recursive: true })
    // Typed by you, or sent by Claude itself (a scheduled task, a background notice): where the
    // payload says where the prompt came from that decides, else the way such prompts begin.
    const kind = (j.origin && j.origin.kind) || j.turnOrigin || j.turn_origin || ''
    const manual = kind ? kind === 'human' : !/^\\s*<(scheduled-task|task-notification|system-reminder)/.test(String(j.prompt || ''))
    fs.appendFileSync(path.join(dir, 'claude.jsonl'), JSON.stringify({ at: Date.now(), cwd: String(j.cwd || ''), session: String(j.session_id || ''), manual }) + '\\n')
  } catch {}
})
`

/** A prompt older than this when it is read is history, not something to follow. */
const FRESH_MS = 2 * 60_000
/** The inbox starts over past this size; each line is about a hundred bytes. */
const KEEP_BYTES = 256 * 1024

export interface ClaudePrompt {
  at: number
  cwd: string
  session: string
  /** Typed by a person; false for a scheduled task or a background notice. */
  manual: boolean
}

export function watchClaude(onPrompt: (p: ClaudePrompt) => void): void {
  try {
    mkdirSync(CLAUDE_DIR, { recursive: true })
    if (!existsSync(CLAUDE_HOOK) || readFileSync(CLAUDE_HOOK, 'utf8') !== SCRIPT) writeFileSync(CLAUDE_HOOK, SCRIPT)
  } catch (err) {
    console.warn('[claude] no hook folder:', err instanceof Error ? err.message : String(err))
    return
  }
  const size = () => {
    try {
      return statSync(CLAUDE_INBOX).size
    } catch {
      return 0
    }
  }
  // Prompts from before this launch are history.
  let offset = size()
  watchFile(CLAUDE_INBOX, { interval: 1000 }, (cur) => {
    if (cur.size < offset) offset = 0
    if (cur.size === offset) return
    let text = ''
    try {
      const fd = openSync(CLAUDE_INBOX, 'r')
      const buf = Buffer.alloc(cur.size - offset)
      readSync(fd, buf, 0, buf.length, offset)
      closeSync(fd)
      text = buf.toString('utf8')
    } catch {
      return
    }
    offset = cur.size
    let latest: ClaudePrompt | null = null
    for (const line of text.split('\n')) {
      try {
        const j = JSON.parse(line) as Partial<ClaudePrompt>
        // Only what a person typed moves the desk.
        if (typeof j.at === 'number' && typeof j.cwd === 'string' && j.cwd && j.manual === true) latest = { at: j.at, cwd: j.cwd, session: String(j.session ?? ''), manual: true }
      } catch {
        // A half-written line: the next read has it whole.
      }
    }
    if (offset > KEEP_BYTES) {
      try {
        truncateSync(CLAUDE_INBOX, 0)
        offset = 0
      } catch {
        // Held open by a hook this instant: the next read tries again.
      }
    }
    if (latest && Date.now() - latest.at < FRESH_MS) onPrompt(latest)
  })
}
