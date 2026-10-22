import { useCallback, useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import type { Command, Layout, UiMode } from '../../shared/bridge'
import { bridge } from './bridge'
import { Capture } from './capture/Capture'
import { Deck } from './deck/Deck'
import { Callout } from './hud/Callout'
import { Feed } from './hud/Feed'
import { Objectives } from './hud/Objectives'
import { Pet } from './hud/Pet'
import { hotkeyLabel, matchesAcceleratorKey, MODIFIER_KEYS } from './lib/keys'
import { setSoundEnabled, sfx } from './lib/sound'
import { PlusMenu } from './plus/PlusMenu'
import { current, useMayorly } from './store'

/** How long the swap hotkey must be held before releasing it closes the menu (hold to peek). */
const PEEK_MS = 400

export function App() {
  const s = useMayorly()
  const [mode, setModeState] = useState<UiMode>('field')
  const modeRef = useRef<UiMode>('field')
  const held = useRef<{ since: number } | null>(null)
  const [warning, setWarning] = useState<string | null>(null)
  const [layout, setLayout] = useState<Layout>({ compact: false, side: 'right', dragging: false })

  const setMode = useCallback((m: UiMode) => {
    if (modeRef.current === m) return
    if (m === 'field') sfx.close()
    else sfx.open()
    modeRef.current = m
    setModeState(m)
    bridge.setMode(m)
  }, [])

  useEffect(() => {
    bridge.setMode('field')
    document.body.classList.toggle('web', bridge.kind === 'web')
  }, [])

  // The shell says whether the window is the pet alone (macOS) and which side it hangs on.
  // Asked for on mount as well as subscribed to: the first push can land before this effect runs.
  useEffect(() => {
    void bridge.getLayout().then(setLayout)
    return bridge.onLayout(setLayout)
  }, [])
  useEffect(() => {
    document.body.classList.toggle('compact', layout.compact)
    document.body.classList.toggle('side-left', layout.side === 'left')
    document.body.classList.toggle('side-right', layout.side === 'right')
  }, [layout])

  // Hotkeys from the shell. Holding the swap key auto-repeats, so ignore repeats until it is released.
  useEffect(
    () =>
      bridge.onCommand((cmd: Command) => {
        const cur = modeRef.current
        if (cmd === 'plus') {
          if (cur === 'plus') {
            if (!held.current) setMode('field')
            return
          }
          held.current = { since: Date.now() }
          setMode('plus')
          return
        }
        setMode(cur === cmd ? 'field' : cmd)
      }),
    [setMode],
  )

  useEffect(() => {
    const up = (e: KeyboardEvent) => {
      if (!held.current) return
      // The swap key or one of its modifiers going up ends the hold. Matched by key
      // position: with Option held, macOS reports the letter as the character it composes.
      const plus = current()?.settings.hotkeys.plus ?? 'Alt+T'
      if (!matchesAcceleratorKey(e, plus) && !MODIFIER_KEYS.has(e.key)) return
      const long = Date.now() - held.current.since > PEEK_MS
      held.current = null
      if (long && modeRef.current === 'plus') setMode('field')
    }
    window.addEventListener('keyup', up)
    return () => window.removeEventListener('keyup', up)
  }, [setMode])

  // Field mode is click-through. Only the HUD's own controls catch the pointer.
  useEffect(() => {
    let last = false
    const move = (e: MouseEvent) => {
      const hit = !!(e.target as Element | null)?.closest?.('[data-hit]')
      if (hit !== last) {
        last = hit
        bridge.setHit(hit)
      }
    }
    // Leaving the window altogether (relatedTarget null) lets a hovered control go.
    const leave = (e: MouseEvent) => {
      if (e.relatedTarget === null && last) {
        last = false
        bridge.setHit(false)
      }
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseout', leave)
    return () => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseout', leave)
    }
  }, [])

  useEffect(
    () =>
      bridge.onHotkeyFailures(({ keys, reason }) => {
        const names = keys.map(hotkeyLabel).join(', ')
        setWarning(
          reason === 'option-only'
            ? `macOS 15.0 and 15.1 refuse Option-only combos such as ${names}. Add Control, like Ctrl+Alt+T, in Deck, Settings.`
            : `${names} ${keys.length === 1 ? 'is' : 'are'} held by another app. Pick another in Deck, Settings.`,
        )
        setTimeout(() => setWarning(null), 9000)
      }),
    [],
  )

  useEffect(() => setSoundEnabled(s?.settings.sound ?? true), [s?.settings.sound])

  if (!s) return null
  const close = () => setMode('field')

  return (
    <main className="stage">
      <AnimatePresence>
        {mode !== 'field' && (
          <motion.div
            key="vignette"
            className={`vignette ${mode === 'capture' ? 'light' : ''}`}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.25 }}
          />
        )}
      </AnimatePresence>

      <Objectives s={s} mode={mode} />
      <Pet s={s} mode={mode} open={setMode} side={layout.compact ? layout.side : s.settings.hudSide} dragging={layout.dragging} notice={layout.compact ? warning : null} />
      <Feed />
      <Callout quiet={mode !== 'field'} />

      <AnimatePresence>
        {mode === 'plus' && <PlusMenu key="plus" s={s} close={close} open={setMode} />}
        {mode === 'deck' && <Deck key="deck" s={s} close={close} kind={bridge.kind} />}
        {mode === 'capture' && <Capture key="capture" s={s} close={close} />}
      </AnimatePresence>

      <AnimatePresence>
        {warning && !layout.compact && (
          <motion.p className="toast" initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} role="status">
            {warning}
          </motion.p>
        )}
      </AnimatePresence>
    </main>
  )
}
