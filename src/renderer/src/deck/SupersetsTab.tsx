import { useEffect, useState } from 'react'
import { Minus, Plus, Repeat, Rocket, Trash, X } from '@phosphor-icons/react'
import {
  formatSuperset, parseSuperset, span, type Id, type MayorlyState, type Superset,
} from '@core/index'
import { dispatch } from '../store'

// Superset = your own rotation rule. The desk moves through the slots by itself:
// legal, then dance, then career, rest between, round after round.

const blank = (s: MayorlyState): Superset => ({
  id: crypto.randomUUID(),
  name: 'New superset',
  slots: s.ledgers.slice(0, 2).map((l) => ({ id: crypto.randomUUID(), target: { kind: 'ledger', ledgerId: l.id }, minutes: 25 })),
  rounds: 3,
  restMin: 5,
  roundRestMin: 15,
  order: 'fixed',
  onClear: 'next-in-ledger',
})

export function SupersetsTab({ s }: { s: MayorlyState }) {
  const [selected, setSelected] = useState<Id | null>(s.desk.plan?.supersetId ?? s.supersets[0]?.id ?? null)
  const [draft, setDraft] = useState<Superset | null>(() => s.supersets.find((x) => x.id === selected) ?? null)
  const saved = s.supersets.find((x) => x.id === draft?.id)
  const dirty = !!draft && JSON.stringify(saved) !== JSON.stringify(draft)

  useEffect(() => {
    if (!dirty) setDraft(s.supersets.find((x) => x.id === selected) ?? null)
  }, [selected, s.supersets])

  const running = s.desk.plan?.mode === 'superset' ? s.desk.plan.supersetId : null

  return (
    <div className="supersets">
      <aside className="ss-list">
        {s.supersets.map((ss) => (
          <button
            key={ss.id}
            className={`ss-item ${ss.id === draft?.id ? 'on' : ''}`}
            onClick={() => {
              // Picking another superset drops unsaved edits to this one.
              setSelected(ss.id)
              setDraft(ss)
            }}
          >
            <span className="ss-item-name">
              <Repeat size={14} />
              {ss.name}
              {running === ss.id && <span className="live-tag caps">Live</span>}
            </span>
            <span className="mono dim small">{formatSuperset(ss, s.ledgers, s.entries)}</span>
          </button>
        ))}
        <button
          className="ss-item ss-new"
          disabled={s.ledgers.length === 0}
          onClick={() => {
            const b = blank(s)
            setDraft(b)
            setSelected(b.id)
          }}
        >
          <Plus size={14} /> New superset
        </button>
      </aside>

      {draft ? <Editor s={s} draft={draft} setDraft={setDraft} dirty={dirty} isNew={!saved} running={running === draft.id} /> : (
        <div className="empty">
          <p className="empty-title">No superset selected.</p>
          <p>A superset rotates the desk through ledgers on its own. Make one, or type /ss legal 25, dance 25 x3 in capture.</p>
        </div>
      )}
    </div>
  )
}

