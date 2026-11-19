import { useEffect, useState } from 'react'
import { motion, type HTMLMotionProps } from 'motion/react'
import { onFeel, type Feel } from '../feel'

// The phone's motion, in a few shared pieces. Everything moves with transform and opacity only,
// and MotionConfig (main.tsx) drops the travel for Reduce Motion.

export const spring = { type: 'spring', stiffness: 520, damping: 34, mass: 0.7 } as const
export const soft = { type: 'spring', stiffness: 320, damping: 30 } as const

/**
 * Text whose characters roll as they change: a new digit rises into its place from a little below,
 * already partly drawn so a full change never leaves the clock blank, the way an odometer turns, and characters that stay put do not move. Only one copy of a character
 * is ever drawn, so nothing shows outside the line however the font sits in its box.
 */
export function RollingText({ text, className }: { text: string; className?: string }) {
  return (
    <span className={`rolling ${className ?? ''}`} aria-hidden>
      {text.split('').map((ch, i) => (
        <span className="rolling-slot" key={`${i}-${text.length}`}>
          <motion.span
            key={ch}
            className="rolling-char"
            initial={{ y: '24%', opacity: 0.35 }}
            animate={{ y: '0%', opacity: 1 }}
            transition={{ duration: 0.26, ease: [0.22, 1, 0.36, 1] }}
          >
            {ch}
          </motion.span>
        </span>
      ))}
    </span>
  )
}

/** A value that pops when it changes: a coin count, a tomato count, a stepper. */
export function Pop({ value, children, className }: { value: string | number; children?: React.ReactNode; className?: string }) {
  return (
    <motion.span
      key={String(value)}
      className={className}
      style={{ display: 'inline-block' }}
      initial={{ scale: 1.35, opacity: 0.4 }}
      animate={{ scale: 1, opacity: 1 }}
      transition={spring}
    >
      {children ?? value}
    </motion.span>
  )
}

/** A row that arrives in a short stagger and leaves by sliding off. */
export function rowIn(i: number): HTMLMotionProps<'button'> {
  return {
    initial: { opacity: 0.3, y: 8 },
    animate: { opacity: 1, y: 0, transition: { ...soft, delay: Math.min(i, 14) * 0.028 } },
    // A row that goes fades as it folds shut, and the rows under it rise with it: none is ever
    // drawn over another.
    exit: { opacity: 0, height: 0, minHeight: 0, paddingTop: 0, paddingBottom: 0, transition: { duration: 0.22, ease: [0.22, 1, 0.36, 1] } },
    whileTap: { scale: 0.98 },
  }
}

/** A counter that goes up each time the desk does one of these: for keying a one-shot animation. */
export function useFeelKey(kinds: Feel[]): number {
  const [n, setN] = useState(0)
  useEffect(() => onFeel((f) => {
    if (kinds.includes(f)) setN((x) => x + 1)
  }), [kinds.join()]) // eslint-disable-line react-hooks/exhaustive-deps
  return n
}
