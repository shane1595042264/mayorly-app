// Where the pet, its caption and the quick drawer sit, in one place for both desktops.
//
// On a Mac the shell turns these rectangles into windows: the pet window, the caption's
// click-through window and the drawer's window. On Windows the overlay already covers the
// work area, so the page draws the same rectangles inside it. Either way the tomato, the
// line above it and the drawer land in the same spot relative to each other.
//
// Coordinates are whatever `area` is in: screen points in the shell, the overlay's own
// pixels in the page (an area at 0,0 the size of the window). The anchor is the tomato's
// bottom centre.

export interface Point {
  x: number
  y: number
}

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

export type Side = 'left' | 'right'

/** The pet at HUD scale 1: the fixed-width sign column, the gap, the tomato, and the hop's headroom.
 * Matches `.pet-col`, `.pet` and `.pet-sprite` in hud.css. */
export const PET = { width: 140 + 10 + 48, height: 48 + 24 }
/** Two task lines at the design size (12px, line height 1.15): what grows when the pet's text setting does. */
export const TASK_LINES = 2 * 12 * 1.15
/**
 * The pet's own corner inside its box; matches `body.compact .pet-wrap` in hud.css. 12, not the 4 it
 * was: the founder's pet drawings are 24x24 at 3x round the 16x16 tomato, 12 px past it on every side,
 * and a Mac's window (or a Windows screen edge) cut what lay beyond 4.
 */
export const INSET = { x: 12, y: 12 }
/** The quick drawer's box, inset included; the drawer itself is 4px inside it. */
export const DRAWER = { width: 340, height: 360 }
/** The switch log's box, inset included, and the least height it shrinks to where the screen is short. */
export const LOG = { width: 380, height: 340, min: 150 }
/** The caption's box: generous, because it never takes the pointer; the text hugs the tomato's side. */
export const CAPTION = { width: 360, height: 40 }
/** The tomato sprite at scale 1. */
export const TOMATO = 48
/** Where a new pet sits: this far in from the right of the work area and up from its bottom. */
const HOME = { right: 64, bottom: 28 }

const half = (scale: number) => (TOMATO / 2) * scale

/** A HUD scale the settings accept: 70% to 160%, in steps of 5. */
export const clampScale = (scale: number): number => Math.min(1.6, Math.max(0.7, Math.round(scale * 20) / 20))

/**
 * The scale a resize drag has reached, from where it started and how far the pointer has gone.
 * The tomato grows around its bottom centre, so the handle on its inner top corner travels half
 * a tomato sideways and a whole tomato up per unit of scale; the pointer is projected on that line.
 */
export function dragScale(from: number, dx: number, dy: number, side: Side): number {
  const ux = ((side === 'right' ? -1 : 1) * TOMATO) / 2
  const uy = -TOMATO
  return clampScale(from + (dx * ux + dy * uy) / (ux * ux + uy * uy))
}

/** The edge the tomato is nearer: the sign's column hangs toward the centre. */
export function sideOf(area: Rect, a: Point): Side {
  return a.x < area.x + area.width / 2 ? 'left' : 'right'
}

/** A Windows taskbar's height at 100%, the strip an auto-hidden taskbar slides up into. */
export const TASKBAR = 48

/**
 * A first-run pet, in the bottom corner on this side. `reserve` keeps that much of the bottom
 * free: on Windows an auto-hidden taskbar leaves the work area the whole screen, then covers
 * the corner whenever it slides up.
 */
export function homeAnchor(area: Rect, scale: number, side: Side = 'right', reserve = 0): Point {
  const x = side === 'left' ? area.x + HOME.right + half(scale) : area.x + area.width - HOME.right - half(scale)
  return { x, y: area.y + area.height - HOME.bottom - reserve }
}

/** The tomato stays whole inside the area. */
export function clampAnchor(a: Point, area: Rect, scale: number): Point {
  const mx = INSET.x + half(scale)
  return {
    x: Math.min(Math.max(a.x, area.x + mx), area.x + area.width - mx),
    y: Math.min(Math.max(a.y, area.y + INSET.y + TOMATO * scale), area.y + area.height - INSET.y),
  }
}

/** The pet's height at this text size: two bigger task lines need the room. */
export function petHeight(text: number): number {
  return PET.height + Math.ceil(TASK_LINES * (text - 1))
}

/**
 * Windows: whether the pointer is on or close to the pet, so the shell feeds the page its moves.
 * `margin` is how close is close: enough for the page to see the pointer arrive and leave.
 */
export function nearPet(p: Point, a: Point, area: Rect, scale: number, text: number, margin: number): boolean {
  const b = petBox(a, area, scale, text)
  return p.x >= b.x - margin && p.x < b.x + b.width + margin && p.y >= b.y - margin && p.y < b.y + b.height + margin
}

/** The pet's box (the Mac pet window), hung off the tomato on the side it favours, kept inside the area. */
export function petBox(a: Point, area: Rect, scale: number, text: number): Rect {
  const width = Math.ceil(PET.width * scale) + INSET.x * 2
  const height = Math.ceil(petHeight(text) * scale) + INSET.y * 2
  const x = sideOf(area, a) === 'right' ? a.x + half(scale) + INSET.x - width : a.x - half(scale) - INSET.x
  const y = a.y + INSET.y - height
  return {
    x: Math.round(Math.min(Math.max(x, area.x), area.x + area.width - width)),
    y: Math.round(Math.min(Math.max(y, area.y), area.y + area.height - height)),
    width,
    height,
  }
}

