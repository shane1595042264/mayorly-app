import { describe, expect, it } from 'vitest'
import { BASE, BAYS, CLERK, DESK, PER_BAY, placeFurniture, ROOM, roomLayout, SCENE, SHELF, SPINE, spineAt, TILE, WALL_STEP, wallRows } from './shelfLayout'

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

  it('makes the room as big as the tab allows, at a whole scale, with the cards level with the bays', () => {
    const r = roomLayout(1180, 640, false)!
    expect(r.k).toBe(7)
    expect(Number.isInteger(r.shelf / r.k) && Number.isInteger(r.shelfTop / r.k) && Number.isInteger(r.deskTop / r.k)).toBe(true)
    expect(r.height).toBeLessThanOrEqual(640)
    // The shelf and the desk stand on the floor, four art pixels into it.
    expect(r.shelfTop + SHELF.h * r.k).toBe((r.wall + 4) * r.k)
    expect(r.deskTop + DESK.h * r.k).toBe((r.wall + 4) * r.k)
    // The cards hang between them and never reach the desk.
    expect(r.cards.left).toBeGreaterThanOrEqual(r.shelf + SHELF.w * r.k)
    expect(r.cards.left + r.cards.width).toBeLessThanOrEqual(r.desk)
    expect(r.cards.width).toBeGreaterThanOrEqual(ROOM.cardsFit)
    // One row of cards per bay, level with it.
    r.cards.rows.forEach((row, i) => expect(row).toEqual({ top: r.shelfTop + BAYS[i][1] * r.k, height: BAYS[i][3] * r.k }))
  })

  it('shrinks the room for a short or narrow tab, and gives the cards their own place when it cannot fit them', () => {
    expect(roomLayout(1180, 450, false)!.k).toBe(5)
    expect(roomLayout(900, 900, false)!.k).toBe(4)
    expect(roomLayout(700, 900, false)).toBeNull()
    expect(roomLayout(1180, 300, false)).toBeNull()
    const clerk = roomLayout(1400, 700, true)!
    expect(clerk.clerk! + CLERK.w * clerk.k).toBeLessThanOrEqual(clerk.shelf)
  })

  it('lets the wall grow above the shelf in a tall tab, within reason', () => {
    const r = roomLayout(1180, 2000, false)!
    expect(r.wall - (SHELF.h - 4)).toBe(ROOM.aboveMax)
  })
})
