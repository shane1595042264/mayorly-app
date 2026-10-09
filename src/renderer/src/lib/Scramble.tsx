import { useEffect, useRef } from 'react'
import { useReducedMotion } from 'motion/react'

const GLYPHS = 'ABCDEFGHJKLMNPRSTUVWXYZ0123456789#/<>'

/**
 * Text that decodes into its new value when it changes, left to right, in about
 * a third of a second. It marks a swap you might have caught from the corner of
 * your eye. Writes straight to the DOM node, so no React render per frame.
 */
export function Scramble({ text, className, ms = 360 }: { text: string; className?: string; ms?: number }) {
  const ref = useRef<HTMLSpanElement>(null)
  const prev = useRef(text)
  const reduce = useReducedMotion()

  useEffect(() => {
    const el = ref.current
    if (!el || text === prev.current) return
    prev.current = text
    if (reduce) {
      el.textContent = text
      return
    }
    const start = performance.now()
    let raf = 0
    const step = (t: number) => {
      const k = Math.min(1, (t - start) / ms)
      const settled = Math.floor(text.length * k)
      el.textContent =
        text.slice(0, settled) +
        text.slice(settled).replace(/\S/g, () => GLYPHS[Math.floor(Math.random() * GLYPHS.length)])
      if (k < 1) raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
    return () => {
      cancelAnimationFrame(raf)
      el.textContent = text
    }
  }, [text, reduce, ms])

  return (
    <span ref={ref} className={className}>
      {text}
    </span>
  )
}
