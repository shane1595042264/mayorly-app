import { motion, useReducedMotion } from 'motion/react'
import type { CSSProperties } from 'react'

// The edge glow, one of the impact styles (hud/Impact.tsx): the screen's edges breathe in the moment's colour. The sides swell
// in with the switch sound's hit (about 85 ms in), hold a beat and fade over most of a second, and
// the frame jolts once and settles, which is the shake: only this layer moves, never the person's own
// windows (Mayorly never captures the screen). Under reduced motion, the glow alone. It never takes
// the pointer.

/** When the sound's hit lands, so the glow peaks and the jolt starts with it (lib/sfx.ts, switchCue). */
const HIT_S = 0.085
const LENGTH_S = 1.05

export function SwitchPulse({ color, onDone }: { color: string; onDone: () => void }) {
  const reduce = useReducedMotion()
  return (
    <motion.div
      className="switch-pulse"
      style={{ '--pulse': color } as CSSProperties}
      aria-hidden
      initial={{ opacity: 0 }}
      animate={{ opacity: [0, 1, 0.85, 0] }}
      transition={{ duration: LENGTH_S, times: [0, 0.1, 0.24, 1], ease: ['easeOut', 'linear', 'easeIn'] }}
      onAnimationComplete={onDone}
    >
      <motion.div
        className="switch-pulse-frame"
        initial={false}
        animate={reduce ? undefined : { x: [0, -9, 7, -4, 2, 0], y: [0, 5, -4, 2, -1, 0] }}
        transition={{ duration: 0.34, delay: HIT_S, ease: 'easeOut' }}
      >
        <i className="switch-pulse-edge is-left" />
        <i className="switch-pulse-edge is-right" />
        <i className="switch-pulse-edge is-top" />
        <i className="switch-pulse-edge is-bottom" />
      </motion.div>
    </motion.div>
  )
}
