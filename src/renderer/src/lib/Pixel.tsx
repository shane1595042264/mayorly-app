import { createContext, useContext, type CSSProperties, type ReactNode } from 'react'
import { art, specOf, type ArtId } from './art'
import './pixel.css'

// The founder's sprites on screen, always at a whole-number scale with nearest-neighbour sampling, so
// each art pixel is an exact square of screen pixels. A sprite not drawn yet shows `fallback` (the
// plain tomato, a Phosphor icon), so a drawing can arrive any day without code waiting for it.

/**
 * The scale the page puts on everything inside it (the pet's HUD scale, the Plus menu's fit to the
 * screen). Where that would make a drawing's pixels uneven, a drawing that has a fallback shows the
 * fallback instead (the Phosphor icon, the text), as it did before it was drawn. One with none (the
 * pet) still shows, as the plain tomato always has.
 */
export const PixelZoom = createContext(1)

/** Whether `k` art-to-CSS pixels under the page's zoom still make whole screen pixels. */
export const wholeUnder = (k: number, zoom: number) => Math.abs(k * zoom - Math.round(k * zoom)) < 0.01

interface Props {
  id: ArtId
  /** Screen pixels per art pixel. Whole numbers only. */
  scale?: number
  /** Shown while the sprite is not drawn. */
  fallback?: ReactNode
  className?: string
  style?: CSSProperties
  title?: string
}

/** A one-frame sprite (or a strip's first frame), or the fallback. */
export function Pixel({ id, scale = 1, fallback = null, className, style, title }: Props) {
  const url = art(id)
  const zoom = useContext(PixelZoom)
  const k = Math.max(1, Math.round(scale))
  if (!url || (fallback !== null && !wholeUnder(k, zoom))) return <>{fallback}</>
  const s = specOf(id)
  if (s.frames > 1) return <PixelAnim id={id} scale={k} fps={0} className={className} style={style} title={title} />
  return <img className={`px ${className ?? ''}`} src={url} width={s.w * k} height={s.h * k} alt="" draggable={false} style={style} title={title} />
}

/**
 * A strip of frames stacked top to bottom, played on a loop at `fps` (0 holds the first frame). The
 * strip is a background stepped a whole frame at a time, never tweened.
 */
export function PixelAnim({ id, scale = 1, fps = 2, fallback = null, className, style, title }: Props & { fps?: number }) {
  const url = art(id)
  const zoom = useContext(PixelZoom)
  const k = Math.max(1, Math.round(scale))
  if (!url || (fallback !== null && !wholeUnder(k, zoom))) return <>{fallback}</>
  const s = specOf(id)
  const h = s.h * k
  const css = {
    width: s.w * k,
    height: h,
    backgroundImage: `url("${url}")`,
    backgroundSize: `${s.w * k}px ${h * s.frames}px`,
    '--px-strip': `${-h * s.frames}px`,
    animation: fps > 0 && s.frames > 1 ? `px-strip ${s.frames / fps}s steps(${s.frames}) infinite` : undefined,
    ...style,
  } as CSSProperties
  return <span className={`px px-anim ${className ?? ''}`} style={css} title={title} aria-hidden />
}

/**
 * A drawn icon in place of a Phosphor one: the founder's 16x16 at the whole scale nearest `size`
 * (16 at 15 to 23, 32 at 24 to 39), else the Phosphor icon given as the fallback.
 */
export function ArtIcon({ id, size = 16, fallback, className, title }: { id: ArtId; size?: number; fallback: ReactNode; className?: string; title?: string }) {
  return <Pixel id={id} scale={Math.max(1, Math.round(size / 16))} fallback={fallback} className={`art-icon ${className ?? ''}`} title={title} />
}
