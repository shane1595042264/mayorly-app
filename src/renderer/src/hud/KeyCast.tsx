import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { IS_MAC, MODIFIER_KEYS } from '../lib/keys'
import { keyLabel } from '../lib/keymap'
import { Wobble } from './Wobble'

// The keys you press, echoed: each one pops up as a keycap at the foot of the screen, tilted a
// little its own way, and floats off. Keys pressed in a row build a combo, Balatro's mult: from three
// on a number says how many, growing and warming from amber to red the longer it runs. Typing into a
// box is not echoed, only the keys that move things (Enter, Escape, the arrows).

/** Keys this close together are a combo. */
const COMBO_MS = 900
/** How long a keycap stays before it floats off. */
const STAY_MS = 1000
/** The keys a box passes on: these are echoed even while typing. */
const MOVES = new Set(['Enter', 'Escape', 'Tab', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'])

interface Cap {
  seq: number
  label: string
  tilt: number
}

function comboLabel(e: KeyboardEvent): string {
  const mods = [e.ctrlKey && (IS_MAC ? 'Control' : 'Ctrl'), e.altKey && (IS_MAC ? 'Option' : 'Alt'), e.metaKey && 'Cmd', e.shiftKey && e.key.length > 1 && 'Shift'].filter(Boolean)
  // With Option held a Mac composes a character; the key's own letter is what was pressed.
  const key = e.altKey && e.code.startsWith('Key') ? e.code.slice(3) : e.key
  return [...mods, keyLabel(key)].join('+')
}

export function KeyCast({ enabled }: { enabled: boolean }) {
  const reduce = useReducedMotion()
  const [caps, setCaps] = useState<Cap[]>([])
  const [combo, setCombo] = useState({ n: 0, seq: 0 })
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>())
  useEffect(() => {
    if (!enabled) return
    let last = 0
    let n = 0
    let seq = 0
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat || MODIFIER_KEYS.has(e.key)) return
      const typing = (e.target as HTMLElement | null)?.closest?.('input, textarea, select, [contenteditable]')
      if (typing && !MOVES.has(e.key)) return
      const now = performance.now()
      n = now - last < COMBO_MS ? n + 1 : 1
      last = now
      const s = ++seq
      setCaps((list) => [...list.slice(-4), { seq: s, label: comboLabel(e), tilt: ((s * 37) % 13) - 6 }])
      setCombo({ n, seq: s })
      const t = setTimeout(() => {
        timers.current.delete(t)
        setCaps((list) => list.filter((c) => c.seq !== s))
      }, STAY_MS)
      timers.current.add(t)
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [enabled])
  useEffect(() => () => timers.current.forEach(clearTimeout), [])
  useEffect(() => {
    if (!enabled) setCaps([])
  }, [enabled])

  const heat = Math.min(1, (combo.n - 3) / 9)
  return (
    <div className="keycast" aria-hidden>
      <AnimatePresence>
        {caps.map((c) => (
          <motion.kbd
            key={c.seq}
            className="keycast-cap mono"
            initial={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.4, y: 18, rotate: c.tilt * 2 }}
            animate={{ opacity: 1, scale: 1, y: 0, rotate: c.tilt }}
            exit={reduce ? { opacity: 0 } : { opacity: 0, y: -34, scale: 0.8, transition: { duration: 0.32 } }}
            transition={{ type: 'spring', stiffness: 640, damping: 15 }}
            layout="position"
          >
            {c.label}
          </motion.kbd>
        ))}
        {combo.n >= 3 && caps.length > 0 && (
          <motion.span
            key={`combo${combo.seq}`}
            className="keycast-combo"
            style={{ '--heat': heat, fontSize: `${Math.min(60, 26 + combo.n * 2.4)}px` } as CSSProperties}
            initial={reduce ? { opacity: 0 } : { opacity: 0, scale: 1.9, rotate: -10 }}
            animate={{ opacity: 1, scale: 1, rotate: 0 }}
            exit={{ opacity: 0, transition: { duration: 0.2 } }}
            transition={{ type: 'spring', stiffness: 700, damping: 14 }}
          >
            <Wobble text={`×${combo.n}`} still={!!reduce} />
          </motion.span>
        )}
      </AnimatePresence>
    </div>
  )
}
