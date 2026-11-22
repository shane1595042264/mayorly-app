// GTA's death is the word WASTED, read off the stream. The eye cuts the middle of each frame
// (WORD_BOX of the 320x180 frame it already draws) into two one-bit masks: near-white pixels
// (WASTED over the red wash) and bright red ones (WASTED in red on black, the beat after). Here a
// mask's letters are found (pieces that sit on one line, close together), the row is scaled to
// WORD_COLS x WORD_ROWS and compared with the shapes of the words GTA shows in that place, taken
// from real frames: WASTED, and the two it must not be taken for, FAILED (a mission failed, on the
// same red wash) and BUSTED. No imports, so the same code can be run on a page to tune it.

/** The middle of the 320x180 frame, where GTA writes its word: x 20% to 80%, y 30% to 70%. */
export const WORD_BOX = { x: 0.2, y: 0.3, w: 0.6, h: 0.4 } as const
export const WORD_W = 192
export const WORD_H = 72
/** A mask's size in bytes: one bit a pixel, row by row, the first pixel in the top bit. */
export const WORD_BYTES = (WORD_W * WORD_H) / 8

export const WORD_COLS = 40
export const WORD_ROWS = 10

export type WordName = 'wasted' | 'failed' | 'busted'

/**
 * The words' shapes at WORD_COLS x WORD_ROWS, '#' for ink: each the majority of the shapes this
 * reader took from real GTA 6 frames on YouTube (WASTED from eight deaths of a compilation, white
 * on the red wash and red on black alike; BUSTED and FAILED from a clip of the three screens). The
 * three overlap by about 0.75 with each other; a real WASTED scored 0.91 or more with its own on
 * every frame of 67 deaths.
 */
export const WORD_SHAPES: Record<WordName, readonly string[]> = {
  wasted: [
    '......................................##',
    '......................................##',
    '##.###.##.#####.#####.######.#####.#####',
    '##.###.##.#####.############.#####.#####',
    '######.##....##.##....###....##.##.##.##',
    '#########.#####.#####..##.##.#####.##.##',
    '#########.#####.#####..#####.#####.##.##',
    '.########.##.##....##..#####.##....##.##',
    '.###.###..#####.#####..#####.#####.#####',
    '.###.###..#####.#####..#####.#####.#####',
  ],
  failed: [
    '.....................................###',
    '.....................................###',
    '######.######..###.##.....######.#######',
    '######.#######.###.##....#######.#######',
    '######.....###.##..##....###.###.#######',
    '######.#######.###.##....#######.#######',
    '####...#######.###.##....#######.#######',
    '###....###.###.###.##....###.....#######',
    '###....#######.###.#####.#######.#######',
    '###....#######.###.#####.#######.#######',
  ],
  busted: [
    '###..................................###',
    '###..................................###',
    '######.##.###.#####.######..#####.######',
    '######.##.###.#####.######.######.######',
    '###.##.##.###.##....####...###.##.##.###',
    '###.##.##.###.#####..##.##.######.##.###',
    '###.##.##.###.#####..##.##.######.##.###',
    '###.##.##.###..#.##..##.##.###.##.##.###',
    '######.######.#####..#####.######.######',
    '######.######.#####..#####.######.######',
  ],
}

export const WORD = {
  /** Ink in the mask: fewer pixels is nothing, more is a wash, not a word. */
  minInk: 60,
  maxInk: 0.45,
  /** A letter: at least this many pixels and this tall. */
  minArea: 6,
  minHeight: 4,
  /** Pieces on one line overlap vertically by half the smaller one's height. */
  lineOverlap: 0.5,
  /** Letters of one word are closer than this many times the line's median letter height. */
  gap: 0.6,
  /** A word: 3 to 10 pieces (compression can join two letters), wide like one, tall enough to read. */
  minLetters: 3,
  maxLetters: 10,
  minAspect: 2.5,
  maxAspect: 8,
  minRowPx: 8,
  /**
   * WASTED: its shape's Dice score at least `min`, ahead of FAILED and BUSTED by `margin`. The
   * score keeps everything else out (the most any play scored in hours of GTA 6 footage was 0.78);
   * FAILED and BUSTED are never closest to WASTED, even 1 px fatter or scaled down, so the lead can
   * be small, which keeps a WASTED whose letters came out a pixel fatter (a shrunk layout, blur).
   */
  min: 0.85,
  margin: 0.05,
} as const

export interface WordRead {
  word: WordName | null
  /** Dice score of the best shape, and of the next best. */
  score: number
  next: number
  letters: number
  box: { x: number; y: number; w: number; h: number }
}

