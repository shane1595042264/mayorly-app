import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion, useAnimate, useReducedMotion, useTransform } from 'motion/react'
import {
  Check, Couch, Lightning, Pause, Play, Repeat, SkipForward, SquaresFour, Stop, Timer, Tray,
} from '@phosphor-icons/react'
import {
  balance, blockView, clock, leisureList, LEISURE_TOKENS_PER_BLOCK, openFlow, type HudEvent, type Id, type MayorlyState, type Mode,
} from '@core/index'
import type { UiMode } from '../../../shared/bridge'
import { Glyph } from '../lib/glyphs'
import { hotkeyLabel, matchesAcceleratorKey, physicalKey } from '../lib/keys'
import { actionFor, keyLabel, keysFor, recordUse } from '../lib/keymap'
import { Scramble } from '../lib/Scramble'
import { useLean } from '../lib/parallax'
import { sfx } from '../lib/sound'
import { dispatch, useHudEvents, useNow } from '../store'
import { ARM_OF_ACTION, onArm, onPick, pointArm, takeArmHint, takePickHint, type Arm } from './arms'

interface Opt {
  key: string
  label: string
  /** The digit that picks it; 0 is the couch. Defaults to its place in the arm. */
  n?: number
  meta?: string
  icon?: React.ReactNode
  current?: boolean
  disabled?: boolean
  apply: () => void
}

interface Props {
  s: MayorlyState
  close: () => void
  open: (m: UiMode) => void
}

