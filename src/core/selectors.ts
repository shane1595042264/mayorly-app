import type { Block, Entry, Id, Ledger, MayorlyState, Ms } from './model'
import { openFlow, supersetOf } from './planner'


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
    tomatoes: txs.length,
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
    slots: plan.sequence.map((slotIndex, i) => {
      const slot = ss.slots[slotIndex]
      const ledgerId =
        slot.target.kind === 'ledger'
          ? slot.target.ledgerId
          : s.entries.find((e) => e.id === (slot.target as { entryId: Id }).entryId)?.ledgerId ?? null
      const ledger = s.ledgers.find((l) => l.id === ledgerId) ?? null
      return {
        key: slot.id,
        letter: String.fromCharCode(65 + i),
        code: ledger?.code ?? '---',
        minutes: slot.minutes,
        state: i < plan.step ? 'done' : i === plan.step ? (resting ? 'next' : 'active') : 'queued',
      } as const
    }),
  }
}
