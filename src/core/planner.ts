import type { Block, Entry, Id, MayorlyState, Mode, Plan, Superset } from './model'

// The planner decides what the desk does next. It never touches time or tokens;
// the reducer owns those. Every function here is pure.

const MIN = 60_000

export function openFlow(s: MayorlyState): Entry[] {
  return s.entries.filter((e) => e.doneAt === null).sort((a, b) => a.order - b.order)
}

export function firstOpenInLedger(s: MayorlyState, ledgerId: Id | null, exclude?: Id): Entry | null {
  if (!ledgerId) return null
  return openFlow(s).find((e) => e.ledgerId === ledgerId && e.id !== exclude) ?? null
}

/** The next open entry after `afterId` in flow order, falling back to the top. */
export function nextInFlow(s: MayorlyState, afterId: Id | null, exclude?: Id): Entry | null {
  const flow = openFlow(s).filter((e) => e.id !== exclude)
  if (!afterId) return flow[0] ?? null
  const after = s.entries.find((e) => e.id === afterId)
  if (!after) return flow[0] ?? null
  return flow.find((e) => e.order > after.order) ?? null
}

export function entrySpentMs(s: MayorlyState, entryId: Id, now: number): number {
  let ms = 0
  for (const seg of s.segments) {
    if (seg.entryId !== entryId || seg.kind !== 'focus') continue
    ms += (seg.end ?? now) - seg.start
  }
  return ms
}

export function supersetOf(s: MayorlyState, plan: Plan | null): Superset | null {
  if (!plan?.supersetId) return null
  return s.supersets.find((x) => x.id === plan.supersetId) ?? null
}

function ledgerName(s: MayorlyState, id: Id | null): string {
  return s.ledgers.find((l) => l.id === id)?.name ?? 'Free focus'
}