/** The tomato as the pet's box actually holds it: the anchor after the box was kept inside the area. */
export function anchorInBox(box: Rect, side: Side, scale: number): Point {
  return {
    x: side === 'right' ? box.x + box.width - INSET.x - half(scale) : box.x + INSET.x + half(scale),
    y: box.y + box.height - INSET.y,
  }
}

/**
 * The caption: just above the tomato, from its outer edge over the sign's column; below it when
 * the top is in the way. `below` (the schedule's line and a notice) tries under the tomato first
 * and goes over the whole pet, task lines included, when there is no room; `over` goes over the
 * whole pet first, and under the tomato when the top is in the way.
 */
export function captionBox(a: Point, area: Rect, side: Side, scale: number, prefer: 'above' | 'below' | 'over' = 'above', text = 1): Rect & { below: boolean } {
  const box = 30
  const gap = 10
  const top = a.y - TOMATO * scale
  const x = side === 'left' ? a.x - half(scale) - 4 : a.x + half(scale) + 4 - CAPTION.width
  const belowY = a.y + gap - (CAPTION.height - box) / 2
  // A line that waits under the tomato and finds no room there goes over the whole pet, task lines
  // included, rather than over the tomato where those lines are; a hover caption hugs the tomato.
  const aboveY = prefer === 'above'
    ? top - gap - box - (CAPTION.height - box) / 2
    : a.y - petHeight(text) * scale - INSET.y - 2 - (CAPTION.height + box) / 2
  const below = prefer === 'below' ? belowY + CAPTION.height <= area.y + area.height || aboveY < area.y : aboveY < area.y
  const y = below ? belowY : aboveY
  return {
    x: Math.round(Math.min(Math.max(x, area.x), area.x + area.width - CAPTION.width)),
    y: Math.round(Math.min(Math.max(y, area.y), area.y + area.height - CAPTION.height)),
    ...CAPTION,
    below,
  }
}

/** The quick drawer: under the pet when there is room, over it otherwise, flush with the pet's outer side. */
export function drawerBox(pet: Rect, area: Rect, side: Side): Rect {
  const gap = 4
  const below = pet.y + pet.height + gap + DRAWER.height <= area.y + area.height
  const x = side === 'right' ? pet.x + pet.width - DRAWER.width : pet.x
  const y = below ? pet.y + pet.height + gap : pet.y - gap - DRAWER.height
  return {
    x: Math.round(Math.min(Math.max(x, area.x), area.x + area.width - DRAWER.width)),
    y: Math.round(Math.min(Math.max(y, area.y), area.y + area.height - DRAWER.height)),
    width: DRAWER.width,
    height: DRAWER.height,
  }
}

export type PanelWhere = 'below' | 'above' | 'beside'

/**
 * A panel hung off the pet (the switch log), always whole on the pet's screen: under the pet when
 * there is room, else over it, else beside it toward the screen's middle, else in the roomier of
 * under and over, shorter (down to `min`; the list inside scrolls). Flush with the pet's outer side.
 */
export function panelBox(pet: Rect, area: Rect, side: Side, size: { width: number; height: number; min?: number }): Rect & { where: PanelWhere } {
  const gap = 4
  const w = Math.min(size.width, area.width)
  const h = Math.min(size.height, area.height)
  const bottom = area.y + area.height
  const right = area.x + area.width
  const clampX = (x: number) => Math.round(Math.min(Math.max(x, area.x), right - w))
  const clampY = (y: number, height: number) => Math.round(Math.min(Math.max(y, area.y), bottom - height))
  const flushX = side === 'right' ? pet.x + pet.width - w : pet.x
  const roomBelow = bottom - (pet.y + pet.height + gap)
  const roomAbove = pet.y - gap - area.y
  if (roomBelow >= h) return { x: clampX(flushX), y: Math.round(pet.y + pet.height + gap), width: w, height: h, where: 'below' }
  if (roomAbove >= h) return { x: clampX(flushX), y: Math.round(pet.y - gap - h), width: w, height: h, where: 'above' }
  const besideX = side === 'right' ? pet.x - gap - w : pet.x + pet.width + gap
  if (besideX >= area.x && besideX + w <= right) return { x: Math.round(besideX), y: clampY(pet.y + pet.height - h, h), width: w, height: h, where: 'beside' }
  const min = Math.min(size.min ?? h, h)
  const down = roomBelow >= roomAbove
  const room = Math.max(min, Math.floor(Math.max(roomBelow, roomAbove)))
  const height = Math.min(h, room)
  return { x: clampX(flushX), y: clampY(down ? pet.y + pet.height + gap : pet.y - gap - height, height), width: w, height, where: down ? 'below' : 'above' }
}

/** Two boxes overlap. */
export function overlaps(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height
}

/** A corner of the area for the tomato: 1 top left, 2 top right, 3 bottom left, 4 bottom right. `reserve` as for `homeAnchor`. */
export function cornerAnchor(area: Rect, corner: 1 | 2 | 3 | 4, scale: number, reserve = 0): Point {
  const margin = 24
  const left = corner === 1 || corner === 3
  const top = corner === 1 || corner === 2
  return {
    x: left ? area.x + margin + half(scale) : area.x + area.width - margin - half(scale),
    y: top ? area.y + margin + TOMATO * scale : area.y + area.height - margin - reserve,
  }
}
