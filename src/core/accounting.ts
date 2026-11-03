import type { Id, MayorlyState, Segment } from './model'

/** Both time and tomatoes come from the same start/end intervals. */
export function segmentMs(seg: Segment, now: number): number {
  return Math.max(0, (seg.end ?? now) - seg.start)
}

export function wholeTomatoes(n: number): number {
  return Math.floor(n + 1e-9)
}

/** Keep each sitting's original tomato length, even after Settings changes. */
function units(s: MayorlyState, now: number, match: (seg: Segment) => boolean): number {
  const intervals = new Map(s.sittings.map(x => [x.id, x.tomatoMs]))
  const time = new Map<number, number>()
  for (const seg of s.segments) {
    if (seg.kind !== 'focus' || !match(seg)) continue
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

/** Rebuild derived counts from closed intervals on load/merge, never replay old payments. */
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
