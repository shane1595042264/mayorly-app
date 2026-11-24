import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { ArrowLeft, Check, LockSimple, PencilSimple, Play, Plus, Trash } from '@phosphor-icons/react'
import {
  completionHistory, dayStats, entrySpentMs, entryTomatoes, LEDGER_CAP, LEDGER_THEMES, ledgerEntries, span, startOfDay, type Entry, type GlyphName, type Ledger, type LedgerTheme, type MayorlyState,
} from '@core/index'
import { Glyph, GLYPH_NAMES, glyphKey, localGlyph } from '../lib/glyphs'
import { ArtIcon } from '../lib/Pixel'
import { bridge } from '../bridge'
import { distinctTheme, ledgerVars, THEME_COLORS } from '../lib/themes'
import { actionFor, keymapOpen, recordUse } from '../lib/keymap'
import { cycleLedger, useListKeys } from '../lib/listkeys'
import { noteOrigin } from '../lib/origin'
import { current, dispatch, useNow } from '../store'
import { Tomatoes } from './Tomatoes'
import { EntryHistory } from './EntryHistory'
import { CueCount, CueToggle, Cues } from './Cues'
import { ShelfRoomArt, ShelfScene } from './ShelfScene'
import { ROOM, roomLayout } from './shelfLayout'
import { art } from '../lib/art'

