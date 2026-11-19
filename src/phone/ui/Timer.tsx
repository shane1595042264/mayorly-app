import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowsLeftRight, CaretRight, ListBullets, Check, Couch as CouchIcon, Pause, Play, SkipForward, Stop } from '@phosphor-icons/react'
import {
  balance, blockView, switchSession, clock, dayStats, objectives, onDeskId, openFlow, span, startOfDay, switchTarget, taskTomatoes, tomatoLabel,
  type MayorlyState,
} from '@core/index'
import { AnimatePresence, motion } from 'motion/react'
import { useAccount } from '../account'
import { Pop, RollingText, rowIn, spring, useFeelKey } from './motion'
import { upcoming } from '../next'
import { act, current, deviceId, useMayorly, useNow } from '../store'
import { onFeel } from '../feel'
import { showToast } from '../toast'
import { Coin, LedgerDot, Tomato } from './parts'

// The desk. One question: what am I on, and how much of this block is left? The clock answers
// it and is the biggest thing on the phone. Below it the task (tap to pick another), one white
// control for the next thing to do, and three quiet ones: skip, clear, stand down.

const at = (t: number) => new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(t)

function phaseOf(s: MayorlyState): string {
  const d = s.desk
  const b = d.block
  if (!b || d.status === 'idle') return 'Ready'
  const obj = objectives(s)
  let kind: string
  if (b.kind === 'rest') kind = b.label || 'Rest'
  else if (b.kind === 'leisure') kind = 'Couch'
  else if (d.plan?.mode === 'blitz') kind = 'Blitz'
  else if (obj) kind = `${obj.name || 'Superset'}, round ${obj.round}${obj.rounds ? ` of ${obj.rounds}` : ''}`
  else kind = `Focus, round ${Math.max(1, b.round)}`
  // Held from another device the desk only looks paused here; the line under the clock says where it runs.
  if (d.status === 'paused' && d.heldAt === null) return `${kind}, paused`
  if (d.status === 'ready') return `${kind}, waiting to start`
  return kind
}

