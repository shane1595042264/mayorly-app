import type { Block, Entry, Id, Ledger, LeisureItem, MayorlyState, Ms, TokenTx } from './model'
import { entryTomatoes, wholeTomatoes } from './accounting'
import { openFlow, supersetOf } from './planner'
import { restSession, switchBack, switchSession, type Action } from './reducer'


export type FoundTask = { kind: 'entry'; entry: Entry } | { kind: 'leisure'; item: LeisureItem }

const idOf = (f: FoundTask): Id => (f.kind === 'entry' ? f.entry.id : f.item.id)

/** The tasks last worked on, newest first, read off the interval log. Finished or removed ones are left out. */
export function recentTasks(s: MayorlyState, limit = 10): FoundTask[] {
  const out: FoundTask[] = []
  const seen = new Set<Id>()
  for (let i = s.segments.length - 1; i >= 0 && out.length < limit; i--) {
    const seg = s.segments[i]
    const id = seg.kind === 'leisure' ? seg.leisureId : seg.kind === 'focus' ? seg.entryId : null
    if (!id || seen.has(id)) continue
    seen.add(id)
    if (seg.kind === 'leisure') {
      const item = s.leisure.find((x) => x.id === id && x.archivedAt === null)
      if (item) out.push({ kind: 'leisure', item })
    } else {
      const entry = s.entries.find((x) => x.id === id && x.doneAt === null)
      if (entry) out.push({ kind: 'entry', entry })
    }
  }
  return out
}

/** The task the desk is on, the one behind a rest included. */
export function onDeskId(s: MayorlyState): Id | null {
  const block = restSession(s)?.block ?? s.desk.block
  return (block?.kind === 'leisure' ? block.leisureId : block?.entryId) ?? null
}

/** What going to this task means: nothing if the desk is on it, the quick switch if that is where it leads, so the clock comes back, otherwise picking it. */
export function switchToAction(s: MayorlyState, f: FoundTask): Action | null {
  const id = idOf(f)
  if (id === onDeskId(s)) return null
  const back = switchBack(s)
  const held = back ? null : switchSession(s)
  if (back?.entryId === id || held?.block.entryId === id || held?.block.leisureId === id) return { type: 'desk/switch' }
  return f.kind === 'entry' ? { type: 'desk/select', entryId: id, ledgerId: f.entry.ledgerId } : { type: 'desk/select', leisureId: id }
}

/**
 * Open tasks for a search, best first: the flow, then the couch list. Every word has to appear in
 * the title or in the name of what the task belongs to, its ledger or the couch. A title that
 * starts with the search comes first, then titles where every word starts a word, then any
 * title holding them, then matches on the group alone; most recently used first within each.
 * No search: what was used last, then the top of the list.
 */
export function findTasks(s: MayorlyState, query: string, limit = 8): FoundTask[] {
  const q = query.trim().toLowerCase()
  const recent = new Map(recentTasks(s).map((f, i) => [idOf(f), i]))
  const soonest = (f: FoundTask) => recent.get(idOf(f)) ?? recent.size
  const ledgers = new Map(s.ledgers.map((l) => [l.id, `${l.name} ${l.code}`.toLowerCase()]))
  const all = [
    ...openFlow(s).map((entry) => ({ found: { kind: 'entry', entry } as FoundTask, title: entry.title.toLowerCase(), group: entry.ledgerId ? (ledgers.get(entry.ledgerId) ?? '') : '' })),
    ...leisureList(s).map((item) => ({ found: { kind: 'leisure', item } as FoundTask, title: item.title.toLowerCase(), group: 'couch leisure' })),
  ].sort((a, b) => soonest(a.found) - soonest(b.found))
  if (!q) return all.slice(0, limit).map((x) => x.found)
  const words = q.split(/\s+/)
  const startsWord = (text: string, w: string) => text.startsWith(w) || text.includes(` ${w}`)
  return all
    .flatMap((x) => {
      if (!words.every((w) => x.title.includes(w) || x.group.includes(w))) return []
      const rank = x.title.startsWith(q) ? 0 : words.every((w) => startsWord(x.title, w)) ? 1 : words.every((w) => x.title.includes(w)) ? 2 : 3
      return [{ found: x.found, rank }]
    })
    .sort((a, b) => a.rank - b.rank)
    .map((x) => x.found)
    .slice(0, limit)
}

