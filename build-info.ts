import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import type { BuildInfo, BuildNotes } from './src/shared/bridge'

// Stamped into every bundle at build time as __MAYORLY_BUILD__: the version, the commit,
// the moment of the build, and the top section of NOTES.md. The app shows the notes once
// per build and the build in Settings, so a machine always knows what it is running.

function git(args: string): string {
  try {
    return execSync(`git ${args}`, { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim()
  } catch {
    return ''
  }
}

/** The first `## ` section of NOTES.md: its heading and its bullet lines. */
export function parseNotes(md: string): BuildNotes | null {
  const lines = md.split(/\r?\n/)
  let title: string | null = null
  const out: string[] = []
  for (const raw of lines) {
    const line = raw.trim()
    if (line.startsWith('## ')) {
      if (title !== null) break
      title = line.slice(3).trim()
      continue
    }
    if (title !== null && line.startsWith('- ')) out.push(line.slice(2).trim())
  }
  return title ? { title, lines: out } : null
}

export function buildInfo(): BuildInfo {
  const version = (JSON.parse(readFileSync('package.json', 'utf8')) as { version: string }).version
  // Tracked changes only: Vite drops a temporary copy of the config beside it while loading, which must not count.
  const commit = (git('rev-parse --short HEAD') || 'local') + (git('status --porcelain --untracked-files=no') ? '+' : '')
  let notes: BuildNotes | null = null
  try {
    notes = parseNotes(readFileSync('NOTES.md', 'utf8'))
  } catch {
    notes = null
  }
  return { version, commit, builtAt: Date.now(), notes }
}