function shuffled(n: number, random: () => number): number[] {
  const a = Array.from({ length: n }, (_, i) => i)
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

function sequenceFor(ss: Superset, random: () => number): number[] {
  return ss.order === 'shuffle' ? shuffled(ss.slots.length, random) : ss.slots.map((_, i) => i)
}

export function rest(label: string, minutes: number, round: number): Block {
  return { kind: 'rest', ledgerId: null, entryId: null, durationMs: minutes * MIN, slotIndex: null, round, label }
}

export function focusForEntry(s: MayorlyState, entry: Entry | null, minutes: number, round: number, ledgerFallback: Id | null = null): Block {
  const ledgerId = entry ? entry.ledgerId : ledgerFallback
  return {
    kind: 'focus',
    ledgerId,
    entryId: entry?.id ?? null,
    durationMs: minutes * MIN,
    slotIndex: null,
    round,
    label: ledgerName(s, ledgerId),
  }
}

/** Blitz runs an entry against what is left of its estimate, or counts up without one. */
export function blitzBlock(s: MayorlyState, entry: Entry, now: number): Block {
  const left = entry.estimateMin ? entry.estimateMin * MIN - entrySpentMs(s, entry.id, now) : null
  return {
    kind: 'focus',
    ledgerId: entry.ledgerId,
    entryId: entry.id,
    durationMs: left !== null && left > 0 ? left : null,
    slotIndex: null,
    round: 1,
    label: ledgerName(s, entry.ledgerId),
  }
}

export function focusForSlot(s: MayorlyState, ss: Superset, slotIndex: number, round: number): Block {
  const slot = ss.slots[slotIndex]
  let ledgerId: Id | null = null
  let entry: Entry | null = null
  if (slot.target.kind === 'ledger') {
    ledgerId = slot.target.ledgerId
    entry = firstOpenInLedger(s, ledgerId)
  } else {
    const targetId = slot.target.entryId
    const pinned = s.entries.find((e) => e.id === targetId) ?? null
    ledgerId = pinned?.ledgerId ?? null
    entry = pinned && pinned.doneAt === null ? pinned : firstOpenInLedger(s, ledgerId)
  }
  return {
    kind: 'focus',
    ledgerId,
    entryId: entry?.id ?? null,
    durationMs: slot.minutes * MIN,
    slotIndex,
    round,
    label: ledgerName(s, ledgerId),
  }
}

export interface DeployOpts {
  mode: Mode
  supersetId?: Id | null
  entryId?: Id | null
  /** pomodoro: work this ledger, with or without an entry. */
  ledgerId?: Id | null
}

export function initialPlan(s: MayorlyState, opts: DeployOpts, random: () => number): Plan | null {
  const plan: Plan = {
    mode: opts.mode,
    supersetId: null,
    anchorEntryId: null,
    anchorLedgerId: null,
    round: 1,
    step: 0,
    sequence: [],
    focusCount: 0,
  }
  if (opts.mode === 'superset') {
    const ss = s.supersets.find((x) => x.id === opts.supersetId)
    if (!ss || ss.slots.length === 0) return null
    plan.supersetId = ss.id
    plan.sequence = sequenceFor(ss, random)
    return plan
  }
  const pick = opts.entryId ? s.entries.find((e) => e.id === opts.entryId && e.doneAt === null) : null
  const ledgerId = opts.ledgerId && s.ledgers.some((l) => l.id === opts.ledgerId) ? opts.ledgerId : null
  if (opts.mode === 'pomodoro' && !pick && ledgerId) {
    plan.anchorLedgerId = ledgerId
    plan.anchorEntryId = firstOpenInLedger(s, ledgerId)?.id ?? null
    return plan
  }
  const anchor = pick ?? openFlow(s)[0] ?? null
  if (opts.mode === 'blitz' && !anchor) return null
  plan.anchorEntryId = anchor?.id ?? null
  plan.anchorLedgerId = anchor?.ledgerId ?? null
  return plan
}

export function firstBlock(s: MayorlyState, plan: Plan, now: number): Block | null {
  const minutes = s.settings.focusMin
  if (plan.mode === 'superset') {
    const ss = supersetOf(s, plan)
    return ss ? focusForSlot(s, ss, plan.sequence[0], 1) : null
  }
  const anchor = s.entries.find((e) => e.id === plan.anchorEntryId) ?? null
  if (plan.mode === 'blitz') return anchor ? blitzBlock(s, anchor, now) : null
  return focusForEntry(s, anchor, minutes, 1, plan.anchorLedgerId)
}

/**
 * What follows `finished`. Mutates and returns `plan` (callers pass a draft).
 * Returns block null when the plan is complete.
 */
export function advance(
  s: MayorlyState,
  plan: Plan,
  finished: Block,
  now: number,
  random: () => number,
): Block | null {
  const st = s.settings

  if (plan.mode === 'blitz') {
    const next = nextInFlow(s, finished.entryId, finished.entryId ?? undefined)
    plan.anchorEntryId = next?.id ?? null
    return next ? blitzBlock(s, next, now) : null
  }

  if (plan.mode === 'pomodoro') {
    if (finished.kind === 'focus') {
      plan.focusCount++
      const long = plan.focusCount % Math.max(1, st.longRestEvery) === 0
      const minutes = long ? st.longRestMin : st.shortRestMin
      if (minutes > 0) return rest(long ? 'Long rest' : 'Rest', minutes, plan.focusCount + 1)
    }
    let anchor = s.entries.find((e) => e.id === plan.anchorEntryId && e.doneAt === null) ?? null
    if (!anchor && plan.anchorLedgerId) anchor = firstOpenInLedger(s, plan.anchorLedgerId)
    else if (!anchor && plan.anchorEntryId) anchor = nextInFlow(s, plan.anchorEntryId)
    plan.anchorEntryId = anchor?.id ?? null
    return focusForEntry(s, anchor, st.focusMin, plan.focusCount + 1, plan.anchorLedgerId)
  }

  const ss = supersetOf(s, plan)
  if (!ss || ss.slots.length === 0) return null

  if (finished.kind === 'rest') {
    return focusForSlot(s, ss, plan.sequence[plan.step], plan.round)
  }

  plan.focusCount++
  const lastInRound = plan.step >= plan.sequence.length - 1
  if (!lastInRound) {
    plan.step++
    if (ss.restMin > 0) return rest('Rest', ss.restMin, plan.round)
    return focusForSlot(s, ss, plan.sequence[plan.step], plan.round)
  }
  if (ss.rounds !== 0 && plan.round >= ss.rounds) return null
  plan.round++
  plan.step = 0
  plan.sequence = sequenceFor(ss, random)
  if (ss.roundRestMin > 0) return rest('Round rest', ss.roundRestMin, plan.round)
  return focusForSlot(s, ss, plan.sequence[0], plan.round)
}

/** A look at the next block without committing to it. Shuffles are previewed unshuffled. */
export function peekNext(s: MayorlyState, now: number): Block | null {
  const { plan, block } = s.desk
  if (!plan || !block) return null
  const draft: Plan = { ...plan, sequence: [...plan.sequence] }
  return advance(s, draft, block, now, () => 0.999999)
}
