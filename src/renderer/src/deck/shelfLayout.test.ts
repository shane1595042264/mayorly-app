import { describe, expect, it } from 'vitest'
import { BASE, BAYS, CLERK, DESK, OPEN, PAGES, PER_BAY, placeFurniture, ROOM, roomLayout, SCENE, SHELF, SPINE, spineAt, TILE, WALL_STEP, wallRows } from './shelfLayout'

describe('the shelf scene', () => {
  it('stands the nine spines where the bookshelf slot sketches them', () => {
    // slots/prop2x4.bookshelf.json: "--======--======--======--" from x 3, rows 9-21, 26-38, 43-55.
    const xs = [5, 13, 21]
    const ys = [9, 26, 43]
    for (let i = 0; i < 9; i++) expect(spineAt(i)).toEqual({ x: xs[i % 3], y: ys[Math.floor(i / 3)] })
  })

  it('keeps every spine inside its bay, on its floor', () => {
    for (let i = 0; i < BAYS.length * PER_BAY; i++) {
      const [bx, by, bw, bh] = BAYS[Math.floor(i / PER_BAY)]
      const p = spineAt(i)
      expect(p.x).toBeGreaterThanOrEqual(bx)
      expect(p.x + SPINE.w).toBeLessThanOrEqual(bx + bw)
      expect(p.y).toBeGreaterThanOrEqual(by)
      expect(p.y + SPINE.h).toBe(by + bh)
    }
  })

  it('covers the whole wall and shows the skirting once, along the floor', () => {
    const rows = wallRows()
    expect(rows[0]).toBe(SCENE.wall - TILE)
    expect(rows[rows.length - 1]).toBeLessThanOrEqual(0)
    // Each row above is covered from WALL_STEP down by the row under it, skirting included.
    for (let i = 1; i < rows.length; i++) expect(rows[i - 1] - rows[i]).toBe(WALL_STEP)
    expect(WALL_STEP).toBeLessThanOrEqual(13)
    expect(wallRows(16)).toEqual([0])
    expect(wallRows(60).at(-1)).toBeLessThanOrEqual(0)
  })

  it('fits the furniture in the scene, with or without the clerk', () => {
    for (const clerk of [false, true]) {
      const p = placeFurniture(clerk)
      expect(p.shelf).toBeGreaterThanOrEqual(clerk ? CLERK.w : 0)
      expect(p.desk).toBeGreaterThanOrEqual(p.shelf + SHELF.w)
      expect(p.desk + DESK.w).toBeLessThanOrEqual(SCENE.w)
      if (clerk) expect(p.clerk! + CLERK.w).toBeLessThanOrEqual(p.shelf)
    }
    expect(BASE - SHELF.h).toBeGreaterThanOrEqual(0)
    expect(BASE).toBeLessThanOrEqual(SCENE.h)
  })

  it('keeps the open ledger pages where its slot sketches them, and big enough to write on', () => {
    // slots/prop4x3.ledger.open.json: bays.rects, "========================" from x 5 and x 35, rows 6-38;
    // its bays.spine [22, 30] with one per bay is the validator's least page, 24 by 31.
    expect(PAGES).toEqual([[5, 6, 24, 33], [35, 6, 24, 33]])
    for (const [x, y, w, h] of PAGES) {
      expect(x + w).toBeLessThanOrEqual(OPEN.w)
      expect(y + h).toBeLessThanOrEqual(OPEN.h)
      expect(w).toBeGreaterThanOrEqual(24)
      expect(h).toBeGreaterThanOrEqual(31)
    }
  })

  it('puts the shelf in the middle of the room, as big as the tab allows, at a whole scale', () => {
    const r = roomLayout(1180, 640, false)!
    expect(r.k).toBe(6)
    expect(Math.abs(r.shelf + (SHELF.w * r.k) / 2 - 1180 / 2)).toBeLessThanOrEqual(1)
    for (const v of [r.shelf, r.shelfTop, r.deskTop, r.desk, r.book.left, r.book.top]) expect(Number.isInteger(v)).toBe(true)
    expect(Number.isInteger(r.shelfTop / r.k) && Number.isInteger(r.deskTop / r.k)).toBe(true)
    expect(r.height).toBeLessThanOrEqual(640)
    // The shelf and the desk stand on the floor, four art pixels into it; the desk at the right.
    expect(r.shelfTop + SHELF.h * r.k).toBe((r.wall + 4) * r.k)
    expect(r.deskTop + DESK.h * r.k).toBe((r.wall + 4) * r.k)
    expect(r.desk).toBeGreaterThanOrEqual(r.shelf + (SHELF.w + ROOM.gap) * r.k)
    expect(r.desk + (DESK.w + ROOM.margin) * r.k).toBe(1180)
  })

  it('opens the ledger whole on the wall left of the shelf', () => {
    for (const [w, h] of [[1180, 640], [1292, 560], [900, 900], [1920, 1000], [700, 420]]) {
      const r = roomLayout(w, h, false)!
      expect(r.book.left).toBeGreaterThanOrEqual(ROOM.margin * r.k)
      expect(r.book.left + OPEN.w * r.k).toBeLessThanOrEqual(r.shelf - ROOM.gap * r.k)
      expect(r.book.top).toBeGreaterThanOrEqual(0)
      expect(r.book.top + OPEN.h * r.k).toBeLessThanOrEqual(r.height)
      expect(r.side.left + r.side.width).toBe(r.shelf - ROOM.gap * r.k)
    }
  })

  it('shrinks the room for a short or narrow tab, and gives way to the small scene when it cannot fit', () => {
    expect(roomLayout(1180, 450, false)!.k).toBe(5)
    expect(roomLayout(1920, 1000, false)!.k).toBe(8)
    expect(roomLayout(900, 900, false)!.k).toBe(5)
    expect(roomLayout(700, 900, false)!.k).toBe(4)
    expect(roomLayout(650, 900, false)).toBeNull()
    expect(roomLayout(1180, 300, false)).toBeNull()
    const clerk = roomLayout(1400, 700, true)!
    expect(clerk.clerk!).toBeGreaterThanOrEqual(clerk.shelf + SHELF.w * clerk.k)
    expect(clerk.clerk! + CLERK.w * clerk.k).toBeLessThanOrEqual(clerk.desk)
  })

  it('lets the wall grow above the shelf in a tall tab, within reason', () => {
    const r = roomLayout(1180, 2000, false)!
    expect(r.wall - (SHELF.h - 4)).toBe(ROOM.aboveMax)
  })
})