/** One bit a pixel, unpacked to 0 and 1. */
export function unpackMask(bits: Uint8Array, w = WORD_W, h = WORD_H): Uint8Array {
  const px = new Uint8Array(w * h)
  for (let i = 0; i < px.length; i++) px[i] = (bits[i >> 3] >> (7 - (i & 7))) & 1
  return px
}

export function packMask(px: Uint8Array): Uint8Array {
  const bits = new Uint8Array(Math.ceil(px.length / 8))
  for (let i = 0; i < px.length; i++) if (px[i]) bits[i >> 3] |= 1 << (7 - (i & 7))
  return bits
}

interface Piece {
  id: number
  x0: number
  x1: number
  y0: number
  y1: number
  area: number
}

/** The mask's connected pieces (8 neighbours), and a map of which piece each pixel is in. */
function pieces(px: Uint8Array, w: number, h: number): { list: Piece[]; label: Int32Array } {
  const label = new Int32Array(w * h).fill(-1)
  const stack = new Int32Array(w * h)
  const list: Piece[] = []
  for (let s = 0; s < px.length; s++) {
    if (!px[s] || label[s] !== -1) continue
    const p: Piece = { id: list.length, x0: w, x1: -1, y0: h, y1: -1, area: 0 }
    let top = 0
    stack[top++] = s
    label[s] = p.id
    while (top) {
      const i = stack[--top]
      const x = i % w
      const y = (i - x) / w
      p.area++
      if (x < p.x0) p.x0 = x
      if (x > p.x1) p.x1 = x
      if (y < p.y0) p.y0 = y
      if (y > p.y1) p.y1 = y
      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy
        if (yy < 0 || yy >= h) continue
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx
          if (xx < 0 || xx >= w) continue
          const j = yy * w + xx
          if (px[j] && label[j] === -1) {
            label[j] = p.id
            stack[top++] = j
          }
        }
      }
    }
    list.push(p)
  }
  return { list, label }
}

const heightOf = (p: Piece) => p.y1 - p.y0 + 1
const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b)
  return s[s.length >> 1]
}

/** Rows of letters: pieces that sit on one line, split into words where the gap is wide. */
function words(list: Piece[], w: number, h: number): Piece[][] {
  const fit = list.filter((p) => p.area >= WORD.minArea && heightOf(p) >= WORD.minHeight && heightOf(p) <= 0.8 * h && p.x1 - p.x0 + 1 <= 0.5 * w)
  const lines: { y0: number; y1: number; ps: Piece[] }[] = []
  for (const p of [...fit].sort((a, b) => b.area - a.area)) {
    const line = lines.find((l) => Math.min(l.y1, p.y1) - Math.max(l.y0, p.y0) + 1 >= WORD.lineOverlap * Math.min(heightOf(p), l.y1 - l.y0 + 1))
    if (line) {
      line.ps.push(p)
      line.y0 = Math.min(line.y0, p.y0)
      line.y1 = Math.max(line.y1, p.y1)
    } else lines.push({ y0: p.y0, y1: p.y1, ps: [p] })
  }
  const out: Piece[][] = []
  for (const l of lines) {
    const ps = l.ps.sort((a, b) => a.x0 - b.x0)
    const gap = WORD.gap * median(ps.map(heightOf))
    let cur: Piece[] = []
    let right = -Infinity
    for (const p of ps) {
      if (cur.length && p.x0 - right - 1 > gap) {
        out.push(cur)
        cur = []
      }
      cur.push(p)
      right = Math.max(right, p.x1)
    }
    if (cur.length) out.push(cur)
  }
  return out
}

/** A word's ink, only its own pieces, scaled to WORD_COLS x WORD_ROWS: 1 where half a cell or more is ink. */
export function shapeOf(px: Uint8Array, label: Int32Array, w: number, ps: Piece[]): { shape: Uint8Array; box: WordRead['box'] } {
  const x0 = Math.min(...ps.map((p) => p.x0))
  const x1 = Math.max(...ps.map((p) => p.x1))
  const y0 = Math.min(...ps.map((p) => p.y0))
  const y1 = Math.max(...ps.map((p) => p.y1))
  const ids = new Set(ps.map((p) => p.id))
  const bw = x1 - x0 + 1
  const bh = y1 - y0 + 1
  const shape = new Uint8Array(WORD_COLS * WORD_ROWS)
  for (let r = 0; r < WORD_ROWS; r++) {
    const ya = y0 + (r * bh) / WORD_ROWS
    const yb = y0 + ((r + 1) * bh) / WORD_ROWS
    for (let c = 0; c < WORD_COLS; c++) {
      const xa = x0 + (c * bw) / WORD_COLS
      const xb = x0 + ((c + 1) * bw) / WORD_COLS
      // Area-weighted: each source pixel counts for the part of it inside the cell.
      let ink = 0
      let all = 0
      for (let y = Math.floor(ya); y < Math.ceil(yb); y++) {
        const fy = Math.min(yb, y + 1) - Math.max(ya, y)
        if (fy <= 0) continue
        for (let x = Math.floor(xa); x < Math.ceil(xb); x++) {
          const fx = Math.min(xb, x + 1) - Math.max(xa, x)
          if (fx <= 0) continue
          const a = fx * fy
          all += a
          const i = y * w + x
          if (px[i] && ids.has(label[i])) ink += a
        }
      }
      shape[r * WORD_COLS + c] = all > 0 && ink / all >= 0.5 ? 1 : 0
    }
  }
  return { shape, box: { x: x0, y: y0, w: bw, h: bh } }
}

