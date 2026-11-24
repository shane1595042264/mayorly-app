import { onDeskId, type Block, type DeskStatus, type HudEvent, type Id, type ImpactMoment, type ImpactStyle, type MayorlyState } from '../core/index'
import { THEME_COLORS } from './themes'
import { COUCH_COLOR, pulseColor, switchedIn } from './pulse'

// What hits the screen when something happens on the desk, the same on the Windows overlay, a Mac's
// effects windows and the browser: which moment one step of the reducer makes, in what colour and
// words, and the geometry that keeps a tsunami in step from one screen to the next. Pure.

export const IMPACT_STYLES: { id: ImpactStyle; label: string }[] = [
  { id: 'ripple', label: 'Tsunami' },
  { id: 'shockwave', label: 'Shockwave' },
  { id: 'edges', label: 'Edge glow' },
  { id: 'sweep', label: 'Sweep' },
  { id: 'tide', label: 'Tide' },
  { id: 'off', label: 'None' },
]

/** Settings' list, in the order a day meets them. */
export const IMPACT_MOMENTS: { id: ImpactMoment; label: string }[] = [
  { id: 'switch', label: 'Task switch' },
  { id: 'done', label: 'Task done' },
  { id: 'start', label: 'Start' },
  { id: 'rest', label: 'Focus ends' },
  { id: 'work', label: 'Rest ends' },
  { id: 'pause', label: 'Pause' },
  { id: 'resume', label: 'Resume' },
  { id: 'tomato', label: 'Tomato grown' },
  { id: 'stop', label: 'Sitting ends' },
]

/** A rest's colour: cool, where the work is warm. */
export const REST_COLOR = THEME_COLORS.sky
/** A pause or the end of a sitting: no task's colour. */
export const QUIET_COLOR = THEME_COLORS.slate
export const TOMATO_COLOR = THEME_COLORS.coral

/** One moment, ready to play: how, in what colour, and its words (a small line over a big one). */
export interface Impact {
  moment: ImpactMoment
  style: ImpactStyle
  color: string
  kicker: string
  title: string | null
}

/** What the desk looked like before a step: a pause, a resume and a rest ending show only as a change. */
export interface DeskSeen {
  status: DeskStatus
  kind: Block['kind'] | null
  /** The task on the desk, so a block started again is told from the next one. */
  id: Id | null
}

export const deskSeen = (s: MayorlyState): DeskSeen => ({ status: s.desk.status, kind: s.desk.block?.kind ?? null, id: onDeskId(s) })

/** The task on the desk in words: the entry's title, the couch item's, else the block's (a ledger's time). */
export function deskTitle(s: MayorlyState): string | null {
  const id = onDeskId(s)
  const entry = id ? s.entries.find((e) => e.id === id) : undefined
  if (entry) return entry.title
  const couch = id ? s.leisure.find((l) => l.id === id) : undefined
  if (couch) return couch.title
  const b = s.desk.block
  return b && b.kind !== 'rest' ? b.label : null
}

function ledgerColor(s: MayorlyState, ledgerId: Id | null | undefined): string {
  const theme = s.ledgers.find((l) => l.id === ledgerId)?.theme
  return THEME_COLORS[theme ?? 'amber'] ?? THEME_COLORS.amber
}

const minutes = (ms: number | null) => (ms ? `${Math.round(ms / 60_000)} min` : null)

/**
 * The moment one step makes, the strongest when it makes several: a task done, then a switch, then a
 * block changing (focus ending, rest ending, a start), a sitting ending, a pause or resume, a tomato.
 * Only on the computer running the desk: one that holds a desk running elsewhere shows nothing.
 */
export function momentOf(events: HudEvent[], before: DeskSeen, s: MayorlyState, device: Id): Omit<Impact, 'style'> | null {
  if (s.desk.device && s.desk.device.id !== device) return null
  const cleared = events.find((e): e is Extract<HudEvent, { type: 'cleared' }> => e.type === 'cleared')
  if (cleared) {
    const entry = s.entries.find((x) => x.id === cleared.entryId)
    return { moment: 'done', color: ledgerColor(s, entry?.ledgerId), kicker: 'Done', title: cleared.title }
  }
  if (switchedIn(events)) return { moment: 'switch', color: pulseColor(s), kicker: 'Switched to', title: deskTitle(s) }
  const block = [...events].reverse().find((e): e is Extract<HudEvent, { type: 'block' }> => e.type === 'block')
  if (block) {
    const b = block.block
    // The same block going again: one that was waiting for you, started, or one paused before a second of it ran.
    if ((before.status === 'ready' || before.status === 'paused') && before.kind === b.kind && before.id === onDeskId(s) && block.started) {
      return { moment: 'resume', color: b.kind === 'rest' ? REST_COLOR : pulseColor(s), kicker: before.status === 'ready' ? 'Started' : 'Resumed', title: b.kind === 'rest' ? 'Rest' : deskTitle(s) }
    }
    if (b.kind === 'rest') {
      const len = minutes(b.durationMs)
      return { moment: 'rest', color: REST_COLOR, kicker: 'Focus done', title: len ? `Rest, ${len}` : 'Rest' }
    }
    const color = b.kind === 'leisure' ? COUCH_COLOR : pulseColor(s)
    if (before.kind === null) return { moment: 'start', color, kicker: 'Starting', title: deskTitle(s) }
    if (before.kind === 'rest') return { moment: 'work', color, kicker: block.started ? 'Back to work' : 'Rest over', title: deskTitle(s) }
    return { moment: 'work', color, kicker: 'Next', title: deskTitle(s) }
  }
  const end = events.find((e): e is Extract<HudEvent, { type: 'sitting-end' }> => e.type === 'sitting-end')
  if (end) {
    const title = end.reason === 'complete' ? 'Rotation complete' : end.reason === 'flow-clear' ? 'Flow clear' : 'Stood down'
    return { moment: 'stop', color: QUIET_COLOR, kicker: end.tomatoes > 0 ? `${end.tomatoes} ${end.tomatoes === 1 ? 'tomato' : 'tomatoes'} this sitting` : 'Sitting over', title }
  }
  if (before.status === 'running' && s.desk.status === 'paused') return { moment: 'pause', color: QUIET_COLOR, kicker: 'Paused', title: deskTitle(s) }
  if ((before.status === 'paused' || before.status === 'ready') && s.desk.status === 'running') return { moment: 'resume', color: pulseColor(s), kicker: 'Resumed', title: deskTitle(s) }
  const tomato = events.find((e): e is Extract<HudEvent, { type: 'tomato' }> => e.type === 'tomato')
  if (tomato) {
    const entry = tomato.entryId ? s.entries.find((x) => x.id === tomato.entryId) : undefined
    return { moment: 'tomato', color: TOMATO_COLOR, kicker: 'Tomato grown', title: entry?.title ?? deskTitle(s) }
  }
  return null
}

