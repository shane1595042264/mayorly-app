import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { blockView, clock, dayStats, nextBlock, startOfDay, switchTarget, type MayorlyState } from '@core/index'
import type { UiMode } from '../../../shared/bridge'
import { INSET, anchorInBox, captionBox, petBox, type Point } from '../../../shared/pet'
import tomato from '../assets/tomato@1x.png'
import { bridge } from '../bridge'
import { hotkeyLabel } from '../lib/keys'
import { ledgerVars } from '../lib/themes'
import { useNow } from '../store'

// The resting HUD is the founder's tomato holding one sign: the clock while a block
// runs, today's tomatoes when the desk is idle. Hover it and it hops and the sign
// says in one line what the desk is on. Everything else is a hotkey; the sign opens
// the swap menu. On macOS the tomato is the window's drag handle, the window is exactly
// the pet, and the caption is the shell's own click-through window beside it. Nothing
// here changes the window's size: that would make the tomato jump for a frame.
//
// On Windows the overlay is the whole work area, so the pet draws itself in the same boxes
// the Mac turns into windows (src/shared/pet.ts): the pet where the tomato was left, the
// caption just above the tomato. The tomato is dragged by the page instead of the window server.

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
  /** Not compact: where the tomato's bottom centre is in this window, and how big the window is. */
  anchor: Point | null
  area: { width: number; height: number }
  /** A drag of the tomato in this window: each point on the way, then where it was let go. */
  onDrag: (a: Point) => void
  onPlace: (a: Point) => void
  /** The tomato is held (Windows): the overlay must keep the pointer until it is let go, wherever it goes. */
  onGrab: (held: boolean) => void
  /** Something the shell needs to say (a hotkey that failed); shown in place of the caption. */
  notice: string | null
}

const MOVE_HINT = 'Arrows or hjkl move it, 1 to 4 pick a corner, Enter when done'
/** A press that moves less than this is not a drag. */
const DRAG_PX = 4

