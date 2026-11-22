import { onDeskId, quickSwitch, switchBack, switchSession, type Action, type Id, type MayorlyState } from '../core/index'
import { PROMPT_ECHO_MS, type PromptStep } from './aiswitch'

// A League streamer's death is Alt+Q. A couch item (or a task) whose context switch rule says the
// streamer dies is watched while it runs: the Mayorly extension reads the stream's own <video> in
// Chrome (never the screen, so a game you play yourself is never seen), hands main a 32x18 grid of
// colour and light twice a second, and the moment the game world turns grey while the minimap
// keeps its colour, the desk does what a tap of Alt+Q does. Once per death: the step from colour
// into grey is what counts, so coming back while the streamer is still down does nothing until
// they are back up and fall again. Pure: the shell (main/streamwatch.ts) feeds it posts and does
// what it returns.

/** The eye's version, in every post; a post from another version is not read. */
export const STREAM_V = 1
export const FRAME_W = 320
export const FRAME_H = 180
export const GRID_W = 32
export const GRID_H = 18
export const CELLS = GRID_W * GRID_H

export type StreamSite = 'twitch' | 'youtube' | 'kick' | 'bilibili' | 'huya' | 'douyu'
const SITES: readonly StreamSite[] = ['twitch', 'youtube', 'kick', 'bilibili', 'huya', 'douyu']

/** One frame of the stream, cut into GRID_W x GRID_H cells, row by row. */
export interface StreamGrid {
  /** Mean colourfulness, max(r,g,b) - min(r,g,b), over the cell's lit pixels; 0 when under a fifth of it is lit. */
  chroma: Uint8Array
  /** Mean brightness. */
  luma: Uint8Array
  /** 255 times the share of the cell's pixels with max(r,g,b) of 40 or more. */
  lit: Uint8Array
}

/** What a stream tab tells Mayorly: who it is, and, while armed, a frame. */
export interface StreamPost {
  v: number
  kind: 'hello' | 'frame' | 'tainted'
  /** The tab and frame, as the extension names them. */
  tab: string
  site: StreamSite
  title: string
  /** The page's game, where the site says it (Twitch, Kick); null where it does not. */
  category: string | null
  visible: boolean
  /** The tab is the one showing in its window. */
  active: boolean
  /** The video's size on the page, in CSS pixels squared. */
  area: number
  /** An ad is playing. */
  ad: boolean
  /** What reading a frame costs the page, in ms; null until measured. */
  cost: number | null
  /** The eye holds a mute of Mayorly's on this tab. */
  held: boolean
  grid: StreamGrid | null
}

/**
 * Mayorly's answer: send frames every `every` ms, or only a hello now and then. `mute`: a death
 * switched you away, so mute the video; the eye unmutes what it muted when it is armed again.
 */
export interface StreamReply {
  armed: boolean
  every: number
  mute?: boolean
}

/** How often a tab says hello while not armed. */
export const HELLO_MS = 5000

const decode = (b64: unknown): Uint8Array | null => {
  if (typeof b64 !== 'string' || b64.length > 1024) return null
  try {
    const bin = atob(b64)
    if (bin.length !== CELLS) return null
    const out = new Uint8Array(CELLS)
    for (let i = 0; i < CELLS; i++) out[i] = bin.charCodeAt(i)
    return out
  } catch {
    return null
  }
}

const text = (v: unknown, max: number) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '')

/** A post from the extension, checked; null when it is not one this version reads. */
export function streamPostOf(j: unknown): StreamPost | null {
  const o = j && typeof j === 'object' ? (j as Record<string, unknown>) : null
  if (!o || o.v !== STREAM_V || !SITES.includes(o.site as StreamSite)) return null
  if (o.kind !== 'hello' && o.kind !== 'frame' && o.kind !== 'tainted') return null
  const tab = text(o.tab, 40)
  if (!tab) return null
  let grid: StreamGrid | null = null
  if (o.kind === 'frame') {
    const g = o.grid && typeof o.grid === 'object' ? (o.grid as Record<string, unknown>) : null
    const chroma = decode(g?.c)
    const luma = decode(g?.l)
    const lit = decode(g?.t)
    if (!chroma || !luma || !lit) return null
    grid = { chroma, luma, lit }
  }
  const cost = typeof o.cost === 'number' && Number.isFinite(o.cost) && o.cost >= 0 ? Math.min(o.cost, 1000) : null
  const area = typeof o.area === 'number' && Number.isFinite(o.area) && o.area > 0 ? o.area : 0
  return {
    v: STREAM_V,
    kind: o.kind,
    tab,
    site: o.site as StreamSite,
    title: text(o.title, 200),
    category: text(o.category, 80) || null,
    visible: o.visible !== false,
    active: o.active === true,
    area,
    ad: o.ad === true,
    held: o.held === true,
    cost,
    grid,
  }
}

