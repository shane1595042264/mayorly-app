import { useCallback, useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import type { HudEvent } from '@core/index'
import type { Command, Layout, UiMode } from '../../shared/bridge'
import { bridge } from './bridge'
import { Capture } from './capture/Capture'
import { ClerkAsk } from './deck/ClerkAsk'
import { Deck } from './deck/Deck'
import { actionFor, recordUse } from './lib/keymap'
import { takeOrigin } from './lib/origin'
import { Callout } from './hud/Callout'
import { CashIn } from './hud/CashIn'
import { Feed } from './hud/Feed'
import { Objectives } from './hud/Objectives'
import { Pet } from './hud/Pet'
import { MODIFIER_KEYS, hotkeyLabel, matchesAcceleratorKey, physicalKey } from './lib/keys'
import { setSoundEnabled, sfx } from './lib/sound'
import { ARM_OF_ACTION, ARM_OF_COMMAND, isPick, onArm, pointArm, pointPick } from './plus/arms'
import { PlusMenu } from './plus/PlusMenu'
import { balance } from '@core/index'
import { current, useHudEvents, useMayorly } from './store'

/** How long the swap hotkey must be held before releasing it closes the menu (hold to peek). */
const PEEK_MS = 400
/** On a Mac the window is the pet. The pet fades out in that small window before the window grows. */
const PET_FADE_MS = 140
/** And a panel finishes its exit in the full window before the window shrinks back to the pet. */
const PANEL_EXIT_MS = 200
/** A tomato ripened: the entry's count stays above the pet this long. */
const POP_MS = 3000

export function App() {
  const s = useMayorly()
  // `mode` is the logical mode, set at once for hotkeys and focus. `shown` is what the stage
  // renders; on a Mac it trails `mode` so each animation plays in a window of the right size.
  const [mode, setModeState] = useState<UiMode>('field')
  const [shown, setShown] = useState<UiMode>('field')
  const [petAway, setPetAway] = useState(false)
  const modeRef = useRef<UiMode>('field')
  /** The mode the shell was last told; its window size follows it. */
  const shellMode = useRef<UiMode>('field')
  const pending = useRef<ReturnType<typeof setTimeout> | null>(null)
  const layoutRef = useRef<Layout>({ compact: false, side: 'right', dragging: false })
  const held = useRef<{ since: number } | null>(null)
  const [warning, setWarning] = useState<string | null>(null)
  const [layout, setLayout] = useState<Layout>({ compact: false, side: 'right', dragging: false })
  const [clerk, setClerk] = useState<string | null>(null)
  // Keyboard move: the pet takes the keys until Enter, Escape, a blur, or a key it does not know.
  const [moving, setMoving] = useState(false)
  useEffect(() => {
    bridge.setMoving(moving)
    if (!moving) return
    const STEP = 16
    const FAR = 96
    const done = () => setMoving(false)
    let idle = setTimeout(done, 30_000)
    const DIRS: Record<string, [number, number]> = { 'move.left': [-1, 0], 'move.down': [0, 1], 'move.up': [0, -1], 'move.right': [1, 0] }
    const key = (e: KeyboardEvent) => {
      if (MODIFIER_KEYS.has(e.key)) return
      clearTimeout(idle)
      idle = setTimeout(done, 30_000)
      e.preventDefault()
      e.stopPropagation()
      const st = current()
      const a = st ? actionFor(e, 'move', st.settings, { ignoreShift: true }) : null
      if (a) recordUse(a)
      const k = physicalKey(e).toLowerCase()
      const d = a ? DIRS[a] : undefined
      const compact = layoutRef.current.compact
      if (d) {
        const step = e.shiftKey ? FAR : STEP
        // Windows: the HUD has two places, left or right.
        if (compact) bridge.nudge(d[0] * step, d[1] * step)
        else if (d[0]) bridge.dispatch({ type: 'settings/update', patch: { hudSide: d[0] < 0 ? 'left' : 'right' } })
        return
      }
      if (k === '1' || k === '2' || k === '3' || k === '4') {
        if (compact) bridge.snap(Number(k) as 1 | 2 | 3 | 4)
        else bridge.dispatch({ type: 'settings/update', patch: { hudSide: k === '1' || k === '3' ? 'left' : 'right' } })
        return
      }
      done()
    }
    window.addEventListener('keydown', key, true)
    window.addEventListener('blur', done)
    return () => {
      clearTimeout(idle)
      window.removeEventListener('keydown', key, true)
      window.removeEventListener('blur', done)
    }
  }, [moving])
  // The harvest inside this window: on Windows always; on macOS when a panel is open, since the pet
  // window is then the whole work area. The coins start at whatever cleared the entry, else the tomato.
  const [cashIn, setCashIn] = useState<{ seq: number; amount: number; balance: number; from: { x: number; y: number } } | null>(null)
  const cashSeq = useRef(0)
  useHudEvents(
    useCallback((events: HudEvent[]) => {
      for (const e of events) {
        if (e.type !== 'harvest') continue
        // The pet alone on a Mac screen: the shell plays it in the effects window.
        if (layoutRef.current.compact && shellMode.current === 'field') continue
        const sprite = document.querySelector('.pet-sprite')?.getBoundingClientRect()
        const from = takeOrigin() ?? (sprite ? { x: sprite.left + sprite.width / 2, y: sprite.top + sprite.height / 2 } : { x: window.innerWidth - 80, y: window.innerHeight - 60 })
        const st = current()
        setCashIn({ seq: ++cashSeq.current, amount: e.tokens, balance: st ? balance(st) : 0, from })
      }
    }, []),
  )

  // A tomato ripened: the entry's count, or the coin for ledger time, shows above the pet for a moment.
  const [pop, setPop] = useState<string | null>(null)
  const popTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useHudEvents(
    useCallback((events: HudEvent[]) => {
      for (const e of events) {
        if (e.type !== 'tomato') continue
        const st = current()
        if (!st) continue
        let text: string
        if (e.entryId) {
          const entry = st.entries.find((x) => x.id === e.entryId)
          if (!entry) continue
          const n = entry.tomatoes ?? 0
          const title = entry.title.length > 40 ? `${entry.title.slice(0, 39)}…` : entry.title
          text = `${title}: ${n} ${n === 1 ? 'tomato' : 'tomatoes'} grown`
        } else {
          text = `${st.desk.block?.label ?? 'Ledger time'}: ${e.tokens} ${e.tokens === 1 ? 'coin' : 'coins'}`
        }
        if (popTimer.current) clearTimeout(popTimer.current)
        setPop(text)
        popTimer.current = setTimeout(() => setPop(null), POP_MS)
      }
    }, []),
  )

  // The clerk narrates on the pet: a working line stays until the result, a result stays a few seconds.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null
    const off = bridge.onClerk((n) => {
      if (timer) clearTimeout(timer)
      setClerk(n.text)
      if (n.phase === 'done') timer = setTimeout(() => setClerk(null), 5000)
    })
    return () => {
      off()
      if (timer) clearTimeout(timer)
    }
  }, [])

  const tellShell = (m: UiMode) => {
    shellMode.current = m
    bridge.setMode(m)
  }

  const setMode = useCallback((m: UiMode) => {
    if (modeRef.current === m) return
    if (m === 'field') sfx.close()
    else sfx.open()
    modeRef.current = m
    setModeState(m)
    if (pending.current) {
      clearTimeout(pending.current)
      pending.current = null
    }
    const windowIsBig = shellMode.current !== 'field'
    if (!layoutRef.current.compact || (m !== 'field' && windowIsBig)) {
      // Windows, or moving between panels: the window does not change size, nothing to wait for.
      setPetAway(m !== 'field')
      setShown(m)
      tellShell(m)
      return
    }
    if (m !== 'field') {
      // Opening: the pet fades out where it is, in the small window; then the window grows and the panel comes in.
      setPetAway(true)
      pending.current = setTimeout(() => {
        pending.current = null
        tellShell(m)
        setShown(m)
      }, PET_FADE_MS)
    } else {
      // Closing: the panel plays its exit in the full window; then the window shrinks and the pet fades back.
      setShown('field')
      pending.current = setTimeout(() => {
        pending.current = null
        tellShell('field')
        setPetAway(false)
      }, PANEL_EXIT_MS)
    }
  }, [])

  useEffect(() => {
    bridge.setMode('field')
    document.body.classList.toggle('web', bridge.kind === 'web')
  }, [])

  // The first launch of a new build opens the deck, which shows what changed.
  useEffect(() => {
    void bridge.whatsNew().then((fresh) => {
      if (fresh && modeRef.current === 'field') setMode('deck')
    })
  }, [setMode])

  // The shell says whether the window is the pet alone (macOS) and which side it hangs on.
  // Asked for on mount as well as subscribed to: the first push can land before this effect runs.
  useEffect(() => {
    void bridge.getLayout().then(setLayout)
    return bridge.onLayout(setLayout)
  }, [])
  useEffect(() => {
    layoutRef.current = layout
    document.body.classList.toggle('compact', layout.compact)
    document.body.classList.toggle('side-left', layout.side === 'left')
    document.body.classList.toggle('side-right', layout.side === 'right')
  }, [layout])

  // Hotkeys from the shell. Holding the swap key auto-repeats, so ignore repeats until it is released.
  useEffect(
    () =>
      bridge.onCommand((cmd: Command) => {
        const cur = modeRef.current
        if (cmd === 'close') {
          held.current = null
          if (cur !== 'field') setMode('field')
          return
        }
        // Option+arrow with the menu open, taken by the shell: point at that arm.
        if (cmd === 'arm-up' || cmd === 'arm-down' || cmd === 'arm-left' || cmd === 'arm-right') {
          const arm = ARM_OF_COMMAND[cmd]
          if (arm && cur === 'plus') pointArm(arm)
          return
        }
        if (isPick(cmd)) {
          if (cur === 'plus') pointPick(Number(cmd.slice(5)))
          return
        }
        recordUse(`global.${cmd}`)
        if (cmd === 'move') {
          if (cur !== 'field') setMode('field')
          setMoving((m) => !m)
          return
        }
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

  // Steering an arm while the swap key is held commits the open: releasing no longer closes it.
  // A plain hold with no steering is still a peek.
  useEffect(() => onArm(() => void (held.current = null)), [])
  // An arrow in the same breath as the swap key can land before the menu has mounted; keep it as the hint it takes on mount.
  useEffect(() => {
    const early = (e: KeyboardEvent) => {
      if (modeRef.current !== 'plus' || e.metaKey || e.ctrlKey || document.querySelector('.plus')) return
      const k = physicalKey(e)
      if (/^[0-9]$/.test(k)) {
        e.preventDefault()
        pointPick(Number(k))
        return
      }
      const st = current()
      const a = st ? actionFor(e, 'plus', st.settings, { ignoreShift: true, ignoreAlt: true }) : null
      const arm = a ? ARM_OF_ACTION[a] : undefined
      if (!arm) return
      e.preventDefault()
      pointArm(arm)
    }
    window.addEventListener('keydown', early, true)
    return () => window.removeEventListener('keydown', early, true)
  }, [])

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
  // Text size per area, as variables the stylesheets read.
  useEffect(() => {
    const t = s?.settings.text
    document.documentElement.style.setProperty('--text-pet', String(t?.pet ?? 1))
    document.documentElement.style.setProperty('--text-deck', String(t?.deck ?? 1))
  }, [s?.settings.text])

  if (!s) return null
  const close = () => setMode('field')

  // A click outside the open interface closes it, like clicking away from a menu.
  const onStageDown = (e: React.PointerEvent) => {
    if (modeRef.current === 'field') return
    const inside = (e.target as Element | null)?.closest?.('.plus, .deck-wrap, .capture, .toast, .clerk-ask')
    if (!inside) close()
  }

  return (
    <main className="stage" onPointerDownCapture={onStageDown}>
      <AnimatePresence>
        {shown !== 'field' && (
          <motion.div
            key="vignette"
            className={`vignette ${shown === 'capture' ? 'light' : ''}`}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.25 }}
          />
        )}
      </AnimatePresence>

      <Objectives s={s} mode={mode} />
      <Pet s={s} away={petAway} moving={moving} open={setMode} side={layout.compact ? layout.side : s.settings.hudSide} dragging={layout.dragging} compact={layout.compact} notice={clerk ?? pop ?? (layout.compact ? warning : null)} />
      <Feed />
      <Callout quiet={mode !== 'field'} />

      <AnimatePresence>
        {shown === 'plus' && <PlusMenu key="plus" s={s} close={close} open={setMode} />}
        {shown === 'deck' && <Deck key="deck" s={s} close={close} kind={bridge.kind} />}
        {shown === 'capture' && <Capture key="capture" s={s} close={close} />}
      </AnimatePresence>

      {shown !== 'field' && <ClerkAsk />}
      {cashIn && <CashIn key={cashIn.seq} amount={cashIn.amount} balance={cashIn.balance} from={cashIn.from} onDone={() => setCashIn(null)} />}

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
