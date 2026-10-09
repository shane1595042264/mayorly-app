import { useMemo, useState } from 'react'
import { motion } from 'motion/react'
import { CaretRight } from '@phosphor-icons/react'
import { matchLedger, parseSuperset, prefixClerk, type Action, type MayorlyState } from '@core/index'
import { dispatch } from '../store'

// The command line. Plain text is an entry for the clerk to file. A leading slash
// is an order:  /ss legal 25, dance 20 x3   /pomo dance   /blitz   /hold   /stand

interface Plan {
  tone: 'file' | 'tray' | 'order' | 'error' | 'idle'
  text: string
  run?: () => void
}

function plan(raw: string, s: MayorlyState): Plan {
  const text = raw.trim()
  if (!text) return { tone: 'idle', text: 'Type an entry. Prefix a ledger like legal: and add ~30 for an estimate.' }

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
      default:
        return { tone: 'error', text: 'Orders: /ss  /pomo  /blitz  /hold  /go  /skip  /stand' }
    }
  }

  const f = prefixClerk.file(text, s.ledgers)
  const ledger = s.ledgers.find((l) => l.id === f.ledgerId)
  const est = f.estimateMin ? `   est ${f.estimateMin}m` : ''
  return {
    tone: ledger ? 'file' : 'tray',
    text: ledger ? `${ledger.code}  ${ledger.name}   ${f.title}${est}` : `Tray   ${f.title}${est}`,
    run: () => dispatch({ type: 'entry/capture', text }),
  }
}

export function Capture({ s, close }: { s: MayorlyState; close: () => void }) {
  const [text, setText] = useState('')
  const p = useMemo(() => plan(text, s), [text, s])
  const [flash, setFlash] = useState(0)

  const submit = (keepOpen: boolean) => {
    if (!p.run) return
    p.run()
    setText('')
    setFlash((n) => n + 1)
    if (!keepOpen) close()
  }

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
            if (e.key === 'Escape') close()
            else if (e.key === 'Enter') {
              e.preventDefault()
              submit(e.shiftKey)
            }
          }}
          placeholder="legal: reply to the landlord ~20"
        />
      </div>
      <div className="capture-under">
        <p className={`capture-preview tone-${p.tone}`} aria-live="polite">{p.text}</p>
        <footer className="hint-row">
          <span><i className="key">Enter</i> File</span>
          <span><i className="key">Shift</i><i className="key">Enter</i> Keep open</span>
          <span><i className="key">Esc</i> Close</span>
        </footer>
      </div>
    </motion.div>
  )
}
