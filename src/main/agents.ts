import { randomBytes } from 'node:crypto'
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, readSync, rmSync, statSync, truncateSync, watchFile, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { AGENT_APPS, type AgentApp, type AgentEvent } from '../shared/aibreak'

// When you send an AI a prompt, and when it has answered. Claude Code, Gemini CLI and Codex run
// AGENT_HOOK from their own hooks (UserPromptSubmit and Stop, BeforeAgent and AfterAgent), which
// appends one line to AGENT_INBOX: the app, the event, the session, the time, and whether a person
// typed it; never the prompt. ChatGPT and Gemini in Chrome come through the Mayorly extension in
// EXTENSION_DIR, which posts the same to a listener on 127.0.0.1 with the token in TOKEN_FILE.
// Everything lives in the home folder, not AppData: the Claude desktop app is a packaged Windows
// app, and the AppData its hooks see is a private copy of their own.

export const AGENT_DIR = join(homedir(), '.mayorly')
export const AGENT_INBOX = join(AGENT_DIR, 'ai.jsonl')
export const AGENT_HOOK = join(AGENT_DIR, 'ai-hook.cjs')
export const EXTENSION_DIR = join(AGENT_DIR, 'chrome-extension')
const TOKEN_FILE = join(AGENT_DIR, 'token')
/** The extension's listener. Fixed, so the extension needs no setup beyond loading it. */
export const AGENT_PORT = 47731

/**
 * The hook script: `node ai-hook.cjs <app> <prompt|done>`, the hook's JSON on stdin. Prints nothing,
 * except `{}` for Gemini, which reads a hook's stdout as JSON.
 */
const HOOK = `// Mayorly: one line when you send an AI a prompt, and one when it has answered, so the desk can
// take a break meanwhile. Keeps the app, the event, the session and whether you typed it; never the prompt.
const fs = require('fs')
const os = require('os')
const path = require('path')
const [app = 'claude', event = 'prompt'] = process.argv.slice(2)
let data = ''
let done = false
const finish = () => {
  if (done) return
  done = true
  try {
    const j = JSON.parse(data || '{}')
    // Typed by you, or sent by the tool itself (a scheduled task, a background notice): where the
    // payload says where the prompt came from, that decides; else the way such prompts begin.
    const kind = (j.origin && j.origin.kind) || j.turnOrigin || j.turn_origin || ''
    const manual = event !== 'prompt' ? true : kind ? kind === 'human' : !/^\\s*<(scheduled-task|task-notification|system-reminder)/.test(String(j.prompt || ''))
    const dir = path.join(os.homedir(), '.mayorly')
    fs.mkdirSync(dir, { recursive: true })
    fs.appendFileSync(path.join(dir, 'ai.jsonl'), JSON.stringify({ at: Date.now(), app, event, session: String(j.session_id || j.sessionId || ''), manual }) + '\\n')
  } catch {}
  if (app === 'gemini') process.stdout.write('{}')
}
process.stdin.setEncoding('utf8')
process.stdin.on('data', (c) => { data += c })
process.stdin.on('end', finish)
// A tool that never closes stdin still gets its line.
setTimeout(finish, 2000).unref()
`

const MANIFEST = {
  manifest_version: 3,
  name: 'Mayorly AI break',
  version: '1.0.0',
  description: 'Tells Mayorly when you send ChatGPT or Gemini a prompt, and when the answer is done, so the desk can take a break meanwhile.',
  background: { service_worker: 'background.js' },
  content_scripts: [{ matches: ['https://chatgpt.com/*', 'https://gemini.google.com/*'], js: ['content.js'], run_at: 'document_idle' }],
  host_permissions: [`http://127.0.0.1:${AGENT_PORT}/*`],
}

const BACKGROUND = `// Mayorly AI break: hands the page's news to Mayorly on this computer.
importScripts('config.js')
chrome.runtime.onMessage.addListener((m) => {
  fetch('http://127.0.0.1:' + self.MAYORLY.port + '/agent', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Mayorly-Token': self.MAYORLY.token },
    body: JSON.stringify(m),
  }).catch(() => {})
})
`

/** The page is writing an answer while its Stop button shows: that starting is the prompt, that ending is the answer. */
const CONTENT = `// Mayorly AI break: watches for an answer being written (the Stop button), nothing else.
(() => {
  const app = location.host.includes('gemini') ? 'gemini-web' : 'chatgpt-web'
  let id = sessionStorage.getItem('mayorly-tab')
  if (!id) {
    id = Math.random().toString(36).slice(2)
    sessionStorage.setItem('mayorly-tab', id)
  }
  const send = (event) => {
    try { chrome.runtime.sendMessage({ app, event, session: id }) } catch {}
  }
  const busy = () => !!document.querySelector('[data-testid="stop-button"], button[aria-label^="Stop" i], button[aria-label*="stop response" i], button[aria-label*="stop generating" i]')
  let was = busy()
  setInterval(() => {
    const now = busy()
    if (now && !was) send('prompt')
    if (!now && was) send('done')
    was = now
  }, 500)
})()
`

