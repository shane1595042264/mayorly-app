// Where things stand in the Shelf tab's scene (ShelfScene.tsx), in art pixels; the scene multiplies
// every number by its one whole scale. Pure, so the numbers are held to the founder's slot files in
// mayorly-assets by shelfLayout.test.ts.

export const TILE = 16

/** The scene: a wall of tile.wall.plaster four tiles tall over one row of tile.floor.wood. */
export const SCENE = { w: 112, h: 80, wall: 64 } as const

/** Furniture stands with its bottom edge here: four pixels into the floor, in front of the skirting. */
export const BASE = SCENE.wall + 4

export const SHELF = { w: 32, h: 64 } as const
export const DESK = { w: 32, h: 32 } as const
export const CLERK = { w: 16, h: 32 } as const

/** The mail tray's canvas on the desk's: its bottom on the green top, at the end away from the lamp. */
export const TRAY_ON_DESK = { x: 16, y: -4 } as const

/**
 * The bookshelf's three bays as x, y, w, h on its 32x64 canvas (`bays.rects` in
 * slots/prop2x4.bookshelf.json). A shelf redrawn with its bays moved needs these moved too.
 */
export const BAYS = [
  [3, 7, 26, 15],
  [3, 24, 26, 15],
  [3, 41, 26, 15],
] as const
export const PER_BAY = 3

/**
 * The spine inside icon.ledger.closed and icon.ledger.locked: the opaque box of each PNG, measured
 * on 2026-11-23 with parsePNG from mayorly-assets/lib/validate.mjs. Both are x 5 to 10, y 1 to 13.
 */
export const SPINE = { x: 5, y: 1, w: 6, h: 13 } as const

/**
 * Ledger i's spine on the shelf canvas: standing on the floor of its bay, three to a bay, left to
 * right with even gaps, as the slot's sketch places them.
 */
export function spineAt(i: number): { x: number; y: number } {
  const [bx, by, bw, bh] = BAYS[Math.floor(i / PER_BAY)]
  const gap = Math.floor((bw - PER_BAY * SPINE.w) / (PER_BAY + 1))
  return { x: bx + gap + (i % PER_BAY) * (SPINE.w + gap), y: by + bh - SPINE.h }
}

/**
 * The wall tile is plaster with the skirting in its bottom rows, drawn to tile left to right only.
 * Its rows are laid this far apart, the bottom row painted over the one above it, so each row's
 * plaster covers the skirting of the row above and the skirting shows once, along the floor.
 */
export const WALL_STEP = 12

/** The tops of the wall's rows of tiles, bottom row first (it paints on top), up past the scene's top. */
export function wallRows(wall: number = SCENE.wall): number[] {
  const rows: number[] = []
  for (let y = wall - TILE; ; y -= WALL_STEP) {
    rows.push(y)
    if (y <= 0) return rows
  }
}

/** Left edges of the clerk (when drawn), the shelf and the desk, the group centred in the scene. */
export function placeFurniture(clerk: boolean): { clerk: number | null; shelf: number; desk: number } {
  const CLERK_GAP = 2
  const DESK_GAP = 6
  const w = (clerk ? CLERK.w + CLERK_GAP : 0) + SHELF.w + DESK_GAP + DESK.w
  const left = Math.floor((SCENE.w - w) / 2)
  const shelf = clerk ? left + CLERK.w + CLERK_GAP : left
  return { clerk: clerk ? left : null, shelf, desk: shelf + SHELF.w + DESK_GAP }
}

/**
 * A ledger off the shelf and lying open (prop4x3.ledger.open): its canvas, and the two pages the app
 * writes the ledger's words on as x, y, w, h (`bays.rects` in slots/prop4x3.ledger.open.json, held
 * to it by shelfLayout.test.ts). A book redrawn with its pages moved needs these moved too.
 */
export const OPEN = { w: 64, h: 48 } as const
export const PAGES = [
  [5, 6, 24, 33],
  [35, 6, 24, 33],
] as const

/**
 * The Shelf tab as one room: the founder's wall and floor across the whole tab, his bookshelf in
 * the middle with a spine for every ledger, the clerk (once drawn) and his desk to its right, and
 * on the wall to its left the ledger you point at or pick, out of the shelf and lying open. All at
 * one whole scale. Art numbers are art pixels; the rest is screen pixels.
 */
export const ROOM = {
  /** Art pixels of wall between the tab's edges and the furniture. */
  margin: 3,
  /** Art pixels between the open ledger and the shelf, and between the shelf and what stands right of it. */
  gap: 4,
  /** Art pixels of floor below the furniture's bottom edge (the floor is one tile; furniture stands four into it). */
  below: TILE - 4,
  /** Art pixels of wall above the shelf at the least, and at the most when the tab is tall. */
  above: 4,
  aboveMax: 28,
  /** The scales tried, largest first; under the smallest the open ledger's pages are too small to read. */
  scales: [8, 7, 6, 5, 4],
} as const

export interface RoomLayout {
  /** Screen pixels per art pixel. */
  k: number
  /** The wall's height, in art pixels; the floor tile row lies under it. */
  wall: number
  /** The room's height in screen pixels. */
  height: number
  /** Left edges in screen pixels; the clerk is null when not drawn. */
  clerk: number | null
  shelf: number
  desk: number
  /** Tops in screen pixels. */
  shelfTop: number
  deskTop: number
  /** The open ledger's top left corner, in screen pixels: on the wall left of the shelf, level with its middle. */
  book: { left: number; top: number }
  /** The wall left of the shelf, in screen pixels: where the edit form goes. */
  side: { left: number; width: number }
}

/**
 * The largest whole scale at which the room fits `width` by `height` screen pixels with the shelf in
 * the middle, the open ledger whole on the wall to its left, and the clerk and the desk to its
 * right; null when none does (the tab then shows the small scene over the cards).
 */
export function roomLayout(width: number, height: number, clerk: boolean): RoomLayout | null {
  const clerkW = clerk ? CLERK.w + 2 : 0
  for (const k of ROOM.scales) {
    if ((ROOM.above + SHELF.h + ROOM.below) * k > height) continue
    const shelf = Math.floor((width - SHELF.w * k) / 2)
    const left = shelf - (ROOM.margin + ROOM.gap) * k
    const right = width - (shelf + SHELF.w * k) - (ROOM.margin + ROOM.gap) * k
    if (left < OPEN.w * k || right < (clerkW + DESK.w) * k) continue
    const above = Math.min(ROOM.aboveMax, Math.max(ROOM.above, Math.floor(height / k) - SHELF.h - ROOM.below))
    const wall = above + SHELF.h - 4
    const base = wall + 4
    const shelfTop = (base - SHELF.h) * k
    const roomH = (wall + TILE) * k
    const bookTop = shelfTop + Math.floor(((SHELF.h - OPEN.h) * k) / 2)
    return {
      k,
      wall,
      height: roomH,
      clerk: clerk ? shelf + (SHELF.w + 2) * k : null,
      shelf,
      desk: width - (ROOM.margin + DESK.w) * k,
      shelfTop,
      deskTop: (base - DESK.h) * k,
      book: { left: ROOM.margin * k + Math.floor((left - OPEN.w * k) / 2), top: Math.max(k, Math.min(roomH - (OPEN.h + 1) * k, bookTop)) },
      side: { left: ROOM.margin * k, width: left },
    }
  }
  return null
}
