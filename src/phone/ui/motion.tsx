import { useEffect, useState } from 'react'
import { AnimatePresence, motion, type HTMLMotionProps } from 'motion/react'
import { onFeel, type Feel } from '../feel'

// The phone's motion, in a few shared pieces. Everything moves with transform and opacity only,
// and MotionConfig (main.tsx) drops the travel for Reduce Motion.

export const spring = { type: 'spring', stiffness: 520, damping: 34, mass: 0.7 } as const
export const soft = { type: 'spring', stiffness: 320, damping: 30 } as const

/**
 * Text whose characters roll as they change: each digit slides up out of its slot as the next
 * rises in from below, clipped to the slot, the way an odometer turns. Characters that stay put
 * do not move.
 */
export function RollingText({ text, className }: { text: string; className?: string }) {
  return (
    <span className={`rolling ${className ?? ''}`} aria-hidden>
      {text.split('').map((ch, i) => (
        <span className="rolling-slot" key={`${i}-${text.length}`}>
          <AnimatePresence initial={false} mode="popLayout">
            <motion.span
              key={ch}
              className="rolling-char"
              initial={{ y: '100%' }}
              animate={{ y: '0%' }}
              exit={{ y: '-100%' }}
              transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
            >
              {ch}
            </motion.span>
          </AnimatePresence>
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
    layout: 'position',
    initial: { opacity: 0, y: 10 },
    animate: { opacity: 1, y: 0, transition: { ...soft, delay: Math.min(i, 14) * 0.028 } },
    exit: { opacity: 0, height: 0, transition: { duration: 0.16 } },
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
