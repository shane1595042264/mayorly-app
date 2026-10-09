import { matchLedger } from './clerk'
import type { Id, Ledger, Superset } from './model'

// One-line superset syntax for the command line:
//
//   legal 25, dance 20, career 25 x3 rest 5 rr 15 shuffle
//
// Slots are "<ledger> <minutes>" separated by commas or ">". Options may follow
// in any order: xN rounds (x0 or "loop" = until you stand down), rest N,
// rr N (rest between rounds), shuffle, and "clear-next" to jump to the next
// slot when an entry is cleared instead of pulling the next one from its ledger.

export type ParseResult = { ok: true; superset: Superset } | { ok: false; error: string }

const OPTION = /\s+(x\s*\d+|loop|rest\s+\d+|rr\s+\d+|shuffle|clear-next)\s*$/i

export function parseSuperset(src: string, ledgers: Ledger[], newId: () => Id, name?: string): ParseResult {
  let body = src.trim()
  if (!body) return { ok: false, error: 'Write slots like: legal 25, dance 20' }

  const ss: Superset = {
    id: newId(),
    name: name?.trim() || '',
    slots: [],
    rounds: 3,
    restMin: 5,
    roundRestMin: 15,
    order: 'fixed',
    onClear: 'next-in-ledger',
  }

  // Peel options off the tail so slot names can never collide with them.
  for (let m = body.match(OPTION); m; m = body.match(OPTION)) {
    const opt = m[1].toLowerCase().replace(/\s+/g, ' ')
    if (opt === 'loop') ss.rounds = 0
    else if (opt === 'shuffle') ss.order = 'shuffle'
    else if (opt === 'clear-next') ss.onClear = 'next-slot'
    else if (opt.startsWith('x')) ss.rounds = Number(opt.slice(1).trim())
    else if (opt.startsWith('rest')) ss.restMin = Number(opt.slice(4))
    else if (opt.startsWith('rr')) ss.roundRestMin = Number(opt.slice(2))
    body = body.slice(0, m.index)
  }

  const parts = body.split(/\s*[,>]\s*/).filter(Boolean)
  for (const part of parts) {
    const m = part.match(/^(.+?)\s+(\d{1,3})\s*m?$/i) ?? part.match(/^(.+)$/)
    if (!m) return { ok: false, error: `Cannot read "${part}"` }
    const word = m[1].trim()
    const ledger = matchLedger(word, ledgers) ?? matchLedger(word.split(/\s+/)[0], ledgers)
    if (!ledger) return { ok: false, error: `No ledger called "${word}"` }
    const minutes = m[2] ? Number(m[2]) : 25
    if (minutes < 1 || minutes > 240) return { ok: false, error: `${minutes} minutes is out of range (1-240)` }
    ss.slots.push({ id: newId(), target: { kind: 'ledger', ledgerId: ledger.id }, minutes })
  }
  if (ss.slots.length === 0) return { ok: false, error: 'No slots found' }
  if (!ss.name) ss.name = ss.slots.map((sl) => ledgers.find((l) => l.id === (sl.target as { ledgerId: Id }).ledgerId)!.code).join(' / ')
  return { ok: true, superset: ss }
}

export function formatSuperset(ss: Superset, ledgers: Ledger[], entries: { id: Id; ledgerId: Id | null }[]): string {
  const slots = ss.slots.map((sl) => {
    const ledgerId = sl.target.kind === 'ledger' ? sl.target.ledgerId : entries.find((e) => e.id === (sl.target as { entryId: Id }).entryId)?.ledgerId
    const code = ledgers.find((l) => l.id === ledgerId)?.code.toLowerCase() ?? '?'
    return `${code} ${sl.minutes}`
  })
  const opts = [ss.rounds === 0 ? 'loop' : `x${ss.rounds}`, `rest ${ss.restMin}`, `rr ${ss.roundRestMin}`]
  if (ss.order === 'shuffle') opts.push('shuffle')
  if (ss.onClear === 'next-slot') opts.push('clear-next')
  return `${slots.join(', ')} ${opts.join(' ')}`
}
