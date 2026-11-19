import { ArrowsLeftRight, CaretRight, Check, Pause, Play, SkipForward, Stop } from '@phosphor-icons/react'
import {
  balance, blockView, clock, dayStats, objectives, onDeskId, openFlow, span, startOfDay, switchTarget, taskTomatoes, tomatoLabel,
  type MayorlyState,
} from '@core/index'
import { AnimatePresence, motion } from 'motion/react'
import { useAccount } from '../account'
import { Pop, RollingText, rowIn, spring, useFeelKey } from './motion'
import { act, deviceId, useMayorly, useNow } from '../store'
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
  else kind = `Focus, round ${b.round + 1}`
  if (d.status === 'paused') return `${kind}, paused`
  if (d.status === 'ready') return `${kind}, waiting to start`
  return kind
}

export function Timer({ openPicker, openSync }: { openPicker: () => void; openSync: () => void }) {
  const s = useMayorly()
  const now = useNow(1000)
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
  const running = d.status === 'running' || !!elsewhere

  const deskId = onDeskId(s)
  const flow = openFlow(s)
  const nextUp = idle ? flow[0] ?? null : null
  const entry = idle ? nextUp : s.entries.find((e) => e.id === deskId) ?? null
  const leisure = !idle && v?.block.kind === 'leisure' ? s.leisure.find((x) => x.id === v.block.leisureId) ?? null : null
  const ledger = s.ledgers.find((l) => l.id === (entry?.ledgerId ?? v?.block.ledgerId)) ?? null
  const crop = idle ? null : taskTomatoes(s, now)
  const back = idle ? null : switchTarget(s)
  const upNext = flow.filter((e) => e.id !== entry?.id).slice(0, 3)
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
  const primaryLabel = elsewhere ? 'Take over here' : idle ? (nextUp ? 'Start' : 'Pick a task') : d.status === 'running' ? 'Pause' : d.status === 'ready' ? 'Start' : 'Resume'
  const PrimaryIcon = !elsewhere && !idle && d.status === 'running' ? Pause : Play

  // One-shot animations, keyed by what the desk just did.
  const launch = useFeelKey(['start', 'resume'])
  const hop = useFeelKey(['tomato', 'harvest'])
  const cleared = useFeelKey(['clear', 'harvest'])
  const taskKey = leisure?.id ?? entry?.id ?? (idle ? 'idle' : `ledger-${v?.block.ledgerId ?? ''}`)

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
        <AnimatePresence mode="wait" initial={false}>
          <motion.p key={phaseOf(s)} className="phase" initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 6 }} transition={{ duration: 0.16 }}>
            {phaseOf(s)}
          </motion.p>
        </AnimatePresence>
        <motion.h1
          key={launch}
          className={`clock ${!running || idle ? 'dim' : ''}`}
          aria-label={`${shown} ${remaining === null ? 'elapsed' : 'left'}`}
          initial={launch ? { scale: 0.9, opacity: 0.4 } : false}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: 'spring', stiffness: 380, damping: 18 }}
        >
          <RollingText text={shown} />
        </motion.h1>
        <div className={`track ${v?.block.kind === 'rest' ? 'rest' : ''} ${!running ? 'still' : ''}`} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress * 100)}>
          <motion.i key={launch} initial={launch ? { scaleX: 0 } : false} animate={{ scaleX: 1 }} transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }} style={{ width: `${idle ? 0 : progress * 100}%`, transformOrigin: 'left' }} />
        </div>
        <p className="sub num">{sub}</p>
      </section>

      <motion.button type="button" className="task" onClick={openPicker} aria-label="Pick a task" whileTap={{ scale: 0.98 }} transition={spring}>
        <AnimatePresence mode="popLayout" initial={false}>
        <motion.span key={taskKey} className="task-body" initial={{ opacity: 0, x: 28 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -28 }} transition={spring}>
        <span className="ledger-line">
          {leisure ? <><i className="dot" aria-hidden />Couch</> : ledger ? <><LedgerDot ledger={ledger} /><span className="code">{ledger.code}</span>{ledger.name}</> : entry ? <><i className="dot" aria-hidden />Tray</> : idle ? 'Nothing on the desk' : <><i className="dot" aria-hidden />Ledger time</>}
          {idle && nextUp && <span>, next up</span>}
        </span>
        <span className={`task-title ${!entry && !leisure ? 'placeholder' : ''}`}>
          {leisure ? leisure.title : entry ? entry.title : idle ? 'Pick a task' : v?.block.label ?? 'Ledger time'}
        </span>
        {crop !== null && (
          <span className="crop num">
            <motion.span key={hop} style={{ display: 'inline-flex' }} initial={hop ? { y: 0, rotate: 0 } : false} animate={hop ? { y: [0, -14, 0, -5, 0], rotate: [0, -12, 8, 0, 0] } : {}} transition={{ duration: 0.7, ease: 'easeOut' }}>
              <Tomato />
            </motion.span>
            <b><Pop value={tomatoLabel(crop)} /></b>
            {leisure ? 'blocks on this' : 'on this task'}
          </span>
        )}
        </motion.span>
        </AnimatePresence>
        <CaretRight className="caret" size={18} weight="bold" aria-hidden />
      </motion.button>

      <div className="controls">
        <motion.button type="button" className="primary" onClick={primary} whileTap={{ scale: 0.95 }} transition={spring}>
          <AnimatePresence mode="popLayout" initial={false}>
            <motion.span key={primaryLabel} className="primary-face" initial={{ opacity: 0, scale: 0.6, rotate: -40 }} animate={{ opacity: 1, scale: 1, rotate: 0 }} exit={{ opacity: 0, scale: 0.6, rotate: 40 }} transition={spring}>
              <PrimaryIcon size={20} weight="fill" aria-hidden />
              {primaryLabel}
            </motion.span>
          </AnimatePresence>
        </motion.button>
        <motion.button type="button" className="round" aria-label="Skip to the next block" disabled={idle || !!elsewhere} onClick={() => act({ type: 'desk/skip' })} whileTap={{ scale: 0.88, rotate: 8 }} transition={spring}>
          <SkipForward size={22} />
        </motion.button>
        <motion.button type="button" className="round clear-btn" aria-label="Clear this task" disabled={idle || !!elsewhere || !entry} onClick={() => entry && act({ type: 'entry/complete', id: entry.id })} whileTap={{ scale: 0.88 }} transition={spring}>
          <Check size={22} />
          <AnimatePresence>
            {cleared > 0 && <motion.i key={cleared} className="burst" initial={{ scale: 0.4, opacity: 0.9 }} animate={{ scale: 2.4, opacity: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.55, ease: 'easeOut' }} />}
          </AnimatePresence>
        </motion.button>
        <motion.button type="button" className="round" aria-label="Stand down" disabled={idle || !!elsewhere} onClick={() => act({ type: 'desk/standDown' })} whileTap={{ scale: 0.88 }} transition={spring}>
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
            <AnimatePresence initial={false} mode="popLayout">
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
        <div className="stat lead"><b><Pop value={today.tomatoes} /></b><span>tomatoes</span></div>
        <div className="stat"><b><Pop value={span(today.focusMs)} /></b><span>at the desk</span></div>
        <div className="stat"><b><Pop value={today.cleared} /></b><span>cleared</span></div>
      </div>
    </>
  )
}
