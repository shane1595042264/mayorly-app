import { useEffect } from 'react'
import { sfx } from './sound'

// Hover, Balatro's way: a card under the pointer lifts, shines and glows where the pointer is
// (hud.css, hover juice); this hook only says where the pointer is on it (`--mx`, `--my`, as a
// share of the card, so a scaled deck lines up), how far from the middle for the cards that lean
// (`--tx`, `--ty`, from -1 to 1), and flicks a soft tick as the pointer comes onto a card.

/** Cards: they glow where the pointer is, and tick as it comes onto one. */
export const HOVER_CARDS = '.bay-card, .tile, .opt, .ss-item, .shelf-spine'
/** Cards that also lean toward the pointer: text only, so no sprite is ever left turned. */
export const HOVER_TILTS = '.tile'
/** Ticks closer than this are one tick: sweeping across a row of cards is not a drum roll. */
const TICK_GAP_MS = 70

export function useHoverJuice() {
  useEffect(() => {
    let on: HTMLElement | null = null
    let lastTick = 0
    let raf = 0
    let pending: PointerEvent | null = null
    const leave = () => {
      if (!on) return
      on.style.removeProperty('--tx')
      on.style.removeProperty('--ty')
      on = null
    }
    const apply = () => {
      raf = 0
      const e = pending
      pending = null
      if (!e) return
      const hit = (e.target as Element | null)?.closest?.(HOVER_CARDS) as HTMLElement | null
      const card = hit && !(hit as HTMLButtonElement).disabled ? hit : null
      if (card !== on) {
        leave()
        on = card
        const now = performance.now()
        if (on && now - lastTick > TICK_GAP_MS) {
          lastTick = now
          sfx.hover()
        }
      }
      if (!on) return
      const r = on.getBoundingClientRect()
      if (r.width < 1 || r.height < 1) return
      const fx = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width))
      const fy = Math.min(1, Math.max(0, (e.clientY - r.top) / r.height))
      on.style.setProperty('--mx', `${(fx * 100).toFixed(1)}%`)
      on.style.setProperty('--my', `${(fy * 100).toFixed(1)}%`)
      if (on.matches(HOVER_TILTS)) {
        on.style.setProperty('--tx', (fx * 2 - 1).toFixed(3))
        on.style.setProperty('--ty', (fy * 2 - 1).toFixed(3))
      }
    }
    const move = (e: PointerEvent) => {
      if (e.pointerType === 'touch') return
      pending = e
      if (!raf) raf = requestAnimationFrame(apply)
    }
    document.addEventListener('pointermove', move, { passive: true })
    document.documentElement.addEventListener('pointerleave', leave)
    return () => {
      document.removeEventListener('pointermove', move)
      document.documentElement.removeEventListener('pointerleave', leave)
      if (raf) cancelAnimationFrame(raf)
      leave()
    }
  }, [])
}
