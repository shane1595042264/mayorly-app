import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { useReducedMotion } from 'motion/react'
import type { ImpactStyle } from '@core/index'
import type { ImpactEffect } from '../../../shared/bridge'
import { reachOf, sweepOf, type Walls } from '../../../shared/impact'
import { bridge } from '../bridge'
import { SwitchPulse } from './SwitchPulse'
import { Wobble } from './Wobble'

// A moment on the desk hitting the screen (shared/impact.ts says which, in what style and colour).
// Everything is timed from the effect's `at`, not from when this page heard of it, so the same wave
// is at the same place on every screen, and a window that shows late joins it where it has got to.
// It draws only on its own layer: the person's windows never move and the screen is never captured.
// Under reduced motion every style is the edge glow without its jolt.
//
// Speed: on Windows the overlay is a transparent window, which Chromium paints in software, so a
// canvas the size of the screen is costly every frame. The canvas is drawn at half resolution (the
// water is soft; the compositor scales it up), and the words animate only by transform and opacity.
// A run whose frames came slow says so in the log, with its numbers.

/** When the switch sound's hit lands (lib/sfx.ts, switchCue): the waves leave the tomato with it. */
const HIT = 85
/** Each style, from the start to the last of it gone. */
const LENGTH: Record<Exclude<ImpactStyle, 'off'>, number> = { edges: 1100, ripple: 2300, shockwave: 950, sweep: 1350, tide: 1750 }
/** The words: in with the hit, held, gone. */
const WORDS = 1750
/** The canvas's resolution against the screen's. */
const RES = 0.5
const ALL_WALLS: Walls = { left: true, right: true, top: true, bottom: true }

interface Geo {
  W: number
  H: number
  ox: number
  oy: number
  reach: number
  dir: 1 | -1
  reachX: number
  rgb: [number, number, number]
  walls: Wall[]
}

/** An edge the wave crashes into: where it is, how far the tomato is from it, the tomato's mirror image in it, and which way is inward. */
interface Wall {
  d: number
  mx: number
  my: number
  /** A point on the wall at `s` along it, `s` from 0 to its length. */
  at: (s: number) => [number, number]
  length: number
  nx: number
  ny: number
}

export function ImpactLayer({ effect, words, onDone }: { effect: ImpactEffect; words: boolean; onDone: () => void }) {
  const reduce = useReducedMotion()
  const style = effect.impact.style === 'off' ? 'edges' : effect.impact.style
  const [elapsed] = useState(() => Math.max(0, Date.now() - effect.at))
  const done = useRef(onDone)
  done.current = onDone
  useEffect(() => {
    const total = Math.max(LENGTH[style], words ? WORDS : 0)
    const t = setTimeout(() => done.current(), Math.max(0, total - elapsed))
    return () => clearTimeout(t)
  }, [style, words, elapsed])
  return (
    <div className="impact" aria-hidden style={{ '--impact': effect.impact.color } as CSSProperties}>
      {reduce || style === 'edges' ? <SwitchPulse color={effect.impact.color} onDone={() => {}} /> : <ImpactCanvas effect={effect} style={style} />}
      {words && (
        <div className="impact-words" style={{ animationDelay: `${-elapsed}ms` }}>
          <span className="impact-kicker">{effect.impact.kicker}</span>
          {effect.impact.title && <Wobble className="impact-title" text={effect.impact.title} still={!!reduce} />}
        </div>
      )}
    </div>
  )
}

/** Where the tomato is on this page when the shell did not say (the browser build): its sprite, else the bottom right. */
function geoOf(effect: ImpactEffect): Geo {
  const W = window.innerWidth
  const H = window.innerHeight
  const sprite = document.querySelector('.pet-sprite')?.getBoundingClientRect()
  const o = effect.origin ?? (sprite ? { x: sprite.left + sprite.width / 2, y: sprite.top + sprite.height / 2 } : { x: W - 90, y: H - 90 })
  const own = [{ x: 0, y: 0, width: W, height: H }]
  const sweep = effect.sweep ?? sweepOf(o, own)
  const w = effect.walls ?? ALL_WALLS
  const walls: Wall[] = []
  // Only walls the wave meets from inside this screen: the tomato on their inner side.
  if (w.left && o.x >= 0) walls.push({ d: o.x, mx: -o.x, my: o.y, at: (s) => [0, s], length: H, nx: 1, ny: 0 })
  if (w.right && o.x <= W) walls.push({ d: W - o.x, mx: 2 * W - o.x, my: o.y, at: (s) => [W, s], length: H, nx: -1, ny: 0 })
  if (w.top && o.y >= 0) walls.push({ d: o.y, mx: o.x, my: -o.y, at: (s) => [s, 0], length: W, nx: 0, ny: 1 })
  if (w.bottom && o.y <= H) walls.push({ d: H - o.y, mx: o.x, my: 2 * H - o.y, at: (s) => [s, H], length: W, nx: 0, ny: -1 })
  return { W, H, ox: o.x, oy: o.y, reach: effect.reach ?? reachOf(o, own), dir: sweep.dir, reachX: sweep.reachX, rgb: rgbOf(effect.impact.color), walls }
}

