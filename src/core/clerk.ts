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
  /** The model that filed it, when the AI clerk did; the prefix clerk leaves it out. */
  model?: string
  /** The AI clerk's own confidence; the prefix clerk is always sure of a prefix. */
  confidence?: 'sure' | 'unsure'
  /** The line is entertainment: it goes to the couch list, not a ledger. */
  leisure?: boolean
  /** No ledger fits, and the clerk proposes one; `ledgerId` is then the closest existing one. Capture decides whether to start it. */
  newLedger?: { name: string; criterion: string; confidence: number }
  /** The AI clerk's pick for one sitting on it, minutes: the entry's longest session on the calendar. */
  sessionMin?: number | null
}

export interface Clerk {
  file(text: string, ledgers: Ledger[]): Filing
}

const ESTIMATE = /(?:^|\s)~\s*(\d+(?:\.\d+)?)\s*(h|hr|hrs|m|min|mins)?(?=\s|$)/i
/** Without the tilde an estimate needs its unit and the end of the line: "call mom 15m", "read 1 h". */
const TRAILING = /\s(\d+(?:\.\d+)?)\s*(h|hr|hrs|hours?|m|min|mins|minutes)\s*$/i
const PREFIX = /^\s*([a-z][\w-]{0,23})\s*:\s*/i
const TAG = /(?:^|\s)#([a-z][\w-]{0,23})(?=\s|$)/i

/** The words for the couch list, as a prefix or a tag. A ledger with exactly that name keeps it. */
const COUCH_WORDS = new Set(['couch', 'leisure'])
const isCouch = (word: string, ledgers: Ledger[]) => {
  const w = word.toLowerCase()
  return COUCH_WORDS.has(w) && !ledgers.some((l) => l.name.toLowerCase() === w || l.code.toLowerCase() === w)
}

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
  const m = text.match(ESTIMATE) ?? text.match(TRAILING)
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
    let leisure = false

    const prefix = title.match(PREFIX)
    if (prefix && isCouch(prefix[1], ledgers)) {
      leisure = true
      title = title.slice(prefix[0].length)
    } else if (prefix && prefix[1].toLowerCase() === 'tray' && !matchLedger('tray', ledgers)) {
      // "tray:" says where it goes, the tray, and is not part of the title.
      title = title.slice(prefix[0].length)
    } else if (prefix) {
      const hit = matchLedger(prefix[1], ledgers)
      if (hit) {
        ledger = hit
        how = 'prefix'
        title = title.slice(prefix[0].length)
      }
    }
    if (!ledger && !leisure) {
      const tag = title.match(TAG)
      if (tag && tag[1].toLowerCase() === 'tray' && !matchLedger('tray', ledgers)) {
        title = title.replace(tag[0], ' ')
      } else if (tag && isCouch(tag[1], ledgers)) {
        leisure = true
        title = title.replace(tag[0], ' ')
      } else if (tag) {
        const hit = matchLedger(tag[1], ledgers)
        if (hit) {
          ledger = hit
          how = 'tag'
          title = title.replace(tag[0], ' ')
        }
      }
    }

    title = tidy(title)
    // A line of nothing but marks ("#", "--") is not a task.
    if (!/[\p{L}\p{N}]/u.test(title)) title = ''
    const quoted = `'${title.length > 40 ? title.slice(0, 39) + '…' : title}'`
    const est = minutes ? ` est ${minutes}m` : ''
    if (leisure) return { title, ledgerId: null, estimateMin: minutes, log: `couch ${quoted}: named`, leisure: true }
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