export interface BlockView {
  block: Block
  ledger: Ledger | null
  entry: Entry | null
  elapsedMs: Ms
  /** null for count-up blocks. */
  remainingMs: Ms | null
  overtimeMs: Ms
  /** 0..1, or null when there is no length to measure against. */
  progress: number | null
  status: MayorlyState['desk']['status']
}

export function blockElapsed(s: MayorlyState, now: number): Ms {
  const d = s.desk
  return d.bankMs + (d.status === 'running' && d.runStartedAt !== null ? Math.max(0, now - d.runStartedAt) : 0)
}

export function blockView(s: MayorlyState, now: number): BlockView | null {
  const d = s.desk
  if (!d.block) return null
  const elapsedMs = blockElapsed(s, now)
  const dur = d.block.durationMs
  const remainingMs = dur === null ? null : Math.max(0, dur - elapsedMs)
  return {
    block: d.block,
    ledger: s.ledgers.find((l) => l.id === d.block!.ledgerId) ?? null,
    entry: s.entries.find((e) => e.id === d.block!.entryId) ?? null,
    elapsedMs,
    remainingMs,
    overtimeMs: dur === null ? 0 : Math.max(0, elapsedMs - dur),
    progress: dur ? Math.min(1, elapsedMs / dur) : null,
    status: d.status,
  }
}


/** Planned block time inside [from, to): what the plan still holds for today, say. */
export function plannedMs(s: MayorlyState, from: number, to: number): Ms {
  let ms = 0
  for (const b of s.calendar.blocks) ms += Math.max(0, Math.min(b.end, to) - Math.max(b.start, from))
  return ms
}

/** The next planned block that has not ended, or null. */
export function nextBlock(s: MayorlyState, now: number) {
  let best: MayorlyState['calendar']['blocks'][number] | null = null
  for (const b of s.calendar.blocks) if (b.end > now && (!best || b.start < best.start)) best = b
  return best
}

/** Tomatoes a coin record stands for. Older records say nothing, so a harvest's coins are its crop and a tomato is one. */
export function tomatoesOf(t: TokenTx): number {
  if (t.tomatoes !== undefined) return t.tomatoes
  return t.reason === 'tomato' ? 1 : t.reason === 'harvest' ? Math.max(0, t.amount) : 0
}

export function balance(s: MayorlyState): number {
  return s.tokens.reduce((n, t) => n + t.amount, 0)
}

export function currentSitting(s: MayorlyState) {
  return s.sittings.find((x) => x.id === s.desk.sittingId) ?? null
}

/** Focus time in the current sitting, including the open segment. */
export function sittingFocus(s: MayorlyState, now: number): Ms {
  const sitting = currentSitting(s)
  if (!sitting) return 0
  const open = s.segments.find((x) => x.end === null && x.sittingId === sitting.id)
  return sitting.focusMs + (open?.kind === 'focus' ? Math.max(0, now - open.start) : 0)
}

/** 0..1 progress toward the next tomato in this sitting. */
export function tomatoProgress(s: MayorlyState, now: number): number {
  const sitting = currentSitting(s)
  if (!sitting) return 0
  return (sittingFocus(s, now) % sitting.tomatoMs) / sitting.tomatoMs
}

export { entryTomatoes } from './accounting'

/** What the quick switch brings back: the entry before the last swap, else the parked session. Null when nothing. */
export function switchTarget(s: MayorlyState): string | null {
  const back = switchBack(s)
  if (back) {
    const e = back.entryId ? s.entries.find((x) => x.id === back.entryId) : null
    return e?.title ?? s.ledgers.find((l) => l.id === back.ledgerId)?.name ?? null
  }
  const held = switchSession(s) ?? restSession(s)
  if (!held) return null
  return s.entries.find(e => e.id === held.block.entryId)?.title ?? held.block.label
}

export function tray(s: MayorlyState): Entry[] {
  return openFlow(s).filter((e) => e.ledgerId === null)
}

export function ledgerEntries(s: MayorlyState, ledgerId: Id): Entry[] {
  return openFlow(s).filter((e) => e.ledgerId === ledgerId)
}