// ---------------------------------------------------------------------------------------------
// Which rules are watched

const DEATH = /\b(die|dies|died|dying|dead|death|killed)\b|死|阵亡|陣亡|挂了|寄了/i
const STREAM = /\bstream(s|er|ers|ing)?\b|\bwatch(es|ing)?\b|\btwitch\b|主播|直播|bilibili|b站|虎牙|斗鱼|鬥魚|huya|douyu/i

/** A task as far as the stream rule cares: its name, its context switch rules, and the eye's switch. */
export interface WatchTask {
  title: string
  cues?: string[]
  watch?: boolean
}

/**
 * The context switch rules Mayorly watches on a task. By their words: the ones that say someone
 * dies, on a task about a stream or about watching (its name or the rule says stream, streamer,
 * watch, Twitch, 主播 or 直播). "Kai'sa dies" on "Stream watch" or "watch theBause" is one; "one main
 * friendly character dies" on a game you play is not. The eye on a task's rules overrides the
 * words: on, every rule that someone dies; off, none.
 */
export function watchedCues(task: WatchTask): string[] {
  const cues = task.cues ?? []
  if (task.watch === false) return []
  if (task.watch === true) return cues.filter((c) => DEATH.test(c))
  const stream = STREAM.test(task.title)
  return cues.filter((c) => DEATH.test(c) && (stream || STREAM.test(c)))
}

/** Whether Mayorly watches a stream for this task: the eye's switch, else whether any rule is watched by its words. */
export function isWatched(task: WatchTask): boolean {
  return task.watch ?? watchedCues(task).length > 0
}

const LEAGUE_NAME = /league of legends|英雄联盟|英雄聯盟|리그 오브 레전드/i

/** Is the page League: true or false when its game or title says, null when neither does. */
export function leagueOf(category: string | null, title: string): boolean | null {
  if (category) return LEAGUE_NAME.test(category) || /^lol$/i.test(category.trim())
  return LEAGUE_NAME.test(title) || /\blol\b/i.test(title) ? true : null
}

// ---------------------------------------------------------------------------------------------
// When the rule runs

export interface StreamArm {
  on: boolean
  why: string
  taskId?: Id
  title?: string
  cue?: string
}

/** The task on the desk, if it is one whose rule is watched and the rule may run here and now. */
export function streamArm(s: MayorlyState, deviceId: string): StreamArm {
  if (!s.settings.autoSwitch.streamDeath) {
    const rule = ruleOf(s)
    return { on: false, why: 'the rule is off', ...(rule.cue ? rule : {}) }
  }
  const d = s.desk
  if (d.status !== 'running' || !d.block || d.heldAt != null) return { on: false, why: 'the desk is not running' }
  if (d.block.kind === 'rest') return { on: false, why: 'resting' }
  if (d.device && d.device.id !== deviceId) return { on: false, why: 'running on another computer' }
  const rule = ruleOf(s)
  if (!rule.taskId) return { on: false, why: 'no task on the desk' }
  if (!rule.cue) return { on: false, why: 'no stream rule on this task', taskId: rule.taskId }
  return { on: true, why: 'watching', ...rule }
}

function ruleOf(s: MayorlyState): { taskId?: Id; title?: string; cue?: string } {
  const id = onDeskId(s)
  const task = id ? (s.entries.find((e) => e.id === id) ?? s.leisure.find((l) => l.id === id)) : undefined
  if (!id || !task) return {}
  if (!isWatched(task)) return { taskId: id }
  return { taskId: id, title: task.title, cue: watchedCues(task)[0] ?? 'the streamer dies' }
}

/** A stream tab as last heard from. */
export interface TabSeen {
  tab: string
  site: StreamSite
  title: string
  category: string | null
  league: boolean | null
  visible: boolean
  active: boolean
  area: number
  /** Its video will not be read (from another origin): not a tab to pick. */
  tainted: boolean
  /** When it was last heard from. */
  at: number
}

