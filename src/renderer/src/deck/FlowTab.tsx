import { useEffect, useState } from 'react'
import { Reorder, useDragControls } from 'motion/react'
import { ArrowCounterClockwise, Check, DotsSixVertical, Lightning, Play, Trash } from '@phosphor-icons/react'
import {
  entrySpentMs, openFlow, prefixClerk, span, startOfDay, type Entry, type MayorlyState,
} from '@core/index'
import { dispatch, useNow } from '../store'

export function FlowTab({ s }: { s: MayorlyState }) {
  const now = useNow(5000)
  const flow = openFlow(s)
  const [ids, setIds] = useState(flow.map((e) => e.id))
  const key = flow.map((e) => e.id).join()
  // Re-sync the local drag order whenever the flow itself changes.
  useEffect(() => setIds(flow.map((e) => e.id)), [key])

  const [draft, setDraft] = useState('')
  const filing = draft.trim() ? prefixClerk.file(draft, s.ledgers) : null
  const filedTo = s.ledgers.find((l) => l.id === filing?.ledgerId)

  const today = startOfDay(now)
  const cleared = s.entries
    .filter((e) => e.doneAt !== null && e.doneAt >= today)
    .sort((a, b) => b.doneAt! - a.doneAt!)
  const byId = new Map(flow.map((e) => [e.id, e]))
  const live = s.desk.block?.entryId

  return (
    <div className="flow">
      <section className="flow-main">
        <form
          className="flow-add"
          onSubmit={(e) => {
            e.preventDefault()
            if (!draft.trim()) return
            dispatch({ type: 'entry/capture', text: draft })
            setDraft('')
          }}
        >
          <label htmlFor="flow-add" className="field-label caps">New entry</label>
          <div className="flow-add-row">
            <input id="flow-add" value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="career: tailor resume for the posting ~45" spellCheck={false} autoComplete="off" />
            <button type="button" className="btn" disabled={flow.length === 0} onClick={() => dispatch({ type: 'desk/deploy', mode: 'blitz' })}>
              <Lightning size={16} /> Blitz the flow
            </button>
          </div>
          <p className="field-help">
            {filing ? (filedTo ? `Files to ${filedTo.code} ${filedTo.name}` : 'Lands in the tray, no ledger named') : 'Prefix a ledger (legal:) or tag one (#dnc). Add ~30 for minutes.'}
            {filing?.estimateMin ? `, est ${filing.estimateMin}m` : ''}
          </p>
        </form>

        {flow.length === 0 ? (
          <div className="empty">
            <p className="empty-title">The flow is empty.</p>
            <p>Capture anything from anywhere with {s.settings.hotkeys.capture}. It lands here in order, and Blitz runs it top to bottom.</p>
          </div>
        ) : (
          <Reorder.Group axis="y" values={ids} onReorder={setIds} className="flow-list" as="ol">
            {ids.map((id, i) => {
              const e = byId.get(id)
              return e ? (
                <Row key={id} e={e} s={s} index={i} live={live === id} now={now} onDrop={() => dispatch({ type: 'entry/move', id, toIndex: ids.indexOf(id) })} />
              ) : null
            })}
          </Reorder.Group>
        )}
      </section>

      <aside className="flow-side">
        <h3 className="side-title caps">Cleared today</h3>
        {cleared.length === 0 ? (
          <p className="dim small">Nothing cleared yet today. That is fine.</p>
        ) : (
          <ol className="cleared">
            {cleared.slice(0, 12).map((e) => (
              <li key={e.id}>
                <span className="mono dim">{s.ledgers.find((l) => l.id === e.ledgerId)?.code ?? 'TRY'}</span>
                <span className="ellipsis">{e.title}</span>
                <button className="icon-btn" aria-label={`Reopen ${e.title}`} onClick={() => dispatch({ type: 'entry/reopen', id: e.id })}>
                  <ArrowCounterClockwise size={14} />
                </button>
              </li>
            ))}
          </ol>
        )}
      </aside>
    </div>
  )
}

function Row({ e, s, index, live, now, onDrop }: { e: Entry; s: MayorlyState; index: number; live: boolean; now: number; onDrop: () => void }) {
  const controls = useDragControls()
  const [editing, setEditing] = useState(false)
  const [title, setTitle] = useState(e.title)
  const spent = entrySpentMs(s, e.id, now)
  const est = e.estimateMin

  return (
    <Reorder.Item value={e.id} dragListener={false} dragControls={controls} onDragEnd={onDrop} className={`row ${live ? 'live' : ''}`} as="li">
      <span className="grip" onPointerDown={(ev) => controls.start(ev)} aria-label="Drag to reorder">
        <DotsSixVertical size={16} />
      </span>
      <span className="row-n mono num dim">{String(index + 1).padStart(2, '0')}</span>
      <select
        className="code-select mono"
        value={e.ledgerId ?? ''}
        onChange={(ev) => dispatch({ type: 'entry/update', id: e.id, patch: { ledgerId: ev.target.value || null } })}
        aria-label="Ledger"
      >
        <option value="">TRAY</option>
        {s.ledgers.map((l) => (
          <option key={l.id} value={l.id}>{l.code}</option>
        ))}
      </select>
      {editing ? (
        <input
          className="row-edit"
          autoFocus
          value={title}
          onChange={(ev) => setTitle(ev.target.value)}
          onBlur={() => {
            setEditing(false)
            if (title.trim() && title !== e.title) dispatch({ type: 'entry/update', id: e.id, patch: { title } })
          }}
          onKeyDown={(ev) => {
            if (ev.key === 'Enter') (ev.target as HTMLInputElement).blur()
            if (ev.key === 'Escape') {
              setTitle(e.title)
              setEditing(false)
            }
          }}
        />
      ) : (
        <span className="row-title ellipsis" onDoubleClick={() => setEditing(true)} title="Double-click to rename">
          {e.title}
        </span>
      )}
      <span className="row-time mono num">
        {spent >= 60_000 ? span(spent) : ''}
        <input
          className="est"
          type="number"
          min={0}
          step={5}
          value={est ?? ''}
          placeholder="est"
          aria-label="Estimate in minutes"
          onChange={(ev) => dispatch({ type: 'entry/update', id: e.id, patch: { estimateMin: ev.target.value ? Number(ev.target.value) : null } })}
        />
      </span>
      <span className="row-actions">
        <button className="icon-btn" aria-label={`Focus on ${e.title}`} title="Pomodoro on this entry" onClick={() => dispatch({ type: 'desk/deploy', mode: 'pomodoro', entryId: e.id })}>
          <Play size={14} />
        </button>
        <button className="icon-btn" aria-label={`Clear ${e.title}`} title="Clear" onClick={() => dispatch({ type: 'entry/complete', id: e.id })}>
          <Check size={14} />
        </button>
        <button className="icon-btn" aria-label={`Delete ${e.title}`} title="Delete" onClick={() => dispatch({ type: 'entry/delete', id: e.id })}>
          <Trash size={14} />
        </button>
      </span>
    </Reorder.Item>
  )
}