export function PlusMenu({ s, close, open }: Props) {
  const now = useNow(250)
  const v = blockView(s, now)
  const reduce = useReducedMotion()
  const lean = useLean(7)
  const rotateX = useTransform(lean.rotateX, (r) => 8 + r)
  const rotateY = useTransform(lean.rotateY, (r) => -11 + r)
  const [slabScope, animateSlab] = useAnimate()
  // The menu's text size scales the whole rig; the fit then keeps the bigger rig on screen.
  const textSize = s.settings.text.plus
  const fit = useFit(1180 * textSize, 720 * textSize) * textSize

  const live = v !== null && v.block.kind === 'focus'
  const couchNow = v !== null && v.block.kind === 'leisure'
  // When the desk is idle, picks build a loadout that the next deploy uses. The couch is a
  // pick too: the entry arm then lists the couch list, and an item there sits you down.
  const [pick, setPick] = useState<{ ledgerId: Id | null; entryId: Id | null; couch: boolean }>(() => {
    const first = openFlow(s)[0]
    return { ledgerId: s.desk.block?.ledgerId ?? first?.ledgerId ?? s.ledgers[0]?.id ?? null, entryId: s.desk.block?.entryId ?? null, couch: s.desk.block?.kind === 'leisure' }
  })
  // Picked the couch, live or not: the entry arm shows the couch list, and an item there parks the desk.
  const onCouch = couchNow || pick.couch
  const ledgerId = onCouch ? null : live ? v!.block.ledgerId : pick.ledgerId
  const entryId = onCouch ? null : live ? v!.block.entryId : pick.entryId
  const ledger = s.ledgers.find((l) => l.id === ledgerId) ?? null
  const entry = s.entries.find((e) => e.id === entryId) ?? null

  const deploy = (mode: Mode, supersetId: Id | null = null) =>
    dispatch({ type: 'desk/deploy', mode, supersetId, entryId: entryId ?? null, ledgerId })

  const arms: Record<Arm, Opt[]> = useMemo(() => {
    const plan = s.desk.plan
    const flow = openFlow(s)
    const inLedger = ledgerId ? flow.filter((e) => e.ledgerId === ledgerId) : flow
    const desk = s.desk.status
    const coins = balance(s)
    const ledgerArm: Opt[] = s.ledgers.map((l, i) => ({
      key: l.id,
      label: l.code,
      n: i + 1,
      icon: <Glyph name={l.glyph} size={22} />,
      current: l.id === ledgerId,
      apply: () => {
        if (live) {
          setPick((p) => ({ ...p, couch: false }))
          dispatch({ type: 'desk/swap', ledgerId: l.id })
        } else if (couchNow) dispatch({ type: 'desk/deploy', mode: 'pomodoro', ledgerId: l.id })
        else {
          setPick({ ledgerId: l.id, entryId: flow.find((e) => e.ledgerId === l.id)?.id ?? null, couch: false })
          sfx.swap()
        }
      },
    }))
    // The couch, on 0: picking it turns the entry arm into the couch list.
    ledgerArm.push({
      key: 'couch',
      label: 'COUCH',
      n: 0,
      icon: <Couch size={22} weight="light" />,
      current: onCouch,
      apply: () => {
        if (couchNow) return
        setPick((p) => ({ ...p, couch: true }))
        sfx.swap()
        pointArm('entry')
      },
    })
    const entryArm: Opt[] = onCouch
      ? leisureList(s).slice(0, 7).map((it, i) => ({
          key: it.id,
          label: it.title,
          n: i + 1,
          meta: coins < LEISURE_TOKENS_PER_BLOCK ? 'no coin' : undefined,
          current: couchNow && v!.block.leisureId === it.id,
          disabled: coins < LEISURE_TOKENS_PER_BLOCK && !(couchNow && v!.block.leisureId === it.id),
          apply: () => dispatch({ type: 'desk/deploy', mode: 'couch', leisureId: it.id }),
        }))
      : inLedger.slice(0, 7).map((e, i) => ({
          key: e.id,
          label: e.title,
          n: i + 1,
          meta: e.estimateMin ? `${e.estimateMin}m` : undefined,
          current: e.id === entryId,
          apply: () => {
            if (live) dispatch({ type: 'desk/swap', entryId: e.id })
            else if (couchNow) dispatch({ type: 'desk/deploy', mode: 'pomodoro', entryId: e.id, ledgerId: e.ledgerId })
            else {
              setPick({ ledgerId: e.ledgerId, entryId: e.id, couch: false })
              sfx.swap()
            }
          },
        }))
    return {
      ledger: ledgerArm,
      entry: entryArm,
      mode: [
        {
          key: 'pomodoro',
          label: 'Pomodoro',
          meta: `${s.settings.focusMin} / ${s.settings.shortRestMin}`,
          icon: <Timer size={18} weight="light" />,
          current: plan?.mode === 'pomodoro',
          apply: () => deploy('pomodoro'),
        },
        {
          key: 'blitz',
          label: 'Blitz flow',
          meta: `${flow.length} in flow`,
          icon: <Lightning size={18} weight="light" />,
          current: plan?.mode === 'blitz',
          disabled: flow.length === 0,
          apply: () => deploy('blitz'),
        },
        ...s.supersets.map((ss) => ({
          key: ss.id,
          label: ss.name,
          meta: `${ss.slots.length} slots ${ss.rounds ? `x${ss.rounds}` : 'loop'}`,
          icon: <Repeat size={18} weight="light" />,
          current: plan?.mode === 'superset' && plan.supersetId === ss.id,
          disabled: ss.slots.length === 0,
          apply: () => deploy('superset', ss.id),
        })),
      ],
      orders:
        desk === 'idle'
          ? [
              { key: 'capture', label: 'Capture', icon: <Tray size={18} weight="light" />, apply: () => open('capture') },
              { key: 'deck', label: 'Deck', icon: <SquaresFour size={18} weight="light" />, apply: () => open('deck') },
            ]
          : [
              desk === 'running'
                ? { key: 'hold', label: 'Hold', icon: <Pause size={18} weight="light" />, apply: () => dispatch({ type: 'desk/pause' }) }
                : { key: 'resume', label: 'Resume', icon: <Play size={18} weight="light" />, apply: () => dispatch({ type: 'desk/resume' }) },
              { key: 'clear', label: 'Clear', icon: <Check size={18} weight="light" />, disabled: !entry || !live, apply: () => entry && dispatch({ type: 'entry/complete', id: entry.id }) },
              { key: 'skip', label: 'Skip', icon: <SkipForward size={18} weight="light" />, apply: () => dispatch({ type: 'desk/skip' }) },
              { key: 'stand', label: 'Stand down', icon: <Stop size={18} weight="light" />, apply: () => dispatch({ type: 'desk/standDown' }) },
              { key: 'deck', label: 'Deck', icon: <SquaresFour size={18} weight="light" />, apply: () => open('deck') },
            ],
    }
  }, [s, ledgerId, entryId, live, couchNow, onCouch, v])

  // An arrow pressed with the swap key, before this mounted, already chose the arm.
  const [arm, setArm] = useState<Arm>(() => takeArmHint() ?? (live || s.ledgers.length ? 'ledger' : 'mode'))
  useEffect(() => {
    const late = takeArmHint()
    if (late) setArm(late)
    return onArm((a) => {
      takeArmHint()
      setArm(a)
      sfx.tick()
    })
  }, [])
  const [cursor, setCursor] = useState<Record<Arm, number>>(() => ({ ledger: 0, entry: 0, mode: 0, orders: 0 }))

  // Keep each arm's cursor on its current option when the menu opens or the current changes.
  useEffect(() => {
    setCursor((c) => {
      const next = { ...c }
      for (const a of Object.keys(arms) as Arm[]) {
        const i = arms[a].findIndex((o) => o.current)
        if (i >= 0) next[a] = i
        else next[a] = Math.min(c[a], Math.max(0, arms[a].length - 1))
      }
      return next
    })
  }, [arms])

  const applyOpt = useCallback((o: Opt | undefined) => {
    if (!o || o.disabled) return
    o.apply()
  }, [])

  // A digit: that item in the arm you are on; 0 is always the couch.
  const pickDigit = useCallback(
    (n: number) => {
      const a: Arm = n === 0 ? 'ledger' : arm
      const i = arms[a].findIndex((o) => o.n === n)
      if (i < 0) return
      setCursor((c) => ({ ...c, [a]: i }))
      applyOpt(arms[a][i])
      recordUse('plus.pick')
    },
    [arm, arms, applyOpt],
  )
  useEffect(() => onPick(pickDigit), [pickDigit])
  // A digit pressed with the swap key, before this mounted.
  const firstPickDone = useRef(false)
  useEffect(() => {
    if (firstPickDone.current) return
    firstPickDone.current = true
    const h = takePickHint()
    if (h !== null) pickDigit(h)
  }, [pickDigit])

  const move = useCallback(
    (d: number) => {
      const n = arms[arm].length
      if (!n) return
      setCursor((c) => ({ ...c, [arm]: (c[arm] + d + n) % n }))
      sfx.tick()
    },
    [arm, arms],
  )

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // The swap hotkey itself (held to peek) is the shell's; app menu chords are not ours.
      if (e.altKey && matchesAcceleratorKey(e, s.settings.hotkeys.plus)) return
      if (e.metaKey || e.ctrlKey) return
      // The plus scope of the keymap, by key position and with Option ignored, so everything
      // works while the swap key is still held on a Mac.
      const a = actionFor(e, 'plus', s.settings, { ignoreShift: true, ignoreAlt: true })
      const pointed = a ? ARM_OF_ACTION[a] : undefined
      if (pointed) {
        e.preventDefault()
        recordUse(a!)
        pointArm(pointed)
        return
      }
      if (a === 'plus.close') return close()
      if (a === 'plus.deck') {
        e.preventDefault()
        recordUse(a)
        return open('deck')
      }
      if (a === 'plus.prev') return move(-1)
      if (a === 'plus.next') return move(1)
      if (a === 'plus.apply') {
        e.preventDefault()
        recordUse(a)
        return applyOpt(arms[arm][cursor[arm]])
      }
      // A number picks that item in the arm you are on, 0 the couch: no cycling.
      const k = physicalKey(e)
      if (/^[0-9]$/.test(k)) {
        e.preventDefault()
        pickDigit(Number(k))
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [arm, arms, cursor, close, open, move, applyOpt, pickDigit, s.settings])

  // Snap the slab when the loadout changes, like an attachment seating.
  useHudEvents(
    useCallback(
      (events: HudEvent[]) => {
        if (reduce || !slabScope.current) return
        if (events.some((e) => e.type === 'swap' || e.type === 'block')) {
          void animateSlab(slabScope.current, { z: [-46, 0], rotateY: [9, 0] }, { type: 'spring', stiffness: 260, damping: 18 })
        }
      },
      [reduce, animateSlab, slabScope],
    ),
  )
  const firstPick = useRef(true)
  useEffect(() => {
    if (firstPick.current) {
      firstPick.current = false
      return
    }
    if (!reduce && slabScope.current) void animateSlab(slabScope.current, { z: [-30, 0] }, { type: 'spring', stiffness: 260, damping: 20 })
  }, [pick, reduce, animateSlab, slabScope])

  const modeName = !s.desk.plan
    ? 'Choose a mode to deploy'
    : s.desk.plan.mode === 'superset'
      ? s.supersets.find((x) => x.id === s.desk.plan!.supersetId)?.name ?? 'Superset'
      : s.desk.plan.mode === 'blitz' ? 'Blitz flow' : 'Pomodoro'

  const status = !v ? 'Idle' : v.status === 'paused' ? 'Hold' : v.status === 'ready' ? 'Ready' : v.block.kind === 'rest' ? 'Rest' : 'Live'
  const time = !v ? clock(s.settings.focusMin * 60_000) : v.remainingMs === null ? clock(v.elapsedMs, false) : clock(v.remainingMs)

  return (
    <motion.div
      className="plus"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, transition: { duration: 0.18 } }}
      onClick={(e) => e.target === e.currentTarget && close()}
    >
      <motion.div
        className="plus-rig"
        data-arm={arm}
        style={{ rotateX, rotateY, scale: fit }}
        initial={reduce ? false : { z: -160, opacity: 0 }}
        animate={{ z: 0, opacity: 1 }}
        transition={{ type: 'spring', stiffness: 170, damping: 22 }}
      >
        {/* leader lines from the slab's attachment points to each arm */}
        <i className="lead lead-top" />
        <i className="lead lead-left" />
        <i className="lead lead-right" />
        <i className="lead lead-bottom" />

        <div className="slab" ref={slabScope}>
          <div className="slab-face">
            <span className="corner tl" /><span className="corner tr" /><span className="corner bl" /><span className="corner br" />
            <i className="node n-top" /><i className="node n-left" /><i className="node n-right" /><i className="node n-bottom" />
            <div className="slab-top">
              <div className="slab-code">
                {ledger && <Glyph name={ledger.glyph} size={30} />}
                {!ledger && onCouch && <Couch size={30} weight="light" />}
                <Scramble text={v?.block.kind === 'rest' ? 'REST' : onCouch ? 'COUCH' : ledger?.code ?? 'FREE'} />
              </div>
              <span className={`slab-status caps ${status === 'Live' ? 'live' : ''}`}>{status}</span>
            </div>
            <div className="slab-ledger caps">{onCouch ? 'Leisure' : ledger?.name ?? 'No ledger'}</div>
            <AnimatePresence mode="wait" initial={false}>
              <motion.div
                key={entry?.id ?? 'none'}
                className="slab-entry"
                initial={{ opacity: 0, x: 12 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -12 }}
                transition={{ duration: 0.22 }}
              >
                {onCouch ? (couchNow ? v!.block.label : 'Pick something from the couch list') : entry?.title ?? (ledger ? `${ledger.name} time, no entry` : 'Nothing picked')}
              </motion.div>
            </AnimatePresence>
            <div className="slab-foot">
              <span className="caps">{modeName}</span>
              <span className="slab-time num">{time}</span>
            </div>
          </div>
          <div className="slab-edge e-top" />
          <div className="slab-edge e-right" />
          <div className="slab-edge e-bottom" />
          <div className="slab-edge e-left" />
        </div>

        <ArmView id="ledger" title="Ledger" keyHint={keyLabel(keysFor('plus.ledger', s.settings)[0] ?? '')} active={arm === 'ledger'} opts={arms.ledger} cursor={cursor.ledger}
          empty="No ledgers yet. Write one in the deck."
          onHover={(i) => { setArm('ledger'); setCursor((c) => ({ ...c, ledger: i })) }} onApply={applyOpt} />
        <ArmView id="entry" title="Entry" keyHint={keyLabel(keysFor('plus.entry', s.settings)[0] ?? '')} active={arm === 'entry'} opts={arms.entry} cursor={cursor.entry}
          empty={onCouch ? 'The couch list is empty. Add something in the deck.' : ledger ? `Nothing open in ${ledger.code}. Capture with ${hotkeyLabel(s.settings.hotkeys.capture)}.` : 'Flow is empty.'}
          onHover={(i) => { setArm('entry'); setCursor((c) => ({ ...c, entry: i })) }} onApply={applyOpt} />
        <ArmView id="mode" title="Mode" keyHint={keyLabel(keysFor('plus.mode', s.settings)[0] ?? '')} active={arm === 'mode'} opts={arms.mode} cursor={cursor.mode}
          empty=""
          onHover={(i) => { setArm('mode'); setCursor((c) => ({ ...c, mode: i })) }} onApply={applyOpt} />
        <ArmView id="orders" title="Orders" keyHint={keyLabel(keysFor('plus.orders', s.settings)[0] ?? '')} active={arm === 'orders'} opts={arms.orders} cursor={cursor.orders}
          empty=""
          onHover={(i) => { setArm('orders'); setCursor((c) => ({ ...c, orders: i })) }} onApply={applyOpt} />
      </motion.div>

      <footer className="plus-hints hint-row">
        <span>{(['plus.ledger', 'plus.entry', 'plus.mode', 'plus.orders'] as const).map((id) => <i key={id} className="key">{keyLabel(keysFor(id, s.settings)[0] ?? '')}</i>)} Arm</span>
        <span><i className="key">1-9</i> Pick</span>
        <span><i className="key">0</i> Couch</span>
        <span><i className="key">{keyLabel(keysFor('plus.prev', s.settings)[0] ?? '')}</i><i className="key">{keyLabel(keysFor('plus.next', s.settings)[0] ?? '')}</i> Cycle</span>
        <span><i className="key">{keyLabel(keysFor('plus.apply', s.settings)[0] ?? '')}</i> Apply</span>
        <span><i className="key">{keyLabel(keysFor('plus.deck', s.settings)[0] ?? '')}</i> Deck</span>
        <span><i className="key">{keyLabel(keysFor('plus.close', s.settings)[0] ?? '')}</i> Close</span>
      </footer>
    </motion.div>
  )
}