function ImpactCanvas({ effect, style }: { effect: ImpactEffect; style: Exclude<ImpactStyle, 'off' | 'edges'> }) {
  const ref = useRef<HTMLCanvasElement>(null)
  const [g] = useState(() => geoOf(effect))
  // The jolt (the stylesheet's) lands with the hit, or for a tsunami when its first crest hits a wall.
  const [joltAt] = useState(() => (style === 'ripple' && g.walls.length ? Math.min(...g.walls.map((w) => crestAt(w.d, 0, g.reach))) : HIT))
  useEffect(() => {
    const c = ref.current
    const ctx = c?.getContext('2d')
    if (!c || !ctx) return
    c.width = Math.max(1, Math.round(g.W * RES))
    c.height = Math.max(1, Math.round(g.H * RES))
    ctx.scale(RES, RES)
    const draw = DRAW[style]
    let raf = 0
    let last = 0
    let frames = 0
    let worst = 0
    const began = performance.now()
    const report = () => {
      const ms = performance.now() - began
      if (frames > 3 && (worst > 70 || ms / frames > 24)) {
        bridge.log('warn', `[impact] ${style} slow: ${frames} frames in ${Math.round(ms)} ms, worst ${Math.round(worst)} ms, canvas ${c.width}x${c.height} for ${g.W}x${g.H}`)
      }
    }
    const frame = (now: number) => {
      if (last) worst = Math.max(worst, now - last)
      last = now
      frames++
      ctx.clearRect(0, 0, g.W, g.H)
      const t = Date.now() - effect.at
      if (!Number.isFinite(t) || !Number.isFinite(g.ox + g.oy + g.reach)) return
      if (draw(ctx, t, g)) raf = requestAnimationFrame(frame)
      else report()
    }
    raf = requestAnimationFrame(frame)
    return () => cancelAnimationFrame(raf)
  }, [effect, style, g])
  return <canvas ref={ref} className={`impact-canvas is-${style}`} style={{ animationDelay: `${joltAt - Math.max(0, Date.now() - effect.at)}ms` }} />
}

type Draw = (ctx: CanvasRenderingContext2D, t: number, g: Geo) => boolean

/** The tsunami's crests: how long one takes to reach the farthest corner, the gap between them, how many. */
const TRAVEL = 1500
const GAP = 180
const CRESTS = 3
const SURGE = 2.2
/** How long a crash at a wall throws spray. */
const SPRAY_MS = 560

/** How far crest `k` has run at `t`: its radius, and how far through its run (0 to 1); null before it leaves or once it is done. */
function crestRun(t: number, k: number, reach: number): { r: number; p: number; e: number } | null {
  const p = (t - HIT - k * GAP) / TRAVEL
  if (p < 0 || p >= 1) return null
  const e = 1 - Math.pow(1 - p, SURGE)
  return { r: e * reach, p, e }
}

/** When crest `k` reaches `d` from the tomato. */
function crestAt(d: number, k: number, reach: number): number {
  if (d >= reach) return Infinity
  return HIT + k * GAP + (1 - Math.pow(1 - d / reach, 1 / SURGE)) * TRAVEL
}

