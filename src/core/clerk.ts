import type { Id, Ledger } from './model'

// The clerk is mute. It files and tags; it never asks. Its only voice is the log.
// This is the deterministic stand-in for the classifier the spec describes as a
// swappable interface: anything that implements Clerk can replace it later.

export interface Filing {
  title: string
  ledgerId: Id | null
  estimateMin: number | null
  /** Machine-log voice. No feelings, no advice. */
  log: string
}

export interface Clerk {
  file(text: string, ledgers: Ledger[]): Filing
}

const ESTIMATE = /(?:^|\s)~\s*(\d+(?:\.\d+)?)\s*(h|hr|hrs|m|min|mins)?(?=\s|$)/i
const PREFIX = /^\s*([a-z][\w-]{0,23})\s*:\s*/i
const TAG = /(?:^|\s)#([a-z][\w-]{0,23})(?=\s|$)/i

export function matchLedger(word: string, ledgers: Ledger[]): Ledger | null {
  const w = word.toLowerCase()
  return (
    ledgers.find((l) => l.code.toLowerCase() === w) ??
    ledgers.find((l) => l.name.toLowerCase() === w) ??
    ledgers.find((l) => w.length >= 3 && l.name.toLowerCase().startsWith(w)) ??
    null
  )
}

export function parseEstimate(text: string): { rest: string; minutes: number | null } {
  const m = text.match(ESTIMATE)
  if (!m) return { rest: text, minutes: null }
  const n = Number(m[1])
  const unit = (m[2] ?? 'm').toLowerCase()
  const minutes = Math.round(unit.startsWith('h') ? n * 60 : n)
  return { rest: text.replace(m[0], ' '), minutes: minutes > 0 ? minutes : null }
}

const tidy = (s: string) => s.replace(/\s+/g, ' ').trim()

export const prefixClerk: Clerk = {
  file(text, ledgers) {
    const { rest, minutes } = parseEstimate(text)
    let title = rest
    let ledger: Ledger | null = null
    let how = ''

    const prefix = title.match(PREFIX)
    if (prefix) {
      const hit = matchLedger(prefix[1], ledgers)
      if (hit) {
        ledger = hit
        how = 'prefix'
        title = title.slice(prefix[0].length)
      }
    }
    if (!ledger) {
      const tag = title.match(TAG)
      if (tag) {
        const hit = matchLedger(tag[1], ledgers)
        if (hit) {
          ledger = hit
          how = 'tag'
          title = title.replace(tag[0], ' ')
        }
      }
    }

    title = tidy(title)
    const quoted = `'${title.length > 40 ? title.slice(0, 39) + '…' : title}'`
    const est = minutes ? ` est ${minutes}m` : ''
    const log = ledger
      ? `filed ${quoted} -> ${ledger.code} (${how})${est}`
      : `tray ${quoted}: no ledger named${est}`
    return { title, ledgerId: ledger?.id ?? null, estimateMin: minutes, log }
  },
}

/** Derive a free 3-letter callsign from a ledger name: LEGAL -> LGL, DANCE -> DNC. */
export function deriveCode(name: string, taken: string[]): string {
  const letters = name.toUpperCase().replace(/[^A-Z]/g, '')
  if (!letters) return uniq('LDG', taken)
  const consonants = letters[0] + letters.slice(1).replace(/[AEIOU]/g, '')
  const base = (consonants.length >= 3 ? consonants : letters).slice(0, 3).padEnd(3, 'X')
  return uniq(base, taken)
}

function uniq(base: string, taken: string[]): string {
  const set = new Set(taken.map((t) => t.toUpperCase()))
  if (!set.has(base)) return base
  for (let i = 2; i < 10; i++) {
    const c = base.slice(0, 2) + i
    if (!set.has(c)) return c
  }
  return base + set.size
}
