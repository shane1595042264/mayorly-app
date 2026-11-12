import { useCallback, useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import type { Action, FoundTask, HudEvent } from '@core/index'
import type { Command, Layout, UiMode } from '../../shared/bridge'
import { clampScale, drawerBox, homeAnchor, petBox, sideOf, type Point } from '../../shared/pet'
import { bridge } from './bridge'
import { Capture } from './capture/Capture'
import { Find } from './capture/Find'
import { Switcher } from './hud/Switcher'
import { ClerkAsk } from './deck/ClerkAsk'
import { Deck } from './deck/Deck'
import { Drawer } from './hud/Drawer'
import { actionFor, recordUse } from './lib/keymap'
import { takeOrigin } from './lib/origin'
import { Callout } from './hud/Callout'
import { CashIn } from './hud/CashIn'
import { Feed } from './hud/Feed'
import { Objectives } from './hud/Objectives'
import { Pet } from './hud/Pet'
import { MODIFIER_KEYS, hotkeyLabel, matchesAcceleratorKey, physicalKey } from './lib/keys'
import { setSoundEnabled, sfx } from './lib/sound'
import { onCalendarAsk } from './lib/calendarAsk'
import { ARM_OF_ACTION, ARM_OF_COMMAND, isPick, onArm, pointArm, pointPick, takeArmHint, takePickHint } from './plus/arms'
import { PlusMenu } from './plus/PlusMenu'
import { balance, onDeskId, recentTasks, switcherAction } from '@core/index'
import { current, dispatch, useHudEvents, useMayorly } from './store'

/** How long the swap hotkey must be held before releasing it closes the menu (hold to peek). */
const PEEK_MS = 400
/** How far the pointer has to travel over the task switcher before it moves the highlight. */
const SWITCHER_STEER_PX = 6
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
  // Browsing the Plus menu is temporary. Only its final choice reaches the engine on close.
  const plusChoice = useRef<Action | null>(null)
  const stagePlus = useCallback((action: Action | null) => {
    if (modeRef.current === 'plus') plusChoice.current = action
  }, [])
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
      if (st && (a === 'move.bigger' || a === 'move.smaller')) {
        dispatch({ type: 'settings/update', patch: { hudScale: clampScale(st.settings.hudScale + (a === 'move.bigger' ? 0.1 : -0.1)) } })
        return
      }
      const d = a ? DIRS[a] : undefined
      if (d) {
        const step = e.shiftKey ? FAR : STEP
        bridge.nudge(d[0] * step, d[1] * step)
        return
      }
      if (k === '1' || k === '2' || k === '3' || k === '4') {
        bridge.snap(Number(k) as 1 | 2 | 3 | 4)
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
        if (e.type !== 'harvest' || e.tokens <= 0) continue
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
    const leavingPlus = modeRef.current === 'plus'
    // The switcher is a key held for a moment, not a panel opening.
    if (m !== 'switcher' && modeRef.current !== 'switcher') {
      if (m === 'field') sfx.close()
      else sfx.open()
    }
    modeRef.current = m
    setModeState(m)
    if (leavingPlus) {
      const action = plusChoice.current
      plusChoice.current = null
      takeArmHint()
      takePickHint()
      if (action) void dispatch(action)
    }
    if (pending.current) {
      clearTimeout(pending.current)
      pending.current = null
    }
    // The drawer keeps the pet in view (Windows and the browser: it is drawn beside the pet in this window).
    const away = m !== 'field' && m !== 'drawer' && m !== 'switcher'
    const windowIsBig = shellMode.current !== 'field'
    if (!layoutRef.current.compact || (m !== 'field' && windowIsBig)) {
      // Windows, or moving between panels: the window does not change size, nothing to wait for.
      setPetAway(away)
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

  // A /cal request from the capture line: the deck opens, and turns to the Calendar tab. The
  // capture line closes itself right after the order, so the open waits a beat to come after.
  useEffect(() => onCalendarAsk(() => void setTimeout(() => setMode('deck'), 40)), [setMode])

  // The first launch of a new build opens the deck, which shows what changed.
  useEffect(() => {
    void bridge.whatsNew().then((fresh) => {
      if (fresh && modeRef.current === 'field') setMode('deck')
    })
  }, [setMode])

  // The shell says whether the window is the pet alone (macOS) and which side it hangs on.
  // Asked for on mount as well as subscribed to: the first push can land before this effect runs.
  // A drag of the tomato in this window (Windows): its live place, until the shell answers with where it settled.
  const [dragAnchor, setDragAnchor] = useState<Point | null>(null)
  const dragClear = useRef<ReturnType<typeof setTimeout> | null>(null)
  // While the tomato is held the overlay keeps the pointer, even where the pet cannot follow (a clamped edge, a fast flick).
  const grabbing = useRef(false)
  useEffect(() => {
    const take = (l: Layout) => {
      setLayout(l)
      // Mid-carry the overlay may change displays; the tomato stays with the pointer.
      if (!grabbing.current) setDragAnchor(null)
    }
    void bridge.getLayout().then(take)
    return bridge.onLayout(take)
  }, [])
  // This computer's id: the pet says so when the desk is running on another one.
  const [here, setHere] = useState<string | null>(null)
  useEffect(() => void bridge.getInfo().then((info) => setHere(info.device)), [])
  const onDrag = useCallback((a: Point) => setDragAnchor(a), [])
  const onScale = useCallback((hudScale: number) => dispatch({ type: 'settings/update', patch: { hudScale } }), [])
  const onGrab = useCallback((held: boolean, carrying = false) => {
    grabbing.current = held
    if (held) bridge.setHit(true)
    bridge.setPetHeld(held && carrying)
  }, [])
  const onPlace = useCallback((a: Point, onScreen: Point) => {
    setDragAnchor(a)
    bridge.placePet(a.x, a.y, onScreen.x, onScreen.y)
    // The shell's layout clears it; if no answer comes, the pet does not stay stuck on the drag.
    if (dragClear.current) clearTimeout(dragClear.current)
    dragClear.current = setTimeout(() => setDragAnchor(null), 1500)
  }, [])
  // The window's size: on Windows the overlay is the work area, the room the pet moves in.
  const [area, setArea] = useState(() => ({ width: window.innerWidth, height: window.innerHeight }))
  useEffect(() => {
    const on = () => setArea({ width: window.innerWidth, height: window.innerHeight })
    window.addEventListener('resize', on)
    return () => window.removeEventListener('resize', on)
  }, [])
  // Where the tomato is in this window. On a Mac the window is the pet, so there is no such place.
  const whole = { x: 0, y: 0, ...area }
  const anchor = layout.compact ? null : (dragAnchor ?? layout.pet ?? homeAnchor(whole, s?.settings.hudScale ?? 1, s?.settings.hudSide ?? 'right'))
  // The side the pet is on: the shell's answer when the window is the pet, else the tomato's half of
  // the screen. The drawer and the caption hang off the same side.
  const petSide = layout.compact || !anchor ? layout.side : sideOf(whole, anchor)
  useEffect(() => {
    layoutRef.current = layout
    document.body.classList.toggle('compact', layout.compact)
    document.body.classList.toggle('side-left', petSide === 'left')
    document.body.classList.toggle('side-right', petSide === 'right')
  }, [layout, petSide])

  // The task switcher, Alt+Tab for tasks. Its keys live here because a quick tap can be over
  // before the list has mounted: the list is only a picture of this.
  const [switcher, setSwitcherState] = useState<{ rows: FoundTask[]; start: number; at: number } | null>(null)
  const switcherRef = useRef<typeof switcher>(null)
  const switcherStep = useRef(0)
  const setSwitcher = (v: typeof switcher) => {
    switcherRef.current = v
    setSwitcherState(v)
  }
  const stepSwitcher = (by: number) => {
    const v = switcherRef.current
    if (v) setSwitcher({ ...v, at: (v.at + by + v.rows.length) % v.rows.length })
  }
  // The list opens in the middle of the screen, often right under a resting pointer, and a twitch
  // there used to move the highlight to whatever row was under it; letting go then took that row.
  // The pointer only steers once it has really moved from where it was when the list appeared.
  const switcherPointer = useRef<{ x: number; y: number } | null>(null)
  const pointSwitcher = (at: number, x: number, y: number) => {
    const v = switcherRef.current
    if (!v) return
    const from = switcherPointer.current
    if (!from) {
      switcherPointer.current = { x, y }
      return
    }
    if (Math.hypot(x - from.x, y - from.y) < SWITCHER_STEER_PX) return
    if (v.at !== at) setSwitcher({ ...v, at })
  }
  const finishSwitcher = useCallback((go: boolean, at?: number) => {
    const v = switcherRef.current
    const st = current()
    if (!v) return
    switcherRef.current = null
    setMode('field')
    if (!go || !st) return
    // What is highlighted is what you get (switcherAction).
    const action = switcherAction(st, v.rows, v.start, at ?? v.at)
    if (action) void dispatch(action)
  }, [setMode])
  useEffect(() => {
    if (mode === 'switcher') return
    switcherRef.current = null
    setSwitcherState(null)
  }, [mode])
  // Always listening, and gated on the ref: a tap's release can arrive before React has drawn the list.
  useEffect(() => {
    const NAMES: Record<string, string> = { alt: 'Alt', option: 'Alt', ctrl: 'Control', control: 'Control', shift: 'Shift', cmd: 'Meta', command: 'Meta', super: 'Meta', meta: 'Meta', commandorcontrol: 'Control', cmdorctrl: 'Control' }
    const mods = () => (current()?.settings.hotkeys.switch ?? 'Alt+Q').split('+').slice(0, -1).map((m) => NAMES[m.toLowerCase()] ?? m)
    // The release. A mouse move catches one that happened before this window had the keyboard.
    const check = (e: KeyboardEvent | MouseEvent) => {
      if (!switcherRef.current) return
      const m = mods()
      if (m.length && !m.some((x) => e.getModifierState(x))) finishSwitcher(true)
    }
    const key = (e: KeyboardEvent) => {
      if (!switcherRef.current || MODIFIER_KEYS.has(e.key)) return
      e.preventDefault()
      e.stopPropagation()
      if (e.key === 'Escape') return finishSwitcher(false)
      const st = current()
      const a = st ? actionFor(e, 'switcher', st.settings, { ignoreAlt: true }) : null
      if (a === 'switcher.pick') finishSwitcher(true)
      else if (a === 'switcher.down') stepSwitcher(1)
      else if (a === 'switcher.up') stepSwitcher(-1)
    }
    window.addEventListener('keydown', key, true)
    window.addEventListener('keyup', check, true)
    window.addEventListener('mousemove', check, true)
    return () => {
      window.removeEventListener('keydown', key, true)
      window.removeEventListener('keyup', check, true)
      window.removeEventListener('mousemove', check, true)
    }
  }, [finishSwitcher])

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
        if (cmd === 'switcher') {
          recordUse('global.switch')
          const now = Date.now()
          if (cur === 'switcher') {
            // A held key repeats: step at a readable pace, as Alt+Tab does.
            if (now - switcherStep.current < 130) return
            switcherStep.current = now
            stepSwitcher(1)
            return
          }
          const st = current()
          if (!st) return
          const rows = recentTasks(st, 10)
          const start = rows[0] && (rows[0].kind === 'entry' ? rows[0].entry.id : rows[0].item.id) === onDeskId(st) ? 1 : 0
          // Nowhere in the list to go: the plain switch still knows a parked place, or says there is none.
          if (start >= rows.length) {
            void dispatch({ type: 'desk/switch' })
            return
          }
          switcherStep.current = now
          switcherPointer.current = null
          setSwitcher({ rows, start, at: start })
          setMode('switcher')
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
      if (grabbing.current) {
        last = true
        return
      }
      const hit = !!(e.target as Element | null)?.closest?.('[data-hit]')
      if (hit !== last) {
        last = hit
        bridge.setHit(hit)
      }
    }
    // Leaving the window altogether (relatedTarget null) lets a hovered control go.
    const leave = (e: MouseEvent) => {
      if (grabbing.current) return
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
  // The page never scrolls. Its roots are overflow hidden, but a focus or scrollIntoView can still
  // move them (on a Mac, while the window is pet-sized and about to grow), and the deck then sits
  // partly above the window until a relaunch. Any such scroll is put back at once.
  useEffect(() => {
    const onScroll = (e: Event) => {
      const t = e.target === document ? document.scrollingElement : e.target
      if (!(t instanceof HTMLElement) || !(t.scrollTop || t.scrollLeft)) return
      if (t === document.documentElement || t === document.body || t.id === 'root' || t.classList.contains('deck-wrap') || t.querySelector('.deck-wrap')) {
        t.scrollTop = 0
        t.scrollLeft = 0
      }
    }
    document.addEventListener('scroll', onScroll, true)
    return () => document.removeEventListener('scroll', onScroll, true)
  }, [])

  if (!s) return null
  const close = () => setMode('field')
  // Windows: the drawer in the box the Mac gives its window, under the pet or over it.
  const drawerRect = anchor ? drawerBox(petBox(anchor, whole, s.settings.hudScale, s.settings.text.pet), whole, petSide) : null
  const drawerAt = drawerRect ? { left: drawerRect.x + 4, top: drawerRect.y + 4, right: 'auto', bottom: 'auto' } : undefined

  // A click outside the open interface closes it, like clicking away from a menu.
  const onStageDown = (e: React.PointerEvent) => {
    if (modeRef.current === 'field') return
    const inside = (e.target as Element | null)?.closest?.('.plus, .deck-wrap, .capture, .switcher, .clerk-ask, .drawer, .pet, .pet-caption-box')
    if (!inside) close()
  }

  return (
    <main className="stage" onPointerDownCapture={onStageDown}>
      <AnimatePresence>
        {/* The drawer is a small panel by the pet, as on a Mac where it is its own window: nothing dims. */}
        {shown !== 'field' && shown !== 'drawer' && shown !== 'switcher' && (
          <motion.div
            key="vignette"
            className={`vignette ${shown === 'capture' || shown === 'find' ? 'light' : ''}`}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.25 }}
          />
        )}
      </AnimatePresence>

      <Objectives s={s} mode={mode} />
      <Pet
        s={s}
        here={here}
        away={petAway}
        moving={moving}
        open={setMode}
        side={petSide}
        dragging={layout.dragging || dragAnchor !== null}
        compact={layout.compact}
        notice={clerk ?? pop ?? warning}
        anchor={anchor}
        area={area}
        onDrag={onDrag}
        onPlace={onPlace}
        onGrab={onGrab}
        onScale={onScale}
      />
      <Feed />
      <Callout quiet={mode !== 'field'} />

      <AnimatePresence>
        {shown === 'plus' && <PlusMenu key="plus" s={s} close={close} open={setMode} stage={stagePlus} />}
        {shown === 'deck' && <Deck key="deck" s={s} close={close} kind={bridge.kind} />}
        {shown === 'capture' && <Capture key="capture" s={s} close={close} />}
        {shown === 'find' && <Find key="find" s={s} close={close} />}
        {shown === 'switcher' && switcher && <Switcher key="switcher" s={s} rows={switcher.rows} at={switcher.at} point={pointSwitcher} pick={(i) => finishSwitcher(true, i)} />}
        {shown === 'drawer' && <Drawer key="drawer" s={s} close={close} style={drawerAt} />}
      </AnimatePresence>

      {shown !== 'field' && shown !== 'switcher' && <ClerkAsk />}
      {cashIn && <CashIn key={cashIn.seq} amount={cashIn.amount} balance={cashIn.balance} from={cashIn.from} onDone={() => setCashIn(null)} />}

    </main>
  )
}
