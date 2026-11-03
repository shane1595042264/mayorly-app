import type { Entry, EntryHistoryEvent, MayorlyState, Segment } from './model'

/** Recover the completion dates older saves actually recorded, without inventing details. */
export function completionHistory(s: MayorlyState, entry: Entry): EntryHistoryEvent[] {
  const history = [...(entry.history ?? [])]
  const dates = new Set(s.tokens.filter(t => t.reason === 'harvest' && t.entryId === entry.id).map(t => t.at))
  if (entry.doneAt !== null) dates.add(entry.doneAt)
  for (const at of dates) {
    if (history.some(e => e.kind === 'cleared' && e.at === at)) continue
    history.push({ id: `${entry.id}:cleared:${at}`, at, kind: 'cleared' })
  }
  return history.sort((a, b) => b.at - a.at || a.id.localeCompare(b.id))
}

export type EntryActivity =
  | { id: string; at: number; kind: 'created' }
  | { id: string; at: number; kind: 'focus'; segment: Segment }
  | EntryHistoryEvent

export function entryActivity(s: MayorlyState, entry: Entry): EntryActivity[] {
  return [
    { id: `${entry.id}:created`, at: entry.createdAt, kind: 'created' as const },
    ...s.segments.filter(seg => seg.entryId === entry.id && seg.kind === 'focus')
      .map(segment => ({ id: segment.id, at: segment.start, kind: 'focus' as const, segment })),
    ...completionHistory(s, entry),
  ].sort((a, b) => b.at - a.at || a.id.localeCompare(b.id))
}
