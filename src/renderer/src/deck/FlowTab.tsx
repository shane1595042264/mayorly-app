import { useEffect, useState } from 'react'
import { Reorder, useDragControls } from 'motion/react'
import { ArrowCounterClockwise, Check, DotsSixVertical, Lightning, Play, Sparkle, Trash } from '@phosphor-icons/react'
import {
  entrySpentMs, entryTomatoes, openFlow, prefixClerk, span, startOfDay, type Entry, type MayorlyState,
} from '@core/index'
import { bridge } from '../bridge'
import { hotkeyLabel } from '../lib/keys'
import { cycleLedger, useListKeys } from '../lib/listkeys'
import { noteOrigin } from '../lib/origin'
import { dispatch, useAi, useNow } from '../store'
import { ledgerVars } from '../lib/themes'
import { Tomatoes } from './Tomatoes'

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
  const ai = useAi()
  const clerkOn = ai.keys.some((k) => k.status === 'ok')
  const trayCount = flow.filter((e) => e.ledgerId === null).length
  const [sorting, setSorting] = useState(false)
  const autoClassify = async () => {
    setSorting(true)
    try {
      await bridge.ai.sweepTray()
    } finally {
      setSorting(false)
    }
  }

  // The keyboard: j and k pick a row, the list keys act on it.
  const [rename, setRename] = useState({ id: '', n: 0 })
  const { sel } = useListKeys(ids, ({ action, id, index }) => {
    if (action === 'list.new') {
      document.getElementById('flow-add')?.focus()
      return true
    }
    if (action === 'list.blitz') {
      if (flow.length) dispatch({ type: 'desk/deploy', mode: 'blitz' })
      return true
    }
    if (action === 'list.sort') {
      if (clerkOn && trayCount > 0 && !sorting) void autoClassify()
      return true
    }
    const e = id ? byId.get(id) : undefined
    if (!e) return false
    if (action === 'list.go') dispatch({ type: 'desk/deploy', mode: 'pomodoro', entryId: e.id })
    else if (action === 'list.clear') {
      noteOrigin(document.querySelector(`[data-row="${CSS.escape(e.id)}"] [aria-label^="Clear"]`))
      dispatch({ type: 'entry/complete', id: e.id })
    }
    else if (action === 'list.delete') dispatch({ type: 'entry/delete', id: e.id })
    else if (action === 'list.rename') setRename((r) => ({ id: e.id, n: r.n + 1 }))
    else if (action === 'list.ledgerNext' || action === 'list.ledgerPrev') {
      dispatch({ type: 'entry/update', id: e.id, patch: { ledgerId: cycleLedger(s, e.ledgerId, action === 'list.ledgerNext' ? 1 : -1) } })
    } else if (action === 'list.moveDown') {
      if (index < ids.length - 1) dispatch({ type: 'entry/move', id: e.id, toIndex: index + 1 })
    } else if (action === 'list.moveUp') {
      if (index > 0) dispatch({ type: 'entry/move', id: e.id, toIndex: index - 1 })
    } else return false
    return true
  })

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
            <button
              type="button"
              className="btn"
              disabled={!clerkOn || trayCount === 0 || sorting}
              title={!clerkOn ? 'Add an AI key in Settings for the clerk to sort the tray' : trayCount === 0 ? 'The tray is empty' : 'Send the tray to the clerk now'}
              onClick={() => void autoClassify()}
            >
              <Sparkle size={16} /> {sorting ? 'Sorting' : 'Auto-classify'}
            </button>
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
            <p>Capture anything from anywhere with {hotkeyLabel(s.settings.hotkeys.capture)}. It lands here in order, and Blitz runs it top to bottom.</p>
            <p>{hotkeyLabel(s.settings.hotkeys.plus)} deploys the desk, {hotkeyLabel(s.settings.hotkeys.deck)} opens this deck, and ? lists every key.</p>
            {s.ledgers.length === 0 && <p>No ledgers yet: write one or three on the Shelf (press 2) so the clerk has somewhere to file.</p>}
          </div>
        ) : (
          <Reorder.Group axis="y" values={ids} onReorder={setIds} className="flow-list" as="ol">
            {ids.map((id, i) => {
              const e = byId.get(id)
              return e ? (
                <Row key={id} e={e} s={s} index={i} live={live === id} selected={sel === id} renameTick={rename.id === id ? rename.n : 0} now={now} onDrop={() => dispatch({ type: 'entry/move', id, toIndex: ids.indexOf(id) })} />
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

function Row({ e, s, index, live, selected, renameTick, now, onDrop }: { e: Entry; s: MayorlyState; index: number; live: boolean; selected: boolean; renameTick: number; now: number; onDrop: () => void }) {
  const controls = useDragControls()
  const [editing, setEditing] = useState(false)
  const [title, setTitle] = useState(e.title)
  // The rename key: each press opens the title for editing.
  useEffect(() => {
    if (renameTick) setEditing(true)
  }, [renameTick])
  const spent = entrySpentMs(s, e.id, now)
  const est = e.estimateMin

  return (
    <Reorder.Item value={e.id} dragListener={false} dragControls={controls} onDragEnd={onDrop} className={`row ${live ? 'live' : ''} ${selected ? 'is-selected' : ''}`} style={ledgerVars(s.ledgers.find((l) => l.id === e.ledgerId))} data-row={e.id} aria-current={selected ? 'true' : undefined} as="li">
      <span className="grip" role="button" onPointerDown={(ev) => controls.start(ev)} aria-label="Drag to reorder">
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
      {e.clerkFiled?.confidence === 'unsure' && (
        <button className="unsure" title="The clerk was not sure. Move it to teach a rule, or click to keep it here." aria-label="Clerk unsure, click to confirm" onClick={() => dispatch({ type: 'entry/confirm', id: e.id })}>?</button>
      )}
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
        <Tomatoes n={entryTomatoes(s, e.id, now)} />
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
        <button className="icon-btn" aria-label={`Clear ${e.title}`} title="Clear" onClick={(ev) => { noteOrigin(ev.currentTarget); dispatch({ type: 'entry/complete', id: e.id }) }}>
          <Check size={14} />
        </button>
        <button className="icon-btn" aria-label={`Delete ${e.title}`} title="Delete" onClick={() => dispatch({ type: 'entry/delete', id: e.id })}>
          <Trash size={14} />
        </button>
      </span>
    </Reorder.Item>
  )
}
