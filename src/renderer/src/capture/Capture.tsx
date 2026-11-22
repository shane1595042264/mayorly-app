import { useEffect, useMemo, useRef, useState } from 'react'
import { motion } from 'motion/react'
import { CaretRight, Check, Prohibit, Question, Sparkle } from '@phosphor-icons/react'
import { matchLedger, parseSuperset, prefixClerk, type Action, type MayorlyState } from '@core/index'
import { looksLikeInstruction, stripInstruction, type InstructionPlan } from '../../../shared/instruct'
import { bridge } from '../bridge'
import { askCalendar } from '../lib/calendarAsk'
import { actionFor, keyLabel, keysFor, recordUse } from '../lib/keymap'
import { aiOn, dispatch } from '../store'

// The command line. Plain text is an entry for the clerk to file. A leading slash
// is an order:  /ss legal 25, dance 20 x3   /pomo dance   /blitz   /hold   /stand

interface Plan {
  tone: 'file' | 'tray' | 'order' | 'error' | 'idle'
  text: string
  run?: () => void
  /** File the line and put it on the desk now, the clock where it is. */
  start?: () => void
  /** The line is an instruction for the clerk: the box stays open for its answer. */
  instruct?: string
}

/** `tasks`: the line is a task whatever it looks like (Find, which starts or adds, never instructs). */
export function plan(raw: string, s: MayorlyState, opts?: { tasks?: boolean }): Plan {
  const text = raw.trim()
  if (!text) return { tone: 'idle', text: 'Type an entry. Prefix a ledger like legal:, or couch: for the couch list, and add ~30 for an estimate.' }

  if (text.startsWith('/')) {
    const [cmd, ...rest] = text.slice(1).split(/\s+/)
    const arg = rest.join(' ')
    const go = (a: Action) => () => dispatch(a)
    switch (cmd.toLowerCase()) {
      case 'ss':
      case 'superset': {
        const r = parseSuperset(arg, s.ledgers, () => crypto.randomUUID())
        if (!r.ok) return { tone: 'error', text: r.error }
        const ss = r.superset
        const total = ss.slots.reduce((n, sl) => n + sl.minutes, 0)
        return {
          tone: 'order',
          text: `Deploy superset ${ss.name}: ${ss.slots.length} slots, ${total}m a round, ${ss.rounds ? `${ss.rounds} rounds` : 'loops until you stand down'}`,
          run: () => {
            dispatch({ type: 'superset/save', superset: ss })
            dispatch({ type: 'desk/deploy', mode: 'superset', supersetId: ss.id })
          },
        }
      }
      case 'pomo':
      case 'pomodoro': {
        const ledger = arg ? matchLedger(arg, s.ledgers) : null
        if (arg && !ledger) return { tone: 'error', text: `No ledger called "${arg}"` }
        return {
          tone: 'order',
          text: `Deploy pomodoro${ledger ? ` on ${ledger.name}` : ''}, ${s.settings.focusMin}m focus`,
          run: go({ type: 'desk/deploy', mode: 'pomodoro', ledgerId: ledger?.id ?? null }),
        }
      }
      case 'blitz':
        return { tone: 'order', text: 'Blitz the flow from the top', run: go({ type: 'desk/deploy', mode: 'blitz' }) }
      case 'hold':
        return { tone: 'order', text: 'Hold the desk', run: go({ type: 'desk/pause' }) }
      case 'go':
      case 'resume':
        return { tone: 'order', text: 'Resume the desk', run: go({ type: 'desk/resume' }) }
      case 'skip':
        return { tone: 'order', text: 'Skip to the next block', run: go({ type: 'desk/skip' }) }
      case 'stand':
        return { tone: 'order', text: 'Stand down and end the sitting', run: go({ type: 'desk/standDown' }) }
      case 'cal':
      case 'calendar':
        if (!arg) return { tone: 'error', text: 'Ask the clerk about the calendar: /cal move leetcode to tomorrow 9am' }
        return { tone: 'order', text: `Ask the clerk: ${arg}`, run: () => askCalendar(arg) }
      default:
        return { tone: 'error', text: 'Orders: /ss  /pomo  /blitz  /hold  /go  /skip  /stand  /cal' }
    }
  }

  // An instruction about how Mayorly works: the clerk reads it and does it, or asks first.
  if (!opts?.tasks && aiOn() && looksLikeInstruction(text)) {
    return { tone: 'order', text: `Clerk: ${stripInstruction(text)}`, instruct: text }
  }

  const f = prefixClerk.file(text, s.ledgers)
  if (f.leisure) {
    return {
      tone: 'file',
      text: `Couch   ${f.title}`,
      run: () => dispatch({ type: 'entry/capture', text }),
      start: () => dispatch({ type: 'entry/capture', text, start: true }),
    }
  }
  const ledger = s.ledgers.find((l) => l.id === f.ledgerId)
  const est = f.estimateMin ? `   est ${f.estimateMin}m` : ''
  // With a key, the clerk reads the line itself; the prefix is the floor, not the answer.
  const clerk = aiOn() && !ledger
  return {
    tone: ledger ? 'file' : clerk ? 'file' : 'tray',
    text: ledger ? `${ledger.code}  ${ledger.name}   ${f.title}${est}` : clerk ? `Clerk files   ${f.title}${est}` : `Tray   ${f.title}${est}`,
    run: () => dispatch({ type: 'entry/capture', text }),
    start: () => dispatch({ type: 'entry/capture', text, start: true }),
  }
}