/** A prompt older than this when it is read is history. */
const FRESH_MS = 2 * 60_000
const KEEP_BYTES = 256 * 1024

const writeIfChanged = (file: string, text: string) => {
  if (!existsSync(file) || readFileSync(file, 'utf8') !== text) writeFileSync(file, text)
}

/** Writes the hook, the token and the extension, then hands every fresh event to `onEvent`. */
export function watchAgents(onEvent: (e: AgentEvent) => void): void {
  let token: string
  try {
    mkdirSync(EXTENSION_DIR, { recursive: true })
    writeIfChanged(AGENT_HOOK, HOOK)
    token = existsSync(TOKEN_FILE) ? readFileSync(TOKEN_FILE, 'utf8').trim() : ''
    if (!/^[0-9a-f]{32}$/.test(token)) {
      token = randomBytes(16).toString('hex')
      writeFileSync(TOKEN_FILE, token)
    }
    writeIfChanged(join(EXTENSION_DIR, 'manifest.json'), JSON.stringify(MANIFEST, null, 2))
    writeIfChanged(join(EXTENSION_DIR, 'background.js'), BACKGROUND)
    writeIfChanged(join(EXTENSION_DIR, 'content.js'), CONTENT)
    writeIfChanged(join(EXTENSION_DIR, 'config.js'), `self.MAYORLY = ${JSON.stringify({ port: AGENT_PORT, token })}\n`)
    // 0.1.66 to 0.1.68 followed Claude alone, by project folder.
    for (const old of ['claude-hook.cjs', 'claude.jsonl']) rmSync(join(AGENT_DIR, old), { force: true })
  } catch (err) {
    console.warn('[agents] no folder in the home directory:', err instanceof Error ? err.message : String(err))
    return
  }

  const size = () => {
    try {
      return statSync(AGENT_INBOX).size
    } catch {
      return 0
    }
  }
  let offset = size()
  watchFile(AGENT_INBOX, { interval: 1000 }, (cur) => {
    if (cur.size < offset) offset = 0
    if (cur.size === offset) return
    let text = ''
    try {
      const fd = openSync(AGENT_INBOX, 'r')
      const buf = Buffer.alloc(cur.size - offset)
      readSync(fd, buf, 0, buf.length, offset)
      closeSync(fd)
      text = buf.toString('utf8')
    } catch {
      return
    }
    offset = cur.size
    for (const line of text.split('\n')) {
      const e = eventOf(line)
      if (e && Date.now() - e.at < FRESH_MS) onEvent(e)
    }
    if (offset > KEEP_BYTES) {
      try {
        truncateSync(AGENT_INBOX, 0)
        offset = 0
      } catch {
        // Held open by a hook this instant: the next read tries again.
      }
    }
  })

  // The Chrome extension. Only a request with the token counts, so a web page cannot move the desk.
  createServer((req, res) => {
    if (req.method !== 'POST' || req.url !== '/agent' || req.headers['x-mayorly-token'] !== token) {
      res.writeHead(403).end()
      return
    }
    let body = ''
    req.setEncoding('utf8')
    req.on('data', (c: string) => {
      body += c
      if (body.length > 2048) req.destroy()
    })
    req.on('end', () => {
      const e = eventOf(JSON.stringify({ ...safeJson(body), at: Date.now(), manual: true }))
      if (e && (e.app === 'chatgpt-web' || e.app === 'gemini-web')) onEvent(e)
      res.writeHead(204).end()
    })
  })
    .on('error', (err) => console.warn('[agents] no listener for the Chrome extension:', err.message))
    .listen(AGENT_PORT, '127.0.0.1')
}

function safeJson(text: string): Record<string, unknown> {
  try {
    const j = JSON.parse(text) as unknown
    return j && typeof j === 'object' ? (j as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

/** One line of the inbox, checked; null when it is not one. */
export function eventOf(line: string): AgentEvent | null {
  const j = safeJson(line)
  const app = j.app as AgentApp
  if (!AGENT_APPS.includes(app) || (j.event !== 'prompt' && j.event !== 'done') || typeof j.at !== 'number') return null
  return { at: j.at, app, event: j.event, session: String(j.session ?? '').slice(0, 120), manual: j.manual === true }
}
