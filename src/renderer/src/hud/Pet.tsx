import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion, useReducedMotion, type TransformProperties } from 'motion/react'
import { blockView, clock, dayStats, nextBlock, startOfDay, switchTarget, taskTomatoes, tomatoLabel, type MayorlyState } from '@core/index'
import type { UiMode } from '../../../shared/bridge'
import { INSET, anchorInBox, captionBox, dragScale, overlaps, petBox, type Point, type Rect } from '../../../shared/pet'
import { art } from '../lib/art'
import { PixelZoom } from '../lib/Pixel'
import { PixelNumber } from '../lib/PixelNumber'
import { bridge } from '../bridge'
import { hotkeyLabel } from '../lib/keys'
import { ledgerVars } from '../lib/themes'
import { useNow } from '../store'
import { PetSprite, drawnPet, petStates, type PetTone } from './PetSprite'

// The resting HUD is the founder's tomato holding one sign: the clock while a block
// runs, with the tomatoes finished on that task in a small number beside it, and today's
// tomatoes when the desk is idle. Hover it and it hops and the sign
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
  /** The schedule's quiet line after a switch off it: under the tomato when there is room, breathing. */
  nudge: string | null
  /** This computer's id, null until the shell says; the desk may be running on another one. */
  here: string | null
  /** Windows: the drawer or switch log open beside the pet, which a notice keeps clear of. */
  panel?: Rect | null
}

const MOVE_HINT = 'Arrows move, + and - resize, 1 to 4 corners, Enter when done'
/** A press that moves less than this is not a drag. */
const DRAG_PX = 4
/** The hover hop, up 6 px and back; the drawn hop (pet.tomato.hop) shows for exactly this long. */
const HOP_S = 0.32
/** The founder's digits in the sign: 12x16 a glyph, inside the 80 px plate's 66 px of text. A clock of
 * an hour or more (seven cells, 84 px) does not fit and shows the plain text. */
const SIGN_SCALE = 2
const SIGN_TEXT_PX = 66
/** The task's count beside it: 6x8 a glyph, the size of its 13 px text. */
const COUNT_SCALE = 1
const COUNT_TEXT_PX = 44

const whole = (v: string | number | undefined): number => Math.round(parseFloat(String(v ?? 0)) || 0)

/**
 * Motion's own transform with the translation on whole pixels, so a sprite never lands between two.
 * Without `scaled` the scale is left out: a drawing is only ever shown at its whole-number size.
 */
function wholePixels(t: TransformProperties, scaled = true): string {
  const x = whole(t.x)
  const y = whole(t.y)
  const s = scaled && t.scale !== undefined ? parseFloat(String(t.scale)) : 1
  const parts = [x || y ? `translate(${x}px, ${y}px)` : '', s !== 1 && Number.isFinite(s) ? `scale(${s})` : '']
  return parts.filter(Boolean).join(' ') || 'none'
}

