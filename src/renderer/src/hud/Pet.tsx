import { useEffect, useState } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { blockView, clock, dayStats, startOfDay, type MayorlyState } from '@core/index'
import type { UiMode } from '../../../shared/bridge'
import tomato from '../assets/tomato@1x.png'
import { bridge } from '../bridge'
import { hotkeyLabel } from '../lib/keys'
import { useNow } from '../store'

// The resting HUD is the founder's tomato holding one number: the clock while a block
// runs, today's tomatoes when the desk is idle. Hover it and it hops and says in one
// line what the desk is on. Everything else is a hotkey; the sign opens the swap menu.
// On macOS the tomato is the window's drag handle.

interface Props {
  s: MayorlyState
  mode: UiMode
  open: (m: UiMode) => void
  side: 'left' | 'right'
  dragging: boolean
  /** Something the shell needs to say (a hotkey that failed); shown in place of the caption. */
  notice: string | null
}

export function Pet({ s, mode, open, side, dragging, notice }: Props) {
  const now = useNow(250)
  const reduce = useReducedMotion()
  const [hover, setHover] = useState(false)
  const v = blockView(s, now)
  const right = side === 'right'
  const away = mode !== 'field'
  const showCaption = (hover && !dragging && !away) || (!!notice && !away)

  // A drag ends hover: the pointer is wherever the window was dropped.
  useEffect(() => {
    if (dragging) setHover(false)
  }, [dragging])
  // The shell grows the window for the caption; a notice needs the room too.
  useEffect(() => {
    bridge.setHover(showCaption)
  }, [showCaption])

  let sign: string
  let tone: 'idle' | 'live' | 'hold' | 'rest' | 'ready'
  let caption: string
  if (!v) {
    sign = String(dayStats(s, startOfDay(now), now).tomatoes)
    tone = 'idle'
    caption = `Desk idle. ${hotkeyLabel(s.settings.hotkeys.plus)} to deploy.`
  } else {
    sign = v.remainingMs === null ? clock(v.elapsedMs, false) : v.overtimeMs > 0 ? `+${clock(v.overtimeMs, false)}` : clock(v.remainingMs)
    tone = v.status === 'paused' ? 'hold' : v.status === 'ready' ? 'ready' : v.block.kind === 'focus' ? 'live' : 'rest'
    const what = v.block.kind === 'focus' ? `${v.ledger?.code ?? 'FREE'}  ${v.entry?.title ?? `${v.block.label}, no entry`}` : v.block.label
    caption = v.status === 'paused' ? `Holding  ${what}` : v.status === 'ready' ? `Ready  ${what}` : what
  }
  const breathing = tone === 'live' && !reduce && !dragging

  return (
    <motion.div
      className={`pet-wrap ${right ? 'pet-right' : 'pet-left'}`}
      style={{ scale: s.settings.hudScale }}
      animate={{ opacity: away ? 0 : 1, x: away ? (right ? 24 : -24) : 0 }}
      transition={{ type: 'spring', stiffness: 160, damping: 24 }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      data-hit
    >
      <AnimatePresence>
        {showCaption && (
          <motion.p
            key="caption"
            className={`pet-caption ${notice ? 'is-notice' : ''}`}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 4, transition: { duration: 0.12 } }}
            transition={{ type: 'spring', stiffness: 260, damping: 26 }}
            role="status"
          >
            {notice ?? caption}
          </motion.p>
        )}
      </AnimatePresence>

      <div className="pet" aria-label="Desk status">
        <button type="button" className={`pet-sign num tone-${tone} ${tone === 'hold' ? 'pulse' : ''}`} onClick={() => open('plus')} title={v ? 'Swap' : 'Deploy'}>
          {sign}
        </button>
        <motion.div
          className="pet-body"
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