export function Pet({ s, away, moving, open, side, dragging, compact, notice, anchor, area, onDrag, onPlace, onGrab }: Props) {
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
    // A hold shows as a hold wherever the desk is, the couch included: the colour is the state.
    tone = v.status === 'paused' ? 'hold' : v.status === 'ready' ? 'ready' : v.block.kind === 'leisure' ? 'couch' : v.block.kind === 'focus' ? 'live' : 'rest'
  }
  const breathing = tone === 'live' && !reduce && !dragging
  // Hover says only what the pet does not already show: how to start when idle, how to get back to the other session.
  const back = v ? switchTarget(s) : null
  // Idle with a block coming up within two hours: the plan's next step, not the deploy hint.
  const next = !v ? nextBlock(s, now) : null
  const nextEntry = next && next.start - now < 2 * 3_600_000 ? s.entries.find((e) => e.id === next.entryId) : null
  const nextAt = next ? new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit', timeZone: s.settings.calendar.tz || undefined }).format(Math.max(next.start, now)) : ''
  const hint = !v
    ? nextEntry ? `Next: ${nextEntry.title}, ${nextAt}. ${hotkeyLabel(s.settings.hotkeys.plus)} to deploy.` : `Desk idle. ${hotkeyLabel(s.settings.hotkeys.plus)} to deploy.`
    : back ? `${hotkeyLabel(s.settings.hotkeys.switch)}: back to ${back}` : ''
  const text = moving ? MOVE_HINT : (notice ?? hint)
  const showCaption = moving || !!notice || (hover && !dragging && hint !== '')

  // macOS: the caption is the shell's window. Elsewhere it is drawn in the same box, in this window.
  useEffect(() => {
    if (compact) bridge.setCaption(showCaption ? text : null)
  }, [compact, showCaption, text])

  // Windows: the pet's box and the caption's, from where the tomato is, as the Mac would hang its windows.
  const scale = s.settings.hudScale
  const whole = { x: 0, y: 0, ...area }
  const box = !compact && anchor ? petBox(anchor, whole, scale, s.settings.text.pet) : null
  const tomatoAt = box ? anchorInBox(box, side, scale) : null
  const cap = tomatoAt ? captionBox(tomatoAt, whole, side, scale) : null
  const placed = box
    ? right
      ? { right: area.width - (box.x + box.width - INSET.x), bottom: area.height - (box.y + box.height - INSET.y) }
      : { left: box.x + INSET.x, bottom: area.height - (box.y + box.height - INSET.y) }
    : {}

  // Windows: the page drags the tomato. On a Mac it is the window's drag region instead.
  const grab = useRef<{ id: number; x: number; y: number; from: Point; last: Point; moved: boolean } | null>(null)
  const at = (e: React.PointerEvent, g: NonNullable<typeof grab.current>): Point => ({ x: g.from.x + e.clientX - g.x, y: g.from.y + e.clientY - g.y })
  const drag = compact || !tomatoAt
    ? {}
    : {
        onPointerDown: (e: React.PointerEvent) => {
          if (e.button !== 0) return
          e.preventDefault()
          // The overlay keeps the pointer through the drag, even past its edge onto another display.
          try {
            e.currentTarget.setPointerCapture(e.pointerId)
          } catch {
            /* the pointer is already gone: the drag still follows the moves that arrive */
          }
          grab.current = { id: e.pointerId, x: e.clientX, y: e.clientY, from: tomatoAt, last: tomatoAt, moved: false }
          onGrab(true)
        },
        onPointerMove: (e: React.PointerEvent) => {
          const g = grab.current
          if (!g || g.id !== e.pointerId) return
          if (!g.moved && Math.hypot(e.clientX - g.x, e.clientY - g.y) < DRAG_PX) return
          g.moved = true
          g.last = at(e, g)
          onDrag(g.last)
        },
        onPointerUp: (e: React.PointerEvent) => {
          const g = grab.current
          grab.current = null
          onGrab(false)
          if (g?.moved && g.id === e.pointerId) onPlace(at(e, g))
        },
        // Cancelled or the capture lost: the tomato stays where it was last seen.
        onPointerCancel: () => {
          const g = grab.current
          grab.current = null
          onGrab(false)
          if (g?.moved) onPlace(g.last)
        },
        onLostPointerCapture: (e: React.PointerEvent) => {
          const g = grab.current
          if (!g || g.id !== e.pointerId) return
          grab.current = null
          onGrab(false)
          if (g.moved) onPlace(g.last)
        },
      }

  return (
    <>
      <AnimatePresence>
        {showCaption && !compact && cap && (
          <motion.div
            key="caption"
            className={`pet-caption-box side-${side}`}
            style={{ left: cap.x, top: cap.y, width: cap.width, height: cap.height }}
            initial={{ opacity: 0, y: cap.below ? -6 : 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: cap.below ? -4 : 4, transition: { duration: 0.12 } }}
            transition={{ type: 'spring', stiffness: 260, damping: 26 }}
          >
            <p className={`pet-sign is-caption ${notice ? 'is-notice' : ''}`} role="status">
              {text}
            </p>
          </motion.div>
        )}
      </AnimatePresence>
      <motion.div
        className={`pet-wrap ${right ? 'pet-right' : 'pet-left'}`}
        style={{ scale, ...placed, ...ledgerVars(v?.ledger) }}
        animate={{ opacity: away ? 0 : 1, y: away ? 4 : 0 }}
        transition={away ? { duration: 0.14, ease: 'easeOut' } : { type: 'spring', stiffness: 220, damping: 26 }}
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        data-hit
      >
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
            className={`pet-body ${moving ? 'is-moving' : ''} ${dragging ? 'is-dragging' : ''}`}
            title="Drag to move"
            {...drag}
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
    </>
  )
}