export function Capture({ s, close }: { s: MayorlyState; close: () => void }) {
  const [text, setText] = useState('')
  const p = useMemo(() => plan(text, s), [text, s])
  const [flash, setFlash] = useState(0)
  const [order, setOrder] = useState<{ line: string; plan: InstructionPlan | null } | null>(null)

  const instruct = async (line: string, startNow: boolean) => {
    setOrder({ line, plan: null })
    const r = await bridge.ai.instruct(line)
    // Read as a task after all: filed as one, as the line would have been.
    if (r.kind === 'task') {
      void dispatch({ type: 'entry/capture', text: stripInstruction(line), start: startNow })
      close()
      return
    }
    if (r.calendarAsk) askCalendar(r.calendarAsk)
    setOrder({ line, plan: r })
  }

  const submit = (keepOpen: boolean, startNow = false) => {
    if (p.instruct) {
      void instruct(p.instruct, startNow)
      setText('')
      return
    }
    const go = startNow && p.start ? p.start : p.run
    if (!go) return
    go()
    setText('')
    setFlash((n) => n + 1)
    if (!keepOpen) close()
  }

  if (order) return <OrderCard order={order} close={close} again={() => setOrder(null)} />

  return (
    <motion.div
      className="capture"
      initial={{ opacity: 0, y: 24 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 16, transition: { duration: 0.15 } }}
      transition={{ type: 'spring', stiffness: 260, damping: 26 }}
    >
      <label className="capture-label caps" htmlFor="capture-input">Capture</label>
      <div className="capture-line" key={flash}>
        <CaretRight size={18} weight="bold" className="capture-caret" aria-hidden />
        <input
          id="capture-input"
          autoFocus
          spellCheck={false}
          autoComplete="off"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.nativeEvent.isComposing || e.repeat) return
            if (e.key === 'Escape') close()
            else {
              const action = actionFor(e.nativeEvent, 'capture', s.settings)
              if (!action) return
              e.preventDefault()
              recordUse(action)
              submit(action === 'capture.keep', action === 'capture.start')
            }
          }}
          placeholder="legal: reply to the landlord ~20"
        />
      </div>
      <div className="capture-under">
        <p className={`capture-preview tone-${p.tone}`} aria-live="polite">{p.text}</p>
        <footer className="hint-row">
          <span><i className="key">{keysFor('capture.start', s.settings).map(keyLabel).join(' / ')}</i> File and start</span>
          <span><i className="key">{keysFor('capture.file', s.settings).map(keyLabel).join(' / ')}</i> File only</span>
          <span><i className="key">{keysFor('capture.keep', s.settings).map(keyLabel).join(' / ')}</i> Keep open</span>
          <span><i className="key">Esc</i> Close</span>
        </footer>
      </div>
    </motion.div>
  )
}

/** How long a card with nothing left to ask stays before it closes on its own; Undo works until then. */
const ORDER_LINGER_MS = 8000

