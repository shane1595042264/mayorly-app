import type { Id, MayorlyState, Segment, TokenTx } from './model'
import { COUCH_COINS_PER_TOMATO } from './rules'

/** Both time and tomatoes come from the same start/end intervals. */
export function segmentMs(seg: Segment, now: number): number {
  return Math.max(0, (seg.end ?? now) - seg.start)
}

export function wholeTomatoes(n: number): number {
  return Math.floor(n + 1e-9)
}

/** Keep each sitting's original tomato length, even after Settings changes. Focus time unless told otherwise. */
function units(s: MayorlyState, now: number, match: (seg: Segment) => boolean, kind: Segment['kind'] = 'focus'): number {
  const intervals = new Map(s.sittings.map(x => [x.id, x.tomatoMs]))
  const time = new Map<number, number>()
  for (const seg of s.segments) {
    if (seg.kind !== kind || !match(seg)) continue
    const interval = intervals.get(seg.sittingId) ?? s.settings.focusMin * 60_000
    if (interval <= 0) continue
    time.set(interval, (time.get(interval) ?? 0) + segmentMs(seg, now))
  }
  return [...time].reduce((n, [interval, ms]) => n + ms / interval, 0)
}

/** Lifetime work on this entry, including partial tomatoes while away from the desk. */
export function entryTomatoes(s: MayorlyState, entryId: Id, now: number): number {
  return units(s, now, seg => seg.entryId === entryId)
}

/** Lifetime time on a couch item in tomatoes, at each sitting's tomato length, as for a task. */
export function couchTomatoes(s: MayorlyState, leisureId: Id, now: number): number {
  return units(s, now, seg => seg.leisureId === leisureId, 'leisure')
}

/** Coins a couch item has paid, under this rule or the per-block one before it. */
export function couchCoinsPaid(s: MayorlyState, leisureId: Id): number {
  return s.tokens.filter(t => t.reason === 'leisure' && t.leisureId === leisureId).reduce((n, t) => n - t.amount, 0)
}

export type CouchCharge = { k: number; at: number; sittingId: Id }

/**
 * The coins a couch item owes at `now`: one for each whole tomato of its couch time not yet paid,
 * each dated when that tomato completed. The k-th tomato is counted over all its intervals in order,
 * so however the time was split, the coins paid come to its whole tomatoes. Coins the per-block rule
 * took cover the first tomatoes, and one it took for a block partly spent on a task covers the next.
 */
export function couchCharges(s: MayorlyState, leisureId: Id, now: number): CouchCharge[] {
  const paid = couchCoinsPaid(s, leisureId)
  const lengths = new Map(s.sittings.map(x => [x.id, x.tomatoMs]))
  const segs = s.segments.filter(seg => seg.kind === 'leisure' && seg.leisureId === leisureId).sort((a, b) => a.start - b.start)
  const out: CouchCharge[] = []
  let acc = 0
  for (const seg of segs) {
    const len = lengths.get(seg.sittingId) ?? s.settings.focusMin * 60_000
    if (len <= 0) continue
    const end = seg.end ?? now
    const after = acc + Math.max(0, end - seg.start) / len
    for (let k = wholeTomatoes(acc) + 1; k <= wholeTomatoes(after); k++) {
      if (k > paid) out.push({ k, at: Math.min(end, Math.round(seg.start + (k - acc) * len)), sittingId: seg.sittingId })
    }
    acc = after
  }
  return out
}

/** The coin record for a couch tomato. Its id is the item and the count, so two computers that settle the same time make one record. */
export function couchCoin(leisureId: Id, c: CouchCharge): TokenTx {
  return { id: `couch:${leisureId}:${c.k}`, at: c.at, amount: -COUCH_COINS_PER_TOMATO, reason: 'leisure', sittingId: c.sittingId, leisureId }
}

/**
 * Settles the couch time in closed intervals that has not been paid for, on load and after a merge,
 * quietly: a save from before this rule, or time another computer sat, comes to what it cost.
 */
export function settleCouch(s: MayorlyState): MayorlyState {
  const closed = { ...s, segments: s.segments.filter(seg => seg.end !== null) }
  const items = new Set(closed.segments.flatMap(seg => (seg.kind === 'leisure' && seg.leisureId ? [seg.leisureId] : [])))
  const add = [...items].flatMap(id => couchCharges(closed, id, 0).map(c => couchCoin(id, c)))
  const have = new Set(s.tokens.map(t => t.id))
  const fresh = add.filter(t => !have.has(t.id))
  return fresh.length ? { ...s, tokens: [...s.tokens, ...fresh] } : s
}

