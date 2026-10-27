import { useEffect, useState } from 'react'
import { ArrowLeft, Check, LockSimple, PencilSimple, Play, Plus, Trash } from '@phosphor-icons/react'
import {
  dayStats, entrySpentMs, LEDGER_CAP, ledgerEntries, span, startOfDay, type Entry, type GlyphName, type Ledger, type MayorlyState,
} from '@core/index'
import { Glyph, GLYPHS } from '../lib/glyphs'
import { actionFor, keymapOpen, recordUse } from '../lib/keymap'
import { cycleLedger, useListKeys } from '../lib/listkeys'
import { noteOrigin } from '../lib/origin'
import { current, dispatch, useNow } from '../store'

// The ledger shelf: nine bays. Every ledger here is hand-written by you, so the
// clerk may file into it but never rename, merge or remove it. A bay opens the
// ledger; the pencil on the bay edits it.

export function ShelfTab({ s }: { s: MayorlyState }) {
  const now = useNow(10_000)
  const today = dayStats(s, startOfDay(now), now)
  const [editing, setEditing] = useState<string | null>(null)
  const [open, setOpen] = useState<string | null>(null)
  const slots = Array.from({ length: LEDGER_CAP }, (_, i) => s.ledgers[i] ?? null)
  const firstEmpty = slots.findIndex((l) => l === null)

  // The keyboard on the grid: h j k l between bays, Enter opens, r edits, n writes a new one.
  const [cell, setCell] = useState(0)
  const slotKey = slots.map((l) => l?.id ?? '').join()
  useEffect(() => {
    if (open || editing) return
    const onKey = (e: KeyboardEvent) => {
      if (keymapOpen() || e.altKey || e.ctrlKey || e.metaKey) return
      if ((e.target as HTMLElement | null)?.closest?.('input, textarea, select')) return
      const st = current()
      const a = st ? actionFor(e, 'shelf', st.settings) : null
      if (!a) return
      const l = slots[cell]
      const reach = slots.map((x, i) => !!x || i === firstEmpty)
      // Step towards the target; when it is a void bay, the nearest meaningful one short of it, or stay.
      const step = (c: number, d: number) => {
        const t = c + d
        if (t < 0 || t >= slots.length) return c
        if (Math.abs(d) === 1 && Math.floor(t / 3) !== Math.floor(c / 3)) return c
        if (reach[t]) return t
        const between = d > 0 ? [...Array(t - c).keys()].map((k) => t - k) : [...Array(c - t).keys()].map((k) => t + k)
        return between.find((i) => i !== c && reach[i] && (d > 0 ? i > c : i < c)) ?? c
      }
      let handled = true
      if (a === 'shelf.left') setCell((c) => step(c, -1))
      else if (a === 'shelf.right') setCell((c) => step(c, 1))
      else if (a === 'shelf.up') setCell((c) => step(c, -3))
      else if (a === 'shelf.down') setCell((c) => step(c, 3))
      else if (a === 'shelf.open') {
        if (l) setOpen(l.id)
        else if (cell === firstEmpty) setEditing(`new-${cell}`)
        else handled = false
      } else if (a === 'shelf.edit') {
        if (l) setEditing(l.id)
        else handled = false
      } else if (a === 'shelf.new') {
        if (firstEmpty >= 0) {
          setCell(firstEmpty)
          setEditing(`new-${firstEmpty}`)
        } else handled = false
      } else handled = false
      if (handled) {
        e.preventDefault()
        recordUse(a)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, editing, cell, slotKey, firstEmpty])

  const opened = open ? s.ledgers.find((l) => l.id === open) : null
  if (opened) {
    return <LedgerView s={s} ledger={opened} now={now} back={() => setOpen(null)} edit={() => { setOpen(null); setEditing(opened.id) }} />
  }

  return (
    <div className="shelf">
      <p className="shelf-note dim">
        {s.ledgers.length} of {LEDGER_CAP} bays. Each ledger carries a criterion; the clerk files against the criterion, not the name.
      </p>
      <div className="shelf-grid">
        {slots.map((l, i) => {
          if (l && editing === l.id) return <LedgerForm key={l.id} s={s} ledger={l} done={() => setEditing(null)} />
          if (!l && editing === `new-${i}`) return <LedgerForm key={`new-${i}`} s={s} ledger={null} done={() => setEditing(null)} />
          if (!l) {
            return i === firstEmpty ? (
              <button key={`e${i}`} className={`bay bay-empty ${cell === i ? 'is-selected' : ''}`} onClick={() => setEditing(`new-${i}`)}>
                <Plus size={18} />
                <span className="caps">Write a ledger</span>
              </button>
            ) : (
              <div key={`e${i}`} className="bay bay-void" aria-hidden />
            )
          }
          const openCount = ledgerEntries(s, l.id).length
          const ms = today.byLedger.find((b) => b.ledgerId === l.id)?.focusMs ?? 0
          return (
            <div key={l.id} className={`bay bay-open ${cell === i ? 'is-selected' : ''}`} role="button" tabIndex={0} onClick={() => setOpen(l.id)} onKeyDown={(e) => e.key === 'Enter' && setOpen(l.id)} aria-label={`Open ${l.name}`}>
              <span className="bay-n mono dim">{i + 1}</span>
              <button
                type="button"
                className="icon-btn bay-edit"
                title={`Edit ${l.name}`}
                aria-label={`Edit ${l.name}`}
                onClick={(e) => { e.stopPropagation(); setEditing(l.id) }}
              >
                <PencilSimple size={14} />
              </button>
              <span className="bay-glyph"><Glyph name={l.glyph} size={26} /></span>
              <span className="bay-code mono">{l.code}</span>
              <span className="bay-name">{l.name}</span>
              <span className="bay-crit">{l.criterion || 'No criterion written yet.'}</span>
              <span className="bay-stats mono num">
                <span>{openCount} open</span>
                <span>{span(ms)} today</span>
                {l.handWritten && <LockSimple size={12} aria-label="Hand-written, locked from the clerk" />}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

/** Inside one ledger: its open entries, and what was cleared today. */
function LedgerView({ s, ledger, now, back, edit }: { s: MayorlyState; ledger: Ledger; now: number; back: () => void; edit: () => void }) {
  const entries = ledgerEntries(s, ledger.id)
  const today = startOfDay(now)
  const cleared = s.entries.filter((e) => e.ledgerId === ledger.id && e.doneAt !== null && e.doneAt >= today).sort((a, b) => b.doneAt! - a.doneAt!)
  const ms = dayStats(s, today, now).byLedger.find((b) => b.ledgerId === ledger.id)?.focusMs ?? 0
  const live = s.desk.block?.entryId

  // The keyboard: the list keys on the rows; Backspace back to the shelf, f focuses here.
  const [rename, setRename] = useState({ id: '', n: 0 })
  const { sel } = useListKeys(entries.map((e) => e.id), ({ action, id }) => {
    const e = id ? entries.find((x) => x.id === id) : undefined
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
    } else return false
    return true
  })
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (keymapOpen() || e.altKey || e.ctrlKey || e.metaKey) return
      if ((e.target as HTMLElement | null)?.closest?.('input, textarea, select')) return
      const st = current()
      const a = st ? actionFor(e, 'shelf', st.settings) : null
      if (a === 'shelf.back') back()
      else if (a === 'shelf.focus') dispatch({ type: 'desk/deploy', mode: 'pomodoro', ledgerId: ledger.id })
      else return
      e.preventDefault()
      recordUse(a)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [back, ledger.id])

  return (
    <div className="ledger-view">
      <div className="ledger-head">
        <button className="btn ghost" onClick={back}><ArrowLeft size={14} /> Shelf</button>
        <span className="bay-glyph"><Glyph name={ledger.glyph} size={22} /></span>
        <span className="bay-code mono">{ledger.code}</span>
        <h2 className="ledger-name">{ledger.name}</h2>
        <span className="ledger-stats mono num dim">{entries.length} open, {span(ms)} today</span>
        <span className="ledger-actions">
          <button className="btn" onClick={() => dispatch({ type: 'desk/deploy', mode: 'pomodoro', ledgerId: ledger.id })} title={`Pomodoro on ${ledger.name}, no entry`}>
            <Play size={14} /> Focus here
          </button>
          <button className="btn ghost" onClick={edit}><PencilSimple size={14} /> Edit ledger</button>
        </span>
      </div>
      <p className="shelf-note dim">{ledger.criterion || 'No criterion written yet.'}</p>

      {entries.length === 0 ? (
        <div className="empty">
          <p className="empty-title">Nothing open in {ledger.name}.</p>
          <p>Capture with {s.settings.hotkeys.capture}; the clerk files here by the criterion above, or prefix the line with {ledger.code.toLowerCase()}:.</p>
        </div>
      ) : (
        <ol className="flow-list">
          {entries.map((e, i) => <LedgerRow key={e.id} s={s} e={e} index={i} now={now} live={live === e.id} selected={sel === e.id} renameTick={rename.id === e.id ? rename.n : 0} />)}
        </ol>
      )}

      {cleared.length > 0 && (
        <section className="flow-cleared">
          <h3 className="side-title caps">Cleared today</h3>
          <ol className="flow-list">
            {cleared.map((e) => (
              <li key={e.id} className="row done">
                <span className="row-title ellipsis">{e.title}</span>
                <span className="row-time mono num">{span(entrySpentMs(s, e.id, now))}</span>
              </li>
            ))}
          </ol>
        </section>
      )}
    </div>
  )
}

function LedgerRow({ s, e, index, now, live, selected, renameTick }: { s: MayorlyState; e: Entry; index: number; now: number; live: boolean; selected: boolean; renameTick: number }) {
  const [editing, setEditing] = useState(false)
  const [title, setTitle] = useState(e.title)
  useEffect(() => {
    if (renameTick) setEditing(true)
  }, [renameTick])
  const spent = entrySpentMs(s, e.id, now)
  return (
    <li className={`row ${live ? 'live' : ''} ${selected ? 'is-selected' : ''}`} data-row={e.id} aria-selected={selected}>
      <span className="row-n mono num dim">{String(index + 1).padStart(2, '0')}</span>
      <select
        className="code-select mono"
        value={e.ledgerId ?? ''}
        onChange={(ev) => dispatch({ type: 'entry/update', id: e.id, patch: { ledgerId: ev.target.value || null } })}
        aria-label="Ledger"
      >
        <option value="">TRAY</option>
        {s.ledgers.map((l) => <option key={l.id} value={l.id}>{l.code}</option>)}
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
            if (ev.key === 'Escape') { setTitle(e.title); setEditing(false) }
          }}
        />
      ) : (
        <span className="row-title ellipsis" onDoubleClick={() => setEditing(true)} title="Double-click to rename">{e.title}</span>
      )}
      <span className="row-time mono num">
        {spent >= 60_000 ? span(spent) : ''}
        <input
          className="est"
          type="number"
          min={0}
          step={5}
          value={e.estimateMin ?? ''}
          placeholder="est"
          aria-label="Estimate in minutes"
          onChange={(ev) => dispatch({ type: 'entry/update', id: e.id, patch: { estimateMin: ev.target.value ? Number(ev.target.value) : null } })}
        />
      </span>
      <span className="row-actions">
        <button className="icon-btn" aria-label={`Focus on ${e.title}`} title="Pomodoro on this entry" onClick={() => dispatch({ type: 'desk/deploy', mode: 'pomodoro', entryId: e.id })}><Play size={14} /></button>
        <button className="icon-btn" aria-label={`Clear ${e.title}`} title="Clear" onClick={(ev) => { noteOrigin(ev.currentTarget); dispatch({ type: 'entry/complete', id: e.id }) }}><Check size={14} /></button>
        <button className="icon-btn" aria-label={`Delete ${e.title}`} title="Delete" onClick={() => dispatch({ type: 'entry/delete', id: e.id })}><Trash size={14} /></button>
      </span>
    </li>
  )
}

function LedgerForm({ s, ledger, done }: { s: MayorlyState; ledger: Ledger | null; done: () => void }) {
  const [name, setName] = useState(ledger?.name ?? '')
  const [code, setCode] = useState(ledger?.code ?? '')
  const [criterion, setCriterion] = useState(ledger?.criterion ?? '')
  const [glyph, setGlyph] = useState<GlyphName>(ledger?.glyph ?? 'book')
  const [confirm, setConfirm] = useState(false)
  const taken = s.ledgers.some((l) => l.id !== ledger?.id && l.code === code.toUpperCase())

  const save = () => {
    if (!name.trim()) return
    if (ledger) dispatch({ type: 'ledger/update', id: ledger.id, patch: { name, code, criterion, glyph } })
    else dispatch({ type: 'ledger/create', name, code: code || undefined, criterion, glyph })
    done()
  }

  return (
    <form
      className="bay bay-form"
      onSubmit={(e) => {
        e.preventDefault()
        save()
      }}
    >
      <div className="form-row">
        <label className="field">
          <span className="field-label caps">Name</span>
          <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Legal" maxLength={24} />
        </label>
        <label className="field field-code">
          <span className="field-label caps">Code</span>
          <input className="mono" value={code} onChange={(e) => setCode(e.target.value.toUpperCase().slice(0, 4))} placeholder="auto" />
        </label>
      </div>
      {taken && <p className="field-error">{code.toUpperCase()} is already on the shelf.</p>}
      <label className="field">
        <span className="field-label caps">Criterion</span>
        <textarea rows={2} value={criterion} onChange={(e) => setCriterion(e.target.value)} placeholder="What belongs in this ledger, in one sentence." />
      </label>
      <div className="glyph-pick" role="radiogroup" aria-label="Glyph">
        {(Object.keys(GLYPHS) as GlyphName[]).map((g) => (
          <button type="button" key={g} role="radio" aria-checked={g === glyph} className={g === glyph ? 'on' : ''} onClick={() => setGlyph(g)} aria-label={g}>
            <Glyph name={g} size={16} />
          </button>
        ))}
      </div>
      <div className="form-actions">
        <button type="submit" className="btn primary" disabled={!name.trim() || taken}>Save</button>
        <button type="button" className="btn" onClick={done}>Cancel</button>
        {ledger && (
          <button
            type="button"
            className={`btn ghost ${confirm ? 'warn' : ''}`}
            onClick={() => {
              if (!confirm) return setConfirm(true)
              dispatch({ type: 'ledger/delete', id: ledger.id })
              done()
            }}
          >
            {confirm ? 'Confirm: entries go to the tray' : 'Remove'}
          </button>
        )}
      </div>
    </form>
  )
}
