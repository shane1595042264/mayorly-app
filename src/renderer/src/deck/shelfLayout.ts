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
 * The Shelf tab as one room: the founder's wall and floor across the whole tab, his bookshelf and
 * desk standing in it at one whole scale, and the ledger cards hung on the wall between them, each
 * row level with the bay its spines stand in. Art numbers are art pixels; the rest is screen pixels.
 */
export const ROOM = {
  /** Art pixels of wall between the tab's edges and the furniture. */
  margin: 3,
  /** Art pixels between the shelf and the cards, and the cards and the desk. */
  gap: 4,
  /** Art pixels of floor below the furniture's bottom edge (the floor is one tile; furniture stands four into it). */
  below: TILE - 4,
  /** Art pixels of wall above the shelf at the least, and at the most when the tab is tall. */
  above: 4,
  aboveMax: 28,
  /** The scales tried, largest first. Under the smallest a card is too short to read: the cards go under the room. At 4 a card has room for its name and numbers, not its criterion. */
  scales: [8, 7, 6, 5, 4],
  /** Screen pixels: the three cards of a row together, wide enough for a name like Professional Work (`cardsFit`), the narrowest they may be when nothing else fits, the widest, and the gap between two. */
  cardsFit: 3 * 200 + 2 * 10,
  cardsMin: 3 * 170 + 2 * 10,
  cardsMax: 3 * 340 + 2 * 10,
  cardGap: 10,
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
  /** The wall between shelf and desk the cards hang on, in screen pixels, and each bay's row: its top and height. */
  cards: { left: number; width: number; rows: { top: number; height: number }[] }
}

/**
 * The largest whole scale at which the room fits `width` by `height` screen pixels with a row of
 * three cards beside the shelf wide enough for their names, else the largest with cards that still
 * read; null when none does (the cards then go under the room).
 */
export function roomLayout(width: number, height: number, clerk: boolean): RoomLayout | null {
  for (const need of [ROOM.cardsFit, ROOM.cardsMin]) {
    const r = roomAt(width, height, clerk, need)
    if (r) return r
  }
  return null
}

function roomAt(width: number, height: number, clerk: boolean, need: number): RoomLayout | null {
  const clerkW = clerk ? CLERK.w + 2 : 0
  for (const k of ROOM.scales) {
    const furniture = (ROOM.margin * 2 + clerkW + SHELF.w + ROOM.gap * 2 + DESK.w) * k
    const room = (ROOM.above + SHELF.h + ROOM.below) * k
    const free = width - furniture
    if (free < need || room > height) continue
    const above = Math.min(ROOM.aboveMax, Math.max(ROOM.above, Math.floor(height / k) - SHELF.h - ROOM.below))
    const wall = above + SHELF.h - 4
    const base = wall + 4
    const shelf = (ROOM.margin + clerkW) * k
    const shelfTop = (base - SHELF.h) * k
    const left = shelf + (SHELF.w + ROOM.gap) * k
    return {
      k,
      wall,
      height: (wall + TILE) * k,
      clerk: clerk ? ROOM.margin * k : null,
      shelf,
      desk: width - (ROOM.margin + DESK.w) * k,
      shelfTop,
      deskTop: (base - DESK.h) * k,
      cards: { left, width: Math.min(ROOM.cardsMax, free), rows: BAYS.map(([, by, , bh]) => ({ top: shelfTop + by * k, height: bh * k })) },
    }
  }
  return null
}
