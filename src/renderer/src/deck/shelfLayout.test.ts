import { describe, expect, it } from 'vitest'
import { BASE, BAYS, CLERK, DESK, PER_BAY, placeFurniture, SCENE, SHELF, SPINE, spineAt, TILE, WALL_STEP, wallRows } from './shelfLayout'

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
})