const shapes = (() => {
  const out: [WordName, Uint8Array][] = []
  for (const name of Object.keys(WORD_SHAPES) as WordName[]) {
    const rows = WORD_SHAPES[name]
    if (rows.length !== WORD_ROWS) continue
    const s = new Uint8Array(WORD_COLS * WORD_ROWS)
    rows.forEach((row, r) => {
      for (let c = 0; c < WORD_COLS; c++) s[r * WORD_COLS + c] = row[c] === '#' ? 1 : 0
    })
    out.push([name, s])
  }
  return out
})()

/** Dice: twice the shared ink over the ink of both. */
export function dice(a: Uint8Array, b: Uint8Array): number {
  let both = 0
  let na = 0
  let nb = 0
  for (let i = 0; i < a.length; i++) {
    both += a[i] & b[i]
    na += a[i]
    nb += b[i]
  }
  return na + nb ? (2 * both) / (na + nb) : 0
}

/**
 * The runs of a row worth reading: the whole row, and the row with one or two pieces dropped from
 * either end, so a blob of light beside the word (scenery, an overlay) does not spoil it.
 */
function runs(ps: Piece[]): Piece[][] {
  const out: Piece[][] = []
  for (let drop = 0; drop <= Math.min(2, ps.length - WORD.minLetters); drop++)
    for (let left = 0; left <= drop; left++) {
      const run = ps.slice(left, ps.length - (drop - left))
      if (run.length >= WORD.minLetters && run.length <= WORD.maxLetters) out.push(run)
    }
  return out
}

/** Every word-like run in the mask, with its scaled shape: for reading, and for tuning the shapes. */
export function wordShapes(bits: Uint8Array, w = WORD_W, h = WORD_H): { shape: Uint8Array; box: WordRead['box']; letters: number }[] {
  const px = unpackMask(bits, w, h)
  let ink = 0
  for (let i = 0; i < px.length; i++) ink += px[i]
  if (ink < WORD.minInk || ink > WORD.maxInk * w * h) return []
  const { list, label } = pieces(px, w, h)
  const out: { shape: Uint8Array; box: WordRead['box']; letters: number }[] = []
  for (const row of words(list, w, h)) {
    for (const ps of runs(row)) {
      const { shape, box } = shapeOf(px, label, w, ps)
      const aspect = box.w / box.h
      if (box.h < WORD.minRowPx || aspect < WORD.minAspect || aspect > WORD.maxAspect) continue
      out.push({ shape, box, letters: ps.length })
    }
  }
  return out
}

/** The best word in a mask: which of GTA's words its shape is closest to, and how close. Null when none is word-like. */
export function readWord(bits: Uint8Array, w = WORD_W, h = WORD_H): WordRead | null {
  let best: WordRead | null = null
  for (const c of wordShapes(bits, w, h)) {
    const scored = shapes.map(([name, s]) => ({ name, d: dice(c.shape, s) })).sort((a, b) => b.d - a.d)
    if (!scored.length) continue
    const r: WordRead = { word: scored[0].name, score: scored[0].d, next: scored[1]?.d ?? 0, letters: c.letters, box: c.box }
    if (!best || r.score > best.score) best = r
  }
  return best
}

/** WASTED, read with confidence: its shape close enough, and clearly not FAILED or BUSTED. */
export function isWasted(r: WordRead | null): boolean {
  return !!r && r.word === 'wasted' && r.score >= WORD.min && r.score - r.next >= WORD.margin
}

/** A shape as rows of '#' and '.', to write the shapes down and to log. */
export function shapeRows(shape: Uint8Array): string[] {
  const rows: string[] = []
  for (let r = 0; r < WORD_ROWS; r++) {
    let s = ''
    for (let c = 0; c < WORD_COLS; c++) s += shape[r * WORD_COLS + c] ? '#' : '.'
    rows.push(s)
  }
  return rows
}
