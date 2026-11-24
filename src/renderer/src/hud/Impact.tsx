import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { useReducedMotion } from 'motion/react'
import type { ImpactStyle } from '@core/index'
import type { ImpactEffect } from '../../../shared/bridge'
import { reachOf, sweepOf } from '../../../shared/impact'
import { SwitchPulse } from './SwitchPulse'

// A moment on the desk hitting the screen (shared/impact.ts says which, in what style and colour).
// Everything is timed from the effect's `at`, not from when this page heard of it, so the same wave
// is at the same place on every screen, and a window that shows late joins it where it has got to.
// It draws only on its own layer: the person's windows never move and the screen is never captured.
// Under reduced motion every style is the edge glow without its jolt.

/** When the switch sound's hit lands (lib/sfx.ts, switchCue): the waves leave the tomato with it. */
const HIT = 85
/** Each style, from the start to the last of it gone. */
const LENGTH: Record<Exclude<ImpactStyle, 'off'>, number> = { edges: 1100, ripple: 2150, shockwave: 950, sweep: 1350, tide: 1750 }
/** The words: in with the hit, held, gone. */
const WORDS = 1750

interface Geo {
  W: number
  H: number
  ox: number
  oy: number
  reach: number
  dir: 1 | -1
  reachX: number
  rgb: [number, number, number]
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
          {effect.impact.title && <span className="impact-title">{effect.impact.title}</span>}
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
  return { W, H, ox: o.x, oy: o.y, reach: effect.reach ?? reachOf(o, own), dir: sweep.dir, reachX: sweep.reachX, rgb: rgbOf(effect.impact.color) }
}

function ImpactCanvas({ effect, style }: { effect: ImpactEffect; style: Exclude<ImpactStyle, 'off' | 'edges'> }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const c = ref.current
    const ctx = c?.getContext('2d')
    if (!c || !ctx) return
    const g = geoOf(effect)
    const dpr = window.devicePixelRatio || 1
    c.width = Math.round(g.W * dpr)
    c.height = Math.round(g.H * dpr)
    ctx.scale(dpr, dpr)
    const draw = DRAW[style]
    let raf = 0
    const frame = () => {
      ctx.clearRect(0, 0, g.W, g.H)
      if (draw(ctx, Date.now() - effect.at, g)) raf = requestAnimationFrame(frame)
    }
    raf = requestAnimationFrame(frame)
    return () => cancelAnimationFrame(raf)
  }, [effect, style])
  // The jolt (the stylesheet's) lands with the hit, wherever this screen joined.
  return <canvas ref={ref} className={`impact-canvas is-${style}`} style={{ animationDelay: `${HIT - Math.max(0, Date.now() - effect.at)}ms` }} />
}

type Draw = (ctx: CanvasRenderingContext2D, t: number, g: Geo) => boolean

const DRAW: Record<Exclude<ImpactStyle, 'off' | 'edges'>, Draw> = {
  /**
   * A tsunami: a splash at the tomato, then three crests rolling out to the farthest corner of every
   * screen, each a wall of colour with white foam on its lip and a thin wash of water behind it. The
   * crests leave fast and slow as they spread, and grow taller as they go, like a wave building.
   */
  ripple(ctx, t, g) {
    const travel = 1500
    const gap = 180
    let alive = splash(ctx, t - HIT, g, 220, 110)
    for (let k = 0; k < 3; k++) {
      const p = (t - HIT - k * gap) / travel
      if (p < 0) {
        alive = true
        continue
      }
      if (p >= 1) continue
      alive = true
      const e = 1 - Math.pow(1 - p, 2.2)
      const r = e * g.reach
      const w = 24 + 190 * e
      const a = Math.pow(1 - p, 1.25) * [1, 0.62, 0.36][k]
      ring(ctx, g, Math.max(0, r - w * 2.8), r + w * 0.22, [
        [0, rgba(g.rgb, 0)],
        [0.45, rgba(g.rgb, 0.2 * a)],
        [0.8, rgba(g.rgb, 0.62 * a)],
        [0.9, rgba(g.rgb, 0.78 * a)],
        [0.95, rgba(foam(g.rgb), 0.9 * a)],
        [1, rgba(g.rgb, 0)],
      ])
    }
    return alive || t < LENGTH.ripple
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
      ring(ctx, g, Math.max(0, r - w * 1.6), r + w * 0.3, [
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
    for (let x = 0; x <= g.W + 24; x += 24) {
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

/** A bright drop at the tomato as the hit lands, swelling and fading: where the wave comes from. */
function splash(ctx: CanvasRenderingContext2D, t: number, g: Geo, ms: number, size: number): boolean {
  if (t < 0) return true
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

/** The band between two radii round the tomato, filled with a gradient across it: only the band is painted. */
function ring(ctx: CanvasRenderingContext2D, g: Geo, inner: number, outer: number, stops: [number, string][]) {
  if (outer <= 0) return
  const grad = ctx.createRadialGradient(g.ox, g.oy, inner, g.ox, g.oy, outer)
  for (const [at, c] of stops) grad.addColorStop(at, c)
  ctx.fillStyle = grad
  ctx.beginPath()
  ctx.arc(g.ox, g.oy, outer, 0, Math.PI * 2)
  if (inner > 0) ctx.arc(g.ox, g.oy, inner, 0, Math.PI * 2, true)
  ctx.fill('evenodd')
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
