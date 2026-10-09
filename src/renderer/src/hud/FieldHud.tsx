import { motion, useTransform } from 'motion/react'
import { Check, Coins, Crosshair, Pause, Play, SkipForward, SquaresFour, Stop, Tray } from '@phosphor-icons/react'
import {
  balance, blockView, clock, currentSitting, peekNext, tomatoProgress, type MayorlyState,
} from '@core/index'
import type { UiMode } from '../../../shared/bridge'
import { Glyph } from '../lib/glyphs'
import { Scramble } from '../lib/Scramble'
import { useLean } from '../lib/parallax'
import { dispatch, useNow } from '../store'

interface Props {
  s: MayorlyState
  mode: UiMode
  open: (m: UiMode) => void
}

export function FieldHud({ s, mode, open }: Props) {
  const now = useNow(250)
  const lean = useLean(2.5)
  const right = s.settings.hudSide === 'right'
  const rotateY = useTransform(lean.rotateY, (r) => (right ? -15 : 15) + r)
  const rotateX = useTransform(lean.rotateX, (r) => 5 + r)
  const v = blockView(s, now)
  const sitting = currentSitting(s)
  const next = v ? peekNext(s, now) : null
  const hk = s.settings.hotkeys
  const hidden = mode === 'plus' || mode === 'deck'

  let tag = 'Idle'
  let tagLive = false
  // Idle shows the loadout that a deploy would run: one focus length, dimmed.
  let big = clock(s.settings.focusMin * 60_000)
  let small = ''
  if (v) {
    const focus = v.block.kind === 'focus'
    tagLive = v.status === 'running' && focus
    tag = v.status === 'paused' ? 'Hold' : v.status === 'ready' ? 'Ready' : focus ? (v.remainingMs === null ? 'Open' : v.overtimeMs > 0 ? 'Over' : 'Live') : 'Rest'
    if (v.remainingMs === null) big = clock(v.elapsedMs, false)
    else if (v.overtimeMs > 0) big = `+${clock(v.overtimeMs, false)}`
    else big = clock(v.remainingMs)
    small = v.block.durationMs ? clock(v.block.durationMs) : 'no est'
  }

  const code = v?.block.kind === 'focus' ? v.ledger?.code ?? 'FREE' : null
  const head = v ? v.block.label : 'Desk idle'
  const title = !v
    ? 'Pick a ledger and deploy'
    : v.block.kind === 'rest'
      ? next ? `Next up: ${next.label}` : 'Last rest'
      : v.entry?.title ?? `${v.block.label} time, no entry`

  const pips = Math.min(sitting?.tomatoes ?? 0, 8)
  const partial = tomatoProgress(s, now)

  return (
    <motion.section
      className={`hud ${right ? 'hud-right' : 'hud-left'} ${v ? `is-${v.block.kind} st-${v.status}` : 'is-idle'}`}
      style={{ rotateX, rotateY, scale: s.settings.hudScale }}
      initial={{ opacity: 0, x: right ? 48 : -48 }}
      animate={{ opacity: hidden ? 0 : 1, x: hidden ? (right ? 40 : -40) : 0 }}
      transition={{ type: 'spring', stiffness: 160, damping: 24 }}
      data-hit
      aria-label="Desk status"
    >
      <div className="hud-scrim" aria-hidden />

      <header className="hud-head caps">
        {code && <Scramble className="hud-code mono" text={code} />}
        {v?.ledger && <Glyph name={v.ledger.glyph} size={15} />}
        <Scramble text={head} />
        {v && v.block.round > 0 && s.desk.plan?.mode === 'superset' && (
          <span className="hud-round mono">R{v.block.round}</span>
        )}
      </header>

      <Scramble className="hud-title" text={title} ms={480} />

      <div className="hud-readout">
        <span className={`hud-clock num ${v ? '' : 'dim'}`}>{big}</span>
        <span className="hud-side">
          <span className="mono num">{small && `/ ${small}`}</span>
          <span className={`hud-tag caps ${tagLive ? 'live' : ''} ${v?.status === 'paused' ? 'pulse' : ''}`}>{tag}</span>
        </span>
      </div>

      <div className="hud-bar" aria-hidden>
        <div
          className={`hud-bar-fill ${tagLive ? 'live' : ''}`}
          style={{ transform: `scaleX(${v?.progress ?? (v ? 1 : 0)})` }}
        />
      </div>

      <div className="hud-economy">
        <span className="hud-pips" aria-label={`${sitting?.tomatoes ?? 0} tomatoes this sitting`}>
          {Array.from({ length: pips }, (_, i) => <i key={i} className="pip full" />)}
          {sitting && <i className="pip"><b style={{ transform: `scaleY(${partial})` }} /></i>}
        </span>
        <span className="caps">{sitting ? `${sitting.tomatoes} tomato${sitting.tomatoes === 1 ? '' : 'es'}` : 'Tokens'}</span>
        {sitting && sitting.tokens > 0 && <span className="hud-earned mono num">+{sitting.tokens}</span>}
        <span className="hud-balance mono num" title="Token balance">
          <Coins size={12} aria-hidden />
          {balance(s).toLocaleString()}
        </span>
      </div>

      {next && (
        <div className="hud-next">
          <span className="caps dim">Next</span>
          {next.kind === 'focus' ? (
            <>
              <span className="mono">{s.ledgers.find((l) => l.id === next.ledgerId)?.code ?? 'FREE'}</span>
              <span className="ellipsis">{s.entries.find((e) => e.id === next.entryId)?.title ?? next.label}</span>
            </>
          ) : (
            <span>{next.label}</span>
          )}
          {next.durationMs !== null && <span className="mono num">{clock(next.durationMs)}</span>}
        </div>
      )}

      <nav className="hud-controls" aria-label="Desk controls">
        {v ? (
          <>
            <Ctl label={v.status === 'running' ? 'Hold' : 'Resume'} keys={hk.pause}
              onClick={() => dispatch({ type: v.status === 'running' ? 'desk/pause' : 'desk/resume' })}>
              {v.status === 'running' ? <Pause size={15} /> : <Play size={15} />}
            </Ctl>
            {v.entry && (
              <Ctl label="Clear entry" onClick={() => dispatch({ type: 'entry/complete', id: v.entry!.id })}>
                <Check size={15} />
              </Ctl>
            )}
            <Ctl label="Skip block" onClick={() => dispatch({ type: 'desk/skip' })}><SkipForward size={15} /></Ctl>
            <Ctl label="Swap" keys={hk.plus} onClick={() => open('plus')}><Crosshair size={15} /></Ctl>
            <Ctl label="Stand down" onClick={() => dispatch({ type: 'desk/standDown' })}><Stop size={15} /></Ctl>
          </>
        ) : (
          <>
            <Ctl label="Deploy" keys={hk.plus} onClick={() => open('plus')}><Crosshair size={15} /></Ctl>
            <Ctl label="Capture" keys={hk.capture} onClick={() => open('capture')}><Tray size={15} /></Ctl>
            <Ctl label="Deck" keys={hk.deck} onClick={() => open('deck')}><SquaresFour size={15} /></Ctl>
          </>
        )}
      </nav>
    </motion.section>
  )
}

function Ctl({ label, keys, onClick, children }: { label: string; keys?: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button className="ctl" onClick={onClick} aria-label={label} title={keys ? `${label}  ${keys}` : label}>
      {children}
      <span className="ctl-label caps">{label}</span>
    </button>
  )
}
