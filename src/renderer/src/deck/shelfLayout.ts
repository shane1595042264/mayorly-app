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