const DRAW: Record<Exclude<ImpactStyle, 'off' | 'edges'>, Draw> = {
  /**
   * A tsunami: a splash at the tomato, then three crests rolling out, each a wall of colour with white
   * foam on its lip and a wash of water behind it, fast at first and growing taller as they go. Where
   * a crest meets the edge of the screen it crashes: spray thrown back off the edge where it hits,
   * running along the edge as the crest does, and the crest bounces back into the screen, weaker
   * (drawn from the tomato's mirror image in that edge, which is where a reflected wave comes from).
   * Where another screen touches, there is no edge: the crest runs on into it.
   */
  ripple(ctx, t, g) {
    let alive = splash(ctx, t - HIT, g, 220, 110) || t < HIT
    for (let k = 0; k < CRESTS; k++) {
      const run = crestRun(t, k, g.reach)
      if (!run) {
        if (t < HIT + k * GAP) alive = true
        continue
      }
      alive = true
      const strength = [1, 0.62, 0.36][k] * Math.pow(1 - run.p, 1.25)
      const w = 24 + 190 * run.e
      crest(ctx, g.ox, g.oy, run.r, w, strength, g.rgb)
      // The bounce: the crest past each wall it reached comes back off it.
      for (const wall of g.walls) if (run.r > wall.d) crest(ctx, wall.mx, wall.my, run.r, w * 0.8, strength * 0.5, g.rgb)
    }
    for (const wall of g.walls) if (spray(ctx, t, g, wall)) alive = true
    return alive
  },

  /** One hard ring out to every edge, a flash at the tomato and a short glow at the screen's rim, with a jolt (the stylesheet's). */
  shockwave(ctx, t, g) {
    const p = (t - HIT) / 560
    if (p < 0) return true
    let alive = splash(ctx, t - HIT, g, 150, 80)
    if (p < 1) {
      alive = true
      const e = 1 - Math.pow(1 - p, 3)
      const r = e * g.reach
      const w = 16 + 84 * e
      const a = Math.pow(1 - p, 1.2)
      ring(ctx, g.ox, g.oy, Math.max(0, r - w * 1.6), r + w * 0.3, [
        [0, rgba(g.rgb, 0)],
        [0.35, rgba(g.rgb, 0.3 * a)],
        [0.7, rgba(g.rgb, 0.8 * a)],
        [0.85, rgba(foam(g.rgb), a)],
        [1, rgba(g.rgb, 0)],
      ])
    }
    const v = 1 - (t - HIT) / 420
    if (v > 0) {
      alive = true
      const cx = g.W / 2
      const cy = g.H / 2
      const grad = ctx.createRadialGradient(cx, cy, Math.min(g.W, g.H) * 0.32, cx, cy, Math.hypot(g.W, g.H) / 2)
      grad.addColorStop(0, rgba(g.rgb, 0))
      grad.addColorStop(1, rgba(g.rgb, 0.7 * Math.pow(v, 1.5)))
      ctx.fillStyle = grad
      ctx.fillRect(0, 0, g.W, g.H)
    }
    return alive
  },

  /** A band of colour with a bright leading edge crosses every screen away from the tomato, its tail thinning behind it. */
  sweep(ctx, t, g) {
    const p = (t - HIT) / 1050
    if (p < 0) return true
    if (p >= 1) return false
    const e = p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2
    const tail = 460
    const x = g.ox + g.dir * e * (g.reachX + 120)
    const from = x - g.dir * tail
    const a = 1 - Math.pow(p, 3)
    const grad = ctx.createLinearGradient(from, 0, x + g.dir * 24, 0)
    grad.addColorStop(0, rgba(g.rgb, 0))
    grad.addColorStop(0.7, rgba(g.rgb, 0.3 * a))
    grad.addColorStop(0.95, rgba(foam(g.rgb), 0.8 * a))
    grad.addColorStop(1, rgba(g.rgb, 0))
    ctx.fillStyle = grad
    const left = Math.min(from, x + g.dir * 24)
    ctx.fillRect(left, 0, Math.abs(x + g.dir * 24 - from), g.H)
    return true
  },

  /** The colour rises from the bottom of the screen as water would, with a moving crest of foam, then drains away. */
  tide(ctx, t, g) {
    const p = (t - HIT) / 1600
    if (p < 0) return true
    if (p >= 1) return false
    const level = g.H * 0.36 * Math.sin(Math.PI * Math.min(1, p * 1.15)) * (p < 0.87 ? 1 : 1 - (p - 0.87) / 0.13)
    if (level <= 0.5) return true
    const top = g.H - level
    ctx.beginPath()
    ctx.moveTo(0, g.H)
    for (let x = 0; x <= g.W + 32; x += 32) {
      ctx.lineTo(x, top + Math.sin(x / 150 + t / 170) * 13 + Math.sin(x / 61 - t / 240) * 5)
    }
    ctx.lineTo(g.W, g.H)
    ctx.closePath()
    const grad = ctx.createLinearGradient(0, top - 18, 0, g.H)
    grad.addColorStop(0, rgba(foam(g.rgb), 0.7))
    grad.addColorStop(0.06, rgba(g.rgb, 0.4))
    grad.addColorStop(1, rgba(g.rgb, 0.12))
    ctx.fillStyle = grad
    ctx.fill()
    return true
  },
}

/** One crest round (cx, cy): colour building to a lip of foam at radius r, a thin wash behind it. */
function crest(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, w: number, a: number, rgb: [number, number, number]) {
  ring(ctx, cx, cy, Math.max(0, r - w * 2.8), r + w * 0.22, [
    [0, rgba(rgb, 0)],
    [0.45, rgba(rgb, 0.2 * a)],
    [0.8, rgba(rgb, 0.62 * a)],
    [0.9, rgba(rgb, 0.78 * a)],
    [0.95, rgba(foam(rgb), 0.9 * a)],
    [1, rgba(rgb, 0)],
  ])
}

/**
 * The crash where crests meet a wall: along the wall, each spot throws foam back into the screen the
 * moment a crest reaches it, a burst that swells and falls away, and a few drops flung farther in. The
 * spots a crest reaches spread out along the wall from the nearest one, so the crash runs along it.
 * Every spot has its own size and throw, the same every frame (a hash of where it is).
 */