/**
 * The clerk's answer to an instruction, in the capture box: each step done (with Undo), waiting
 * for Apply, or not allowed. Enter applies what waits, or closes; Esc closes.
 */
function OrderCard({ order, close, again }: { order: { line: string; plan: InstructionPlan | null }; close: () => void; again: () => void }) {
  const [steps, setSteps] = useState(order.plan?.steps ?? [])
  const [undone, setUndone] = useState(false)
  useEffect(() => setSteps(order.plan?.steps ?? []), [order.plan])
  const plan = order.plan
  const waiting = steps.some((x) => x.status === 'ask')
  const done = steps.some((x) => x.status === 'done')
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Nothing to decide: the card goes by itself, as a capture would.
  useEffect(() => {
    if (!plan || waiting || undone) return
    timer.current = setTimeout(close, plan.kind === 'none' ? ORDER_LINGER_MS / 2 : ORDER_LINGER_MS)
    return () => {
      if (timer.current) clearTimeout(timer.current)
    }
  }, [plan, waiting, undone, close])
  const apply = () => {
    for (const st of steps) if (st.status === 'ask') for (const a of st.actions) void dispatch(a)
    setSteps((xs) => xs.map((x) => (x.status === 'ask' ? { ...x, status: 'done' } : x)))
  }
  const skip = () => setSteps((xs) => xs.filter((x) => x.status !== 'ask'))
  const undo = () => {
    for (const st of [...steps].reverse()) if (st.status === 'done') for (const a of st.undo) void dispatch(a)
    setUndone(true)
    setTimeout(close, 900)
  }
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') close()
    else if (e.key === 'Enter') {
      e.preventDefault()
      if (waiting) apply()
      else close()
    }
  }
  return (
    <motion.div
      className="capture"
      initial={{ opacity: 0, y: 24 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 16, transition: { duration: 0.15 } }}
      transition={{ type: 'spring', stiffness: 260, damping: 26 }}
    >
      <span className="capture-label caps">Clerk</span>
      <div className="order-card" role="dialog" aria-label="The clerk's answer" tabIndex={-1} onKeyDown={onKey} ref={(el) => el?.focus()}>
        <p className="order-line"><Sparkle size={14} weight="fill" /> {stripInstruction(order.line)}</p>
        {!plan ? (
          <p className="order-say dim">Reading it…</p>
        ) : (
          <>
            {steps.length > 0 && (
              <ul className="order-steps">
                {steps.map((st, i) => (
                  <li key={i} className={`order-step is-${undone && st.status === 'done' ? 'undone' : st.status}`}>
                    {st.status === 'done' ? <Check size={14} weight="bold" /> : st.status === 'never' ? <Prohibit size={14} /> : <Question size={14} />}
                    <span>{st.says}{st.status === 'never' ? '. Not allowed: Settings, AI clerk, What the clerk may do.' : ''}{undone && st.status === 'done' ? '. Undone.' : ''}</span>
                  </li>
                ))}
              </ul>
            )}
            {plan.calendarAsk && <p className="order-say">The calendar opens with the clerk's plan for: {plan.calendarAsk}</p>}
            {plan.refused.length > 0 && <p className="order-say dim">Could not do: {plan.refused.join(', ')}.</p>}
            {(plan.say || plan.kind === 'none') && <p className="order-say dim">{plan.say || 'Nothing to do.'}</p>}
            <div className="form-actions">
              {waiting && <button type="button" className="btn primary" onClick={apply}>Apply</button>}
              {waiting && <button type="button" className="btn ghost" onClick={skip}>Skip</button>}
              {done && !undone && <button type="button" className="btn ghost" onClick={undo}>Undo</button>}
              {plan.kind === 'none' && <button type="button" className="btn ghost" onClick={again}>Say it again</button>}
              <button type="button" className="btn ghost" onClick={close}>Close</button>
            </div>
          </>
        )}
      </div>
      <footer className="hint-row">
        <span><i className="key">Enter</i> {waiting ? 'Apply' : 'Close'}</span>
        <span><i className="key">Esc</i> Close</span>
      </footer>
    </motion.div>
  )
}
