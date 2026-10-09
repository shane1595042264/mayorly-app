import { useState } from 'react'
import { LockSimple, Plus } from '@phosphor-icons/react'
import {
  dayStats, LEDGER_CAP, ledgerEntries, span, startOfDay, type GlyphName, type Ledger, type MayorlyState,
} from '@core/index'
import { Glyph, GLYPHS } from '../lib/glyphs'
import { dispatch, useNow } from '../store'

// The ledger shelf: nine bays. Every ledger here is hand-written by you, so the
// clerk may file into it but never rename, merge or remove it.

export function ShelfTab({ s }: { s: MayorlyState }) {
  const now = useNow(10_000)
  const today = dayStats(s, startOfDay(now), now)
  const [editing, setEditing] = useState<string | null>(null)
  const slots = Array.from({ length: LEDGER_CAP }, (_, i) => s.ledgers[i] ?? null)
  const firstEmpty = slots.findIndex((l) => l === null)

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
              <button key={`e${i}`} className="bay bay-empty" onClick={() => setEditing(`new-${i}`)}>
                <Plus size={18} />
                <span className="caps">Write a ledger</span>
              </button>
            ) : (
              <div key={`e${i}`} className="bay bay-void" aria-hidden />
            )
          }
          const open = ledgerEntries(s, l.id).length
          const ms = today.byLedger.find((b) => b.ledgerId === l.id)?.focusMs ?? 0
          return (
            <button key={l.id} className="bay" onClick={() => setEditing(l.id)} aria-label={`Edit ${l.name}`}>
              <span className="bay-n mono dim">{i + 1}</span>
              <span className="bay-glyph"><Glyph name={l.glyph} size={26} /></span>
              <span className="bay-code mono">{l.code}</span>
              <span className="bay-name">{l.name}</span>
              <span className="bay-crit">{l.criterion || 'No criterion written yet.'}</span>
              <span className="bay-stats mono num">
                <span>{open} open</span>
                <span>{span(ms)} today</span>
                {l.handWritten && <LockSimple size={12} aria-label="Hand-written, locked from the clerk" />}
              </span>
            </button>
          )
        })}
      </div>
    </div>
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
