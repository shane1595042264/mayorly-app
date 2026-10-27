import { appendFileSync, mkdirSync, renameSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'

// One log a user could send: userData/logs/mayorly.log, rotated at 1 MB with one older
// file kept. console.error and console.warn are teed into it, and an uncaught error in
// the main process is written down instead of taking the menu bar app with it.

const MAX_BYTES = 1024 * 1024
let file: string | null = null

function line(level: string, args: unknown[]): string {
  const text = args
    .map((a) => (a instanceof Error ? (a.stack ?? a.message) : typeof a === 'string' ? a : JSON.stringify(a)))
    .join(' ')
  return `${new Date().toISOString()} ${level.padEnd(5)} ${text}\n`
}

function write(level: string, args: unknown[]) {
  if (!file) return
  try {
    appendFileSync(file, line(level, args))
    if (statSync(file).size > MAX_BYTES) renameSync(file, `${file}.1`)
  } catch {
    // A full disk or a read-only folder: the console still has it.
  }
}

export const log = {
  info: (...args: unknown[]) => write('info', args),
  warn: (...args: unknown[]) => write('warn', args),
  error: (...args: unknown[]) => write('error', args),
}

export function installLog(dataDir: string) {
  const dir = join(dataDir, 'logs')
  try {
    mkdirSync(dir, { recursive: true })
    file = join(dir, 'mayorly.log')
  } catch (err) {
    console.error('[log] no log folder:', err)
    return
  }
  for (const level of ['error', 'warn'] as const) {
    const orig = console[level].bind(console)
    console[level] = (...args: unknown[]) => {
      orig(...args)
      write(level, args)
    }
  }
  process.on('uncaughtException', (err) => write('fatal', ['uncaughtException', err]))
  process.on('unhandledRejection', (reason) => write('error', ['unhandledRejection', reason instanceof Error ? reason : String(reason)]))
  app.on('child-process-gone', (_e, d) => write('error', ['child-process-gone', d]))
  // A renderer that dies comes back; the state lives in the main process, so nothing is lost.
  // Three deaths in five minutes is not a glitch, and the log is left to say so.
  const deaths: number[] = []
  app.on('render-process-gone', (_e, wc, d) => {
    write('error', ['render-process-gone', d])
    const now = Date.now()
    while (deaths.length && now - deaths[0] > 5 * 60_000) deaths.shift()
    deaths.push(now)
    if (d.reason !== 'clean-exit' && !wc.isDestroyed() && deaths.length <= 3) wc.reload()
  })
  write('info', [`Mayorly ${app.getVersion()} ${process.platform} ${process.arch} electron ${process.versions.electron} packaged=${app.isPackaged}`])
}
