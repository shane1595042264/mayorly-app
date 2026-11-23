import { useContext, type ReactNode } from 'react'
import { art, specOf } from './art'
import { PixelZoom, wholeUnder } from './Pixel'
import './pixel.css'

// Numbers in the founder's own digits: font.digits is one strip of twelve 6x8 cells, '0123456789:.'
// left to right, and each glyph is its cell of the strip, picked by background-position at a
// whole-number scale. A string the strip cannot spell (a '+', a thousands comma), one wider than its
// box, or a strip not drawn yet shows `fallback`, the plain text unless given, so nothing changes until
// the digits exist. The digits carry the text as their label for screen readers.

/** The strip's cells, left to right. */
export const DIGITS = '0123456789:.'

/** Each character's cell in the strip, or null when the strip cannot spell the text. */
export function digitCells(text: string): number[] | null {
  if (!text) return null
  const cells: number[] = []
  for (const ch of text) {
    const i = DIGITS.indexOf(ch)
    if (i < 0) return null
    cells.push(i)
  }
  return cells
}

interface Props {
  text: string
  /** Screen pixels per art pixel. Whole numbers only. */
  scale?: number
  /** Shown instead while the digits cannot be: the plain text unless given. */
  fallback?: ReactNode
  /** The widest the digits may be, in CSS pixels: wider shows the fallback rather than spill out of the box. */
  maxWidth?: number
  /** On the digits' row (`.px-num`), not on the fallback. */
  className?: string
}

/**
 * A number in the founder's digits. The row is `.px-num` with one inline-block per glyph, sitting
 * on the baseline; a box that wants them centred styles `.px-num` as a flex row.
 */
export function PixelNumber({ text, scale = 2, fallback = text, maxWidth, className }: Props) {
  const url = art('font.digits')
  const cells = url ? digitCells(text) : null
  const strip = specOf('font.digits')
  const k = Math.max(1, Math.round(scale))
  const w = (strip.w / DIGITS.length) * k
  const h = strip.h * k
  // Under a HUD scale that would make the digits' pixels uneven (a 6x8 cell at 70% loses columns), the text.
  const zoom = useContext(PixelZoom)
  if (!url || !cells || !wholeUnder(k, zoom) || (maxWidth !== undefined && cells.length * w > maxWidth)) return <>{fallback}</>
  return (
    <span className={`px-num ${className ?? ''}`} role="img" aria-label={text}>
      {cells.map((c, i) => (
        <span
          key={i}
          className="px"
          aria-hidden
          style={{
            display: 'inline-block',
            width: w,
            height: h,
            backgroundImage: `url("${url}")`,
            backgroundRepeat: 'no-repeat',
            backgroundSize: `${strip.w * k}px ${h}px`,
            backgroundPosition: `${-c * w}px 0`,
          }}
        />
      ))}
    </span>
  )
}