// The ledger shelf: nine bays. Every ledger here is hand-written by you, so the
// clerk may file into it but never rename, merge or remove it. A bay opens the
// ledger; the pencil on the bay edits it. With room for it, the tab is the founder's
// room (ShelfRoomArt): his bookshelf holds a spine for every ledger, and each card
// hangs on the wall level with the bay its spine stands in; a narrow tab shows his
// scene small over the grid of cards instead.

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

  // The room's size: the tab's width, and the height the deck shows without scrolling.
  const wrap = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState<{ w: number; h: number } | null>(null)
  const zoom = s.settings.text.deck || 1
  useLayoutEffect(() => {
    const el = wrap.current
    const body = el?.closest('.deck-body') as HTMLElement | null
    if (!el || !body) return
    const measure = () => {
      // Screen pixels: the body's padding and the note under the room are in the deck's zoom.
      const w = Math.floor(el.getBoundingClientRect().width)
      const h = Math.floor(body.getBoundingClientRect().height - (24 + 28 + 44) * zoom)
      setSize((o) => (o && o.w === w && o.h === h ? o : { w, h }))
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(body)
    ro.observe(el)
    return () => ro.disconnect()
  }, [zoom, !!open])
  const [hot, setHot] = useState<string | null>(null)

  const opened = open ? s.ledgers.find((l) => l.id === open) : null
  if (opened) {
    return <LedgerView s={s} ledger={opened} now={now} back={() => setOpen(null)} edit={() => { setOpen(null); setEditing(opened.id) }} />
  }

  const room = size && art('prop2x4.bookshelf') ? roomLayout(size.w, size.h, !!art('char.clerk.stand')) : null
  const note = (
    <p className="shelf-note dim">
      {s.ledgers.length} of {LEDGER_CAP} bays. Each ledger carries a criterion; the clerk files against the criterion, not the name.
    </p>
  )

  /** Bay i as a card: its ledger, the bay a new one would go in, or nothing. */
  const card = (i: number, place?: CSSProperties): ReactNode => {
    const l = slots[i]
    if (!l) {
      if (i !== firstEmpty) return room ? null : <div key={`e${i}`} className="bay bay-void" aria-hidden />
      return (
        <button key={`e${i}`} className={`bay bay-empty bay-card ${cell === i ? 'is-selected' : ''}`} style={place} onClick={() => setEditing(`new-${i}`)}>
          <Plus size={18} />
          <span className="caps">Write a ledger</span>
        </button>
      )
    }
    const openCount = ledgerEntries(s, l.id).length
    const ms = today.byLedger.find((b) => b.ledgerId === l.id)?.focusMs ?? 0
    // On the wall a card has room for so many lines of criterion: fewer on a short card, one fewer on a
    // narrow one or one with the no coins badge, whose numbers wrap onto a second line.
    const narrow = !!room && room.cards.width < ROOM.cardsFit
    const critLines = room ? Math.max(0, (room.k >= 7 ? 2 : room.k >= 5 ? 1 : 0) - (narrow ? 1 : 0) - (l.pays === false ? 1 : 0)) : 2
    return (
      <div
        key={l.id}
        className={`bay bay-open bay-card ${cell === i ? 'is-selected' : ''} ${room && hot === l.id ? 'is-hot' : ''}`}
        style={{ ...ledgerVars(l), ...place, ...(room ? { '--crit-lines': critLines } : null) } as CSSProperties}
        role="button"
        tabIndex={0}
        onClick={() => setOpen(l.id)}
        onKeyDown={(e) => e.key === 'Enter' && setOpen(l.id)}
        onMouseEnter={() => setHot(l.id)}
        onMouseLeave={() => setHot(null)}
        aria-label={`Open ${l.name}`}
      >
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
        {/* On the wall the name has the top line to itself and the code goes down with the numbers. */}
        <span className="bay-head">
          <span className="bay-glyph"><Glyph name={l.glyph} size={room ? 20 : 26} /></span>
          {room ? <span className="bay-name" title={l.name}>{l.name}</span> : <span className="bay-code mono">{l.code}</span>}
        </span>
        {!room && <span className="bay-name">{l.name}</span>}
        {critLines > 0 && <span className="bay-crit">{l.criterion || 'No criterion written yet.'}</span>}
        <span className="bay-stats mono num">
          {room && <span className="bay-code mono">{l.code}</span>}
          <span>{openCount} open</span>
          <span title={`${span(ms)} today`}>{span(ms)}{narrow ? '' : ' today'}</span>
          {l.pays === false && <span className="bay-nopay" title="Paid work: tomatoes count, no coin is minted">no coins</span>}
          {l.handWritten && (
            <span className="bay-lock" role="img" aria-label="Hand-written, locked from the clerk" title="Hand-written, locked from the clerk">
              <ArtIcon id="icon.ledger.locked" size={12} fallback={<LockSimple size={12} />} />
            </span>
          )}
        </span>
      </div>
    )
  }

  const editingSlot = editing ? slots.findIndex((l, i) => (l ? l.id === editing : editing === `new-${i}`)) : -1
  const form = editingSlot >= 0 ? <LedgerForm key={editing} s={s} ledger={slots[editingSlot]} done={() => setEditing(null)} /> : null

  if (room) {
    const { k, cards } = room
    const colW = (cards.width - 2 * 10) / 3
    // The cards layer keeps the deck's text size; the room under it is in screen pixels.
    const at = (x: number, y: number, w: number, h: number): CSSProperties => ({ left: x / zoom, top: y / zoom, width: w / zoom, height: h / zoom })
    return (
      <div className="shelf shelf-in-room" ref={wrap}>
        <div className="shelf-room" style={{ height: room.height, '--k': `${k}px` } as CSSProperties}>
          <ShelfRoomArt s={s} room={room} hot={hot} picked={slots[cell]?.id ?? null} onHot={setHot} open={setOpen} />
          <div className="shelf-room-cards">
            {form ? (
              // The form takes the whole wall between the shelf and the desk, and the floor under it.
              <div className="shelf-room-form" style={at(cards.left, 2 * k, cards.width, room.height - 4 * k)}>{form}</div>
            ) : (
              slots.map((_, i) => {
                const row = cards.rows[Math.floor(i / 3)]
                return card(i, at(cards.left + (i % 3) * (colW + 10), row.top, colW, row.height))
              })
            )}
          </div>
        </div>
        {note}
      </div>
    )
  }

  return (
    <div className="shelf" ref={wrap}>
      <div className="shelf-head">
        <ShelfScene s={s} open={setOpen} />
        {note}
      </div>
      <div className="shelf-grid">
        {slots.map((_, i) => (i === editingSlot ? form : card(i)))}
      </div>
    </div>
  )
}

