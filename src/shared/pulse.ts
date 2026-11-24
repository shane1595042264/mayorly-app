import { onDeskId, type HudEvent, type MayorlyState } from '../core/index'
import { THEME_COLORS } from './themes'

// The task on the desk changed: what the switch sound and the edge pulse answer to, the same on the
// Windows overlay, a Mac's effects window and the browser. Pure.

/**
 * A step that changed the task inside the running clock: a swap (a pick, Alt+Q's swap-back) or a
 * switch (a parked session brought back), but not a clear, whose ding says it, and not a fresh
 * deploy, which has the work alarm. Alt+Q makes both a swap and a switch: still one.
 */
export function switchedIn(events: HudEvent[]): boolean {
  return events.some((e) => e.type === 'swap' || e.type === 'switch') && !events.some((e) => e.type === 'cleared')
}

/** The couch's colour, as the stylesheets' --leisure. */
export const COUCH_COLOR = '#b48cf2'

/** The colour of the task now on the desk: its ledger's, the couch's purple, amber for anything else. */
export function pulseColor(s: MayorlyState): string {
  const id = onDeskId(s)
  if (id && s.leisure.some((l) => l.id === id)) return COUCH_COLOR
  const ledgerId = s.entries.find((e) => e.id === id)?.ledgerId ?? s.desk.block?.ledgerId ?? null
  const theme = s.ledgers.find((l) => l.id === ledgerId)?.theme
  return THEME_COLORS[theme ?? 'amber'] ?? THEME_COLORS.amber
}
