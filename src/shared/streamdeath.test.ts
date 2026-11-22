import { writeFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { onDeskId, reduce, sampleState, type Action, type MayorlyState } from '../core/index'
import EYE from '../main/stream-eye.js?raw'
import {
  cellsIn,
  CELLS,
  deathStep,
  FRAME_H,
  FRAME_W,
  gameOf,
  graceStep,
  LEAGUE,
  leagueFeatures,
  leagueOf,
  leagueStep,
  learningWhy,
  pickTab,
  REGION,
  streamArm,
  streamPostOf,
  watchedCues,
  isWatched,
  leftStream,
  openStep,
  type DeathMemory,
  type DeathTick,
  type LeagueFeatures,
  type StreamGrid,
  type TabSeen,
  type WordMemory,
  type WordSight,
  wordSight,
  wordStep,
} from './streamdeath'

const now = Date.parse('2026-11-22T15:00:00Z')

// The extension's own grid, the very function it ships, run on frames painted here.
const mayorlyGrid = new Function(`${EYE}\nreturn mayorlyGrid`)() as (data: Uint8ClampedArray, w: number, h: number) => StreamGrid

// ---------------------------------------------------------------------------------------------
// A painted League stream: a moving, coloured world; the minimap in a corner, still and coloured;
// the ability bar bottom centre; a webcam; a chat column. Each part can go grey, dim or dark.

interface Scene {
  /** How much of the world's colour is left: 1 alive, about 0.3 dead. */
  world?: number
  /** The world's brightness, 1 as usual; 0.05 is a fade to black. */
  light?: number
  /** The ability bar: lit, dimmed (dead, or cooldowns), dark (dead on a darker death screen) or covered by an overlay of no colour. */
  bar?: 'lit' | 'dim' | 'dark' | 'covered'
  /** Where the minimap is, or none; grey turns its colour off. */
  map?: 'right' | 'left' | 'none'
  mapGrey?: boolean
  /** Another scene in the corner (the client, a break card): a different picture where the minimap was. */
  mapOther?: boolean
  /** A coloured webcam over the lower left quarter of the world. */
  cam?: boolean
  /** The Tab scoreboard, in colour, over the middle of a grey world. */
  scoreboard?: boolean
  /** A paler map: less colour to begin with (about 30 against 38). */
  snow?: boolean
  /** A still picture: the world does not move. */
  still?: boolean
  /** A small minimap (Minimap Scale turned down), with world around it in the corner. */
  mapSmall?: boolean
  /** A still, coloured logo in the bottom left corner (an overlay), the minimap on the right. */
  logoLeft?: boolean
  /** A bright white page over the world (an alt-tab to a browser). */
  white?: boolean
  /** A flat window of this brightness over most of the world (a dark app alt-tabbed to), the HUD and minimap still showing. */
  panel?: number
  /** A black and white clip over the world and the bar, the minimap and webcam still showing. */
  clip?: boolean
}

/** A colour wheel: for each of 256 hues, how far red, green and blue sit from the grey. */
const HUE = new Float32Array(256 * 3)
for (let k = 0; k < 256; k++) {
  const a = (k / 256) * 2 * Math.PI
  HUE[k * 3] = Math.cos(a)
  HUE[k * 3 + 1] = Math.cos(a - 2.094)
  HUE[k * 3 + 2] = Math.cos(a + 2.094)
}

function paint(scene: Scene, t: number): Uint8ClampedArray {
  const { world = 1, light = 1, bar = 'lit', map = 'right', cam = false, scoreboard = false, snow = false, still = false } = scene
  const px = new Uint8ClampedArray(FRAME_W * FRAME_H * 4)
  const phase = still ? 0 : t / 500
  const k0 = snow ? 18 : 22
  const put = (x: number, y: number, g: number, k: number, h: number) => {
    const i = (y * FRAME_W + x) * 4
    const j = (Math.round((h / (2 * Math.PI)) * 256) & 255) * 3
    px[i] = g + k * HUE[j]
    px[i + 1] = g + k * HUE[j + 1]
    px[i + 2] = g + k * HUE[j + 2]
    px[i + 3] = 255
  }
  for (let y = 0; y < FRAME_H; y++) {
    for (let x = 0; x < FRAME_W; x++) {
      const fx = x / FRAME_W
      const fy = y / FRAME_H
      const inMap = map !== 'none' && (scene.mapSmall ? fy >= 0.83 && (map === 'right' ? fx >= 0.905 : fx <= 0.095) : fy >= 0.73 && (map === 'right' ? fx >= 0.855 : fx <= 0.145))
      const inLogo = scene.logoLeft && fy >= 0.73 && fx <= 0.145
      const inBar = fx >= 0.35 && fx <= 0.65 && fy >= 0.87
      const inCam = cam && fx >= 0.05 && fx <= 0.45 && fy >= 0.4 && fy <= 0.72
      const inBoard = scoreboard && fx >= 0.25 && fx <= 0.75 && fy >= 0.15 && fy <= 0.6
      const inChat = fx < 0.08 && fy > 0.2 && fy < 0.7
      if (inMap) {
        if (scene.mapOther) put(x, y, 160 + 60 * Math.sin(x * 0.3 + t / 300), 0, 0)
        else {
          // The minimap: a still checker of lanes and jungle, and one icon that moves.
          const checker = (Math.floor(x / 5) + Math.floor(y / 5)) % 2
          const dot = Math.abs(x - (280 + ((t / 100) % 30))) < 3 && Math.abs(y - 160) < 3
          put(x, y, dot ? 200 : 60 + 30 * checker, scene.mapGrey ? 0 : 20, x * 0.2 + y * 0.1)
        }
      } else if (inLogo) {
        put(x, y, 90 + 40 * ((Math.floor(x / 8) + Math.floor(y / 8)) % 2), 25, (x + y) * 0.05)
      } else if (inBar && scene.clip) {
        put(x, y, 100 + 50 * Math.sin(y * 0.4 + t / 300) * Math.sin(x * 0.02), 0, 0)
      } else if (inBar) {
        if (bar === 'covered') put(x, y, 50, 0, 0)
        // The HUD is drawn over the world: a darker world (night, fog) leaves it as it is.
        else put(x, y, bar === 'dark' ? 30 : bar === 'dim' ? 45 : 70, bar === 'dark' ? 7 : bar === 'dim' ? 13 : 24, x * 0.15)
      } else if (inBoard) put(x, y, 70, 24, x * 0.1 + y * 0.2)
      else if (inCam) put(x, y, 120 + 30 * Math.sin(x * 0.2 + t / 200), 30, y * 0.1 + t / 400)
      else if (inChat) put(x, y, 60 + (x % 3) * 20, 8, x)
      else if (scene.white) put(x, y, 235, 0, 0)
      else if (scene.panel !== undefined && fx >= 0.15 && fx <= 0.85 && fy >= 0.1 && fy <= 0.7) put(x, y, scene.panel, 0, 0)
      else {
        const g = 95 + 40 * Math.sin(x * 0.08 + phase) * Math.cos(y * 0.11 - phase * 0.7)
        put(x, y, g * light, k0 * world * light, x * 0.05 + y * 0.03 + phase * 0.3)
      }
    }
  }
  return px
}

const grid = (scene: Scene, t: number) => mayorlyGrid(paint(scene, t), FRAME_W, FRAME_H)

/** Feeds a timeline of scenes, a sample every `every` ms, as the shell does; returns each tick. */
function play(timeline: [number, Scene][], o: { every?: number; ad?: (t: number) => boolean; memory?: DeathMemory | null; from?: number } = {}) {
  const every = o.every ?? 500
  let memory = o.memory ?? null
  let prev: StreamGrid | null = null
  const ticks: (DeathTick & { t: number })[] = []
  let t = o.from ?? 0
  for (const [ms, scene] of timeline) {
    for (const end = t + ms; t < end; t += every) {
      const g = grid(scene, t)
      const tick = leagueStep(memory, leagueFeatures(g, prev, now + t), { ad: o.ad?.(t) ?? false }, now + t)
      prev = g
      memory = tick.memory
      ticks.push({ ...tick, t })
    }
  }
  return { ticks, memory, deaths: ticks.filter((x) => x.event === 'death').map((x) => x.t), events: ticks.filter((x) => x.event).map((x) => `${x.event}@${x.t}`) }
}

const alive: Scene = { cam: true }
const dead: Scene = { cam: true, world: 0.3, bar: 'dim' }

describe('the stream eye', () => {
  it('reads colour, brightness and light per cell, the function the extension ships', () => {
    const px = new Uint8ClampedArray(FRAME_W * FRAME_H * 4)
    for (let i = 0; i < px.length; i += 4) {
      const x = (i / 4) % FRAME_W
      // Left half red, right half mid grey; the bottom rows black.
      const y = Math.floor(i / 4 / FRAME_W)
      const [r, g, b] = y >= 170 ? [0, 0, 0] : x < 160 ? [200, 30, 30] : [120, 120, 120]
      px.set([r, g, b, 255], i)
    }
    const g = mayorlyGrid(px, FRAME_W, FRAME_H)
    expect(g.chroma.length).toBe(CELLS)
    expect(g.chroma[0]).toBe(170)
    expect(g.chroma[31]).toBe(0)
    expect(g.luma[31]).toBe(120)
    expect(g.lit[31]).toBe(255)
    expect(g.lit[17 * 32]).toBe(0)
    expect(g.chroma[17 * 32]).toBe(0)
  })

  it('cuts the frame into the world, the bar and the two minimap corners', () => {
    expect(cellsIn(REGION.world)).toHaveLength(312)
    expect(cellsIn(REGION.bar)).toHaveLength(16)
    expect(cellsIn(REGION.mapRight)).toHaveLength(20)
    expect(cellsIn(REGION.mapLeft)).toHaveLength(20)
  })

  it('paints a stream with the numbers measured on Twitch: about 38 alive, 11 dead, the minimap unchanged', () => {
    const a = leagueFeatures(grid(alive, 0), null, now)!
    const d = leagueFeatures(grid(dead, 0), null, now)!
    expect(a.w).toBeGreaterThan(30)
    expect(a.w).toBeLessThan(45)
    expect(d.w).toBeLessThan(15)
    expect(d.a).toBeLessThan(0.85 * a.a)
    expect(Math.abs(d.right.m - a.right.m)).toBeLessThan(2)
    expect(leagueFeatures(grid({ light: 0.04 }, 0), null, now)).toBeNull()
  })
})

describe('a League streamer dying', { timeout: 30_000 }, () => {
  it('is one death, a second after the world goes grey', () => {
    const r = play([[10_000, alive], [12_000, dead], [6000, alive]])
    expect(r.events).toEqual(['learned@6000', 'death@11000', 'respawn@22500'])
  })

  it('still fires at one sample a second, on the second grey one', () => {
    const r = play([[10_000, alive], [10_000, dead]], { every: 1000 })
    expect(r.deaths).toEqual([11_000])
  })

  it('waits, when it starts on a streamer already down, for them to be back up and fall again', () => {
    const r = play([[20_000, dead], [10_000, alive], [6000, dead]])
    expect(r.deaths).toEqual([30_000 + 1000])
  })

  it('counts a long death once, and a second death after the respawn again', () => {
    const r = play([[10_000, alive], [30_000, dead], [5000, alive], [8000, dead]])
    expect(r.deaths).toEqual([11_000, 46_000])
  })

  it('is not a whole frame gone grey (a break card, a black and white clip), a fade to black, or an ad', () => {
    expect(play([[10_000, alive], [10_000, { ...dead, mapGrey: true }]]).deaths).toEqual([])
    expect(play([[10_000, alive], [10_000, { ...dead, mapGrey: true, cam: true, still: true }]]).deaths).toEqual([])
    expect(play([[10_000, alive], [10_000, { ...alive, light: 0.04 }]]).deaths).toEqual([])
    expect(play([[10_000, alive], [10_000, dead]], { ad: (t) => t >= 10_000 }).deaths).toEqual([])
  })

  it('is not a cut to another scene, which it learns again', () => {
    const r = play([[10_000, alive], [10_000, { ...dead, mapOther: true }]])
    expect(r.deaths).toEqual([])
    expect(r.events).toContain('reset@13000')
  })

  it('is not two grey samples and then colour, nor cooldowns that dim the bar under a coloured world', () => {
    const flash = play([[10_000, alive], [1000, dead], [5000, alive]])
    expect(flash.deaths).toEqual([])
    expect(play([[10_000, alive], [10_000, { ...alive, bar: 'dim' }]]).deaths).toEqual([])
  })

  it('is not a slow fade of the world, only a step from colour into grey', () => {
    const fade: [number, Scene][] = Array.from({ length: 48 }, (_, i) => [500, { cam: true, world: 1 - (0.7 * (i + 1)) / 48, bar: i > 30 ? 'dim' : 'lit' }] as [number, Scene])
    expect(play([[10_000, alive], ...fade, [6000, dead]]).deaths).toEqual([])
  })

  it('fires with the minimap on the left, a webcam over the world, or the bar covered when the world falls deep', () => {
    expect(play([[10_000, { ...alive, map: 'left' }], [3000, { ...dead, map: 'left' }]]).deaths).toEqual([11_000])
    expect(play([[10_000, { ...alive, bar: 'covered' }], [3000, { ...dead, bar: 'covered' }]]).deaths).toEqual([11_000])
    expect(play([[10_000, { ...alive, snow: true }], [3000, { ...dead, snow: true }]]).deaths).toEqual([11_000])
  })

  it('never fires without a minimap in view, and says so', () => {
    const r = play([[10_000, { ...alive, map: 'none' }], [5000, { ...dead, map: 'none' }]])
    expect(r.deaths).toEqual([])
    expect(r.memory?.phase).toBe('learning')
    expect(learningWhy(play([[10_000, { ...alive, map: 'none' }]]).memory!)).toBe('no minimap')
  })

  it('never fires on a still picture, however coloured', () => {
    const r = play([[10_000, { ...alive, still: true }], [5000, { ...dead, still: true }]])
    expect(r.deaths).toEqual([])
    expect(learningWhy(play([[10_000, { ...alive, still: true }]]).memory!)).toBe('no movement')
  })

  it('takes the Tab scoreboard over a grey world as still down, not back up', () => {
    const r = play([[10_000, alive], [4000, dead], [4000, { ...dead, scoreboard: true }], [4000, dead]])
    expect(r.events).toEqual(['learned@6000', 'death@11000'])
  })

  it('never learns a death as the usual picture when it starts on one, fights on screen and all', () => {
    const fight: Scene = { ...dead, world: 0.85 }
    const r = play([[3000, dead], [1000, fight], [2000, dead], [1500, fight], [2000, dead], [1000, fight], [3000, dead]])
    expect(r.events).toEqual([])
    expect(r.memory?.phase).toBe('learning')
    // Up for good, then down: one death.
    const later = play([[8000, alive], [3000, dead]], { memory: r.memory, from: 13_500 })
    expect(later.deaths).toEqual([13_500 + 8000 + 1000])
  })

  it('keeps a death whose fight stays on screen a moment after the fall', () => {
    const fight: Scene = { ...dead, world: 0.8 }
    const r = play([[10_000, alive], [1000, dead], [1500, fight], [4000, dead]])
    expect(r.deaths).toEqual([13_500])
  })

  it('is not a flat window over the world, nor a black and white clip over the world and the bar', () => {
    for (const panel of [50, 90, 120]) expect(play([[10_000, alive], [5000, { ...alive, panel }]]).deaths).toEqual([])
    expect(play([[10_000, alive], [5000, { ...dead, clip: true }]]).deaths).toEqual([])
  })

  it('never fires on a death you came back into, whatever flashes of colour come before the respawn', () => {
    const first = play([[10_000, alive]])
    // Away 30 s; back mid-death: a fight or a shop in colour over it with the bar still dim, then grey again.
    const back = play([[2000, dead], [1000, { ...dead, world: 1 }], [3000, dead], [1000, { ...dead, scoreboard: true }], [3000, dead]], { memory: first.memory, from: 40_000 })
    expect(back.deaths).toEqual([])
    // Up again, then down: that one counts.
    const later = play([[5000, alive], [3000, dead]], { memory: back.memory, from: 50_000 })
    expect(later.deaths).toEqual([55_000 + 1000])
    // The same after an ad.
    const ad = play([[10_000, alive], [3000, dead], [1000, { ...dead, world: 1 }], [3000, dead]], { ad: (t) => t >= 10_000 && t < 12_000 })
    expect(ad.deaths).toEqual([])
  })

  it('is not a darker scene (fog, a night effect) with the bar dimmed by cooldowns, but is a dark death with the bar gone dark', () => {
    expect(play([[10_000, alive], [6000, { ...alive, light: 0.6, bar: 'dim' }]]).deaths).toEqual([])
    // Thebausffs' death screen: the world at 45% of its brightness, its colour with it, the bar at a third.
    expect(play([[10_000, alive], [3000, { ...alive, light: 0.45, bar: 'dark' }]]).deaths).toEqual([11_000])
    // velja's death over a dark jungle: grey and darker, the bar only dimmed.
    expect(play([[10_000, alive], [3000, { ...dead, light: 0.6 }]]).deaths).toEqual([11_000])
  })

  it('takes the minimap on the right over a still logo on the left, and a white page is no death', () => {
    const r = play([[10_000, { ...alive, logoLeft: true }], [5000, { ...alive, logoLeft: true, white: true }]])
    expect(r.memory?.side).toBe('right')
    expect(r.deaths).toEqual([])
    expect(play([[10_000, { ...alive, logoLeft: true }], [3000, { ...dead, logoLeft: true }]]).deaths).toEqual([11_000])
  })

  it('fires with a small minimap and world around it in its corner', () => {
    expect(play([[10_000, { ...alive, mapSmall: true }], [3000, { ...dead, mapSmall: true }]]).deaths).toEqual([11_000])
  })

  it('with the bar covered, takes Tab in a death as still down, so one death is one switch', () => {
    const covered: Scene = { ...alive, bar: 'covered' }
    const down: Scene = { ...dead, bar: 'covered' }
    const r = play([[10_000, covered], [3000, down], [1000, { ...down, world: 1 }], [3000, down], [1000, { ...down, world: 1 }], [4000, down]])
    expect(r.deaths).toEqual([11_000])
  })

  it('starts the step over after a gap, and forgets a tab silent for minutes', () => {
    const first = play([[10_000, alive]])
    // Seen again 30 s later, already grey: no step seen, no death; then up and down again is one.
    const later = play([[4000, dead], [5000, alive], [3000, dead]], { memory: first.memory, from: 40_000 })
    expect(later.deaths).toEqual([49_000 + 1000])
    const gone = play([[1000, alive]], { memory: first.memory, from: 10_000 + LEAGUE.forgetMs + 1000 })
    expect(gone.events[0]).toMatch(/^reset/)
  })

  it('fires on the measured onsets: 36.6 > 15.2 > 9.6 and 31.9 > 10.5 against a usual 38, through one stray sample', () => {
    // As measured, padded; and with one sample just over the line a second in, which is forgiven.
    // ...and one caught mid-fade, a step too small at first that the deeper grey makes good.
    for (const onset of [[36.6, 15.2, 9.6, 9.6], [31.9, 10.5, 10.5, 10.5], [36.6, 15.2, 9.6, 26, 21, 21], [31.9, 10.5, 21, 25, 21], [31.9, 26, 10.5, 10.5, 10.5]]) {
      let m: DeathMemory | null = null
      let t = 0
      const at = (w: number, a: number): LeagueFeatures => ({
        at: now + t, w, s: (100 * w) / 90, l: 90, tex: 20, a, bar: Array.from({ length: 16 }, (_, i) => (60 + (i % 4) * 15) * (a / 35)), worldMove: 3,
        right: { chroma: Array(20).fill(26), luma: Array(20).fill(80), m: 26, move: 0.5, life: 6 },
        left: { chroma: Array(20).fill(30), luma: Array(20).fill(100), m: 30, move: 6, life: 6 },
      })
      for (; t < 10_000; t += 500) m = leagueStep(m, at(38 + ((t / 500) % 3) - 1, 35), { ad: false }, now + t).memory
      const events: string[] = []
      for (const w of onset) {
        const tick = leagueStep(m, at(w, w > 30 ? 35 : 21), { ad: false }, now + t)
        m = tick.memory
        if (tick.event) events.push(tick.event)
        t += 500
      }
      expect(events).toEqual(['death'])
    }
  })
})

// ---------------------------------------------------------------------------------------------
// The desk: which tasks are watched, and what a death does

function desk(o: { cue?: string; title?: string; at?: number } = {}) {
  let n = 0
  const at = o.at ?? now
  const ctx = { now: at, newId: () => `id${++n}`, random: () => 0.5, device: 'here' }
  let s: MayorlyState = sampleState(at, ctx.newId)
  s = { ...s, tokens: [...s.tokens, { id: 'seed', at, amount: 40, reason: 'tomato', sittingId: null } as never] }
  const act = (a: Action) => (s = reduce(s, a, ctx).state)
  act({ type: 'entry/capture', text: 'legal: alpha', start: true })
  act({ type: 'leisure/add', title: o.title ?? 'Stream watch' })
  act({ type: 'leisure/add', title: "Play Baldur's Gate 3" })
  const stream = s.leisure.find((l) => l.title === (o.title ?? 'Stream watch'))!.id
  const bg3 = s.leisure.find((l) => l.title === "Play Baldur's Gate 3")!.id
  act({ type: 'entry/cue-add', id: stream, text: o.cue ?? "Kai'sa dies" })
  act({ type: 'entry/cue-add', id: bg3, text: 'one main friendly character dies' })
  act({ type: 'desk/select', leisureId: stream })
  const alpha = s.entries.find((e) => e.title === 'alpha')!.id
  return { get s() { return s }, act, stream, bg3, alpha }
}

// A GTA stream, read by its word: a sample is WASTED read or not (streamword.test.ts reads real frames).
const word = (wasted: boolean, score = wasted ? 0.98 : 0): WordSight => ({ wasted, score, seen: wasted ? 'word wasted' : score ? 'word failed' : 'no word' })
/**
 * Feeds [ms, sight] spans a sample every `every` ms ('ad': WASTED on screen, with Twitch's ad label up);
 * `hint` is the frame interval the shell asked for (500 unless said). Returns the deaths and every event, by time.
 */
function gta(timeline: [number, WordSight | 'ad'][], o: { every?: number; hint?: number; memory?: WordMemory | null } = {}) {
  const every = o.every ?? 500
  let memory = o.memory ?? null
  let t = 0
  const ticks: { t: number; event: string | null; near: boolean; seen: string }[] = []
  for (const [ms, sight] of timeline) {
    for (const end = t + ms; t < end; t += every) {
      const tick = wordStep(memory, sight === 'ad' ? word(true) : sight, { ad: sight === 'ad', every: o.hint ?? 500 }, now + t)
      memory = tick.memory
      ticks.push({ t, event: tick.event, near: tick.near, seen: tick.seen })
    }
  }
  return { memory, ticks, deaths: ticks.filter((x) => x.event === 'death').map((x) => x.t), events: ticks.filter((x) => x.event).map((x) => `${x.event}@${x.t}`) }
}
const on = word(true)
const off = word(false)

describe('a GTA streamer wasted', () => {
  it('is one death on the second read of WASTED, and back up once it has been gone 3 s', () => {
    const r = gta([[5000, off], [5000, on], [8000, off]])
    expect(r.events).toEqual(['death@5500', 'respawn@12500'])
  })

  it('still fires at one sample a second, and with the trip to the app making it a little slower', () => {
    expect(gta([[5000, off], [5000, on], [5000, off]], { every: 1000, hint: 1000 }).deaths).toEqual([6000])
    // Asked for one a second, arriving every 1.25 s: the next frame always counts.
    expect(gta([[5000, off], [5000, on], [5000, off]], { every: 1250, hint: 1000 }).deaths).toEqual([6250])
  })

  it('never counts two deaths within 10 s, even after the word has gone and come back', () => {
    // Read at 5 and 5.5 s (a death), gone 3.5 s (back up), read again at 9 and 9.5 s: the same death.
    const r = gta([[5000, off], [1000, on], [3000, off], [1000, on], [6000, off]])
    expect(r.deaths).toEqual([5500])
    expect(r.ticks.find((x) => x.t === 9500)?.seen).toMatch(/just counted/)
  })

  it('never fires on a WASTED it came in on, only on the next one', () => {
    const r = gta([[3000, on], [6000, off], [5000, on], [4000, off]])
    expect(r.deaths).toEqual([9500])
    expect(r.ticks.find((x) => x.t === 500)?.near).toBe(true)
  })

  it('is not one stray read, FAILED or BUSTED, or WASTED during an ad', () => {
    expect(gta([[5000, off], [500, on], [5000, off]]).deaths).toEqual([])
    expect(gta([[5000, off], [500, on], [1000, off], [500, on], [5000, off]]).deaths).toEqual([])
    expect(gta([[5000, off], [6000, word(false, 1)], [5000, off]]).deaths).toEqual([])
    expect(gta([[5000, off], [6000, 'ad'], [5000, off]]).deaths).toEqual([])
  })

  it('counts each death once, a long WASTED with a blank beat in it included, and the next one again', () => {
    const r = gta([[5000, off], [3000, on], [500, off], [3000, on], [6000, off], [5000, on], [5000, off]])
    expect(r.deaths).toEqual([5500, 18_000])
  })

  it('needs the streamer seen up again after a gap: a tab back from silence mid-WASTED does not fire', () => {
    const first = gta([[5000, off]])
    const back = gta([[5000, on], [5000, off], [5000, on]], { memory: { ...first.memory!, lastAt: first.memory!.lastAt - 10_000 } })
    expect(back.deaths).toEqual([10_500])
  })

  it('does not switch you back out when you come back a few seconds later onto a WASTED that began while you were away', () => {
    // Up and read at 4.5 s, then not read for 3 s (you were on another task), back on WASTED.
    const before = gta([[5000, off]])
    const back = gta([[4000, on], [5000, off]], { memory: { ...before.memory!, lastAt: now - 3000 } })
    expect(back.deaths).toEqual([])
    expect(back.ticks.some((x) => x.near)).toBe(true)
  })

  it('reads the word from the masks, and only WASTED counts', () => {
    expect(wordSight(null)).toEqual({ wasted: false, score: 0, seen: 'no word' })
    expect(wordSight({ white: null, red: null }).wasted).toBe(false)
  })
})

describe('a watched rule', () => {
  it('is a death on a stream: on an item named for a stream, or a rule that names the streamer', () => {
    expect(watchedCues({ title: 'Stream watch', cues: ['catilyn dies', "Kai'sa dies", 'finish the game'] })).toEqual(['catilyn dies', "Kai'sa dies"])
    expect(watchedCues({ title: 'Caedrel', cues: ['streamer dies'] })).toEqual(['streamer dies'])
    expect(watchedCues({ title: 'watch bilibili', cues: ['主播死了'] })).toEqual(['主播死了'])
    expect(watchedCues({ title: "Play Baldur's Gate 3", cues: ['one main friendly character dies'] })).toEqual([])
    expect(watchedCues({ title: 'couch: league of legends 2026', cues: ['Finish one game'] })).toEqual([])
    expect(watchedCues({ title: 'Stream watch' })).toEqual([])
  })

  it('runs only while its task is on the desk, here, outside a rest, with the rule on', () => {
    const d = desk()
    d.act({ type: 'desk/claim', name: 'this pc' })
    expect(streamArm(d.s, 'here')).toMatchObject({ on: true, taskId: d.stream, cue: "Kai'sa dies" })
    expect(streamArm(d.s, 'there')).toEqual({ on: false, why: 'running on another computer' })
    const bg = desk()
    bg.act({ type: 'desk/select', leisureId: bg.bg3 })
    expect(streamArm(bg.s, 'here')).toEqual({ on: false, why: 'no stream rule on this task', taskId: bg.bg3 })
    const off = desk()
    off.act({ type: 'settings/update', patch: { autoSwitch: { aiPrompt: true, streamDeath: false, streamMute: true, streamOpen: true } } })
    expect(streamArm(off.s, 'here')).toMatchObject({ on: false, why: 'the rule is off', taskId: off.stream })
    off.act({ type: 'desk/select', leisureId: off.bg3 })
    expect(streamArm(off.s, 'here')).toEqual({ on: false, why: 'the rule is off' })
    const paused = desk()
    paused.act({ type: 'desk/pause' })
    expect(streamArm(paused.s, 'here').why).toBe('the desk is not running')
    const plain = desk({ title: 'TV night', cue: 'someone dies' })
    expect(streamArm(plain.s, 'here').why).toBe('no stream rule on this task')
  })

  it('takes the eye on a task over its words: on for any task, off for one its words would watch', () => {
    const d = desk({ title: 'Thebausffs', cue: 'Irelia dies' })
    expect(streamArm(d.s, 'here').why).toBe('no stream rule on this task')
    d.act({ type: 'entry/watch', id: d.stream, watch: true })
    expect(streamArm(d.s, 'here')).toMatchObject({ on: true, cue: 'Irelia dies' })
    d.act({ type: 'entry/watch', id: d.stream, watch: null })
    expect(d.s.leisure.find((l) => l.id === d.stream)!.watch).toBeUndefined()
    const off = desk()
    off.act({ type: 'entry/watch', id: off.stream, watch: false })
    expect(streamArm(off.s, 'here').why).toBe('no stream rule on this task')
    // On with no rule that someone dies: the streamer's death is the rule.
    const bare = desk({ title: 'Caedrel', cue: 'one game' })
    bare.act({ type: 'entry/watch', id: bare.stream, watch: true })
    expect(streamArm(bare.s, 'here')).toMatchObject({ on: true, cue: 'the streamer dies' })
    expect(isWatched({ title: 'watch theBause', cues: ['Irelia dies'] })).toBe(true)
  })

  it('does what a tap of Alt+Q does on a death: back to the task worked on last', () => {
    const d = desk()
    // On the stream, having played BG3 last: a tap goes to BG3.
    d.act({ type: 'desk/select', leisureId: d.bg3 })
    d.act({ type: 'desk/select', leisureId: d.stream })
    const step = deathStep(d.s, 'here', { ownMatch: false, sinceFireMs: Infinity })
    expect(step.why).toBe('switched')
    d.act(step.act!)
    expect(onDeskId(d.s)).toBe(d.bg3)
    // Off the stream now: a second death does nothing.
    expect(deathStep(d.s, 'here', { ownMatch: false, sinceFireMs: Infinity })).toEqual({ act: null, why: 'no stream rule on this task' })
  })

  it('goes to the task from before the couch when that is the one worked on last', () => {
    const d = desk()
    const step = deathStep(d.s, 'here', { ownMatch: false, sinceFireMs: Infinity })
    d.act(step.act!)
    expect(onDeskId(d.s)).toBe(d.alpha)
  })

  it('never switches while a League match of your own runs, or a moment after another rule switched', () => {
    const d = desk()
    expect(deathStep(d.s, 'here', { ownMatch: true, sinceFireMs: Infinity })).toEqual({ act: null, why: 'your own League match is running' })
    expect(deathStep(d.s, 'here', { ownMatch: false, sinceFireMs: 1200 })).toEqual({ act: null, why: 'switched a moment ago' })
  })

  it('lets go of your own Alt+Q a beat after it switched, and only then', () => {
    const d = desk()
    d.act(deathStep(d.s, 'here', { ownMatch: false, sinceFireMs: Infinity }).act!)
    const fired = { at: now, taskId: d.stream }
    expect(graceStep({ type: 'desk/switch' }, d.s, fired, now + 1000).drop).toBe(true)
    expect(graceStep({ type: 'desk/select', leisureId: d.stream }, d.s, fired, now + 2000).drop).toBe(true)
    expect(graceStep({ type: 'desk/switch' }, d.s, fired, now + 3500).drop).toBe(false)
    expect(graceStep({ type: 'desk/select', leisureId: d.bg3 }, d.s, fired, now + 1000).drop).toBe(false)
    expect(graceStep({ type: 'desk/switch' }, d.s, null, now + 1000).drop).toBe(false)
    // A switch that no longer leads to the stream goes through: you went on to BG3 and switch back to alpha.
    d.act({ type: 'desk/select', leisureId: d.bg3 })
    expect(graceStep({ type: 'desk/switch' }, d.s, fired, now + 1500).drop).toBe(false)
    // Back on the stream already: nothing to let go.
    d.act({ type: 'desk/select', leisureId: d.stream })
    expect(graceStep({ type: 'desk/switch' }, d.s, fired, now + 1500).drop).toBe(false)
  })
})

describe('a live stream brought to the front', () => {
  const page = { title: 'Thebausffs - Twitch', live: true }
  it('switches from another task to the one that watches streams', () => {
    const d = desk()
    d.act({ type: 'entry/capture', text: 'legal: gamma', start: true })
    const step = openStep(d.s, 'here', page, { sinceFireMs: Infinity })
    expect(step).toMatchObject({ why: 'switched', to: 'Stream watch' })
    d.act(step.act!)
    expect(onDeskId(d.s)).toBe(d.stream)
    // On it already: nothing more.
    expect(openStep(d.s, 'here', page, { sinceFireMs: Infinity })).toEqual({ act: null, why: 'already on a stream task' })
  })

  it('picks the task named like the page, else the one watched last', () => {
    const d = desk()
    d.act({ type: 'leisure/add', title: 'watch theBause' })
    const bause = d.s.leisure.find((l) => l.title === 'watch theBause')!.id
    d.act({ type: 'entry/cue-add', id: bause, text: 'Irelia dies' })
    d.act({ type: 'desk/select', leisureId: d.bg3 })
    expect(openStep(d.s, 'here', { title: 'Thebausffs - Twitch', live: true }, { sinceFireMs: Infinity }).to).toBe('watch theBause')
    expect(openStep(d.s, 'here', { title: 'Caedrel - Twitch', live: true }, { sinceFireMs: Infinity }).to).toBe('Stream watch')
  })

  it('does nothing on a page that is not live, with the rule off, in a rest, with no stream task, or right after a death', () => {
    const d = desk()
    d.act({ type: 'desk/select', leisureId: d.bg3 })
    expect(openStep(d.s, 'here', { ...page, live: false }, { sinceFireMs: Infinity }).why).toBe('not a live stream')
    expect(openStep(d.s, 'here', page, { sinceFireMs: 4000 }).why).toBe('a death switched away a moment ago')
    const off = desk()
    off.act({ type: 'desk/select', leisureId: off.bg3 })
    off.act({ type: 'settings/update', patch: { autoSwitch: { aiPrompt: true, streamDeath: true, streamMute: true, streamOpen: false } } })
    expect(openStep(off.s, 'here', page, { sinceFireMs: Infinity }).why).toBe('the rule is off')
    const none = desk({ title: 'TV night', cue: 'someone dies' })
    none.act({ type: 'desk/select', leisureId: none.bg3 })
    expect(openStep(none.s, 'here', page, { sinceFireMs: Infinity }).why).toBe('no task watches a stream')
    const idle = desk()
    idle.act({ type: 'desk/standDown' })
    expect(openStep(idle.s, 'here', page, { sinceFireMs: Infinity }).why).toBe('the desk is idle')
    const broke = desk()
    broke.act({ type: 'entry/capture', text: 'legal: gamma', start: true })
    const spent = { ...broke.s, tokens: [...broke.s.tokens, { id: 'spend', at: now, amount: -1000, reason: 'market', sittingId: null } as never] }
    expect(openStep(spent, 'here', page, { sinceFireMs: Infinity }).why).toBe('no coin for the couch')
  })
})

describe('leaving the stream task', () => {
  it('is any switch from a task that watches streams to one that does not', () => {
    const d = desk()
    const on = d.s
    d.act({ type: 'desk/switch' })
    expect(leftStream(on, d.s)).toBe(d.stream)
    // Back onto it, or between two stream tasks, or a rest on it: not leaving.
    const off = d.s
    d.act({ type: 'desk/select', leisureId: d.stream })
    expect(leftStream(off, d.s)).toBeNull()
    d.act({ type: 'leisure/add', title: 'watch theBause' })
    const bause = d.s.leisure.find((l) => l.title === 'watch theBause')!.id
    d.act({ type: 'entry/cue-add', id: bause, text: 'Irelia dies' })
    const still = d.s
    d.act({ type: 'desk/select', leisureId: bause })
    expect(leftStream(still, d.s)).toBeNull()
    const rest = d.s
    d.act({ type: 'desk/skip' })
    expect(leftStream(rest, d.s)).toBeNull()
  })
})

describe('the stream tabs', () => {
  it('know League by the game the page names, or its title', () => {
    expect(leagueOf('League of Legends', 'Caedrel - Twitch')).toBe(true)
    expect(leagueOf('VALORANT', 'tarik - Twitch')).toBe(false)
    expect(leagueOf(null, 'T1 vs GEN | League of Legends - YouTube')).toBe(true)
    expect(leagueOf(null, '英雄联盟 主播')).toBe(true)
    expect(leagueOf(null, 'a cooking video - YouTube')).toBeNull()
  })

  it('know the game by the name the page gives it, or its title; a game no detector knows is never read', () => {
    expect(gameOf('League of Legends', 'Caedrel - Twitch')).toBe('league')
    expect(gameOf('Grand Theft Auto VI', 'xQc - Twitch')).toBe('gta')
    expect(gameOf('Grand Theft Auto V', 'xQc - Kick')).toBe('other')
    expect(gameOf('GTA 6', 'xQc - Kick')).toBe('gta')
    expect(gameOf('Just Chatting', 'GTA 6 later - Twitch')).toBe('other')
    expect(gameOf('VALORANT', 'tarik - Twitch')).toBe('other')
    expect(gameOf(null, 'xQc plays GTA 6 day 3 - YouTube')).toBe('gta')
    expect(gameOf(null, 'T1 vs GEN - YouTube')).toBe('league')
    expect(watchedCues({ title: 'Stream watch', cues: ['xqc wasted'] })).toEqual(['xqc wasted'])
  })

  it('pick one tab: the one named like the task, then the one in front, then the bigger video', () => {
    const tab = (id: string, o: Partial<TabSeen> = {}): TabSeen => ({ tab: id, site: 'twitch', title: `${id} - Twitch`, category: 'League of Legends', game: 'league', visible: true, active: false, area: 1000, tainted: false, at: now, ...o })
    expect(pickTab([tab('a', { area: 2000 }), tab('b', { active: true })], 'Stream watch', now)?.tab).toBe('b')
    expect(pickTab([tab('a', { active: true }), tab('caedrel')], 'Caedrel stream', now)?.tab).toBe('caedrel')
    expect(pickTab([tab('a', { area: 2000 }), tab('b')], 'Stream watch', now)?.tab).toBe('a')
    expect(pickTab([tab('a', { at: now - 20_000 }), tab('b', { visible: false }), tab('c', { game: 'other' }), tab('d', { tainted: true })], 'Stream watch', now)).toBeNull()
  })

  it('take a post only in this version, with whole grids', () => {
    const g = grid(alive, 0)
    const b64 = (a: Uint8Array) => Buffer.from(a).toString('base64')
    const post = { v: 1, kind: 'frame', tab: '7:0', site: 'twitch', title: 'x - Twitch', category: 'League of Legends', visible: true, active: true, area: 5, ad: false, cost: 4.4, grid: { c: b64(g.chroma), l: b64(g.luma), t: b64(g.lit) } }
    const p = streamPostOf(post)!
    expect(p.grid!.chroma).toEqual(g.chroma)
    expect(p).toMatchObject({ kind: 'frame', site: 'twitch', category: 'League of Legends', cost: 4.4 })
    expect(streamPostOf({ ...post, v: 2 })).toBeNull()
    expect(streamPostOf({ ...post, site: 'example' })).toBeNull()
    expect(streamPostOf({ ...post, grid: { ...post.grid, c: b64(g.chroma.slice(1)) } })).toBeNull()
    expect(streamPostOf({ ...post, kind: 'hello', grid: undefined })).toMatchObject({ kind: 'hello', grid: null })
  })
})

// The save the Windows runner starts the app with (scripts/e2e-stream.ps1): on the couch item
// "Stream watch" with its rule, having come from alpha, built through the reducer like any save.
it.runIf(!!process.env.E2E_STREAM_SEED)('writes the e2e seed', () => {
  const at = Date.now()
  const d = desk({ at })
  writeFileSync(process.env.E2E_STREAM_SEED as string, JSON.stringify({ lastBeat: at, state: d.s }))
})