function ArmView(props: {
  id: Arm
  title: string
  keyHint: string
  active: boolean
  opts: Opt[]
  cursor: number
  empty: string
  onHover: (i: number) => void
  onApply: (o: Opt) => void
}) {
  const { id, title, keyHint, active, opts, cursor, empty, onHover, onApply } = props
  return (
    <section className={`arm arm-${id} ${active ? 'active' : ''}`} aria-label={title}>
      <header className="arm-title caps">
        <span className="key">{keyHint}</span>
        {title}
      </header>
      {opts.length === 0 && empty && <p className="arm-empty">{empty}</p>}
      <div className="arm-opts" role="listbox">
        {opts.map((o, i) => (
          <button
            key={o.key}
            role="option"
            aria-selected={o.current}
            disabled={o.disabled}
            className={`opt ${o.current ? 'current' : ''} ${active && i === cursor ? 'cursor' : ''}`}
            onMouseEnter={() => onHover(i)}
            onClick={() => onApply(o)}
          >
            {(o.n ?? i + 1) <= 9 && <span className="opt-n mono num" aria-hidden="true">{o.n ?? i + 1}</span>}
            {o.icon && <span className="opt-icon">{o.icon}</span>}
            <span className="opt-label">{o.label}</span>
            {o.meta && <span className="opt-meta mono">{o.meta}</span>}
          </button>
        ))}
      </div>
    </section>
  )
}

/**
 * Uniform scale so the rig fits small screens without reflowing. On a Mac the menu mounts
 * while the window is still the pet's size and grows a moment later, so the measure is taken
 * again on every resize, from an observer on the document, and on a few timers after mount:
 * one missed resize event left the rig tiny at the centre until the menu was reopened.
 */
function useFit(w: number, h: number): number {
  const calc = () => {
    const el = document.documentElement
    const vw = Math.max(window.innerWidth, el.clientWidth)
    const vh = Math.max(window.innerHeight, el.clientHeight)
    return Math.min(1, (vw - 32) / w, (vh - 90) / h)
  }
  const [k, setK] = useState(calc)
  useEffect(() => {
    const on = () => setK(calc())
    window.addEventListener('resize', on)
    window.visualViewport?.addEventListener('resize', on)
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(on) : null
    ro?.observe(document.documentElement)
    const timers = [80, 200, 400, 800, 1500].map((ms) => setTimeout(on, ms))
    return () => {
      window.removeEventListener('resize', on)
      window.visualViewport?.removeEventListener('resize', on)
      ro?.disconnect()
      for (const t of timers) clearTimeout(t)
    }
  }, [])
  return k
}
