import { readFileSync } from 'node:fs'
import { gunzipSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import EYE from '../main/stream-eye.js?raw'
import { FRAME_H, FRAME_W, streamPostOf, wordSight } from './streamdeath'
import { isWasted, packMask, readWord, unpackMask, WORD, WORD_BYTES, WORD_COLS, WORD_H, WORD_ROWS, WORD_SHAPES, WORD_W, type WordName } from './streamword'
import { WORD_FRAMES } from './streamword.fixtures'

// The extension's own mask function, the very one it ships, run on frames painted here.
const mayorlyWord = new Function(`${EYE}\nreturn mayorlyWord`)() as (data: Uint8ClampedArray, w: number, h: number) => { white: Uint8Array; red: Uint8Array; nw: number; nr: number }

/** A word's shape scaled up to w x h (nearest), as ink in a WORD_W x WORD_H mask at (x, y). */
function inked(name: WordName, x: number, y: number, w: number, h: number): Uint8Array {
  const px = new Uint8Array(WORD_W * WORD_H)
  const rows = WORD_SHAPES[name]
  for (let yy = 0; yy < h; yy++)
    for (let xx = 0; xx < w; xx++) {
      const c = Math.min(WORD_COLS - 1, Math.floor((xx * WORD_COLS) / w))
      const r = Math.min(WORD_ROWS - 1, Math.floor((yy * WORD_ROWS) / h))
      if (rows[r][c] === '#') px[(y + yy) * WORD_W + x + xx] = 1
    }
  return px
}

/** A 320x180 frame: a background, with the word's ink painted in a colour where GTA puts it. */
function frame(name: WordName, bg: [number, number, number], ink: [number, number, number], scale = 1): Uint8ClampedArray {
  const data = new Uint8ClampedArray(FRAME_W * FRAME_H * 4)
  const w = Math.round(110 * scale)
  const h = Math.round(25 * scale)
  const mask = inked(name, Math.round((WORD_W - w) / 2), Math.round((WORD_H - h) / 2), w, h)
  const x0 = Math.round(0.2 * FRAME_W)
  const y0 = Math.round(0.3 * FRAME_H)
  for (let y = 0; y < FRAME_H; y++)
    for (let x = 0; x < FRAME_W; x++) {
      const i = (y * FRAME_W + x) * 4
      const inBox = x >= x0 && x < x0 + WORD_W && y >= y0 && y < y0 + WORD_H
      const on = inBox && mask[(y - y0) * WORD_W + (x - x0)]
      // The world under the wash still has texture: a little light that varies.
      const n = ((x * 7 + y * 13) % 23) - 11
      const c = on ? ink : [bg[0] + n, bg[1] + n / 3, bg[2] + n / 3]
      data[i] = c[0]
      data[i + 1] = c[1]
      data[i + 2] = c[2]
      data[i + 3] = 255
    }
  return data
}

const RED_WASH: [number, number, number] = [150, 28, 30]
const WHITE: [number, number, number] = [248, 247, 247]
const BLACK: [number, number, number] = [3, 2, 2]
const SALMON: [number, number, number] = [214, 64, 62]
const BLUE_WASH: [number, number, number] = [30, 60, 150]

describe('the masks', () => {
  it('pack one bit a pixel, the first pixel in the top bit, and unpack the same', () => {
    const px = new Uint8Array(WORD_W * WORD_H)
    px[0] = 1
    px[9] = 1
    px[px.length - 1] = 1
    const bits = packMask(px)
    expect(bits.length).toBe(WORD_BYTES)
    expect(bits[0]).toBe(0b10000000)
    expect(bits[1]).toBe(0b01000000)
    expect(unpackMask(bits)).toEqual(px)
  })

  it('come from the eye as the middle of the frame: white ink over the red wash, red ink on black', () => {
    const a = mayorlyWord(frame('wasted', RED_WASH, WHITE), FRAME_W, FRAME_H)
    expect(a.white.length).toBe(WORD_BYTES)
    expect(a.nw).toBeGreaterThan(1000)
    // A bright wash is red light too: as a mask it is a wash, not a word.
    expect(readWord(a.red)).toBeNull()
    const b = mayorlyWord(frame('wasted', BLACK, SALMON), FRAME_W, FRAME_H)
    expect(b.nw).toBe(0)
    expect(b.nr).toBeGreaterThan(1000)
  })
})

describe('reading the word', () => {
  it('reads WASTED, white on the wash and red on black, at the size GTA writes it and smaller', () => {
    for (const [bg, ink] of [
      [RED_WASH, WHITE],
      [BLACK, SALMON],
    ] as const) {
      for (const scale of [1, 0.75, 1.3]) {
        const m = mayorlyWord(frame('wasted', bg, ink, scale), FRAME_W, FRAME_H)
        const r = readWord(m.nw ? m.white : m.red)
        expect(r?.word).toBe('wasted')
        expect(isWasted(r)).toBe(true)
      }
    }
  })

  it('tells FAILED and BUSTED from WASTED', () => {
    const failed = readWord(mayorlyWord(frame('failed', RED_WASH, WHITE), FRAME_W, FRAME_H).white)
    expect(failed?.word).toBe('failed')
    expect(isWasted(failed)).toBe(false)
    const busted = readWord(mayorlyWord(frame('busted', BLUE_WASH, WHITE), FRAME_W, FRAME_H).white)
    expect(busted?.word).toBe('busted')
    expect(isWasted(busted)).toBe(false)
  })

  it('reads nothing in an empty mask, a wash of ink, a lone blob or scattered dots', () => {
    expect(readWord(new Uint8Array(WORD_BYTES))).toBeNull()
    expect(readWord(new Uint8Array(WORD_BYTES).fill(255))).toBeNull()
    const blob = new Uint8Array(WORD_W * WORD_H)
    for (let y = 20; y < 50; y++) for (let x = 60; x < 130; x++) blob[y * WORD_W + x] = 1
    expect(readWord(packMask(blob))).toBeNull()
    const dots = new Uint8Array(WORD_W * WORD_H)
    for (let i = 0; i < dots.length; i += 37) dots[i] = 1
    expect(readWord(packMask(dots))).toBeNull()
  })

  it('needs a clear lead: a shape halfway between two words is not WASTED', () => {
    expect(isWasted({ word: 'wasted', score: 0.97, next: 0.76, letters: 6, box: { x: 0, y: 0, w: 1, h: 1 } })).toBe(true)
    expect(isWasted({ word: 'wasted', score: 0.84, next: 0.7, letters: 6, box: { x: 0, y: 0, w: 1, h: 1 } })).toBe(false)
    expect(isWasted({ word: 'wasted', score: 0.9, next: 0.86, letters: 6, box: { x: 0, y: 0, w: 1, h: 1 } })).toBe(false)
    expect(isWasted({ word: 'failed', score: 1, next: 0.76, letters: 7, box: { x: 0, y: 0, w: 1, h: 1 } })).toBe(false)
    expect(isWasted(null)).toBe(false)
    expect(WORD.min).toBeGreaterThan(0.8)
  })
})

describe('real GTA 6 frames', () => {
  const mask = (b64: string) => new Uint8Array(gunzipSync(Buffer.from(b64, 'base64')))

  it('are masks of the right size', () => {
    expect(WORD_FRAMES.length).toBeGreaterThanOrEqual(8)
    for (const f of WORD_FRAMES) expect(mask(f.mask).length, f.what).toBe(WORD_BYTES)
  })

  it('still read WASTED a pixel fatter, or with the game drawn smaller (a facecam beside it), and FAILED and BUSTED still never do', () => {
    const fatter = (px: Uint8Array) => {
      const o = px.slice()
      for (let i = 0; i < px.length; i++) if (px[i] && (i + 1) % WORD_W) o[i + 1] = 1
      return o
    }
    // Sampled smaller about the middle, each pixel the majority of the source under it.
    const smaller = (px: Uint8Array, s: number) => {
      const o = new Uint8Array(px.length)
      for (let y = 0; y < WORD_H; y++)
        for (let x = 0; x < WORD_W; x++) {
          let ink = 0
          let all = 0
          for (let dy = 0; dy < 4; dy++)
            for (let dx = 0; dx < 4; dx++) {
              const sx = Math.floor((x + dx / 4 - WORD_W / 2) / s + WORD_W / 2)
              const sy = Math.floor((y + dy / 4 - WORD_H / 2) / s + WORD_H / 2)
              all++
              if (sx >= 0 && sx < WORD_W && sy >= 0 && sy < WORD_H) ink += px[sy * WORD_W + sx]
            }
          o[y * WORD_W + x] = ink * 2 >= all ? 1 : 0
        }
      return o
    }
    for (const f of WORD_FRAMES.filter((x) => x.word !== 'none')) {
      const px = unpackMask(mask(f.mask))
      for (const [how, v] of [
        ['fatter', fatter(px)],
        ['at 0.8', smaller(px, 0.8)],
      ] as const) {
        const r = readWord(packMask(v))
        expect(isWasted(r), `${f.what}, ${how}: ${r ? `${r.word} ${r.score.toFixed(2)}/${r.next.toFixed(2)}` : 'nothing'}`).toBe(f.word === 'wasted')
      }
    }
  })

  it('read as what they show: WASTED fires, FAILED, BUSTED and play never do', () => {
    for (const f of WORD_FRAMES) {
      const r = readWord(mask(f.mask))
      expect(isWasted(r), `${f.what}: ${r ? `${r.word} ${r.score.toFixed(2)}/${r.next.toFixed(2)}` : 'nothing'}`).toBe(f.word === 'wasted')
      if (f.word !== 'none') expect(r?.word, f.what).toBe(f.word)
    }
  })
})

describe('a frame of a GTA stream', () => {
  const mask = (b64: string) => new Uint8Array(gunzipSync(Buffer.from(b64, 'base64')))
  const shown = (word: string) => WORD_FRAMES.find((f) => f.word === word)!

  it('is read from either mask, and only WASTED makes it a death', () => {
    const wasted = wordSight({ white: mask(shown('wasted').mask), red: null })
    expect(wasted.wasted).toBe(true)
    expect(wasted.seen).toMatch(/^word wasted (0\.9\d|1\.00) \(next 0\.\d\d\)/)
    expect(wordSight({ white: null, red: mask(shown('wasted').mask) }).wasted).toBe(true)
    const failed = wordSight({ white: mask(shown('failed').mask), red: null })
    expect(failed.wasted).toBe(false)
    expect(failed.seen).toMatch(/^word failed/)
    expect(wordSight({ white: mask(shown('none').mask), red: mask(shown('busted').mask) }).wasted).toBe(false)
  })

  it('arrives as the eye posts it: its version, and the masks with a frame', () => {
    const g = new Uint8Array(576)
    const b64 = (a: Uint8Array) => Buffer.from(a).toString('base64')
    const m = mayorlyWord(frame('wasted', RED_WASH, WHITE), FRAME_W, FRAME_H)
    const base = { v: 1, tab: '7:0', site: 'twitch', title: 'xQc - Twitch', category: 'Grand Theft Auto VI', visible: true, active: true, area: 5, ad: false, cost: 4, grid: { c: b64(g), l: b64(g), t: b64(g) } }
    const p = streamPostOf({ ...base, eye: 2, kind: 'frame', word: { w: b64(m.white), r: null } })!
    expect(p.eye).toBe(2)
    expect(p.word?.white?.length).toBe(WORD_BYTES)
    expect(p.word?.red).toBeNull()
    expect(wordSight(p.word).wasted).toBe(true)
    // An eye older than words says no version; a mask of the wrong size is dropped, the frame kept;
    // a hello carries no words.
    expect(streamPostOf({ ...base, kind: 'frame' })!.eye).toBe(1)
    const bad = streamPostOf({ ...base, eye: 2, kind: 'frame', word: { w: b64(new Uint8Array(100)), r: 'x' } })!
    expect(bad.word).toBeNull()
    expect(bad.grid).not.toBeNull()
    expect(streamPostOf({ ...base, eye: 2, kind: 'hello', word: { w: b64(m.white), r: null } })!.word).toBeNull()
  })
})

describe('the CI stream page', () => {
  it('draws the words GTA writes from the same shapes the reader holds', () => {
    const page = readFileSync(new URL('../../scripts/e2e-stream.html', import.meta.url), 'utf8')
    for (const name of ['wasted', 'failed'] as const) {
      const block = page.match(new RegExp(`${name}: \\[([^\\]]+)\\]`))
      expect(block, name).not.toBeNull()
      expect(block![1].match(/[.#]{40}/g), name).toEqual([...WORD_SHAPES[name]])
    }
  })
})