function Editor({ s, draft, setDraft, dirty, isNew, running }: {
  s: MayorlyState
  draft: Superset
  setDraft: (d: Superset | null) => void
  dirty: boolean
  isNew: boolean
  running: boolean
}) {
  const [quick, setQuick] = useState(() => formatSuperset(draft, s.ledgers, s.entries))
  const [quickErr, setQuickErr] = useState<string | null>(null)
  const [quickFocus, setQuickFocus] = useState(false)

  // Keep the one-liner in step with the visual editor unless you are typing in it.
  useEffect(() => {
    if (!quickFocus) setQuick(formatSuperset(draft, s.ledgers, s.entries))
  }, [draft, quickFocus, s.ledgers, s.entries])

  const patch = (p: Partial<Superset>) => setDraft({ ...draft, ...p })
  const slotLedger = (i: number) => {
    const t = draft.slots[i].target
    return t.kind === 'ledger' ? t.ledgerId : s.entries.find((e) => e.id === t.entryId)?.ledgerId ?? ''
  }

  const perRound = draft.slots.reduce((n, sl) => n + sl.minutes, 0) + draft.restMin * Math.max(0, draft.slots.length - 1)
  const rounds = draft.rounds || 1
  const total = perRound * rounds + draft.roundRestMin * Math.max(0, rounds - 1)
  const focusTotal = draft.slots.reduce((n, sl) => n + sl.minutes, 0) * rounds

  const save = () => dispatch({ type: 'superset/save', superset: draft })

  return (
    <section className="ss-editor">
      <div className="form-row">
        <label className="field grow">
          <span className="field-label caps">Name</span>
          <input value={draft.name} onChange={(e) => patch({ name: e.target.value })} maxLength={32} />
        </label>
      </div>

      <label className="field">
        <span className="field-label caps">One line</span>
        <input
          className={`mono ${quickErr ? 'invalid' : ''}`}
          value={quick}
          spellCheck={false}
          onFocus={() => setQuickFocus(true)}
          onBlur={() => {
            setQuickFocus(false)
            setQuickErr(null)
          }}
          onChange={(e) => {
            setQuick(e.target.value)
            const r = parseSuperset(e.target.value, s.ledgers, () => crypto.randomUUID(), draft.name)
            if (r.ok) {
              setQuickErr(null)
              setDraft({ ...r.superset, id: draft.id, name: draft.name })
            } else setQuickErr(r.error)
          }}
        />
        <span className={quickErr ? 'field-error' : 'field-help'}>
          {quickErr ?? 'ledger minutes, comma separated. Options: x3 rounds, loop, rest 5, rr 15, shuffle, clear-next.'}
        </span>
      </label>

      <ol className="slots">
        {draft.slots.map((sl, i) => (
          <li key={sl.id} className="slot">
            <span className="slot-letter">{String.fromCharCode(65 + i)}</span>
            <select
              value={slotLedger(i)}
              aria-label={`Slot ${i + 1} ledger`}
              onChange={(e) => {
                const slots = draft.slots.map((x, j) => (j === i ? { ...x, target: { kind: 'ledger' as const, ledgerId: e.target.value } } : x))
                patch({ slots })
              }}
            >
              {s.ledgers.map((l) => (
                <option key={l.id} value={l.id}>{l.code}  {l.name}</option>
              ))}
            </select>
            <span className="stepper">
              <button className="icon-btn" aria-label="Five minutes less" onClick={() => patch({ slots: draft.slots.map((x, j) => (j === i ? { ...x, minutes: Math.max(5, x.minutes - 5) } : x)) })}>
                <Minus size={12} />
              </button>
              <span className="mono num">{sl.minutes}m</span>
              <button className="icon-btn" aria-label="Five minutes more" onClick={() => patch({ slots: draft.slots.map((x, j) => (j === i ? { ...x, minutes: Math.min(240, x.minutes + 5) } : x)) })}>
                <Plus size={12} />
              </button>
            </span>
            <button className="icon-btn" aria-label={`Remove slot ${i + 1}`} onClick={() => patch({ slots: draft.slots.filter((_, j) => j !== i) })}>
              <X size={14} />
            </button>
          </li>
        ))}
        <li>
          <button
            className="btn ghost"
            disabled={s.ledgers.length === 0 || draft.slots.length >= 12}
            onClick={() => {
              const used = new Set(draft.slots.map((_, i) => slotLedger(i)))
              const l = s.ledgers.find((x) => !used.has(x.id)) ?? s.ledgers[0]
              patch({ slots: [...draft.slots, { id: crypto.randomUUID(), target: { kind: 'ledger', ledgerId: l.id }, minutes: 25 }] })
            }}
          >
            <Plus size={14} /> Add slot
          </button>
        </li>
      </ol>

      <div className="rules">
        <Num label="Rounds" help="0 loops until you stand down" value={draft.rounds} min={0} max={24} onChange={(rounds) => patch({ rounds })} />
        <Num label="Rest" help="minutes between slots" value={draft.restMin} min={0} max={120} onChange={(restMin) => patch({ restMin })} />
        <Num label="Round rest" help="minutes between rounds" value={draft.roundRestMin} min={0} max={180} onChange={(roundRestMin) => patch({ roundRestMin })} />
        <Toggle label="Order" value={draft.order} options={[['fixed', 'Fixed'], ['shuffle', 'Shuffle each round']]} onChange={(order) => patch({ order })} />
        <Toggle label="When an entry is cleared" value={draft.onClear} options={[['next-in-ledger', 'Next in the same ledger'], ['next-slot', 'Jump to the next slot']]} onChange={(onClear) => patch({ onClear })} />
      </div>

      <Timeline s={s} draft={draft} />
      <p className="ss-total mono num dim">
        {draft.rounds ? `${draft.rounds} rounds` : 'Loops'}  {span(focusTotal * 60_000)} focus  {draft.rounds ? `${span(total * 60_000)} total` : `${span(perRound * 60_000)} a round`}
      </p>

      <div className="form-actions">
        <button className="btn primary" disabled={draft.slots.length === 0} onClick={() => {
          save()
          dispatch({ type: 'desk/deploy', mode: 'superset', supersetId: draft.id })
        }}>
          <Rocket size={16} /> {running ? 'Redeploy' : 'Deploy'}
        </button>
        <button className="btn" disabled={!dirty || draft.slots.length === 0} onClick={save}>Save</button>
        {!isNew && (
          <button className="btn ghost" onClick={() => {
            dispatch({ type: 'superset/delete', id: draft.id })
            setDraft(null)
          }}>
            <Trash size={14} /> Delete
          </button>
        )}
      </div>
    </section>
  )
}