/** Inside one ledger: its open entries, and what was cleared today. */
function LedgerView({ s, ledger, now, back, edit }: { s: MayorlyState; ledger: Ledger; now: number; back: () => void; edit: () => void }) {
  const [history, setHistory] = useState<string | null>(null)
  const entries = ledgerEntries(s, ledger.id)
  const today = startOfDay(now)
  const cleared = s.entries.filter((e) => e.ledgerId === ledger.id && e.doneAt !== null && e.doneAt >= today).sort((a, b) => b.doneAt! - a.doneAt!)
  const ms = dayStats(s, today, now).byLedger.find((b) => b.ledgerId === ledger.id)?.focusMs ?? 0
  const live = s.desk.block?.entryId

  // The keyboard: the list keys on the rows; Backspace back to the shelf, f focuses here.
  const [rename, setRename] = useState({ id: '', n: 0 })
  const [open, setOpen] = useState<string | null>(null)
  const { sel } = useListKeys(entries.map((e) => e.id), ({ action, id }) => {
    if (action === 'list.history') {
      setHistory('')
      return true
    }
    const e = id ? entries.find((x) => x.id === id) : undefined
    if (!e) return false
    if (action === 'list.go') dispatch({ type: 'desk/deploy', mode: 'pomodoro', entryId: e.id })
    else if (action === 'list.clear') {
      noteOrigin(document.querySelector(`[data-row="${CSS.escape(e.id)}"] [aria-label^="Clear"]`))
      dispatch({ type: 'entry/complete', id: e.id })
    }
    else if (action === 'list.delete') dispatch({ type: 'entry/delete', id: e.id })
    else if (action === 'list.rename') setRename((r) => ({ id: e.id, n: r.n + 1 }))
    else if (action === 'list.cues') setOpen((o) => (o === e.id ? null : e.id))
    else if (action === 'list.ledgerNext' || action === 'list.ledgerPrev') {
      dispatch({ type: 'entry/update', id: e.id, patch: { ledgerId: cycleLedger(s, e.ledgerId, action === 'list.ledgerNext' ? 1 : -1) } })
    } else return false
    return true
  }, history === null)
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
    if (history !== null) return
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [back, ledger.id, history])

  if (history !== null) return <EntryHistory s={s} ledgerId={ledger.id} initialOpen={history} back={() => setHistory(null)} />

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
          {entries.map((e, i) => <LedgerRow key={e.id} s={s} e={e} index={i} now={now} live={live === e.id} selected={sel === e.id} renameTick={rename.id === e.id ? rename.n : 0} expanded={open === e.id} onToggle={() => setOpen((o) => (o === e.id ? null : e.id))} />)}
        </ol>
      )}

      {s.entries.some(e => e.ledgerId === ledger.id && completionHistory(s, e).some(h => h.kind === 'cleared')) && (
        <section className="flow-cleared">
          <div className="history-heading"><h3 className="side-title caps">Cleared today</h3><button type="button" className="btn ghost small" title="Everything cleared in this ledger, and its trash (H)" onClick={() => setHistory('')}>History</button></div>
          <ol className="flow-list">
            {cleared.map((e) => (
              <li key={e.id} className="row done">
                <button className="row-title history-title" onClick={() => setHistory(e.id)}>{e.title}</button>
                <span className="row-time mono num">
                  <Tomatoes n={entryTomatoes(s, e.id, now)} showZero />
                  {span(entrySpentMs(s, e.id, now))}
                </span>
              </li>
            ))}
          </ol>
        </section>
      )}
    </div>
  )
}

function LedgerRow({ s, e, index, now, live, selected, renameTick, expanded, onToggle }: { s: MayorlyState; e: Entry; index: number; now: number; live: boolean; selected: boolean; renameTick: number; expanded: boolean; onToggle: () => void }) {
  const [editing, setEditing] = useState(false)
  const [title, setTitle] = useState(e.title)
  useEffect(() => {
    if (renameTick) setEditing(true)
  }, [renameTick])
  const spent = entrySpentMs(s, e.id, now)
  return (
    <li className={`row no-grip has-cues ${live ? 'live' : ''} ${selected ? 'is-selected' : ''} ${expanded ? 'expanded' : ''}`} style={ledgerVars(s.ledgers.find((l) => l.id === e.ledgerId))} data-row={e.id} aria-current={selected ? 'true' : undefined}>
      <span className="row-n mono num dim">{String(index + 1).padStart(2, '0')}</span>
      <CueToggle open={expanded} onToggle={onToggle} />
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
        <span className="row-title ellipsis" onDoubleClick={() => setEditing(true)} title="Double-click to rename">{e.title}<CueCount cues={e.cues} /></span>
      )}
      <span className="row-time mono num">
        <Tomatoes n={entryTomatoes(s, e.id, now)} />
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
      {expanded && <Cues inRow id={e.id} title={e.title} cues={e.cues ?? []} live={live} example="stuck 20 minutes: read the hint" />}
    </li>
  )
}

