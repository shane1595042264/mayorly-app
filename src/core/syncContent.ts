import type { MayorlyState } from './model'
import { DEVICE_SETTINGS } from './reducer'

// What one computer's copy has to tell the others, as a string to compare. A write to the
// server wakes every other computer, so a change that says nothing new must not make one.

const canonical = (v: unknown): unknown => {
  if (Array.isArray(v)) return v.map(canonical)
  if (!v || typeof v !== 'object') return v
  return Object.fromEntries(
    Object.entries(v)
      .filter(([, x]) => x !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([k, x]) => [k, canonical(x)]),
  )
}

/**
 * The copy without what each computer works out for itself: the plan, which the next replan
 * rewrites anyway; the settings that belong to one machine; and focus totals, which only sum the
 * intervals. A desk another computer owns is left out too, with the run it is timing: what this
 * computer made of them by holding them is a view, and the owner's copy is the record.
 */
export function syncContent(s: MayorlyState, self: string): string {
  const mine = !s.desk.device || s.desk.device.id === self
  const run = mine ? undefined : s.segments.filter((x) => x.sittingId === s.desk.sittingId).at(-1)?.id
  const device: readonly string[] = DEVICE_SETTINGS
  return JSON.stringify(
    canonical({
      ...s,
      desk: mine ? s.desk : null,
      calendar: { ...s.calendar, blocks: null, overflow: null, plannedAt: null, horizonEnd: null, plannedMode: null },
      settings: Object.fromEntries(Object.entries(s.settings).filter(([k]) => !device.includes(k))),
      sittings: s.sittings.map((x) => ({ ...x, focusMs: 0 })),
      segments: run ? s.segments.map((x) => (x.id === run ? { ...x, end: null } : x)) : s.segments,
    }),
  )
}

/** The plan alone: it still has to reach the calendar feed, just not every minute. */
export const planContent = (s: MayorlyState): string => JSON.stringify([s.calendar.blocks, s.calendar.overflow])
