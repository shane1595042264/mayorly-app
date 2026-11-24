import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import type { Command } from '../../../shared/bridge'
import type { HotkeyAction, Settings } from '@core/index'
import { bridge } from '../bridge'
import { current } from '../store'
import { hotkeyLabel } from '../lib/keys'
import { describeTip, pressesTip, type TipCard } from '../lib/tips'
import { sfx } from '../lib/sound'
import { Wobble } from './Wobble'

// Tips: a click on something a key also does (a control marked with `tip()`, lib/tips.ts) shows that
// key, big, in the middle of the screen. In force mode the click is swallowed before anything hears
// it, so the key is the way; pressing it says Nice. Every tip says, under it, the two keys that turn
// force mode and tips off. A click from the keyboard (Enter on a focused button) is never a tip.

/** A global hotkey's use, as the command it sends the page. */
const COMMAND_OF: Partial<Record<HotkeyAction, Command>> = {
  plus: 'plus',
  capture: 'capture',
  find: 'find',
  deck: 'deck',
  switch: 'switcher',
  move: 'move',
  drawer: 'drawer',
  schedule: 'schedule',
  switchLog: 'switchLog',
}
/** How long a tip stays, and longer when the click was swallowed. */
const SHOW_MS = 2800
const FORCED_MS = 4200
/** The same tip, the click let through, again only after this long. */
const AGAIN_MS = 12_000

type Shown = TipCard & { seq: number; forced: boolean; state: 'tip' | 'nice' | 'off' | 'force-off' | 'force-on' }

export function Tips({ enabled, tips, hotkeys }: { enabled: boolean; tips: Settings['tips']; hotkeys: Settings['hotkeys'] }) {
  const reduce = useReducedMotion()
  const [shown, setShown] = useState<Shown | null>(null)
  const shownRef = useRef<Shown | null>(null)
  shownRef.current = shown
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const seq = useRef(0)

  const hideIn = (ms: number) => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => setShown(null), ms)
  }
  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), [])

  // The clicks: a tip for each one on a control that names its key; in force mode, swallowed.
  useEffect(() => {
    if (!enabled) return
    const last = new Map<string, number>()
    let blocked: Element | null = null
    let blockedAt = 0
    const tipped = (e: Event) => (e.target as Element | null)?.closest?.('[data-tip]') as HTMLElement | null
    const onDown = (e: PointerEvent) => {
      if (e.button !== 0 || !e.isPrimary) return
      const el = tipped(e)
      const s = current()
      if (!el || !s || !s.settings.tips.on) return
      const card = describeTip(el, s.settings)
      if (!card) return
      const forced = s.settings.tips.force
      if (forced) {
        blocked = el
        blockedAt = Date.now()
        e.preventDefault()
        e.stopPropagation()
        sfx.nope()
      } else {
        const at = last.get(card.id)
        if (at && Date.now() - at < AGAIN_MS) return
      }
      last.set(card.id, Date.now())
      setShown({ ...card, seq: ++seq.current, forced, state: 'tip' })
      hideIn(forced ? FORCED_MS : SHOW_MS)
    }
    // The rest of a swallowed click: nothing of it reaches the control. A click from a key passes.
    const swallow = (e: MouseEvent) => {
      if (!blocked || Date.now() - blockedAt > 1500) return
      const el = tipped(e)
      if (el !== blocked) return
      if (e.type === 'click' && e.detail === 0) return
      e.preventDefault()
      e.stopPropagation()
      if (e.type === 'click') blocked = null
    }
    const kinds = ['pointerup', 'mousedown', 'mouseup', 'click', 'dblclick'] as const
    document.addEventListener('pointerdown', onDown, true)
    for (const k of kinds) document.addEventListener(k, swallow, true)
    return () => {
      document.removeEventListener('pointerdown', onDown, true)
      for (const k of kinds) document.removeEventListener(k, swallow, true)
    }
  }, [enabled])

  // The key the tip asked for: Nice, and gone.
  const nice = () => {
    const s = shownRef.current
    if (!s || s.state !== 'tip') return
    sfx.place()
    setShown({ ...s, state: 'nice' })
    hideIn(900)
  }
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const s = shownRef.current
      if (!s || s.state !== 'tip') return
      if (s.hotkey === null && pressesTip(e, s.raw)) nice()
      else if (e.key === 'Escape') setShown(null)
    }
    window.addEventListener('keydown', onKey, true)
    const off = bridge.onCommand((cmd) => {
      const s = shownRef.current
      if (s?.hotkey && COMMAND_OF[s.hotkey] === cmd) nice()
    })
    return () => {
      window.removeEventListener('keydown', onKey, true)
      off()
    }
  }, [])

  // Force mode or tips turned off (or on) with a tip up: it says so, and goes.
  const was = useRef(tips)
  useEffect(() => {
    const before = was.current
    was.current = tips
    const s = shownRef.current
    if (!s) return
    if (before.on && !tips.on) setShown({ ...s, state: 'off' })
    else if (before.force !== tips.force) setShown({ ...s, state: tips.force ? 'force-on' : 'force-off' })
    else return
    hideIn(1600)
  }, [tips.on, tips.force])

  const kicker = !shown ? '' : shown.state === 'nice' ? 'Nice.' : shown.state === 'off' ? 'Tips off' : shown.state === 'force-off' ? 'Force mode off' : shown.state === 'force-on' ? 'Force mode on' : shown.forced ? 'Use the key' : 'Tip'
  return (
    <div className="tip-layer" aria-live="polite">
      <AnimatePresence>
        {enabled && shown && (
          <motion.div
            key={shown.seq}
            className={`tip-card is-${shown.state} ${shown.forced ? 'is-forced' : ''}`}
            role="status"
            initial={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.55, rotate: -7, y: 24 }}
            animate={{ opacity: 1, scale: 1, rotate: 0, y: 0 }}
            exit={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.92, y: -18, transition: { duration: 0.22 } }}
            transition={{ type: 'spring', stiffness: 560, damping: 16, mass: 0.8 }}
          >
            <span className="tip-kicker caps"><Wobble text={kicker} still={!!reduce} /></span>
            <div className="tip-keys">
              {shown.keys.map((k, i) => (
                <kbd key={i} className="tip-key mono" style={{ animationDelay: `${i * 0.12}s` }}>{k}</kbd>
              ))}
            </div>
            <p className="tip-does">{shown.state === 'tip' || shown.state === 'nice' ? shown.does : shown.state === 'off' ? 'No more tips. Clicks work as they always have.' : shown.state === 'force-off' ? 'Clicks work again. The tips still show.' : 'A click a key does now waits for the key.'}</p>
            {shown.state === 'tip' && shown.forced && <p className="tip-forced">Force mode: the click did nothing. Press the key.</p>}
            <p className="tip-off">
              <span><kbd className="mono">{hotkeyLabel(hotkeys.tipsForce)}</kbd> force mode {tips.force ? 'off' : 'on'}</span>
              <span><kbd className="mono">{hotkeyLabel(hotkeys.tips)}</kbd> tips {tips.on ? 'off' : 'on'}</span>
            </p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