function spray(ctx: CanvasRenderingContext2D, t: number, g: Geo, wall: Wall): boolean {
  const step = 30
  let alive = false
  const lip = foam(g.rgb)
  for (let k = 0; k < 2; k++) {
    const power = k === 0 ? 1 : 0.55
    for (let s = step / 2; s < wall.length; s += step) {
      const [px, py] = wall.at(s)
      const hit = crestAt(Math.hypot(px - g.ox, py - g.oy), k, g.reach)
      const age = t - hit
      if (age < 0) {
        if (hit !== Infinity) alive = true
        continue
      }
      if (age >= SPRAY_MS) continue
      alive = true
      const q = age / SPRAY_MS
      const out = 1 - Math.pow(1 - q, 3)
      const h = hash(s * 7.13 + k * 101 + wall.length)
      const fade = Math.pow(1 - q, 1.5) * power
      // The burst at the wall: soft-edged, so it reads as spray, not a bubble.
      const size = (14 + 34 * h) * (0.45 + 0.75 * out)
      const push = 6 + (24 + 30 * h) * out
      const bx = px + wall.nx * push
      const by = py + wall.ny * push
      const blob = ctx.createRadialGradient(bx, by, 0, bx, by, size)
      blob.addColorStop(0, rgba(lip, 0.8 * fade))
      blob.addColorStop(0.55, rgba(lip, 0.45 * fade))
      blob.addColorStop(1, rgba(g.rgb, 0))
      ctx.fillStyle = blob
      ctx.beginPath()
      ctx.arc(bx, by, size, 0, Math.PI * 2)
      ctx.fill()
      // Two drops thrown farther in, one to each side.
      for (const side of [-1, 1]) {
        const h2 = hash(s * 3.7 + side * 13 + k * 17)
        const throwPx = (70 + 190 * h2) * q * (1.35 - q)
        const along = side * (8 + 22 * h2) * out
        const dx = wall.nx * throwPx + (wall.nx === 0 ? along : 0)
        const dy = wall.ny * throwPx + (wall.ny === 0 ? along : 0)
        ctx.fillStyle = rgba(lip, 0.75 * fade)
        ctx.beginPath()
        ctx.arc(px + dx, py + dy, 2.5 + 4 * h2 * (1 - q), 0, Math.PI * 2)
        ctx.fill()
      }
    }
  }
  return alive
}

/** A bright drop at the tomato as the hit lands, swelling and fading: where the wave comes from. */
function splash(ctx: CanvasRenderingContext2D, t: number, g: Geo, ms: number, size: number): boolean {
  if (t < 0) return false
  const p = t / ms
  if (p >= 1) return false
  const r = 12 + size * (1 - Math.pow(1 - p, 3))
  const grad = ctx.createRadialGradient(g.ox, g.oy, 0, g.ox, g.oy, r)
  grad.addColorStop(0, rgba(foam(g.rgb), 0.9 * (1 - p)))
  grad.addColorStop(0.5, rgba(g.rgb, 0.55 * (1 - p)))
  grad.addColorStop(1, rgba(g.rgb, 0))
  ctx.fillStyle = grad
  ctx.beginPath()
  ctx.arc(g.ox, g.oy, r, 0, Math.PI * 2)
  ctx.fill()
  return true
}

/** The band between two radii round (cx, cy), filled with a gradient across it: only the band is painted. */
function ring(ctx: CanvasRenderingContext2D, cx: number, cy: number, inner: number, outer: number, stops: [number, string][]) {
  if (outer <= 0) return
  const grad = ctx.createRadialGradient(cx, cy, inner, cx, cy, outer)
  for (const [at, c] of stops) grad.addColorStop(at, c)
  ctx.fillStyle = grad
  ctx.beginPath()
  ctx.arc(cx, cy, outer, 0, Math.PI * 2)
  if (inner > 0) ctx.arc(cx, cy, inner, 0, Math.PI * 2, true)
  ctx.fill('evenodd')
}

/** A number from 0 to 1 that is the same for the same input. */
function hash(n: number): number {
  const x = Math.sin(n * 12.9898) * 43758.5453
  return x - Math.floor(x)
}

function rgbOf(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) return [240, 174, 60]
  const n = parseInt(m[1], 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

/** The colour washed most of the way to white: the foam on a crest. */
const foam = ([r, g, b]: [number, number, number]): [number, number, number] => [r + (255 - r) * 0.6, g + (255 - g) * 0.6, b + (255 - b) * 0.6]

const rgba = ([r, g, b]: [number, number, number], a: number) => `rgba(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)}, ${Math.max(0, Math.min(1, a)).toFixed(3)})`