/** One round, to scale: focus slots as bars, rests as gaps. */
function Timeline({ s, draft }: { s: MayorlyState; draft: Superset }) {
  const parts: { key: string; kind: 'focus' | 'rest'; min: number; code?: string }[] = []
  draft.slots.forEach((sl, i) => {
    if (i > 0 && draft.restMin > 0) parts.push({ key: `r${i}`, kind: 'rest', min: draft.restMin })
    const id = sl.target.kind === 'ledger' ? sl.target.ledgerId : s.entries.find((e) => e.id === (sl.target as { entryId: Id }).entryId)?.ledgerId
    parts.push({ key: sl.id, kind: 'focus', min: sl.minutes, code: s.ledgers.find((l) => l.id === id)?.code })
  })
  if (draft.roundRestMin > 0 && draft.rounds !== 1) parts.push({ key: 'rr', kind: 'rest', min: draft.roundRestMin })
  const total = parts.reduce((n, p) => n + p.min, 0) || 1
  return (
    <div className="timeline" role="img" aria-label={`One round: ${parts.map((p) => (p.kind === 'focus' ? `${p.code} ${p.min} minutes` : `rest ${p.min}`)).join(', ')}`}>
      {parts.map((p) => (
        <span key={p.key} className={`tl tl-${p.kind}`} style={{ flexGrow: p.min }} title={`${p.kind === 'focus' ? p.code : 'Rest'} ${p.min}m`}>
          {p.kind === 'focus' && p.min / total > 0.08 && <b className="mono">{p.code}</b>}
        </span>
      ))}
    </div>
  )
}

function Num({ label, help, value, min, max, onChange }: { label: string; help: string; value: number; min: number; max: number; onChange: (n: number) => void }) {
  return (
    <label className="field">
      <span className="field-label caps">{label}</span>
      <input className="mono num" type="number" min={min} max={max} value={value} onChange={(e) => onChange(Math.min(max, Math.max(min, Number(e.target.value) || 0)))} />
      <span className="field-help">{help}</span>
    </label>
  )
}

function Toggle<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: [T, string][]; onChange: (v: T) => void }) {
  return (
    <div className="field">
      <span className="field-label caps">{label}</span>
      <div className="seg" role="radiogroup" aria-label={label}>
        {options.map(([v, text]) => (
          <button key={v} type="button" role="radio" aria-checked={v === value} className={v === value ? 'on' : ''} onClick={() => onChange(v)}>
            {text}
          </button>
        ))}
      </div>
    </div>
  )
}
