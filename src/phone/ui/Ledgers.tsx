import { useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { rowIn } from './motion'
import { ArrowCounterClockwise, ArrowDown, ArrowLeft, ArrowUp, CaretRight, Check, PencilSimple, Play, Plus, Trash, Tray } from '@phosphor-icons/react'
import {
  dayStats, deriveCode, entryTomatoes, LEDGER_CAP, LEDGER_THEMES, onDeskId, openFlow, span, startOfDay, tomatoLabel,
  type Entry, type Ledger, type LedgerTheme,
} from '@core/index'
import { Glyph, GLYPH_NAMES, glyphKey, localGlyph } from '../../renderer/src/lib/glyphs'
import { distinctTheme, THEME_COLORS } from '../../renderer/src/lib/themes'
import { act, useMayorly, useNow } from '../store'
import { showToast } from '../toast'
import { captured } from '../feel'
import { LedgerDot, Sheet, Toggle } from './parts'

// The shelf: every ledger with what is open in it and today's time, the tray of unfiled
// entries, and inside a ledger its entries in the flow's order. A tap on an entry offers what
// can be done with it; adding is the line at the top.

type Open = { kind: 'ledger'; id: string | null } | null

export function Ledgers() {
  const s = useMayorly()
  const now = useNow(30_000)
  const [open, setOpen] = useState<Open>(null)
  const [editing, setEditing] = useState<Ledger | 'new' | null>(null)
  const flow = openFlow(s)
  const today = dayStats(s, startOfDay(now), now)
  const todayOf = (id: string | null) => today.byLedger.find((b) => b.ledgerId === id)?.focusMs ?? 0

  const openLedger = open?.id ? s.ledgers.find((l) => l.id === open.id) ?? null : null
  if (open?.id && !openLedger) {
    setOpen(null)
    return null
  }
  const form = <AnimatePresence>{editing && <LedgerForm key="ledger-form" ledger={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}</AnimatePresence>
  const tray = flow.filter((e) => e.ledgerId === null)
  // A ledger opens like an iOS push: it slides in over the shelf, which slips back and dims under
  // it, and Back plays it in reverse. Both pages are drawn for the whole move, so no frame is empty.
  const dir = open ? 1 : -1
  return (
    <div className="push">
      <AnimatePresence initial={false} custom={dir} mode="popLayout">
        {open ? (
          <motion.div key={`ledger-${open.id ?? 'tray'}`} className="push-page" custom={dir} variants={PUSH} initial="enter" animate="center" exit="leave">
            <LedgerView ledger={openLedger} back={() => setOpen(null)} edit={() => openLedger && setEditing(openLedger)} />
            {form}
          </motion.div>
        ) : (
    <motion.div key="shelf" className="push-page" custom={dir} variants={PUSH} initial="enter" animate="center" exit="leave">
      <header className="top">
        <h1 className="title" style={{ flex: 1, padding: 0 }}>Ledgers</h1>
        <button type="button" className="btn" onClick={() => setEditing('new')} disabled={s.ledgers.length >= LEDGER_CAP}><Plus size={16} />New</button>
      </header>
      <div className="list" style={{ marginTop: 8 }}>
        {s.ledgers.map((l) => {
          const n = flow.filter((e) => e.ledgerId === l.id).length
          const t = todayOf(l.id)
          return (
            <button type="button" key={l.id} className="row" onClick={() => setOpen({ kind: 'ledger', id: l.id })}>
              <span className="glyph"><Glyph name={l.glyph} size={20} /></span>
              <span className="row-main">
                <span className="row-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}><LedgerDot ledger={l} />{l.name}</span>
                <span className="row-sub">{l.code}, {n} open{t >= 60_000 ? `, ${span(t)} today` : ''}{l.pays === false ? ', pays no coins' : ''}</span>
              </span>
              <CaretRight size={16} className="row-end" />
            </button>
          )
        })}
        {tray.length > 0 && (
          <button type="button" className="row" onClick={() => setOpen({ kind: 'ledger', id: null })}>
            <span className="glyph"><Tray size={20} /></span>
            <span className="row-main"><span className="row-title">Tray</span><span className="row-sub">{tray.length} not filed yet</span></span>
            <CaretRight size={16} className="row-end" />
          </button>
        )}
        {s.ledgers.length === 0 && <p className="empty">No ledgers yet. A ledger is a part of your life that work is filed into: Legal, Dance, Career.</p>}
      </div>
      {form}
    </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

const pushSpring = { type: 'spring', stiffness: 360, damping: 38 } as const
const PUSH = {
  enter: (d: number) => (d > 0 ? { x: '100%', opacity: 1, zIndex: 2 } : { x: '-28%', opacity: 0.4, zIndex: 0 }),
  center: { x: 0, opacity: 1, zIndex: 1, transition: pushSpring },
  leave: (d: number) => (d > 0 ? { x: '-28%', opacity: 0.4, zIndex: 0, transition: pushSpring } : { x: '100%', opacity: 1, zIndex: 2, transition: pushSpring }),
}

function LedgerView({ ledger, back, edit }: { ledger: Ledger | null; back: () => void; edit: () => void }) {
  const s = useMayorly()
  const now = useNow(10_000)
  const [title, setTitle] = useState('')
  const [menu, setMenu] = useState<Entry | null>(null)
  const id = ledger?.id ?? null
  const entries = openFlow(s).filter((e) => e.ledgerId === id)
  const day = startOfDay(now)
  const cleared = s.entries.filter((e) => e.ledgerId === id && e.doneAt !== null && e.doneAt >= day).sort((a, b) => b.doneAt! - a.doneAt!)
  const add = () => {
    if (!title.trim()) return
    act({ type: 'entry/add', title, ledgerId: id, estimateMin: null })
    captured()
    setTitle('')
  }
  return (
    <>
      <header className="top">
        <button type="button" className="btn" onClick={back} style={{ paddingLeft: 12 }}><ArrowLeft size={18} />Ledgers</button>
        <span className="spacer" />
        {ledger && <button type="button" className="btn" onClick={edit}><PencilSimple size={16} />Edit</button>}
      </header>
      <h1 className="title" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        {ledger ? <><LedgerDot ledger={ledger} />{ledger.name}</> : 'Tray'}
      </h1>
      {ledger?.criterion && <p className="help" style={{ marginTop: -8, marginBottom: 12 }}>{ledger.criterion}</p>}
      <input className="field" value={title} onChange={(e) => setTitle(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && add()} placeholder={ledger ? `Add to ${ledger.name}` : 'Add to the tray'} aria-label="New entry" enterKeyHint="done" />
      <div className="list" style={{ marginTop: 10 }}>
        <AnimatePresence initial={false} mode="popLayout">
          {entries.map((e, i) => {
            const crop = entryTomatoes(s, e.id, now)
            return (
              <motion.button type="button" key={e.id} className="row" onClick={() => setMenu(e)} {...rowIn(i)}>
                <span className="row-main">
                  <span className="row-title">{e.title}</span>
                  {e.estimateMin ? <span className="row-sub">{e.estimateMin} min</span> : null}
                </span>
                {crop >= 0.1 && <span className="row-end num"><b>{tomatoLabel(crop)}</b></span>}
              </motion.button>
            )
          })}
        </AnimatePresence>
        {entries.length === 0 && <p className="empty">Nothing open here.</p>}
      </div>
      {cleared.length > 0 && (
        <>
          <h2 className="section-title">Cleared today</h2>
          <div className="list">
            {cleared.map((e) => (
              <div key={e.id} className="row">
                <span className="row-main"><span className="row-title" style={{ color: 'var(--muted)' }}>{e.title}</span></span>
                <button type="button" className="btn" style={{ height: 36 }} onClick={() => act({ type: 'entry/reopen', id: e.id })}><ArrowCounterClockwise size={16} />Reopen</button>
              </div>
            ))}
          </div>
        </>
      )}
      <AnimatePresence>{menu && <EntryMenu key="entry-menu" entry={menu} onClose={() => setMenu(null)} />}</AnimatePresence>
    </>
  )
}

function EntryMenu({ entry, onClose }: { entry: Entry; onClose: () => void }) {
  const s = useMayorly()
  const [title, setTitle] = useState(entry.title)
  const [estimate, setEstimate] = useState(entry.estimateMin ? String(entry.estimateMin) : '')
  const [confirm, setConfirm] = useState(false)
  const flow = openFlow(s)
  const index = flow.findIndex((e) => e.id === entry.id)
  const live = s.entries.find((e) => e.id === entry.id)
  const done = (a: () => void) => () => {
    a()
    onClose()
  }
  const saveText = () => {
    const patch: { title?: string; estimateMin?: number | null } = {}
    if (title.trim() && title.trim() !== entry.title) patch.title = title.trim()
    const est = estimate.trim() ? Math.round(Number(estimate)) : null
    if (est !== entry.estimateMin && (est === null || (Number.isFinite(est) && est > 0))) patch.estimateMin = est
    if (Object.keys(patch).length) act({ type: 'entry/update', id: entry.id, patch })
  }
  // Once cleared or deleted the sheet keeps drawing what it had while it slides away.
  const gone = !live || live.doneAt !== null
  const onDesk = !gone && onDeskId(s) === entry.id && s.desk.status !== 'idle'
  const crop = entryTomatoes(s, entry.id, Date.now())
  return (
    <Sheet title="Entry" short onClose={() => { saveText(); onClose() }}>
      <label className="label" htmlFor="et">Title</label>
      <textarea id="et" className="field entry-title" rows={2} value={title} onChange={(e) => setTitle(e.target.value)} onBlur={saveText} />
      <label className="label" htmlFor="ee">Estimate, minutes</label>
      <input id="ee" className="field num" inputMode="numeric" value={estimate} onChange={(e) => setEstimate(e.target.value.replace(/[^0-9]/g, ''))} onBlur={saveText} placeholder="None" />
      <label className="label" htmlFor="el">Ledger</label>
      <select id="el" className="field" value={entry.ledgerId ?? ''} onChange={(e) => { act({ type: 'entry/update', id: entry.id, patch: { ledgerId: e.target.value || null } }); onClose() }}>
        <option value="">Tray</option>
        {s.ledgers.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
      </select>
      <div className="menu" style={{ marginTop: 16 }}>
        {onDesk ? <button type="button" disabled><Play size={20} />On the desk now</button> : <button type="button" disabled={gone} onClick={done(() => { saveText(); act({ type: 'desk/select', entryId: entry.id, ledgerId: entry.ledgerId }) })}><Play size={20} />Start now</button>}
        <button type="button" onClick={done(() => { const place = openFlow(s).findIndex((x) => x.id === entry.id); act({ type: 'entry/complete', id: entry.id }); showToast(`Cleared ${entry.title}`, () => { act({ type: 'entry/reopen', id: entry.id }); act({ type: 'entry/move', id: entry.id, toIndex: place }) }) })}><Check size={20} />Clear</button>
        {index > 0 && <button type="button" onClick={() => act({ type: 'entry/move', id: entry.id, toIndex: index - 1 })}><ArrowUp size={20} />Earlier in the flow</button>}
        {index >= 0 && index < flow.length - 1 && <button type="button" onClick={() => act({ type: 'entry/move', id: entry.id, toIndex: index + 1 })}><ArrowDown size={20} />Later in the flow</button>}
        <button type="button" className="danger" onClick={() => (confirm ? done(() => { act({ type: 'entry/delete', id: entry.id }); showToast(`Deleted ${entry.title}`, () => act({ type: 'entry/restore', id: entry.id })) })() : setConfirm(true))}>
          <Trash size={20} />{confirm ? (crop >= 0.1 ? 'Delete: its tomatoes go too' : 'Tap again to delete') : 'Delete'}
        </button>
      </div>
    </Sheet>
  )
}

function LedgerForm({ ledger, onClose }: { ledger: Ledger | null; onClose: () => void }) {
  const s = useMayorly()
  const others = s.ledgers.filter((l) => l.id !== ledger?.id)
  const [name, setName] = useState(ledger?.name ?? '')
  const [code, setCode] = useState(ledger?.code ?? '')
  const [criterion, setCriterion] = useState(ledger?.criterion ?? '')
  const [theme, setTheme] = useState<LedgerTheme>(ledger?.theme ?? distinctTheme([...others.map((l) => l.theme), 'amber']))
  // A new ledger's icon follows its name until one is chosen.
  const [chosen, setGlyph] = useState<string | null>(glyphKey(ledger?.glyph) ?? null)
  const [pays, setPays] = useState(ledger?.pays !== false)
  const [confirm, setConfirm] = useState(false)
  const worn = others.map((l) => glyphKey(l.glyph)).filter((g): g is string => !!g)
  const glyph = chosen ?? (name.trim() ? localGlyph(name, criterion, worn) : null) ?? 'book-open'
  const taken = others.some((l) => l.code === code.toUpperCase())
  const changed = !ledger
    ? !!name.trim()
    : name !== ledger.name || (code && code !== ledger.code) || criterion !== ledger.criterion || theme !== (ledger.theme ?? 'amber') || glyph !== (glyphKey(ledger.glyph) ?? 'book-open') || pays !== (ledger.pays !== false)
  // Done, a swipe down or a tap outside keeps what was typed, as Save does, when it can be kept.
  const close = () => (changed && name.trim() && !taken ? save() : onClose())
  // The suggested code is worked out while typing and kept still once saved, as the sheet leaves.
  const saved = useRef(false)
  const hint = useRef('Two to four letters')
  if (!saved.current) hint.current = name.trim() ? deriveCode(name, others.map((l) => l.code)) : 'Two to four letters'
  const codeHint = hint.current
  const save = () => {
    if (!name.trim() || taken) return
    saved.current = true
    captured()
    if (ledger) act({ type: 'ledger/update', id: ledger.id, patch: { name, code: code || ledger.code, criterion, glyph, pays, theme } })
    else act({ type: 'ledger/create', name, code: code || undefined, criterion, glyph, pays, theme })
    onClose()
  }
  const auto = () => {
    const g = localGlyph(name, criterion, worn)
    if (g) setGlyph(g)
    setTheme(distinctTheme([...others.map((l) => l.theme), 'amber']))
  }
  return (
    <Sheet title={ledger ? 'Edit ledger' : 'New ledger'} onClose={close}>
      <label className="label" htmlFor="ln">Name</label>
      <input id="ln" className="field" value={name} maxLength={24} onChange={(e) => setName(e.target.value)} placeholder="Reading" />
      <label className="label" htmlFor="lc">Code</label>
      <input id="lc" className="field" value={code} onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4))} placeholder={codeHint} autoCapitalize="characters" />
      {taken && <p className="error">{code} is already on the shelf.</p>}
      <label className="label" htmlFor="lk">Criterion</label>
      <textarea id="lk" className="field" value={criterion} onChange={(e) => setCriterion(e.target.value)} placeholder="What belongs in this ledger, in one sentence." />
      <span className="label">Colour</span>
      <div className="swatches" role="radiogroup" aria-label="Colour">
        {LEDGER_THEMES.map((t) => (
          <button type="button" key={t} role="radio" aria-checked={t === theme} aria-label={t} className={`swatch ${others.some((l) => (l.theme ?? 'amber') === t) && t !== theme ? 'taken' : ''}`} style={{ background: THEME_COLORS[t] }} onClick={() => setTheme(t)} />
        ))}
      </div>
      <span className="label" style={{ display: 'flex', alignItems: 'center' }}>
        <span style={{ flex: 1 }}>Icon</span>
        <button type="button" className="btn" style={{ height: 32 }} onClick={auto} disabled={!name.trim()}>Auto</button>
      </span>
      <div className="glyphs" role="radiogroup" aria-label="Icon">
        {GLYPH_NAMES.map((g) => (
          <button type="button" key={g} role="radio" aria-checked={g === glyph} aria-label={g} style={{ opacity: worn.includes(g) && g !== glyph ? 0.4 : 1 }} onClick={() => setGlyph(g)}>
            <Glyph name={g} size={20} />
          </button>
        ))}
      </div>
      <div className="list" style={{ marginTop: 16 }}>
        <div className="row">
          <span className="row-main"><span className="row-title">Pays coins</span><span className="row-sub">Off for work you are paid for in money</span></span>
          <Toggle on={pays} onChange={setPays} label="Pays coins" />
        </div>
      </div>
      {ledger && (
        <div className="menu" style={{ marginTop: 16 }}>
          <button type="button" className="danger" onClick={() => (confirm ? (act({ type: 'ledger/delete', id: ledger.id }), onClose()) : setConfirm(true))}>
            <Trash size={20} />{confirm ? 'Delete: its entries go to the tray' : 'Delete ledger'}
          </button>
        </div>
      )}
    </Sheet>
  )
}
