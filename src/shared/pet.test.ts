import { describe, expect, it } from 'vitest'
import { anchorInBox, captionBox, clampAnchor, drawerBox, homeAnchor, petBox, sideOf, type Point, type Rect } from './pet'

// The Mac pet window's geometry as overlay.ts computed it before it moved here, kept verbatim
// so the shared functions are held to it: the Mac must not move by a pixel.
const legacy = {
  PET: { width: 140 + 10 + 48, height: 48 + 24 },
  TASK_LINES: 2 * 12 * 1.15,
  INSET: { x: 4, y: 4 },
  DRAWER: { width: 340, height: 360 },
  CAPTION: { width: 360, height: 40 },
  TOMATO: 48,
  half: (scale: number) => (48 / 2) * scale,
  side(wa: Rect, a: Point) {
    return a.x < wa.x + wa.width / 2 ? 'left' : 'right'
  },
  defaultAnchor(wa: Rect, scale: number): Point {
    return { x: wa.x + wa.width - 64 - this.half(scale), y: wa.y + wa.height - 28 }
  },
  clampAnchor(a: Point, wa: Rect, scale: number): Point {
    const mx = this.INSET.x + this.half(scale)
    return {
      x: Math.min(Math.max(a.x, wa.x + mx), wa.x + wa.width - mx),
      y: Math.min(Math.max(a.y, wa.y + this.INSET.y + this.TOMATO * scale), wa.y + wa.height - this.INSET.y),
    }
  },
  fieldBounds(wa: Rect, a: Point, scale: number, text: number): Rect {
    const petHeight = this.PET.height + Math.ceil(this.TASK_LINES * (text - 1))
    const size = { width: Math.ceil(this.PET.width * scale) + this.INSET.x * 2, height: Math.ceil(petHeight * scale) + this.INSET.y * 2 }
    const x = this.side(wa, a) === 'right' ? a.x + this.half(scale) + this.INSET.x - size.width : a.x - this.half(scale) - this.INSET.x
    const y = a.y + this.INSET.y - size.height
    return {
      x: Math.round(Math.min(Math.max(x, wa.x), wa.x + wa.width - size.width)),
      y: Math.round(Math.min(Math.max(y, wa.y), wa.y + wa.height - size.height)),
      width: size.width,
      height: size.height,
    }
  },
  caption(wa: Rect, a: Point, scale: number): Rect {
    const side = this.side(wa, a)
    const box = 30
    const gap = 10
    const top = a.y - this.TOMATO * scale
    const x = side === 'left' ? a.x - this.half(scale) - 4 : a.x + this.half(scale) + 4 - this.CAPTION.width
    let y = top - gap - box - (this.CAPTION.height - box) / 2
    if (y < wa.y) y = a.y + gap - (this.CAPTION.height - box) / 2
    return {
      x: Math.round(Math.min(Math.max(x, wa.x), wa.x + wa.width - this.CAPTION.width)),
      y: Math.round(Math.min(Math.max(y, wa.y), wa.y + wa.height - this.CAPTION.height)),
      ...this.CAPTION,
    }
  },
  drawer(wa: Rect, a: Point, scale: number, text: number): Rect {
    const pet = this.fieldBounds(wa, a, scale, text)
    const gap = 4
    const below = pet.y + pet.height + gap + this.DRAWER.height <= wa.y + wa.height
    const x = this.side(wa, a) === 'right' ? pet.x + pet.width - this.DRAWER.width : pet.x
    const y = below ? pet.y + pet.height + gap : pet.y - gap - this.DRAWER.height
    return {
      x: Math.round(Math.min(Math.max(x, wa.x), wa.x + wa.width - this.DRAWER.width)),
      y: Math.round(Math.min(Math.max(y, wa.y), wa.y + wa.height - this.DRAWER.height)),
      width: this.DRAWER.width,
      height: this.DRAWER.height,
    }
  },
  moved(b: Rect, wa: Rect, a: Point, scale: number): Point {
    const side = this.side(wa, a)
    return {
      x: side === 'right' ? b.x + b.width - this.INSET.x - this.half(scale) : b.x + this.INSET.x + this.half(scale),
      y: b.y + b.height - this.INSET.y,
    }
  },
}

const areas: Rect[] = [
  { x: 0, y: 25, width: 1440, height: 875 },
  { x: -1920, y: 0, width: 1920, height: 1040 },
  { x: 0, y: 0, width: 3840, height: 2110 },
]
const scales = [0.7, 1, 1.35, 1.6]
const texts = [0.8, 1, 1.25, 1.6]

function* cases() {
  for (const wa of areas) {
    for (const scale of scales) {
      for (const text of texts) {
        // Corners, edges, the middle, and points off the area that the clamp must pull back.
        for (const fx of [-0.1, 0, 0.02, 0.3, 0.5, 0.51, 0.9, 0.99, 1, 1.1]) {
          for (const fy of [-0.1, 0, 0.03, 0.5, 0.97, 1, 1.1]) {
            yield { wa, scale, text, a: { x: wa.x + wa.width * fx, y: wa.y + wa.height * fy } }
          }
        }
      }
    }
  }
}

describe('pet geometry matches the Mac pet window', () => {
  it('home, clamp, side, box, caption, drawer and the settled anchor', () => {
    let n = 0
    for (const { wa, scale, text, a } of cases()) {
      expect(homeAnchor(wa, scale)).toEqual(legacy.defaultAnchor(wa, scale))
      expect(clampAnchor(a, wa, scale)).toEqual(legacy.clampAnchor(a, wa, scale))
      const c = clampAnchor(a, wa, scale)
      const side = sideOf(wa, c)
      expect(side).toBe(legacy.side(wa, c))
      const box = petBox(c, wa, scale, text)
      expect(box).toEqual(legacy.fieldBounds(wa, c, scale, text))
      const { below: _below, ...cap } = captionBox(c, wa, side, scale)
      expect(cap).toEqual(legacy.caption(wa, c, scale))
      expect(drawerBox(box, wa, side)).toEqual(legacy.drawer(wa, c, scale, text))
      expect(anchorInBox(box, side, scale)).toEqual(legacy.moved(box, wa, c, scale))
      n++
    }
    expect(n).toBeGreaterThan(3000)
  })

  it('puts a first-run pet on the left when asked', () => {
    const wa = { x: 0, y: 0, width: 1920, height: 1040 }
    const a = homeAnchor(wa, 1, 'left')
    expect(sideOf(wa, a)).toBe('left')
    expect(a).toEqual({ x: 64 + 24, y: 1040 - 28 })
  })

  it('flips the caption below the tomato when the top of the area is in the way', () => {
    const wa = { x: 0, y: 0, width: 1920, height: 1040 }
    expect(captionBox({ x: 1800, y: 1000 }, wa, 'right', 1).below).toBe(false)
    expect(captionBox({ x: 1800, y: 60 }, wa, 'right', 1).below).toBe(true)
  })
})