/** A tab not heard from in this long is gone. */
export const TAB_STALE_MS = 12_000
const STOP = new Set(['stream', 'streams', 'live', 'twitch', 'youtube', 'watch', 'watching', 'the', 'and', 'with'])
const words = (t: string) => new Set(t.toLowerCase().split(/[^\p{L}\p{N}']+/u).filter((w) => w.length >= 3 && !STOP.has(w)))

/**
 * The one tab to read: heard from lately, showing, not another game. One whose title shares a
 * word with the task's name first ("Caedrel" for a task called "Caedrel stream"), then the tab in
 * front, then the bigger video.
 */
export function pickTab(tabs: TabSeen[], taskTitle: string, now: number): TabSeen | null {
  const want = words(taskTitle)
  const score = (t: TabSeen) => ([...words(t.title)].some((w) => want.has(w)) ? 4 : 0) + (t.active ? 2 : 0)
  const fit = tabs.filter((t) => now - t.at <= TAB_STALE_MS && t.visible && !t.tainted && t.league !== false)
  fit.sort((a, b) => score(b) - score(a) || b.area - a.area || b.at - a.at)
  return fit[0] ?? null
}

// ---------------------------------------------------------------------------------------------
// Seeing a death

interface Box {
  x0: number
  x1: number
  y0: number
  y1: number
}

/** Parts of the frame, as fractions of it; a cell belongs when its centre is inside. */
export const REGION = {
  /** The game world, clear of the HUD at the bottom and most corner overlays. */
  world: { x0: 0.1, x1: 0.9, y0: 0.08, y1: 0.72 },
  /** The ability bar, bottom centre. It dims while the champion is dead. */
  bar: { x0: 0.36, x1: 0.64, y0: 0.88, y1: 1 },
  /** The minimap, bottom right by default, bottom left with "Show minimap on left". It keeps its colour. */
  mapRight: { x0: 0.86, x1: 1, y0: 0.74, y1: 1 },
  mapLeft: { x0: 0, x1: 0.14, y0: 0.74, y1: 1 },
} satisfies Record<string, Box>

export function cellsIn(b: Box): number[] {
  const out: number[] = []
  for (let r = 0; r < GRID_H; r++) {
    for (let c = 0; c < GRID_W; c++) {
      const x = (c + 0.5) / GRID_W
      const y = (r + 0.5) / GRID_H
      if (x >= b.x0 && x <= b.x1 && y >= b.y0 && y <= b.y1) out.push(r * GRID_W + c)
    }
  }
  return out
}

const WORLD = cellsIn(REGION.world)
const BAR = cellsIn(REGION.bar)
const MAP = { right: cellsIn(REGION.mapRight), left: cellsIn(REGION.mapLeft) }
type SideName = keyof typeof MAP

/**
 * Starting values from two deaths of one streamer, measured on Twitch at 320x180 (a world colour of
 * 37 to 39 alive and 10 to 23 dead, onsets 36.6 > 15.2 > 9.6 and 31.9 > 10.5, the bar 35 > 21, the
 * minimap 25 to 27 throughout). Every death, near miss and switch by hand is logged with these
 * numbers, so they are tuned from the log and ship with an update; the extension never changes.
 */
export const LEAGUE = {
  /** A world cell counts when 30% of it is lit; a frame with under 25% of its world counted is dark (a fade to black), not a dim death screen. */
  cellLitMin: 77,
  validMin: 0.25,
  /**
   * The baseline: up to 40 samples of the streamer alive, learned from 6 s of unbroken colour of
   * 28 or more (any sample under it starts the learning over), above anything a death shows: fights
   * seen while dead measure 25 to 29. Then only samples taken while the streamer is seen up join it.
   */
  baseMax: 40,
  baseMin: 6,
  baseMinMs: 6000,
  baseFloor: 28,
  /** The game moves: the median change of the world's brightness between samples, so a webcam alone does not count. A still card is not a game. */
  worldMoveMin: 1,
  /**
   * The minimap corner: five or more of its cells hold still while the world moves (a cell's
   * brightness strays under 6 from its usual), with some colour, and something moves somewhere in
   * the corner; a still logo is not a minimap. A small minimap with world around it is its still cells.
   */
  mapMax: 70,
  mapStillCell: 6,
  mapCellsMin: 5,
  mapLife: 2.5,
  /**
   * A grey sample, one of two ways. Drained: the world's colour under 72% of usual (and under 30),
   * its colour for its brightness under 70% (a darker scene, fog or a night effect keeps that; a
   * death loses it, velja's to a quarter even over a dark jungle), and the bar dimmed under 85%.
   * Or the bar gone dark: under half its colour and still the bar, with the world's colour under
   * 85% or drained (Thebausffs' death screen, dark as well as grey, the shop open over it: the
   * world 68% of usual, the bar 31%)...
   */
  greyRatio: 0.72,
  greyCap: 30,
  satRatio: 0.7,
  greyLoose: 0.85,
  barStrong: 0.5,
  /**
   * ...the world keeping its texture (a flat window or card over it is not a death)... the bar
   * dimmed under 85% and still the bar (its pattern of brightness correlates with its usual one,
   * so a card or clip over it is not a dimmed bar); with no bar to read, the world under 45%...
   */
  texRatio: 0.4,
  barRatio: 0.85,
  barMin: 8,
  barCorr: 0.5,
  deepRatio: 0.45,
  /** ...the minimap still there: 60% of its cells keep 60% of their colour, and most of it in place... */
  mapCell: 8,
  mapKeep: 0.6,
  mapHeld: 0.6,
  mapShift: 20,
  /** ...and the picture lit, if darker: a fade to black (a dark frame) or a white page is not a death. */
  lightRatio: 0.3,
  lightMin: 15,
  lightMax: 1.5,
  /**
   * The step: colour of 75% of usual in the 2.5 s before the grey began, with the streamer seen up.
   * A slow fade has none. The fall is remembered for 10 s, until the streamer looks up again, so a
   * fight still on screen a moment after the death does not lose it.
   */
  edgeRatio: 0.75,
  edgeMs: 2500,
  /** ...and a fall of a fifth of the usual colour or more from there: a fade is slower than that. */
  stepDrop: 0.2,
  fallMs: 10_000,
  /** Grey for a second, two samples at least; one stray sample inside it is forgiven. */
  deathMs: 1000,
  deathSamples: 2,
  /** Up: the world at 75% and the bar at 90% of usual, twice; with no bar to read, the world at 90%, four times. */
  liveRatio: 0.75,
  liveBar: 0.9,
  liveSamples: 2,
  liveBare: 0.9,
  liveBareSamples: 4,
  /** No death is shorter (the shortest timer is 10 s) or longer (the longest is 79 s); none comes sooner than 8 s after the last. */
  minDeadMs: 9000,
  deadMaxMs: 90_000,
  refractoryMs: 8000,
  /** Samples further apart than this, or an ad, and the streamer must be seen up again first; a tab silent this long is learned again. */
  gapMs: 5000,
  forgetMs: 180_000,
  /** Another scene: most of the minimap changed, or it lost its colour, for 3 s. */
  sceneShift: 40,
  sceneHeld: 0.3,
  sceneMs: 3000,
} as const

/** One corner where the minimap may be. */
export interface MapCorner {
  /** Each cell's colour and brightness. */
  chroma: number[]
  luma: number[]
  /** The 75th percentile of its cells' colour: whether the corner has colour at all. */
  m: number
  /** Median change of brightness across its cells since the last sample, and the largest; null for the first. */
  move: number | null
  life: number | null
}

/** One frame, in numbers. */
export interface LeagueFeatures {
  at: number
  /** The world's colour: the median over its lit cells, so a webcam or a panel over it does not count. */
  w: number
  /** The world's colour for its brightness, in percent: a darker scene keeps it, a grey one loses it. */
  s: number
  /** The world's brightness, and its texture: how far its lit cells' brightness strays from their median, in percent of it, so darkening keeps it. */
  l: number
  tex: number
  /** The ability bar's colour, and its brightness cell by cell. */
  a: number
  bar: number[]
  /** Median change of the world's brightness since the last sample; null for the first. */
  worldMove: number | null
  right: MapCorner
  left: MapCorner
}

const median = (xs: number[]): number => {
  if (!xs.length) return 0
  const s = [...xs].sort((a, b) => a - b)
  const h = s.length >> 1
  return s.length % 2 ? s[h] : (s[h - 1] + s[h]) / 2
}
const quantile = (xs: number[], q: number): number => {
  if (!xs.length) return 0
  const s = [...xs].sort((a, b) => a - b)
  return s[Math.min(s.length - 1, Math.floor(q * s.length))]
}
const mean = (xs: number[]): number => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0)
const known = (xs: (number | null)[]): number[] => xs.filter((x): x is number => x !== null)

function corner(g: StreamGrid, prev: StreamGrid | null, cells: number[]): MapCorner {
  const moves = prev ? cells.map((i) => Math.abs(g.luma[i] - prev.luma[i])) : null
  const chroma = cells.map((i) => g.chroma[i])
  return {
    chroma,
    luma: cells.map((i) => g.luma[i]),
    m: quantile(chroma, 0.75),
    move: moves ? median(moves) : null,
    life: moves ? Math.max(...moves) : null,
  }
}

/** A frame's numbers; null when it is too dark to read (a fade, a black screen). */
export function leagueFeatures(g: StreamGrid, prev: StreamGrid | null, at: number): LeagueFeatures | null {
  const lit = WORLD.filter((i) => g.lit[i] >= LEAGUE.cellLitMin)
  if (lit.length < LEAGUE.validMin * WORLD.length) return null
  const lumas = lit.map((i) => g.luma[i])
  const mid = median(lumas)
  return {
    at,
    w: median(lit.map((i) => g.chroma[i])),
    s: median(lit.map((i) => (100 * g.chroma[i]) / Math.max(g.luma[i], 16))),
    l: mean(WORLD.map((i) => g.luma[i])),
    tex: (100 * median(lumas.map((v) => Math.abs(v - mid)))) / Math.max(mid, 16),
    a: mean(BAR.map((i) => g.chroma[i])),
    bar: BAR.map((i) => g.luma[i]),
    worldMove: prev ? median(WORLD.map((i) => Math.abs(g.luma[i] - prev.luma[i]))) : null,
    right: corner(g, prev, MAP.right),
    left: corner(g, prev, MAP.left),
  }
}

/** What the detector remembers of one tab. Plain data, so it can be logged and tested. */
export interface DeathMemory {
  /** learning: building the baseline; watching: the streamer is up, or not seen down; dead: down until back up. */
  phase: 'learning' | 'watching' | 'dead'
  /** Seen up since the last gap, ad or death: only then can a step into grey be a death. */
  up: boolean
  /** Samples of the streamer alive, oldest first. Frozen while dead. */
  base: LeagueFeatures[]
  side: SideName | null
  /** The minimap's own cells in its corner, by their place in the corner's list. */
  mapCells: number[]
  /** The last few samples' colour, for the step into grey (a dark frame counts as 0). */
  recent: { at: number; w: number }[]
  /** The grey run going on: whether it began with a step from colour, and whether a stray sample broke it once. */
  run: { since: number; last: number; n: number; edge: boolean; miss: boolean } | null
  /** When the world last fell from colour into grey with the streamer up; null once they look up again. */
  fall: number | null
  liveN: number
  deadAt: number | null
  lastDeathAt: number | null
  sceneSince: number | null
  lastAt: number
}

export interface Baseline {
  w: number
  s: number
  l: number
  tex: number
  a: number
  /** The bar's usual brightness, cell by cell. */
  bar: number[]
  m: number
  /** The minimap corner's usual colour and brightness, cell by cell. */
  chroma: number[]
  luma: number[]
}

export type DeathEvent = 'learned' | 'death' | 'respawn' | 'reset'

export interface DeathTick {
  memory: DeathMemory
  event: DeathEvent | null
  /** Close to a death but not one: worth a line in the log, now and then. */
  near: boolean
  /** The sample's numbers against the baseline, for the log. */
  seen: string
}

const fresh = (at: number): DeathMemory => ({ phase: 'learning', up: false, base: [], side: null, mapCells: [], recent: [], run: null, fall: null, liveN: 0, deadAt: null, lastDeathAt: null, sceneSince: null, lastAt: at })

/** The usual picture, from the alive samples; null until there is a minimap side. */
export function baselineOf(m: DeathMemory): Baseline | null {
  const side = m.side
  if (!side || !m.base.length) return null
  const n = m.base[0][side].luma.length
  return {
    w: median(m.base.map((b) => b.w)),
    s: median(m.base.map((b) => b.s)),
    l: median(m.base.map((b) => b.l)),
    tex: median(m.base.map((b) => b.tex)),
    a: median(m.base.map((b) => b.a)),
    bar: m.base[0].bar.map((_, i) => median(m.base.map((b) => b.bar[i]))),
    m: median(m.base.map((b) => b[side].m)),
    chroma: Array.from({ length: n }, (_, i) => median(m.base.map((b) => b[side].chroma[i]))),
    luma: Array.from({ length: n }, (_, i) => median(m.base.map((b) => b[side].luma[i]))),
  }
}

/** Why the detector is still learning: too little seen yet, the picture does not move, or no minimap. */
export function learningWhy(m: DeathMemory): 'too little seen' | 'no movement' | 'no minimap' {
  if (m.base.length < LEAGUE.baseMin || m.base[m.base.length - 1].at - m.base[0].at < LEAGUE.baseMinMs) return 'too little seen'
  if (median(known(m.base.map((b) => b.worldMove))) < LEAGUE.worldMoveMin) return 'no movement'
  return 'no minimap'
}

/**
 * The corner that holds the minimap, and its cells: the coloured ones that held still while the
 * world moved, five at least, with something moving somewhere in the corner. The right corner,
 * League's default, whenever it is such a corner; the left only when it is not.
 */
function mapOf(base: LeagueFeatures[]): { side: SideName; cells: number[] } | null {
  const of = (side: SideName) => {
    const n = base[0][side].luma.length
    const cells: number[] = []
    for (let i = 0; i < n; i++) {
      const lumas = base.map((b) => b[side].luma[i])
      const usual = median(lumas)
      const still = median(lumas.map((v) => Math.abs(v - usual))) <= LEAGUE.mapStillCell
      const colour = median(base.map((b) => b[side].chroma[i]))
      if (still && colour >= LEAGUE.mapCell && colour <= LEAGUE.mapMax) cells.push(i)
    }
    const life = mean(known(base.map((b) => b[side].life)))
    return cells.length >= LEAGUE.mapCellsMin && life >= LEAGUE.mapLife ? { side, cells } : null
  }
  return of('right') ?? of('left')
}

/** The minimap as it is now against its usual self: the share of its cells that kept their colour, and how far most of it moved. */
function mapNow(c: MapCorner, b: Baseline, cells: number[]): { held: number; shift: number } {
  if (!cells.length) return { held: 0, shift: 255 }
  const held = cells.filter((i) => c.chroma[i] >= LEAGUE.mapKeep * b.chroma[i]).length / cells.length
  return { held, shift: median(cells.map((i) => Math.abs(c.luma[i] - b.luma[i]))) }
}

const barReads = (b: Baseline) => b.a >= LEAGUE.barMin

/** The bar is still the bar: its cells' brightness goes with its usual pattern (a dimmed bar keeps it; a card or clip over it does not). */
function barInPlace(f: LeagueFeatures, b: Baseline): boolean {
  const mx = mean(b.bar)
  const my = mean(f.bar)
  let sxy = 0
  let sxx = 0
  let syy = 0
  for (let i = 0; i < b.bar.length; i++) {
    const dx = b.bar[i] - mx
    const dy = f.bar[i] - my
    sxy += dx * dy
    sxx += dx * dx
    syy += dy * dy
  }
  // A flat bar has no pattern to keep.
  if (sxx < 4 * b.bar.length) return true
  if (syy < 1e-6) return false
  return sxy / Math.sqrt(sxx * syy) >= LEAGUE.barCorr
}
/** The streamer looks up: the world in colour, and the bar lit (or, with no bar to read, the world nearly as usual). */
const looksUp = (f: LeagueFeatures, b: Baseline) => f.w >= LEAGUE.liveRatio * b.w && (barReads(b) ? f.a >= LEAGUE.liveBar * b.a : f.w >= LEAGUE.liveBare * b.w)
const upSamples = (b: Baseline) => (barReads(b) ? LEAGUE.liveSamples : LEAGUE.liveBareSamples)

const r1 = (x: number) => Math.round(x * 10) / 10

/** One sample: the detector's memory before it, the frame's numbers (null for a dark frame), whether an ad plays. */
export function leagueStep(mem: DeathMemory | null, f: LeagueFeatures | null, hints: { ad: boolean }, at: number): DeathTick {
  let m: DeathMemory = mem ? { ...mem, base: mem.base.slice(), recent: mem.recent.slice(), run: mem.run && { ...mem.run } } : fresh(at)
  let event: DeathEvent | null = null
  // Not seen for a while, or an ad: anything may have happened meanwhile, so the streamer must be
  // seen up again before a step into grey counts.
  const lose = () => {
    m.run = null
    m.fall = null
    m.recent = []
    m.liveN = 0
    m.up = false
  }
  if (mem && at - mem.lastAt > LEAGUE.forgetMs) {
    m = fresh(at)
    event = 'reset'
  } else if (mem && at - mem.lastAt > LEAGUE.gapMs) lose()
  m.lastAt = at
  const keep = (w: number) => {
    m.recent.push({ at, w })
    m.recent = m.recent.filter((x) => at - x.at <= 2 * LEAGUE.edgeMs)
  }
  const done = (seen: string, near = false): DeathTick => ({ memory: m, event, near, seen })
  if (hints.ad) {
    lose()
    return done('an ad')
  }
  if (!f) {
    if (m.phase === 'learning') m.base = []
    // A dark frame inside a death is forgiven once, like any stray sample.
    if (m.run) {
      if (m.run.miss) m.run = null
      else m.run.miss = true
    }
    keep(0)
    return done('dark')
  }
  const admit = () => {
    m.base.push(f)
    m.base = m.base.filter((b) => at - b.at <= LEAGUE.forgetMs).slice(-LEAGUE.baseMax)
  }

  if (m.phase === 'learning') {
    // Only unbroken colour: anything under the floor starts over, so a death with fights on screen is never learned as usual.
    if (f.w >= LEAGUE.baseFloor) admit()
    else m.base = []
    const map = learningWhy(m) === 'no minimap' ? mapOf(m.base) : null
    const side = map?.side ?? null
    if (map) {
      m.side = map.side
      m.mapCells = map.cells
      m.phase = 'watching'
      m.up = false
      m.liveN = 0
      event = 'learned'
    }
    keep(f.w)
    const b = baselineOf(m)
    return done(b ? `world ${r1(b.w)} sat ${r1(b.s)} tex ${r1(b.tex)} bar ${r1(b.a)} map ${r1(b.m)} ${side}, ${m.mapCells.length} cells, light ${r1(b.l)}` : `learning: world ${r1(f.w)} bar ${r1(f.a)} light ${r1(f.l)}`)
  }

  const b = baselineOf(m) as Baseline
  const map = mapNow(f[m.side as SideName], b, m.mapCells)
  const seen = `world ${r1(f.w)}/${r1(b.w)} sat ${r1(f.s)}/${r1(b.s)} tex ${r1(f.tex)}/${r1(b.tex)} bar ${r1(f.a)}/${r1(b.a)} map ${r1(map.held)} shift ${r1(map.shift)} light ${r1(f.l)}/${r1(b.l)} ${m.phase}${m.up ? ' up' : ''}`

  // Another scene (the client, a break, another game): learn the picture again.
  if (map.shift > LEAGUE.sceneShift || map.held < LEAGUE.sceneHeld) {
    m.sceneSince ??= at
    if (at - m.sceneSince >= LEAGUE.sceneMs) {
      m = fresh(at)
      event = 'reset'
      return done(seen)
    }
  } else m.sceneSince = null

  const up = looksUp(f, b)
  if (m.phase === 'dead') {
    m.liveN = up ? m.liveN + 1 : 0
    const deadFor = at - (m.deadAt ?? at)
    if (m.liveN >= upSamples(b) && deadFor >= LEAGUE.minDeadMs) {
      m.phase = 'watching'
      m.up = true
      m.liveN = 0
      m.run = null
      event = 'respawn'
      admit()
    } else if (deadFor >= LEAGUE.deadMaxMs) {
      // Down longer than any death: whatever this is, the streamer must be seen up before the next one.
      m.phase = 'watching'
      m.up = false
      m.liveN = 0
      m.run = null
      event = 'respawn'
    }
    keep(f.w)
    return done(seen)
  }

  if (!m.up) {
    m.liveN = up ? m.liveN + 1 : 0
    if (m.liveN >= upSamples(b)) {
      m.up = true
      m.liveN = 0
    }
  }
  if (up) m.fall = null
  const inPlace = barReads(b) && barInPlace(f, b)
  const drained = f.s <= LEAGUE.satRatio * b.s
  const greyWorld = f.w <= Math.min(LEAGUE.greyRatio * b.w, LEAGUE.greyCap) && drained
  const barDim = barReads(b) ? inPlace && f.a <= LEAGUE.barRatio * b.a : f.w <= LEAGUE.deepRatio * b.w
  // Drained, with the texture kept (a flat window over the world is not a death).
  const greyDrained = greyWorld && barDim && f.tex >= LEAGUE.texRatio * b.tex
  // The bar gone dark: the HUD itself says dead, whatever lies over the world.
  const greyDark = inPlace && f.a <= LEAGUE.barStrong * b.a && (f.w <= LEAGUE.greyLoose * b.w || drained)
  const mapHeld = map.held >= LEAGUE.mapHeld && map.shift <= LEAGUE.mapShift
  const lit = f.l >= Math.max(LEAGUE.lightRatio * b.l, LEAGUE.lightMin) && f.l <= LEAGUE.lightMax * b.l
  // The step from colour: the most colour in the 2.5 s before `since`, and how far it fell to now.
  const stepTo = (since: number) => {
    const before = m.recent.filter((x) => x.at >= since - LEAGUE.edgeMs && x.at < since)
    const top = before.length ? Math.max(...before.map((x) => x.w)) : 0
    return m.up && top >= LEAGUE.edgeRatio * b.w && top - f.w >= LEAGUE.stepDrop * b.w
  }
  if ((greyDrained || greyDark) && mapHeld && lit) {
    if (!m.run) {
      const step = stepTo(at)
      const fell = m.fall !== null && at - m.fall <= LEAGUE.fallMs
      if (step && !fell) m.fall = at
      m.run = { since: at, last: at, n: 1, edge: step || fell, miss: false }
    } else {
      m.run.n++
      m.run.last = at
      m.run.miss = false
      // A run that began on a sample caught mid-fade gets its step once the grey has gone deep enough.
      if (!m.run.edge && stepTo(m.run.since)) {
        m.run.edge = true
        m.fall ??= at
      }
    }
    const r = m.run
    if (r.edge && r.n >= LEAGUE.deathSamples && r.last - r.since >= LEAGUE.deathMs && (m.lastDeathAt === null || at - m.lastDeathAt >= LEAGUE.refractoryMs)) {
      m.phase = 'dead'
      m.deadAt = at
      m.lastDeathAt = at
      m.run = null
      m.fall = null
      m.liveN = 0
      m.up = false
      event = 'death'
    }
    keep(f.w)
    return done(seen)
  }
  // One stray sample inside a grey run (a flash of colour from a fight, a frame read badly) is
  // forgiven, unless the streamer plainly looks up.
  if (m.run && !m.run.miss && !up) {
    m.run.miss = true
    keep(f.w)
    return done(seen)
  }
  m.run = null
  // The usual picture only from the streamer seen up, not from a fight on screen just after a fall.
  if (m.up && m.fall === null) admit()
  keep(f.w)
  return done(seen, f.w <= LEAGUE.edgeRatio * b.w && (greyWorld || barDim || greyDark))
}

// ---------------------------------------------------------------------------------------------
// What a death does

/** A death switches only when the rule may still run, no League match of yours is on, and it did not just switch for another. */
export function deathStep(s: MayorlyState, deviceId: string, o: { ownMatch: boolean; sinceFireMs: number }): PromptStep {
  const arm = streamArm(s, deviceId)
  if (!arm.on) return { act: null, why: arm.why }
  if (o.ownMatch) return { act: null, why: 'your own League match is running' }
  if (o.sinceFireMs < PROMPT_ECHO_MS) return { act: null, why: 'switched a moment ago' }
  const act = quickSwitch(s)
  if (!act) return { act: null, why: 'no recent task to switch to' }
  return { act, why: 'switched' }
}

/** A switch of yours this soon after the rule switched is the same death, seen by you too. */
export const GRACE_MS = 3000

/**
 * Your own Alt+Q right after the rule switched would take you back to the stream: you saw the death
 * too and pressed a beat later. Within GRACE_MS such a switch, or a pick of the stream's task, is let go.
 */
export function graceStep(a: Action, s: MayorlyState, fired: { at: number; taskId: Id } | null, now: number): { drop: boolean; why: string } {
  if (!fired || now - fired.at >= GRACE_MS || onDeskId(s) === fired.taskId) return { drop: false, why: '' }
  const target = a.type === 'desk/switch' ? switchTarget(s) : a.type === 'desk/select' ? (a.leisureId ?? a.entryId ?? null) : null
  const back = target === fired.taskId
  return back ? { drop: true, why: `already switched: your switch ${((now - fired.at) / 1000).toFixed(1)} s after the death let go` } : { drop: false, why: '' }
}

/** Where the plain switch would take the desk now: the swap-back, else the parked session. */
function switchTarget(s: MayorlyState): Id | null {
  const back = switchBack(s)
  if (back) return back.leisureId ?? back.entryId ?? null
  const held = switchSession(s)
  return held ? (held.block.leisureId ?? held.block.entryId ?? null) : null
}

/** What the couch list says beside a watched rule. */
export type StreamWord =
  | 'Watching the stream'
  | 'Learning the stream'
  | 'No minimap in view'
  | 'Streamer is down'
  | 'No stream seen'
  | 'Stream hidden'
  | 'Stream cannot be read'
  | 'Not League'
  | 'Off in Settings'

export interface StreamStatus {
  taskId: Id | null
  word: StreamWord | null
}