/** Only whole, unpaid tomatoes can be harvested. Existing coin records stay unchanged. */
export function unharvestedTomatoes(s: MayorlyState, entryId: Id, now: number): number {
  const paid = s.tokens.filter(t => t.reason === 'harvest' && t.entryId === entryId)
    .reduce((n, t) => n + (t.tomatoes ?? Math.max(0, t.amount)), 0)
  return Math.max(0, wholeTomatoes(entryTomatoes(s, entryId, now)) - paid)
}

export const ledgerKey = (ledgerId: Id | null): string => ledgerId ?? ''

export function ledgerTomatoes(s: MayorlyState, sittingId: Id, ledgerId: Id | null, now: number): number {
  return units(s, now, seg => seg.sittingId === sittingId && seg.entryId === null && seg.ledgerId === ledgerId)
}

/**
 * The first Windows build paid a coin the minute a tomato ripened, entry or not, as a tomato record
 * with no count and no entry. Under the harvest those coins would be paid a second time when the
 * entry is cleared. Each such record whose minute fell in a focus segment on an entry becomes a
 * one-tomato harvest on that entry, once; id and amount stay, so the balance and the coin history
 * do not change. Records for ledger time are left as they are.
 */
export function settleLegacyCoins(s: MayorlyState): MayorlyState {
  const tokens = s.tokens.map(tx => {
    if (tx.reason !== 'tomato' || tx.tomatoes !== undefined) return tx
    const seg = s.segments.find(seg => seg.sittingId === tx.sittingId && seg.kind === 'focus' && seg.start < tx.at && (seg.end === null || seg.end >= tx.at))
    if (!seg || seg.entryId === null) return tx
    return { ...tx, reason: 'harvest' as const, tomatoes: 1, entryId: seg.entryId }
  })
  return { ...s, tokens }
}

/**
 * The desk has one clock, so its intervals follow one another and never overlap. From 2026-11-19 two
 * copies of the desk each ended one block and both rests came through a merge, so two intervals were
 * open at once; closing only the first open one then kept a stray open through every switch after it,
 * and time was counted two and three times over. Each interval ends no later than the next one
 * starts, which is when the desk moved on. Run on load and after every merge, so a copy that still
 * has the longer ends cannot bring them back: the same intervals always come out the same.
 */
export function untangle(s: MayorlyState): MayorlyState {
  const order = s.segments.map((seg, i) => ({ seg, i })).sort((a, b) => a.seg.start - b.seg.start || a.i - b.i)
  let segments: Segment[] | null = null
  for (let n = 0; n + 1 < order.length; n++) {
    const { seg, i } = order[n]
    const next = order[n + 1].seg.start
    if (seg.end !== null && seg.end <= next) continue
    segments ??= s.segments.slice()
    segments[i] = { ...seg, end: Math.max(seg.start, next) }
  }
  return segments ? { ...s, segments } : s
}

/** Rebuild derived counts from closed intervals on load/merge, never replay old payments. */
/** A sitting's focus time is what its closed intervals add up to: the log is the record, this only sums it. */
export function focusFromLog(s: MayorlyState): MayorlyState {
  const spent = new Map<Id, number>()
  for (const seg of s.segments) {
    if (seg.kind === 'focus') spent.set(seg.sittingId, (spent.get(seg.sittingId) ?? 0) + (seg.end === null ? 0 : seg.end - seg.start))
  }
  return { ...s, sittings: s.sittings.map((x) => (spent.has(x.id) ? { ...x, focusMs: spent.get(x.id)! } : x)) }
}

export function reconcileTomatoes(s: MayorlyState): MayorlyState {
  const closed = { ...s, segments: s.segments.filter(seg => seg.end !== null) }
  return {
    ...s,
    entries: s.entries.map(e => ({ ...e, tomatoes: e.doneAt === null ? unharvestedTomatoes(closed, e.id, 0) : 0 })),
    sittings: s.sittings.map(sitting => {
      if (sitting.ledgerTomatoes) return sitting
      const segments = s.segments.filter(seg => seg.sittingId === sitting.id && seg.kind === 'focus' && seg.entryId === null)
      const ledgerIds = new Set(segments.map(seg => seg.ledgerId))
      const paid = new Map<Id | null, number>()
      for (const tx of s.tokens) {
        if (tx.sittingId !== sitting.id || tx.reason !== 'tomato') continue
        const seg = segments.find(seg => seg.start < tx.at && (seg.end === null || seg.end >= tx.at))
        if (seg) paid.set(seg.ledgerId, (paid.get(seg.ledgerId) ?? 0) + (tx.tomatoes ?? 1))
      }
      return { ...sitting, ledgerTomatoes: Object.fromEntries([...ledgerIds].map(id => [ledgerKey(id), Math.max(paid.get(id) ?? 0, wholeTomatoes(ledgerTomatoes(closed, sitting.id, id, 0)))])) }
    }),
  }
}