function LedgerForm({ s, ledger, done }: { s: MayorlyState; ledger: Ledger | null; done: () => void }) {
  const [name, setName] = useState(ledger?.name ?? '')
  const [code, setCode] = useState(ledger?.code ?? '')
  const [criterion, setCriterion] = useState(ledger?.criterion ?? '')
  const [glyph, setGlyph] = useState<GlyphName>(glyphKey(ledger?.glyph) ?? 'book-open')
  const [glyphQuery, setGlyphQuery] = useState('')
  const [picking, setPicking] = useState(false)
  const worn = s.ledgers.filter((l) => l.id !== ledger?.id).map((l) => glyphKey(l.glyph)).filter((g): g is string => !!g)
  const shown = GLYPH_NAMES.filter((g) => !glyphQuery.trim() || g.includes(glyphQuery.trim().toLowerCase().replace(/\s+/g, '-')))
  const wornThemes = s.ledgers.filter((l) => l.id !== ledger?.id).map((l) => l.theme ?? 'amber')
  // Auto: the clerk picks a name from the catalogue; without a key, the words of the ledger do.
  // The colour is the one that stands apart from the other ledgers', chosen here, not by the clerk.
  const auto = async () => {
    setTheme(distinctTheme(wornThemes))
    setPicking(true)
    try {
      const byClerk = await bridge.ai.pickGlyph(name, criterion, GLYPH_NAMES, worn).catch(() => null)
      const pick = byClerk ?? localGlyph(name, criterion, worn)
      if (pick) setGlyph(pick)
    } finally {
      setPicking(false)
    }
  }
  const [pays, setPays] = useState(ledger?.pays !== false)
  const [theme, setTheme] = useState<LedgerTheme>(ledger?.theme ?? 'amber')
  const [confirm, setConfirm] = useState(false)
  const taken = s.ledgers.some((l) => l.id !== ledger?.id && l.code === code.toUpperCase())

  const save = () => {
    if (!name.trim()) return
    if (ledger) dispatch({ type: 'ledger/update', id: ledger.id, patch: { name, code, criterion, glyph, pays, theme } })
    else dispatch({ type: 'ledger/create', name, code: code || undefined, criterion, glyph, pays, theme })
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
      <div className="glyph-head">
        <span className="glyph-now"><Glyph name={glyph} size={18} /><span className="mono dim">{glyph}</span></span>
        <input className="glyph-search" value={glyphQuery} onChange={(e) => setGlyphQuery(e.target.value)} placeholder="Search icons" aria-label="Search icons" />
        <button type="button" className="btn ghost" onClick={() => void auto()} disabled={picking || !name.trim()} title="Picks an icon for this ledger and a colour no other ledger wears. The clerk chooses the icon; without a key, its words do">
          {picking ? 'Picking' : 'Auto'}
        </button>
      </div>
      <div className="glyph-pick" role="radiogroup" aria-label="Glyph">
        {shown.map((g) => (
          <button type="button" key={g} role="radio" aria-checked={g === glyph} className={`${g === glyph ? 'on' : ''} ${worn.includes(g) ? 'taken' : ''}`} onClick={() => setGlyph(g)} aria-label={g} title={worn.includes(g) ? `${g} (another ledger wears it)` : g}>
            <Glyph name={g} size={16} />
          </button>
        ))}
        {shown.length === 0 && <span className="dim">No icon by that name.</span>}
      </div>
      <div className="form-row ledger-extras">
        <div className="theme-pick" role="radiogroup" aria-label="Colour">
          {LEDGER_THEMES.map((t) => (
            <button type="button" key={t} role="radio" aria-checked={t === theme} className={`${t === theme ? 'on' : ''} ${wornThemes.includes(t) ? 'taken' : ''}`} style={{ background: THEME_COLORS[t] }} onClick={() => setTheme(t)} aria-label={t} title={wornThemes.includes(t) ? `${t} (another ledger wears it)` : t} />
          ))}
        </div>
        <label className="check" title="Off for work you are paid for in money: tomatoes still count, no coin is minted, nothing is charged.">
          <input type="checkbox" checked={pays} onChange={(e) => setPays(e.target.checked)} />
          <span className="check-box" aria-hidden />
          <span>Pays coins</span>
        </label>
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
