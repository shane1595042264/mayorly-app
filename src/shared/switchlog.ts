import { restSession, type Action, type DeskStatus, type HudEvent, type MayorlyState } from '../core/index'

// The switch log: every time the task on the desk changes, what it went from and to, and what did
// it (you, an AI prompt, a streamer's death, the timer, the couch running out of coins, the clerk,
// another computer). The shell compares the desk before and after each step (engine.ts) and keeps
// the last hundred records (main/switchlog.ts); Alt+Shift+H shows them under the tomato. Pure.

/** Who or what moved the desk. */
export type SwitchCause = 'you' | 'ai' | 'stream' | 'timer' | 'coins' | 'clerk' | 'sync' | 'import'

/** Why, as the call site knows it: the cause, a few words, and the numbers or names behind it. */
export interface SwitchWhy {
  cause: SwitchCause
  via: string
  detail?: string
}

/** One end of a switch: the task as it was named then (it may be renamed or deleted later). */
export interface SwitchEnd {
  /** c:<couch item>, e:<entry> or l:<ledger>: what counts as the same task. */
  key: string
  kind: 'couch' | 'entry' | 'ledger'
  title: string
  ledger?: string
}

export interface SwitchRecord extends SwitchWhy {
  id: string
  at: number
  from: SwitchEnd | null
  to: SwitchEnd | null
  /** The desk after it: running, paused, ready or idle. */
  status: DeskStatus
  /** Not a switch: one that was let go (your Alt+Q a beat after a death switched you, an AI prompt then). */
  kept?: boolean
}

/** How many records the log keeps. */
export const SWITCH_LOG_MAX = 100

/** The task on the desk, the one behind a rest included; ledger time is its ledger. */
export function deskEnd(s: MayorlyState): SwitchEnd | null {
  const block = restSession(s)?.block ?? s.desk.block
  if (!block) return null
  if (block.kind === 'leisure' && block.leisureId) {
    const it = s.leisure.find((l) => l.id === block.leisureId)
    return { key: `c:${block.leisureId}`, kind: 'couch', title: it?.title ?? block.label }
  }
  const ledger = (id: string | null | undefined) => (id ? s.ledgers.find((l) => l.id === id) : undefined)
  if (block.entryId) {
    const e = s.entries.find((x) => x.id === block.entryId)
    return { key: `e:${block.entryId}`, kind: 'entry', title: e?.title ?? block.label, ledger: ledger(e?.ledgerId ?? block.ledgerId)?.code }
  }
  if (block.ledgerId) {
    const l = ledger(block.ledgerId)
    return { key: `l:${block.ledgerId}`, kind: 'ledger', title: l?.name ?? block.label, ledger: l?.code }
  }
  return null
}

/** What moved the desk when the call site did not say: read from the step itself. */
export function switchCause(action: Action, after: MayorlyState, events: HudEvent[]): SwitchWhy {
  const notice = (start: string) => events.some((e) => e.type === 'notice' && e.text.startsWith(start))
  switch (action.type) {
    case 'desk/tick': {
      if (notice('Out of coins')) return { cause: 'coins', via: 'Out of coins: back to the desk' }
      if (events.some((e) => e.type === 'sitting-end')) return { cause: 'timer', via: after.desk.block ? 'The sitting ended; the parked one came back' : 'The sitting ended' }
      const p = after.desk.plan
      if (p?.mode === 'superset') return { cause: 'timer', via: 'Superset: the next slot', detail: `slot ${p.step + 1} of ${p.sequence.length}, round ${p.round}` }
      return { cause: 'timer', via: 'The block ended' }
    }
    case 'sync/merge':
    case 'sync/replace':
      return { cause: 'sync', via: `From ${after.desk.device?.name ?? 'another computer'}` }
    case 'entry/toLeisure':
      return { cause: 'clerk', via: 'The clerk moved it to the couch list' }
    case 'desk/switch':
      return { cause: 'you', via: 'Alt+Q' }
    case 'desk/select':
    case 'desk/swap':
      return { cause: 'you', via: 'Picked' }
    case 'desk/deploy':
      return { cause: 'you', via: 'Started' }
    case 'desk/standDown':
      return { cause: 'you', via: 'Stood down' }
    case 'desk/skip':
      return { cause: 'you', via: 'Skipped' }
    case 'entry/complete':
      return { cause: 'you', via: 'Cleared; the desk took the next' }
    case 'entry/delete':
      return { cause: 'you', via: 'Deleted; the desk took the next' }
    case 'entry/capture':
      return { cause: 'you', via: 'Captured and started' }
    case 'recipe/run':
      return { cause: 'you', via: 'A recipe started it' }
    case 'superset/delete':
    case 'leisure/delete':
      return { cause: 'you', via: 'Deleted what was running' }
    default:
      return { cause: 'you', via: action.type }
  }
}

/**
 * The record of one step, or null when the task on the desk did not change. `why` is what the
 * call site knows (an AI prompt, a death and its numbers); otherwise the step says.
 */
export function switchRecord(before: MayorlyState, after: MayorlyState, action: Action, events: HudEvent[], why: SwitchWhy | undefined, at: number, id: string): SwitchRecord | null {
  // Renaming, merging or deleting a ledger relabels ledger time; it moves nothing.
  if (action.type.startsWith('ledger/')) return null
  const from = deskEnd(before)
  const to = deskEnd(after)
  if ((from?.key ?? null) === (to?.key ?? null)) return null
  return { id, at, from, to, status: after.desk.status, ...(why ?? switchCause(action, after, events)) }
}

/** A record checked as it comes back from the file; null when it is not one. */
export function switchRecordOf(j: unknown): SwitchRecord | null {
  const o = j && typeof j === 'object' ? (j as Record<string, unknown>) : null
  if (!o || typeof o.id !== 'string' || typeof o.at !== 'number' || typeof o.via !== 'string' || typeof o.cause !== 'string') return null
  const end = (x: unknown): SwitchEnd | null => {
    const e = x && typeof x === 'object' ? (x as Record<string, unknown>) : null
    return e && typeof e.key === 'string' && typeof e.title === 'string' ? { key: e.key, kind: (e.kind as SwitchEnd['kind']) ?? 'entry', title: e.title, ledger: typeof e.ledger === 'string' ? e.ledger : undefined } : null
  }
  return {
    id: o.id,
    at: o.at,
    from: end(o.from),
    to: end(o.to),
    status: (o.status as DeskStatus) ?? 'running',
    cause: o.cause as SwitchCause,
    via: o.via.slice(0, 200),
    detail: typeof o.detail === 'string' ? o.detail.slice(0, 400) : undefined,
    kept: o.kept === true || undefined,
  }
}

/** The cause in a word, for the log's first column. */
export const CAUSE_LABEL: Record<SwitchCause, string> = {
  you: 'You',
  ai: 'AI',
  stream: 'Stream',
  timer: 'Timer',
  coins: 'Coins',
  clerk: 'Clerk',
  sync: 'Sync',
  import: 'Import',
}

/** A task's name for the log: its ledger's code first, as the tomato shows it. */
export function endLabel(e: SwitchEnd | null): string {
  if (!e) return 'nothing'
  return e.kind === 'entry' && e.ledger ? `${e.ledger} ${e.title}` : e.title
}