/** The moment one step makes, in the style chosen for it; null when there is none or its style is off. */
export function impactFor(events: HudEvent[], before: DeskSeen, s: MayorlyState, device: Id): Impact | null {
  const m = momentOf(events, before, s, device)
  if (!m) return null
  const style = s.settings.impact.styles[m.moment]
  return style === 'off' ? null : { ...m, style }
}

/** Settings' Try: the moment as it would look now, in the style given. */
export function previewImpact(moment: ImpactMoment, style: ImpactStyle, s: MayorlyState): Impact {
  const task = deskTitle(s) ?? 'Your next task'
  const words: Record<ImpactMoment, [string, string | null, string]> = {
    switch: ['Switched to', task, pulseColor(s)],
    done: ['Done', task, pulseColor(s)],
    start: ['Starting', task, pulseColor(s)],
    rest: ['Focus done', `Rest, ${s.settings.shortRestMin} min`, REST_COLOR],
    work: ['Back to work', task, pulseColor(s)],
    pause: ['Paused', task, QUIET_COLOR],
    resume: ['Resumed', task, pulseColor(s)],
    tomato: ['Tomato grown', task, TOMATO_COLOR],
    stop: ['Sitting over', 'Stood down', QUIET_COLOR],
  }
  const [kicker, title, color] = words[moment]
  return { moment, style, color, kicker, title }
}

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

/**
 * How far the farthest corner of every screen it plays on is from the tomato. Each screen's waves run
 * to that one distance in the same time, so a wave leaving one screen's edge arrives at the next one's
 * as it would on one big screen.
 */
export function reachOf(origin: { x: number; y: number }, rects: Rect[]): number {
  let far = 0
  for (const r of rects) {
    for (const [x, y] of [[r.x, r.y], [r.x + r.width, r.y], [r.x, r.y + r.height], [r.x + r.width, r.y + r.height]]) {
      far = Math.max(far, Math.hypot(x - origin.x, y - origin.y))
    }
  }
  return Math.max(1, Math.ceil(far))
}

/** A screen's edges a wave crashes into, by side. */
export interface Walls {
  left: boolean
  right: boolean
  top: boolean
  bottom: boolean
}

/**
 * The edges of `r` a wave crashes into: every one but those another of the screens touches along it,
 * where the wave runs on into the next screen instead. A few pixels of slack, as screens line up.
 */
export function wallsOf(r: Rect, others: Rect[]): Walls {
  const slack = 4
  const near = (a: number, b: number) => Math.abs(a - b) <= slack
  const spanY = (o: Rect) => o.y < r.y + r.height - slack && o.y + o.height > r.y + slack
  const spanX = (o: Rect) => o.x < r.x + r.width - slack && o.x + o.width > r.x + slack
  const rest = others.filter((o) => o !== r)
  return {
    left: !rest.some((o) => near(o.x + o.width, r.x) && spanY(o)),
    right: !rest.some((o) => near(o.x, r.x + r.width) && spanY(o)),
    top: !rest.some((o) => near(o.y + o.height, r.y) && spanX(o)),
    bottom: !rest.some((o) => near(o.y, r.y + r.height) && spanX(o)),
  }
}

/** A sweep runs away from the tomato: to the far left of every screen from a tomato on the right half, else to the far right. */
export function sweepOf(origin: { x: number; y: number }, rects: Rect[]): { dir: 1 | -1; reachX: number } {
  const left = Math.min(...rects.map((r) => r.x))
  const right = Math.max(...rects.map((r) => r.x + r.width))
  const dir = origin.x - left > right - origin.x ? -1 : 1
  return { dir, reachX: Math.max(1, Math.ceil(dir < 0 ? origin.x - left : right - origin.x)) }
}

/** At most this many impacts play at once: a new one lets the last finish its wave under it, its words gone. */
export const IMPACTS_KEPT = 2

/** What a page plays once `e` arrives: older impacts beyond the kept few go; coins keep flying. */
export function withEffect<T extends { kind: string }>(list: T[], e: T): T[] {
  if (e.kind !== 'impact') return [...list, e]
  const impacts = list.filter((x) => x.kind === 'impact')
  const drop = new Set(impacts.slice(0, Math.max(0, impacts.length - (IMPACTS_KEPT - 1))))
  return [...list.filter((x) => !drop.has(x)), e]
}

/** Only the newest impact shows its words. */
export const lastImpact = <T extends { kind: string; seq: number }>(list: T[]): number | null => list.filter((x) => x.kind === 'impact').at(-1)?.seq ?? null
