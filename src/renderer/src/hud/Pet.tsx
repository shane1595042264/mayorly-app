import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { blockView, clock, dayStats, nextBlock, startOfDay, switchTarget, type MayorlyState } from '@core/index'
import type { UiMode } from '../../../shared/bridge'
import { INSET, anchorInBox, captionBox, dragScale, petBox, type Point } from '../../../shared/pet'
import tomato from '../assets/tomato@1x.png'
import { bridge } from '../bridge'
import { hotkeyLabel } from '../lib/keys'
import { ledgerVars } from '../lib/themes'
import { useNow } from '../store'

// The resting HUD is the founder's tomato holding one sign: the clock while a block
// runs, with today's tomatoes in a small number beside it, and those tomatoes alone when the desk is idle. Hover it and it hops and the sign
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
  onPlace: (a: Point, onScreen: Point) => void
  /** The tomato is held (Windows): the overlay must keep the pointer until it is let go, wherever it goes. */
  onGrab: (held: boolean, carrying?: boolean) => void
  /** The resize handle was dragged to this HUD scale. */
  onScale: (scale: number) => void
  /** Something the shell needs to say (a hotkey that failed); shown in place of the caption. */
  notice: string | null
  /** This computer's id, null until the shell says; the desk may be running on another one. */
  here: string | null
}

const MOVE_HINT = 'Arrows move, + and - resize, 1 to 4 corners, Enter when done'
/** A press that moves less than this is not a drag. */
const DRAG_PX = 4

export function Pet({ s, away, moving, open, side, dragging, compact, notice, here, anchor, area, onDrag, onPlace, onGrab, onScale }: Props) {
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
  const today = dayStats(s, startOfDay(now), now).tomatoes
  if (!v) {
    sign = String(today)
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
    : s.desk.heldAt !== null && s.desk.device && s.desk.device.id !== here ? `Running on ${s.desk.device.name}. Anything you do here takes it over.`
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

  // Windows: the page drags the tomato. On a Mac it is the window's drag region instead. The drag is
  // kept in desktop coordinates and followed on the window, not the element: the overlay moves
  // between displays under the pointer, and the mouse capture does not always survive the border.
  const grab = useRef<{ stop: () => void } | null>(null)
  useEffect(() => () => grab.current?.stop(), [])
  const drag = compact || !tomatoAt
    ? {}
    : {
        onPointerDown: (e: React.PointerEvent) => {
          if (e.button !== 0) return
          e.preventDefault()
          try {
            e.currentTarget.setPointerCapture(e.pointerId)
          } catch {
            /* the pointer is already gone: the drag still follows the moves that arrive */
          }
          const id = e.pointerId
          const down = { x: e.screenX, y: e.screenY }
          const start = { x: tomatoAt.x + e.screenX - e.clientX, y: tomatoAt.y + e.screenY - e.clientY }
          let moved = false
          let page: Point = tomatoAt
          let desk: Point = start
          const track = (ev: PointerEvent) => {
            desk = { x: start.x + ev.screenX - down.x, y: start.y + ev.screenY - down.y }
            page = { x: desk.x - (ev.screenX - ev.clientX), y: desk.y - (ev.screenY - ev.clientY) }
          }
          const stop = () => {
            window.removeEventListener('pointermove', onMove)
            window.removeEventListener('pointerup', onUp)
            window.removeEventListener('pointercancel', finish)
            grab.current = null
            onGrab(false)
          }
          function finish() {
            stop()
            if (moved) onPlace(page, desk)
          }
          function onMove(ev: PointerEvent) {
            if (ev.pointerId !== id) return
            // The button came up somewhere no event reached.
            if (ev.buttons === 0) return finish()
            if (!moved && Math.hypot(ev.screenX - down.x, ev.screenY - down.y) < DRAG_PX) return
            moved = true
            track(ev)
            onDrag(page)
          }
          function onUp(ev: PointerEvent) {
            if (ev.pointerId !== id) return
            if (moved) track(ev)
            finish()
          }
          window.addEventListener('pointermove', onMove)
          window.addEventListener('pointerup', onUp)
          window.addEventListener('pointercancel', finish)
          grab.current = { stop }
          onGrab(true, true)
        },
      }

  // The resize handle. Screen coordinates, because on a Mac the window resizes under the pointer.
  const sizing = useRef<{ id: number; x: number; y: number; from: number; last: number } | null>(null)
  const stopSizing = () => {
    if (!sizing.current) return
    sizing.current = null
    onGrab(false)
  }
  const handle = {
    onPointerDown: (e: React.PointerEvent) => {
      if (e.button !== 0) return
      e.preventDefault()
      e.stopPropagation()
      try {
        e.currentTarget.setPointerCapture(e.pointerId)
      } catch {
        /* the pointer is already gone */
      }
      sizing.current = { id: e.pointerId, x: e.screenX, y: e.screenY, from: scale, last: scale }
      onGrab(true)
    },
    onPointerMove: (e: React.PointerEvent) => {
      e.stopPropagation()
      const r = sizing.current
      if (!r || r.id !== e.pointerId) return
      const next = dragScale(r.from, e.screenX - r.x, e.screenY - r.y, side)
      if (next === r.last) return
      r.last = next
      onScale(next)
    },
    onPointerUp: (e: React.PointerEvent) => {
      e.stopPropagation()
      stopSizing()
    },
    onPointerCancel: stopSizing,
    onLostPointerCapture: stopSizing,
  }

  return (
    <>
      <AnimatePresence>
        {showCaption && !compact && cap && (
          <motion.div
            key="caption"
            className={`pet-caption-box side-${side} ${moving ? 'is-over' : ''}`}
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
            <div className="pet-sign-row">
              {v && (
                <span className="pet-count num" title="Tomatoes finished today" aria-label={`${today} ${today === 1 ? 'tomato' : 'tomatoes'} today`}>
                  {today}
                </span>
              )}
              <button
                type="button"
                className={`pet-sign num tone-${tone} ${tone === 'hold' ? 'pulse' : ''}`}
                onClick={() => open('plus')}
                title={v ? 'Swap' : 'Deploy'}
              >
                {sign}
              </button>
            </div>
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
            {moving && <span className="pet-resize" title="Drag to resize" aria-hidden {...handle} />}
          </motion.div>
        </div>
      </motion.div>
    </>
  )
}
