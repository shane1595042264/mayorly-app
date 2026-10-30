import { useEffect, useRef, useState } from 'react'
import { Check, Sparkle, X } from '@phosphor-icons/react'
import type { Arrangement } from '../../../shared/bridge'
import { bridge } from '../bridge'
import { onCalendarAsk, takeCalendarAsk } from '../lib/calendarAsk'
import { aiOn } from '../store'

// The ask box: one line to the clerk about the calendar. The answer comes back as a proposal
// card, every change in words, refused ones with their reason, names it could not pin down as
// choices; Enter applies, Esc discards. Nothing happens until Apply.

export function AskClerk() {
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [proposal, setProposal] = useState<Arrangement | null>(null)
  const [picks, setPicks] = useState<Record<string, string>>({})
  const [note, setNote] = useState<string | null>(null)
  const input = useRef<HTMLInputElement>(null)

  const send = async (request: string) => {
    const r = request.trim()
    if (!r || busy) return
    setBusy(true)
    setNote(null)
    try {
      const p = await bridge.ai.arrange(r)
      if (p) {
        setProposal(p)
        setPicks({})
        setText('')
      } else setNote(aiOn() ? 'The clerk could not read that. Try plainer words, or name the entry as it is written.' : 'Add an AI key in Settings to ask the clerk.')
    } finally {
      setBusy(false)
    }
  }
  // A /cal request from the capture line, raised before or after this mounted.
  useEffect(() => {
    const t = takeCalendarAsk()
    if (t) void send(t)
    return onCalendarAsk((req) => void send(req))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const needs = proposal ? proposal.asks.filter((a) => !picks[a.ref]) : []
  const apply = async () => {
    if (!proposal || needs.length) return
    const ok = await bridge.ai.applyArrangement(proposal.id, picks)
    setNote(ok ? null : 'That proposal expired. Ask again.')
    setProposal(null)
  }
  const discard = () => {
    if (proposal) bridge.ai.discardArrangement(proposal.id)
    setProposal(null)
  }

  if (proposal) {
    return (
      <section className="cal-sel ask-card" onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); discard() } else if (e.key === 'Enter' && !needs.length) { e.preventDefault(); void apply() } e.stopPropagation() }} tabIndex={-1} ref={(el) => el?.focus()}>
        <h3 className="side-title caps"><Sparkle size={12} weight="fill" /> The clerk proposes</h3>
        <p className="ask-say mono">{proposal.say}</p>
        {proposal.ask && <p className="field-help">{proposal.ask}</p>}
        <ul className="ask-lines">
          {proposal.lines.map((l, i) => (
            <li key={i} className={l.ok ? 'ok' : 'no'}>
              {l.ok ? <Check size={12} weight="bold" /> : <X size={12} weight="bold" />}
              <span>{l.text}{!l.ok && l.reason ? <span className="dim">: {l.reason}</span> : null}</span>
            </li>
          ))}
        </ul>
        {proposal.asks.map((a) => (
          <div key={a.ref} className="ask-which">
            <span className="field-label caps">Which is "{a.ref}"?</span>
            <div className="form-actions">
              {a.options.map((o) => (
                <button key={o.id} type="button" className={`btn ${picks[a.ref] === o.id ? 'primary' : 'ghost'}`} onClick={() => setPicks((p) => ({ ...p, [a.ref]: o.id }))}>{o.title}</button>
              ))}
            </div>
          </div>
        ))}
        {proposal.lines.some((l) => l.ok) && (
          <p className="field-help">{proposal.moved ? `Moves ${proposal.moved} ${proposal.moved === 1 ? 'block' : 'blocks'}` : 'Moves nothing'}{proposal.newLate ? `, ${proposal.newLate} now late` : ''}.</p>
        )}
        <div className="form-actions">
          <button type="button" className="btn primary" disabled={needs.length > 0 || !proposal.lines.some((l) => l.ok)} onClick={() => void apply()}>Apply</button>
          <button type="button" className="btn ghost" onClick={discard}>Discard</button>
          <span className="field-help">Enter applies, Esc discards.</span>
        </div>
      </section>
    )
  }

  return (
    <section className="cal-sel ask-box">
      <h3 className="side-title caps">Ask the clerk</h3>
      <input
        id="cal-ask"
        ref={input}
        value={text}
        disabled={busy}
        placeholder={aiOn() ? 'move leetcode to tomorrow 9am' : 'Add an AI key in Settings to ask'}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            void send(text)
          }
          e.stopPropagation()
        }}
      />
      <p className="field-help">{busy ? 'The clerk is reading.' : note ?? 'It can change estimates, dues, order and splitting, place an entry at a time, or block time for you. It cannot touch your own events.'}</p>
    </section>
  )
}