export function Pet({ s, away, moving, open, side, dragging, compact, notice, nudge, here, anchor, area, onDrag, onPlace, onGrab, onScale, panel }: Props) {
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

  // The hop on arriving: the drawn hop shows while it plays, then the pet is back to its state.
  const [hopping, setHopping] = useState(false)
  useEffect(() => {
    if (!hover || reduce || dragging) {
      setHopping(false)
      return
    }
    setHopping(true)
    const t = setTimeout(() => setHopping(false), HOP_S * 1000)
    return () => clearTimeout(t)
  }, [hover, reduce, dragging])

  let sign: string
  let tone: PetTone
  /** The line above the sign: what the desk is on, up to two lines of the column. */
  let task = ''
  // The current task's own count, beside the clock. Idle, the sign itself is today's.
  const grown = v ? taskTomatoes(s, now) : null
  const done = grown === null ? null : tomatoLabel(grown)
  if (!v) {
    sign = String(dayStats(s, startOfDay(now), now).tomatoes)
    tone = 'idle'
  } else {
    task = v.block.kind === 'leisure' ? v.block.label : v.block.kind === 'rest' ? v.block.label : v.entry ? `${v.ledger?.code ?? 'FREE'}  ${v.entry.title}` : v.block.label
    sign = v.remainingMs === null ? clock(v.elapsedMs, false) : v.overtimeMs > 0 ? `+${clock(v.overtimeMs, false)}` : clock(v.remainingMs)
    // A hold shows as a hold wherever the desk is, the couch included: the colour is the state.
    tone = v.status === 'paused' ? 'hold' : v.status === 'ready' ? 'ready' : v.block.kind === 'leisure' ? 'couch' : v.block.kind === 'focus' ? 'live' : 'rest'
  }
  const gaming = s.settings.gaming
  // The founder's drawing for what the pet is doing (PetSprite), or null for the plain tomato.
  const drawn = drawnPet(petStates({ gaming, held: dragging, hop: hopping, tone }))
  // The plain tomato breathes through a focus block; a drawing is never scaled, and the drawn work
  // loop's two frames are its breath.
  const breathing = tone === 'live' && !reduce && !dragging && !drawn
  // Hover says only what the pet does not already show: how to start when idle, how to get back to the other session.
  const back = v ? switchTarget(s) : null
  // Idle with a block coming up within two hours: the plan's next step, not the deploy hint.
  const next = !v ? nextBlock(s, now) : null
  const nextEntry = next && next.start - now < 2 * 3_600_000 ? s.entries.find((e) => e.id === next.entryId) : null
  const nextAt = next ? new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit', timeZone: s.settings.calendar.tz || undefined }).format(Math.max(next.start, now)) : ''
  const hint = gaming
    ? `Gaming mode: shortcuts off. ${hotkeyLabel(s.settings.hotkeys.gaming)} turns them on.`
    : !v
    ? nextEntry ? `Next: ${nextEntry.title}, ${nextAt}. ${hotkeyLabel(s.settings.hotkeys.plus)} to deploy.` : `Desk idle. ${hotkeyLabel(s.settings.hotkeys.plus)} to deploy.`
    : s.desk.heldAt !== null && s.desk.device && s.desk.device.id !== here ? `Running on ${s.desk.device.name}. Anything you do here takes it over.`
    : back ? `${hotkeyLabel(s.settings.hotkeys.switch)}: back to ${back}` : ''
  const quiet = !moving && !notice && !!nudge && !(hover && !dragging)
  const text = moving ? MOVE_HINT : (notice ?? (quiet ? nudge! : hint))
  const showCaption = moving || !!notice || quiet || (hover && !dragging && hint !== '')

  // macOS: the caption is the shell's window. Elsewhere it is drawn in the same box, in this window.
  useEffect(() => {
    if (compact) bridge.setCaption(showCaption ? text : null, moving ? undefined : notice ? 'notice' : quiet ? 'scheduled' : undefined)
  }, [compact, showCaption, text, quiet, notice, moving])

  // Windows: the pet's box and the caption's, from where the tomato is, as the Mac would hang its windows.
  const scale = s.settings.hudScale
  const whole = { x: 0, y: 0, ...area }
  const box = !compact && anchor ? petBox(anchor, whole, scale, s.settings.text.pet) : null
  const tomatoAt = box ? anchorInBox(box, side, scale) : null
  // A notice or the schedule's line: under the tomato, else over the whole pet, task lines and all,
  // and never over an open drawer or switch log (then not at all; the panel has your eyes). A hover
  // hint hugs the tomato.
  const lineUp = !moving && (!!notice || quiet)
  const cap = !tomatoAt
    ? null
    : lineUp
      ? ([captionBox(tomatoAt, whole, side, scale, 'below', s.settings.text.pet), captionBox(tomatoAt, whole, side, scale, 'over', s.settings.text.pet)].find((c) => !panel || !overlaps(c, panel)) ?? null)
      : captionBox(tomatoAt, whole, side, scale, 'above', s.settings.text.pet)
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
            className={`pet-caption-box side-${side} ${moving ? 'is-over' : ''} ${lineUp ? (cap.below ? 'is-below' : 'is-above') : ''}`}
            style={{ left: cap.x, top: cap.y, width: cap.width, height: cap.height }}
            initial={{ opacity: 0, y: cap.below ? -6 : 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: cap.below ? -4 : 4, transition: { duration: 0.12 } }}
            transition={{ type: 'spring', stiffness: 260, damping: 26 }}
          >
            <p className={`pet-sign is-caption ${notice ? 'is-notice' : ''} ${quiet ? 'is-scheduled' : ''}`} role="status">
              {text}
            </p>
          </motion.div>
        )}
      </AnimatePresence>
      <motion.div
        className={`pet-wrap ${right ? 'pet-right' : 'pet-left'}`}
        style={{ scale, ...placed, ...ledgerVars(v?.ledger) }}
        transformTemplate={(t) => wholePixels(t)}
        animate={{ opacity: away ? 0 : 1, y: away ? 4 : 0 }}
        transition={away ? { duration: 0.14, ease: 'easeOut' } : { type: 'spring', stiffness: 220, damping: 26 }}
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        onContextMenu={(e) => {
          // The tray's menu, Quit included, right on the pet.
          e.preventDefault()
          bridge.petMenu()
        }}
        data-hit
      >
        {/* The HUD scale is on everything in here: the digits fall back to text where it would make their pixels uneven. */}
        <PixelZoom.Provider value={scale}>
        <div className="pet" role="status" aria-label="Desk status">
          <div className="pet-col">
            {task && <span className={`pet-task clamp tone-${tone}`} title={task}>{task}</span>}
            <div className="pet-sign-row">
              {done !== null && (
                <span className="pet-count num" title="Tomatoes finished on this task" aria-label={`${done} ${done === '1' ? 'tomato' : 'tomatoes'} on this task`}>
                  <PixelNumber text={done} scale={COUNT_SCALE} maxWidth={COUNT_TEXT_PX} />
                </span>
              )}
              <button
                type="button"
                className={`pet-sign num tone-${tone} ${tone === 'hold' ? 'pulse' : ''}`}
                onClick={() => open('plus')}
                title={v ? 'Swap' : 'Deploy'}
              >
                <PixelNumber text={sign} scale={SIGN_SCALE} maxWidth={SIGN_TEXT_PX} />
              </button>
            </div>
          </div>
          <motion.div
            className={`pet-body ${moving ? 'is-moving' : ''} ${dragging ? 'is-dragging' : ''}`}
            title="Drag to move"
            {...drag}
            // The hop lands on whole pixels; only the plain tomato is ever scaled (its breath).
            transformTemplate={(t) => wholePixels(t, !drawn)}
            animate={
              reduce || dragging ? { y: 0, scale: 1 }
                : hover ? { y: [0, -6, 0], scale: 1 }
                  : breathing ? { y: 0, scale: [1, 1.04, 1] }
                    : { y: 0, scale: 1 }
            }
            transition={
              hover ? { duration: HOP_S, ease: 'easeOut' }
                : breathing ? { duration: 2.4, repeat: Infinity, ease: 'easeInOut' }
                  : { duration: 0.2 }
            }
          >
            {/* The plain tomato stays in place under a drawing, unseen, so the drag box and the hit
                test are the same 48x48 whatever the pet is wearing. */}
            <img className={`pet-sprite ${drawn ? 'is-drawn' : ''}`} src={art('icon.tomato')} alt="" draggable={false} />
            {/* The founder's drawing for this state (gaming mode's headset among them), centred on the
                tomato at the same 3x on whole pixels; held still while carried. */}
            {drawn && <PetSprite state={drawn} still={dragging} />}
            {moving && <span className="pet-resize" title="Drag to resize" aria-hidden {...handle} />}
          </motion.div>
        </div>
        </PixelZoom.Provider>
      </motion.div>
    </>
  )
}
