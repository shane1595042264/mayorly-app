import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion, useAnimate, useReducedMotion, useTransform } from 'motion/react'
import {
  Check, Lightning, Pause, Play, Repeat, SkipForward, SquaresFour, Stop, Timer, Tray,
} from '@phosphor-icons/react'
import {
  blockView, clock, openFlow, type HudEvent, type Id, type MayorlyState, type Mode,
} from '@core/index'
import type { UiMode } from '../../../shared/bridge'
import { Glyph } from '../lib/glyphs'
import { Scramble } from '../lib/Scramble'
import { useLean } from '../lib/parallax'
import { sfx } from '../lib/sound'
import { dispatch, useHudEvents, useNow } from '../store'

type Arm = 'ledger' | 'entry' | 'mode' | 'orders'

interface Opt {
  key: string
  label: string
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

const ARM_KEYS: Record<string, Arm> = {
  ArrowUp: 'ledger', w: 'ledger', ArrowLeft: 'entry', a: 'entry', ArrowRight: 'mode', d: 'mode', ArrowDown: 'orders', s: 'orders',
}

export function PlusMenu({ s, close, open }: Props) {
  const now = useNow(250)
  const v = blockView(s, now)
  const reduce = useReducedMotion()
  const lean = useLean(7)
  const rotateX = useTransform(lean.rotateX, (r) => 8 + r)
  const rotateY = useTransform(lean.rotateY, (r) => -11 + r)
  const [slabScope, animateSlab] = useAnimate()
  const fit = useFit(1180, 720)

  const live = v !== null && v.block.kind === 'focus'
  // When the desk is idle, picks build a loadout that the next deploy uses.
  const [pick, setPick] = useState<{ ledgerId: Id | null; entryId: Id | null }>(() => {
    const first = openFlow(s)[0]
    return { ledgerId: s.desk.block?.ledgerId ?? first?.ledgerId ?? s.ledgers[0]?.id ?? null, entryId: s.desk.block?.entryId ?? null }
  })
  const ledgerId = live ? v!.block.ledgerId : pick.ledgerId
  const entryId = live ? v!.block.entryId : pick.entryId
  const ledger = s.ledgers.find((l) => l.id === ledgerId) ?? null
  const entry = s.entries.find((e) => e.id === entryId) ?? null

  const deploy = (mode: Mode, supersetId: Id | null = null) =>
    dispatch({ type: 'desk/deploy', mode, supersetId, entryId: entryId ?? null, ledgerId })

  const arms: Record<Arm, Opt[]> = useMemo(() => {
    const plan = s.desk.plan
    const flow = openFlow(s)
    const inLedger = ledgerId ? flow.filter((e) => e.ledgerId === ledgerId) : flow
    const desk = s.desk.status
    return {
      ledger: s.ledgers.map((l, i) => ({
        key: l.id,
        label: l.code,
        meta: String(i + 1),
        icon: <Glyph name={l.glyph} size={22} />,
        current: l.id === ledgerId,
        apply: () => {
          if (live) dispatch({ type: 'desk/swap', ledgerId: l.id })
          else {
            setPick({ ledgerId: l.id, entryId: flow.find((e) => e.ledgerId === l.id)?.id ?? null })
            sfx.swap()
          }
        },
      })),
      entry: inLedger.slice(0, 7).map((e) => ({
        key: e.id,
        label: e.title,
        meta: e.estimateMin ? `${e.estimateMin}m` : undefined,
        current: e.id === entryId,
        apply: () => {
          if (live) dispatch({ type: 'desk/swap', entryId: e.id })
          else {
            setPick({ ledgerId: e.ledgerId, entryId: e.id })
            sfx.swap()
          }
        },
      })),
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
  }, [s, ledgerId, entryId, live])

  const [arm, setArm] = useState<Arm>(live || s.ledgers.length ? 'ledger' : 'mode')
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
      if (e.altKey && e.key.toLowerCase() === 't') return
      const k = e.key.length === 1 ? e.key.toLowerCase() : e.key
      if (k === 'Escape') return close()
      if (k === 'Tab') {
        e.preventDefault()
        return open('deck')
      }
      if (ARM_KEYS[k]) {
        e.preventDefault()
        setArm(ARM_KEYS[k])
        sfx.tick()
        return
      }
      if (k === 'q') return move(-1)
      if (k === 'e') return move(1)
      if (k === 'Enter' || k === ' ') {
        e.preventDefault()
        return applyOpt(arms[arm][cursor[arm]])
      }
      if (/^[1-9]$/.test(k)) applyOpt(arms.ledger[Number(k) - 1])
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [arm, arms, cursor, close, open, move, applyOpt])

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
                <Scramble text={v?.block.kind === 'rest' ? 'REST' : ledger?.code ?? 'FREE'} />
              </div>
              <span className={`slab-status caps ${status === 'Live' ? 'live' : ''}`}>{status}</span>
            </div>
            <div className="slab-ledger caps">{ledger?.name ?? 'No ledger'}</div>
            <AnimatePresence mode="wait" initial={false}>
              <motion.div
                key={entry?.id ?? 'none'}
                className="slab-entry"
                initial={{ opacity: 0, x: 12 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -12 }}
                transition={{ duration: 0.22 }}
              >
                {entry?.title ?? (ledger ? `${ledger.name} time, no entry` : 'Nothing picked')}
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

        <ArmView id="ledger" title="Ledger" keyHint="↑" active={arm === 'ledger'} opts={arms.ledger} cursor={cursor.ledger}
          empty="No ledgers yet. Write one in the deck."
          onHover={(i) => { setArm('ledger'); setCursor((c) => ({ ...c, ledger: i })) }} onApply={applyOpt} />
        <ArmView id="entry" title="Entry" keyHint="←" active={arm === 'entry'} opts={arms.entry} cursor={cursor.entry}
          empty={ledger ? `Nothing open in ${ledger.code}. Capture with ${s.settings.hotkeys.capture}.` : 'Flow is empty.'}
          onHover={(i) => { setArm('entry'); setCursor((c) => ({ ...c, entry: i })) }} onApply={applyOpt} />
        <ArmView id="mode" title="Mode" keyHint="→" active={arm === 'mode'} opts={arms.mode} cursor={cursor.mode}
          empty=""
          onHover={(i) => { setArm('mode'); setCursor((c) => ({ ...c, mode: i })) }} onApply={applyOpt} />
        <ArmView id="orders" title="Orders" keyHint="↓" active={arm === 'orders'} opts={arms.orders} cursor={cursor.orders}
          empty=""
          onHover={(i) => { setArm('orders'); setCursor((c) => ({ ...c, orders: i })) }} onApply={applyOpt} />
      </motion.div>

      <footer className="plus-hints hint-row">
        <span><i className="key">↑</i><i className="key">←</i><i className="key">→</i><i className="key">↓</i> Arm</span>
        <span><i className="key">Q</i><i className="key">E</i> Cycle</span>
        <span><i className="key">Enter</i> Apply</span>
        <span><i className="key">1-9</i> Ledger</span>
        <span><i className="key">Tab</i> Deck</span>
        <span><i className="key">Esc</i> Close</span>
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
            {o.icon && <span className="opt-icon">{o.icon}</span>}
            <span className="opt-label">{o.label}</span>
            {o.meta && <span className="opt-meta mono">{o.meta}</span>}
          </button>
        ))}
      </div>
    </section>
  )
}

/** Uniform scale so the rig fits small screens without reflowing. */
function useFit(w: number, h: number): number {
  const calc = () => Math.min(1, (window.innerWidth - 32) / w, (window.innerHeight - 90) / h)
  const [k, setK] = useState(calc)
  useEffect(() => {
    const on = () => setK(calc())
    window.addEventListener('resize', on)
    return () => window.removeEventListener('resize', on)
  }, [])
  return k
}