export function startOfDay(t: number): number {
  const d = new Date(t)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

export interface DayStats {
  focusMs: Ms
  tomatoes: number
  tokens: number
  cleared: number
  byLedger: { ledgerId: Id | null; focusMs: Ms }[]
}

export function dayStats(s: MayorlyState, dayStart: number, now: number): DayStats {
  const dayEnd = dayStart + 86_400_000
  const by = new Map<Id | null, Ms>()
  let focusMs = 0
  for (const seg of s.segments) {
    if (seg.kind !== 'focus') continue
    const a = Math.max(seg.start, dayStart)
    const b = Math.min(seg.end ?? now, dayEnd)
    if (b <= a) continue
    focusMs += b - a
    by.set(seg.ledgerId, (by.get(seg.ledgerId) ?? 0) + (b - a))
  }
  const inDay = (t: number) => t >= dayStart && t < dayEnd
  const txs = s.tokens.filter((t) => inDay(t.at))
  return {
    focusMs,
    tomatoes: txs.reduce((n, t) => n + tomatoesOf(t), 0),
    tokens: txs.reduce((n, t) => n + t.amount, 0),
    cleared: s.entries.filter((e) => e.doneAt !== null && inDay(e.doneAt)).length,
    byLedger: [...by.entries()]
      .map(([ledgerId, ms]) => ({ ledgerId, focusMs: ms }))
      .sort((x, y) => y.focusMs - x.focusMs),
  }
}

export function lastDays(s: MayorlyState, now: number, n: number): { day: number; focusMs: Ms }[] {
  const today = startOfDay(now)
  const out: { day: number; focusMs: Ms }[] = []
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(today)
    d.setDate(d.getDate() - i)
    const day = d.getTime()
    out.push({ day, focusMs: dayStats(s, day, now).focusMs })
  }
  return out
}

/** Superset objective strip for the HUD: each slot, in this round's order. */
export function objectives(s: MayorlyState) {
  const ss = supersetOf(s, s.desk.plan)
  const plan = s.desk.plan
  if (!ss || !plan) return null
  const resting = s.desk.block?.kind === 'rest'
  return {
    name: ss.name,
    round: plan.round,
    rounds: ss.rounds,
    slots: plan.sequence.flatMap((slotIndex, i) => {
      const slot = ss.slots[slotIndex]
      if (!slot) return []
      const ledgerId =
        slot.target.kind === 'ledger'
          ? slot.target.ledgerId
          : s.entries.find((e) => e.id === (slot.target as { entryId: Id }).entryId)?.ledgerId ?? null
      const ledger = s.ledgers.find((l) => l.id === ledgerId) ?? null
      return [{
        key: slot.id,
        letter: String.fromCharCode(65 + i),
        code: ledger?.code ?? '---',
        minutes: slot.minutes,
        state: i < plan.step ? 'done' : i === plan.step ? (resting ? 'next' : 'active') : 'queued',
      } as const]
    }),
  }
}

/** Time consumed on the couch for one entertainment, all time. */
export function leisureSpentMs(s: MayorlyState, leisureId: Id, now: number): Ms {
  let ms = 0
  for (const seg of s.segments) {
    if (seg.kind !== 'leisure' || seg.leisureId !== leisureId) continue
    ms += (seg.end ?? now) - seg.start
  }
  return ms
}

/** Coins paid for one entertainment, net of refunds. */
export function leisureTokensSpent(s: MayorlyState, leisureId: Id): number {
  return -s.tokens.filter((t) => t.leisureId === leisureId).reduce((n, t) => n + t.amount, 0)
}

/**
 * Whole tomatoes finished on the task the desk is on, over its whole life: an entry's focus time in
 * tomatoes, the open block's included; a couch item's completed blocks. A rest counts for the task it
 * follows. Null when the desk is on no task (idle, or ledger time with no entry).
 */
export function taskTomatoes(s: MayorlyState, now: number): number | null {
  const block = restSession(s)?.block ?? s.desk.block
  if (!block || block.kind === 'rest') return null
  if (block.kind === 'leisure') return block.leisureId ? leisureTokensSpent(s, block.leisureId) || 0 : null
  return block.entryId ? wholeTomatoes(entryTomatoes(s, block.entryId, now)) : null
}

/** Entertainment on the list, newest first. */
export function leisureList(s: MayorlyState) {
  return s.leisure.filter((x) => x.archivedAt === null).sort((a, b) => b.createdAt - a.createdAt)
}
