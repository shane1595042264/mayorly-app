import type { CSSProperties } from 'react'
import { art, type ArtId } from '../lib/art'

// The founder's ui9 panels as frames: a CSS nine-slice (border-image) whose corners are the drawing
// at a whole scale and never stretch, with nearest-neighbour sampling. Edges and the centre stretch,
// so only a slice whose edges are one colour along their length stays clean; `stretch` then never
// leaves a seam, where `round` would. A panel not drawn yet gives undefined, and the frame keeps
// its CSS look.

/**
 * The inline style for a frame of the drawn panel `id`: `slice` art pixels from each side (8 is
 * the standard's corner), shown `scale` screen pixels to the art pixel. `fill` paints the panel's
 * centre as the background too.
 */
export function ui9Frame(id: ArtId, scale: number, { slice = 8, fill = false }: { slice?: number; fill?: boolean } = {}): CSSProperties | undefined {
  const url = art(id)
  if (!url) return undefined
  const w = slice * Math.max(1, Math.round(scale))
  return {
    borderStyle: 'solid',
    borderColor: 'transparent',
    borderWidth: w,
    borderImageSource: `url("${url}")`,
    borderImageSlice: fill ? `${slice} fill` : `${slice}`,
    borderImageWidth: `${w}px`,
    borderImageRepeat: 'stretch',
    imageRendering: 'pixelated',
  }
}