export function Timer({ openPicker, openSync }: { openPicker: () => void; openSync: () => void }) {
  const s = useMayorly()
  // A quarter-second tick, so a new block's clock turns over a second after it starts, not two.
  const now = useNow(250)
  const { account, sync } = useAccount()
  const d = s.desk
  const me = deviceId()
  const v = blockView(s, now)
  // Running on another device: this phone holds it and shows that device's clock, carried on from the hold.
  const elsewhere = d.device && d.device.id !== me && d.heldAt !== null ? d.device.name : null
  let elapsed = v?.elapsedMs ?? 0
  if (v && elsewhere && d.heldAt !== null) elapsed = d.bankMs + Math.max(0, now - d.heldAt)
  const dur = v?.block.durationMs ?? null
  const remaining = dur === null ? null : Math.max(0, dur - elapsed)
  const progress = dur ? Math.min(1, elapsed / dur) : 0
  const idle = !v || d.status === 'idle'
  // A new block draws a new bar, which starts at its own width: never the last block's, draining.
  const blockKey = v ? `${v.block.kind}-${v.block.round}-${v.block.slotIndex}-${v.block.entryId}-${v.block.leisureId}-${v.block.durationMs}` : 'idle'
  // A new block starts its bar empty at once, rather than draining the old width over a second.
  const lastProgress = useRef(0)
  const drop = progress < lastProgress.current - 0.02
  lastProgress.current = progress
  const running = d.status === 'running' || !!elsewhere

  const deskId = onDeskId(s)
  const flow = openFlow(s)
  const nextUp = idle ? flow[0] ?? null : null
  const entry = idle ? nextUp : s.entries.find((e) => e.id === deskId) ?? null
  const leisure = !idle && v?.block.kind === 'leisure' ? s.leisure.find((x) => x.id === v.block.leisureId) ?? null : null
  const ledger = s.ledgers.find((l) => l.id === (entry?.ledgerId ?? v?.block.ledgerId)) ?? null
  const crop = idle ? null : taskTomatoes(s, now)
  // The way back can be a ledger itself (its entry was cleared): then it says ledger time.
  const backName = idle ? null : switchTarget(s)
  // A way back that is only a ledger (its entry was cleared) is not offered: it reads as nothing.
  const back = backName && (backName === entry?.title || backName === leisure?.title) ? null : backName && s.ledgers.some((l) => l.name === backName) && !s.entries.some((e) => e.title === backName && e.doneAt === null) && !s.leisure.some((x) => x.title === backName) ? null : backName
  // Up next is what the desk will really do: the superset's next slots while one runs, else the
  // flow. The swap-back target already has its own row (Switch to), so it is left out here.
  const backId = d.previous?.entryId ?? switchSession(s)?.block.entryId ?? null
  // Working out the plan runs the reducer forward, so it is done once per state, not per second.
  const peek = useMemo(() => (d.status !== 'idle' && d.block ? upcoming(s, Date.now(), 4) : []), [s]) // eslint-disable-line react-hooks/exhaustive-deps
  const planned = !idle && d.plan?.mode === 'superset'
    ? peek.map((u) => s.entries.find((e) => e.id === u.entryId)).filter((e): e is NonNullable<typeof e> => !!e)
    : flow
  const today = dayStats(s, startOfDay(now), now)

  const shown = idle ? clock(s.settings.focusMin * 60_000) : remaining === null ? clock(elapsed, false) : clock(remaining)
  let sub = `${s.settings.focusMin} min focus, ${s.settings.shortRestMin} min rest`
  if (elsewhere) sub = `Running on ${elsewhere}`
  else if (!idle && d.status === 'running' && remaining !== null) sub = `Ends at ${at(now + remaining)}`
  else if (!idle && remaining === null) sub = 'Counting up'
  else if (!idle && dur) sub = `${clock(elapsed, false)} of ${Math.round(dur / 60_000)} min`

  const primary = () => {
    if (elsewhere) act({ type: 'desk/tick' })
    else if (idle) {
      if (nextUp) act({ type: 'desk/select', entryId: nextUp.id, ledgerId: nextUp.ledgerId })
      else openPicker()
    } else if (d.status === 'running') act({ type: 'desk/pause' })
    else act({ type: 'desk/resume' })
  }
  const primaryLabel = elsewhere ? 'Take over' : idle ? (nextUp ? 'Start' : 'Pick a task') : d.status === 'running' ? 'Pause' : d.status === 'ready' ? 'Start' : 'Resume'
  const PrimaryIcon = !elsewhere && !idle && d.status === 'running' ? Pause : idle && !nextUp ? ListBullets : Play

  // One-shot animations, keyed by what the desk just did.
  const launch = useFeelKey(['start', 'resume'])
  const hop = useFeelKey(['tomato', 'harvest'])
  const cleared = useFeelKey(['clear', 'harvest'])
  const resting = !idle && v?.block.kind === 'rest'
  // During a rest the card says what comes back after it, not the rest itself.
  // During a rest the card names what the plan will put on after it: the next superset slot, or
  // the same task in a pomodoro.
  const next = resting ? peek[0] : undefined
  const after = next ? s.entries.find((e) => e.id === next.entryId) ?? s.leisure.find((x) => x.id === next.leisureId) ?? null : null
  const afterLedger = next && !after ? s.ledgers.find((l) => l.id === next.ledgerId) ?? null : null
  const upNext = planned.filter((e, i, all) => e.id !== entry?.id && e.id !== backId && e.id !== next?.entryId && all.findIndex((x) => x.id === e.id) === i).slice(0, 3)
  // A stand down that brings a parked session back says so for a moment, in place of the phase.
  const [said, setSaid] = useState<string | null>(null)
  useEffect(() => onFeel((f) => {
    if (f !== 'restore') return
    setSaid('Back to your parked session, paused')
    setTimeout(() => setSaid(null), 2600)
  }), [])
  // The word lasts only while the desk is still the paused session that came back.
  const shownPhase = said && d.status === 'paused' ? said : phaseOf(s)
  // Clear acts on what the card shows. Until the card shows the next task, a second tap does nothing.
  const clearedAt = useRef(0)
  const clear = () => {
    if (!entry || Date.now() - clearedAt.current < 900) return
    clearedAt.current = Date.now()
    const { id, ledgerId } = entry
    const place = flow.findIndex((x) => x.id === id)
    act({ type: 'entry/complete', id })
    // Undo opens it again and puts it back on the desk, on the same block.
    showToast(`Cleared ${entry.title}`, () => {
      act({ type: 'entry/reopen', id })
      act({ type: 'entry/move', id, toIndex: place })
      act({ type: 'desk/select', entryId: id, ledgerId })
    })
  }
  const taskKey = resting ? `rest-${deskId ?? ''}` : leisure?.id ?? entry?.id ?? (idle ? 'idle' : `ledger-${v?.block.ledgerId ?? ''}`)

  let syncLine = ''
  if (account && sync.phase === 'error') syncLine = 'Sync failed'
  else if (account && sync.phase === 'syncing') syncLine = 'Syncing'

  return (
    <>
      <header className="top">
        <Tomato scale={2} />
        <span className="word">Mayorly</span>
        <span className="spacer" />
        {syncLine && <button type="button" className={`sync ${sync.phase === 'error' ? 'err' : ''}`} onClick={openSync}>{syncLine}</button>}
        <span className="coins num" aria-label={`${balance(s)} coins`}><Coin scale={1} /><Pop value={balance(s)} /></span>
      </header>

      <section className="dial" aria-live="off">
        {/* The phase line changes in place: the new words drop in, never a blank line. */}
        <motion.p key={shownPhase} className="phase" initial={{ opacity: 0.2, y: -5 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2 }}>
          {shownPhase}
        </motion.p>
        <motion.h1
          key={launch}
          className={`clock ${!running || idle ? 'dim' : ''}`}
          aria-label={idle ? `${shown}, the focus length` : `${shown} ${remaining === null ? 'elapsed' : 'left'}`}
          initial={launch ? { scale: 0.9, opacity: 0.4 } : false}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: 'spring', stiffness: 380, damping: 18 }}
        >
          <RollingText text={shown} />
        </motion.h1>
        <div className={`track ${v?.block.kind === 'rest' ? 'rest' : ''} ${!running ? 'still' : ''}`} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress * 100)}>
          <motion.i key={`${launch}-${blockKey}`} initial={launch ? { scaleX: 0 } : false} animate={{ scaleX: 1 }} transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }} style={{ width: `${idle ? 0 : progress * 100}%`, transformOrigin: 'left', transition: drop ? 'none' : undefined }} />
        </div>
        <p className="sub num">{sub}</p>
      </section>

      <motion.button type="button" className="task" onClick={openPicker} aria-label="Pick a task" whileTap={{ scale: 0.98 }} transition={spring}>
        {/* The new task replaces the old at once and slides in from a little way off: never empty, never two at once. */}
        <motion.span key={taskKey} className={`task-body ${idle && !nextUp ? 'blank' : ''}`} initial={{ opacity: 0.3, x: 18 }} animate={{ opacity: 1, x: 0 }} transition={{ type: 'spring', stiffness: 520, damping: 36 }}>
        {resting ? (
          <>
            <span className="ledger-line"><i className="dot rest-dot" aria-hidden />Rest, then</span>
            <span className={`task-title ${after ? '' : 'placeholder'}`}>{after ? after.title : afterLedger ? `${afterLedger.name}, ledger time` : 'Back to the desk'}</span>
            <span className="crop num">{s.settings.autoStartFocus ? 'Starts on its own when the rest ends' : 'Starts when you tap Start'}</span>
          </>
        ) : (<>
        {!(idle && !nextUp) && <span className="ledger-line">
          {leisure ? <><i className="dot" aria-hidden />Couch</> : ledger ? <><LedgerDot ledger={ledger} /><span className="code">{ledger.code}</span>{idle && nextUp ? `${ledger.name}, next up` : ledger.name}</> : entry ? <><i className="dot" aria-hidden />{idle && nextUp ? 'Tray, next up' : 'Tray'}</> : <><i className="dot" aria-hidden />Free focus</>}
        </span>}
        <span className={`task-title ${(idle && !entry) || (!idle && !entry && !leisure && !ledger) ? 'placeholder' : ''}`}>
          {leisure ? leisure.title : entry ? entry.title : idle ? 'Your desk is clear' : ledger ? 'Ledger time' : 'Nothing picked'}
        </span>
        {crop === null ? <span className="crop num">{idle ? (nextUp ? 'Tap Start, or tap here for another' : 'Tap here to choose one') : ledger ? 'Time on this ledger counts' : 'The time counts; tap here to pick a task'}</span> : (
          <span className="crop num">
            <motion.span key={hop} style={{ display: 'inline-flex' }} initial={hop ? { y: 0, rotate: 0 } : false} animate={hop ? { y: [0, -14, 0, -5, 0], rotate: [0, -12, 8, 0, 0] } : {}} transition={{ duration: 0.7, ease: 'easeOut' }}>
              {leisure ? <CouchIcon size={16} /> : <Tomato />}
            </motion.span>
            <b><Pop value={tomatoLabel(crop)} /></b>
            {leisure ? 'blocks on this' : 'on this task'}
          </span>
        )}
        </>)}
        </motion.span>
        <CaretRight className="caret" size={18} weight="bold" aria-hidden />
      </motion.button>

      <div className="controls">
        <motion.button type="button" className="primary" onClick={primary} whileTap={{ scale: 0.95 }} transition={spring}>
          {/* The new label takes the old one's place at once and rises in: one label, never two. */}
          <motion.span key={primaryLabel} className="primary-face" initial={{ opacity: 0.3, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ type: 'spring', stiffness: 620, damping: 40 }}>
            <PrimaryIcon size={20} weight="fill" aria-hidden />
            {primaryLabel}
          </motion.span>
        </motion.button>
        <motion.button type="button" className="round" aria-label="Skip to the next block" disabled={idle || !!elsewhere} onClick={() => act({ type: 'desk/skip' })} whileTap={{ scale: 0.88, rotate: 8 }} transition={spring}>
          <SkipForward size={22} />
        </motion.button>
        <motion.button type="button" className="round clear-btn" aria-label="Clear this task" disabled={idle || !!elsewhere || !entry || resting} onClick={clear} whileTap={{ scale: 0.88 }} transition={spring}>
          <Check size={22} />
          <AnimatePresence>
            {cleared > 0 && <motion.i key={cleared} className="burst" initial={{ scale: 0.4, opacity: 0.9 }} animate={{ scale: 2.4, opacity: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.55, ease: 'easeOut' }} />}
          </AnimatePresence>
        </motion.button>
        <motion.button type="button" className="round" aria-label="Stand down" disabled={idle || !!elsewhere} onClick={() => {
          const was = entry?.title ?? leisure?.title ?? null
          act({ type: 'desk/standDown' })
          // Said in words like a clear; the time stays counted, so there is nothing to undo.
          if (was && current().desk.status === 'idle') showToast(`Stood down from ${was}. Its time is kept.`)
        }} whileTap={{ scale: 0.88 }} transition={spring}>
          <Stop size={22} />
        </motion.button>
      </div>

      <AnimatePresence initial={false}>
        {back && !elsewhere && (
          <motion.button key="switch" type="button" className="switch" onClick={() => act({ type: 'desk/switch' })} initial={{ opacity: 0, height: 0, marginTop: 0 }} animate={{ opacity: 1, height: 48, marginTop: 10 }} exit={{ opacity: 0, height: 0, marginTop: 0 }} whileTap={{ scale: 0.98 }} transition={spring}>
            <ArrowsLeftRight size={18} aria-hidden />
            Switch to <b>{back}</b>
          </motion.button>
        )}
      </AnimatePresence>

      {upNext.length > 0 && (
        <>
          <h2 className="section-title">Up next</h2>
          <div className="list">
            <AnimatePresence initial={false}>
              {upNext.map((e, i) => {
                const l = s.ledgers.find((x) => x.id === e.ledgerId)
                return (
                  <motion.button type="button" key={e.id} className="row" onClick={() => act({ type: 'desk/select', entryId: e.id, ledgerId: e.ledgerId })} {...rowIn(i)}>
                    <LedgerDot ledger={l} />
                    <span className="row-main"><span className="row-title">{e.title}</span></span>
                    <span className="row-end">{l?.code ?? 'Tray'}</span>
                  </motion.button>
                )
              })}
            </AnimatePresence>
          </div>
        </>
      )}

      <h2 className="section-title">Today</h2>
      <div className="stats">
        <div className="stat lead"><b><Pop value={today.tomatoes} /></b><span>harvested</span></div>
        <div className="stat"><b><Pop value={span(today.focusMs)} /></b><span>at the desk</span></div>
        <div className="stat"><b><Pop value={today.cleared} /></b><span>cleared</span></div>
      </div>
    </>
  )
}
