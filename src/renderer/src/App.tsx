import { useCallback, useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import type { Command, UiMode } from '../../shared/bridge'
import { bridge } from './bridge'
import { Capture } from './capture/Capture'
import { Deck } from './deck/Deck'
import { Callout } from './hud/Callout'
import { Feed } from './hud/Feed'
import { FieldHud } from './hud/FieldHud'
import { Objectives } from './hud/Objectives'
import { setSoundEnabled, sfx } from './lib/sound'
import { PlusMenu } from './plus/PlusMenu'
import { useMayorly } from './store'

/** How long the swap hotkey must be held before releasing it closes the menu (hold to peek). */
const PEEK_MS = 400

export function App() {
  const s = useMayorly()
  const [mode, setModeState] = useState<UiMode>('field')
  const modeRef = useRef<UiMode>('field')
  const held = useRef<{ since: number } | null>(null)
  const [warning, setWarning] = useState<string | null>(null)

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
      if (!held.current || (e.key.toLowerCase() !== 't' && e.key !== 'Alt')) return
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
    window.addEventListener('mousemove', move)
    return () => window.removeEventListener('mousemove', move)
  }, [])

  useEffect(
    () =>
      bridge.onHotkeyFailures((keys) => {
        setWarning(`${keys.join(', ')} ${keys.length === 1 ? 'is' : 'are'} held by another app. Pick another in Deck, Settings.`)
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
      <FieldHud s={s} mode={mode} open={setMode} />
      <Feed />
      <Callout quiet={mode !== 'field'} />

      <AnimatePresence>
        {mode === 'plus' && <PlusMenu key="plus" s={s} close={close} open={setMode} />}
        {mode === 'deck' && <Deck key="deck" s={s} close={close} kind={bridge.kind} />}
        {mode === 'capture' && <Capture key="capture" s={s} close={close} />}
      </AnimatePresence>

      <AnimatePresence>
        {warning && (
          <motion.p className="toast" initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} role="status">
            {warning}
          </motion.p>
        )}
      </AnimatePresence>
    </main>
  )
}
