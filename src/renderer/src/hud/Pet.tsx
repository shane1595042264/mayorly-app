import { useEffect, useState } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { blockView, clock, dayStats, startOfDay, switchTarget, type MayorlyState } from '@core/index'
import type { UiMode } from '../../../shared/bridge'
import tomato from '../assets/tomato@1x.png'
import { bridge } from '../bridge'
import { hotkeyLabel } from '../lib/keys'
import { useNow } from '../store'

// The resting HUD is the founder's tomato holding one sign: the clock while a block
// runs, today's tomatoes when the desk is idle. Hover it and it hops and the sign
// says in one line what the desk is on. Everything else is a hotkey; the sign opens
// the swap menu. On macOS the tomato is the window's drag handle, the window is exactly
// the pet, and the caption is the shell's own click-through window beside it. Nothing
// here changes the window's size: that would make the tomato jump for a frame.

interface Props {
  s: MayorlyState
  /** A panel is open or opening: the pet fades where it stands and comes back when the panel is gone. */
  away: boolean
  /** The keyboard is moving the tomato: a dashed box around it and the keys in the caption. */
  moving: boolean
  open: (m: UiMode) => void
  side: 'left' | 'right'
  dragging: boolean
  /** The window is the pet alone (macOS): the caption goes to the shell. */
  compact: boolean
  /** Something the shell needs to say (a hotkey that failed); shown in place of the caption. */
  notice: string | null
}

const MOVE_HINT = 'Arrows or hjkl move it, 1 to 4 pick a corner, Enter when done'

export function Pet({ s, away, moving, open, side, dragging, compact, notice }: Props) {
  // Idle, the pet only counts today's tomatoes; a clock is what needs the quarter second.
  const now = useNow(s.desk.status === 'idle' ? 10_000 : 250)
  const reduce = useReducedMotion()
  const [hover, setHover] = useState(false)
  const v = blockView(s, now)
  const right = side === 'right'

  // A drag ends hover: the pointer is wherever the window was dropped.
  useEffect(() => {
    if (dragging) setHover(false)
  }, [dragging])

  let sign: string
  let tone: 'idle' | 'live' | 'hold' | 'rest' | 'ready' | 'couch'
  /** The line above the sign: what the desk is on, up to two lines of the column. */
  let task = ''
  if (!v) {
    sign = String(dayStats(s, startOfDay(now), now).tomatoes)
    tone = 'idle'
  } else {
    task = v.block.kind === 'leisure' ? v.block.label : v.block.kind === 'rest' ? v.block.label : v.entry ? `${v.ledger?.code ?? 'FREE'}  ${v.entry.title}` : v.block.label
    sign = v.remainingMs === null ? clock(v.elapsedMs, false) : v.overtimeMs > 0 ? `+${clock(v.overtimeMs, false)}` : clock(v.remainingMs)
    tone = v.block.kind === 'leisure' ? 'couch' : v.status === 'paused' ? 'hold' : v.status === 'ready' ? 'ready' : v.block.kind === 'focus' ? 'live' : 'rest'
  }
  const breathing = tone === 'live' && !reduce && !dragging
  // Hover says only what the pet does not already show: how to start when idle, how to get back to the other session.
  const back = v ? switchTarget(s) : null
  const hint = !v
    ? `Desk idle. ${hotkeyLabel(s.settings.hotkeys.plus)} to deploy.`
    : back ? `${hotkeyLabel(s.settings.hotkeys.switch)}: back to ${back}` : ''
  const text = moving ? MOVE_HINT : (notice ?? hint)
  const showCaption = moving || !!notice || (hover && !dragging && hint !== '')

  // macOS: the caption is the shell's window. Elsewhere it is drawn above the pet.
  useEffect(() => {
    if (compact) bridge.setCaption(showCaption ? text : null)
  }, [compact, showCaption, text])

  return (
    <motion.div
      className={`pet-wrap ${right ? 'pet-right' : 'pet-left'}`}
      style={{ scale: s.settings.hudScale }}
      animate={{ opacity: away ? 0 : 1, y: away ? 4 : 0 }}
      transition={away ? { duration: 0.14, ease: 'easeOut' } : { type: 'spring', stiffness: 220, damping: 26 }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      data-hit
    >
      <AnimatePresence>
        {showCaption && !compact && (
          <motion.p
            key="caption"
            className={`pet-sign is-caption pet-caption ${notice ? 'is-notice' : ''}`}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 4, transition: { duration: 0.12 } }}
            transition={{ type: 'spring', stiffness: 260, damping: 26 }}
            role="status"
          >
            {text}
          </motion.p>
        )}
      </AnimatePresence>

      <div className="pet" role="status" aria-label="Desk status">
        <div className="pet-col">
          {task && <span className={`pet-task clamp tone-${tone}`} title={task}>{task}</span>}
          <button
            type="button"
            className={`pet-sign num tone-${tone} ${tone === 'hold' ? 'pulse' : ''}`}
            onClick={() => open('plus')}
            title={v ? 'Swap' : 'Deploy'}
          >
            {sign}
          </button>
        </div>
        <motion.div
          className={`pet-body ${moving ? 'is-moving' : ''}`}
          title="Drag to move"
          animate={
            reduce || dragging ? { y: 0, scale: 1 }
              : hover ? { y: [0, -6, 0], scale: 1 }
                : breathing ? { y: 0, scale: [1, 1.04, 1] }
                  : { y: 0, scale: 1 }
          }
          transition={
            hover ? { duration: 0.32, ease: 'easeOut' }
              : breathing ? { duration: 2.4, repeat: Infinity, ease: 'easeInOut' }
                : { duration: 0.2 }
          }
        >
          <img className="pet-sprite" src={tomato} alt="" draggable={false} />
        </motion.div>
      </div>
    </motion.div>
  )
}
