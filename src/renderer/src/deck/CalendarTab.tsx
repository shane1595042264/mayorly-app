import { useEffect, useMemo, useRef, useState } from 'react'
import { CalendarBlank, CaretLeft, CaretRight, Lock, Play, PushPin, Sparkle, Warning } from '@phosphor-icons/react'
import { openFlow, span, type Action, type CalBlock, type CalEvent, type ExternalEvent, type MayorlyState } from '@core/index'
import { startOfDayIn, wallClock, zonedEpoch } from '../../../shared/windows'
import { askCalendar } from '../lib/calendarAsk'
import { actionFor, keymapOpen, recordUse } from '../lib/keymap'
import { useListKeys } from '../lib/listkeys'
import { ledgerVars } from '../lib/themes'
import { current, dispatch, useNow } from '../store'
import { AskClerk } from './AskClerk'

// The calendar: a week of the plan. Blocks are what the planner placed (derived, redrawn on
// every replan), events are yours and never move, outside events are busy time from Google.
// Read with j and k, deploy with Enter; [ and ] turn the week, t comes back to today. The
// planner's own doing shows in the banner: what does not fit, and why. A block dragged to
// another time becomes a pin there; an event drags whole, or by its bottom edge to resize.

const MIN = 60_000
const SNAP = 15 * MIN
/** A press that moves less than this is a click. */
const DRAG_PX = 4
const DAY = 24 * 60 * MIN
const HOUR_PX = 44
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

type Item =
  | { kind: 'block'; id: string; start: number; end: number; block: CalBlock }
  | { kind: 'event'; id: string; start: number; end: number; event: CalEvent }
  | { kind: 'external'; id: string; start: number; end: number; external: ExternalEvent }

export function CalendarTab({ s }: { s: MayorlyState }) {
  const now = useNow(30_000)
  const tz = s.settings.calendar.tz
  const [weekOffset, setWeekOffset] = useState(0)
  const thisSunday = useMemo(() => {
    const d0 = startOfDayIn(now, tz)
    const w = wallClock(d0, tz)
    return startOfDayIn(d0 - w.weekday * DAY + DAY / 2, tz)
  }, [now, tz])
  const weekStart = useMemo(() => {
    let d = thisSunday
    for (let i = 0; i < Math.abs(weekOffset); i++) d = startOfDayIn(d + (weekOffset > 0 ? 7 * DAY : -7 * DAY) + DAY / 2, tz)
    return d
  }, [thisSunday, weekOffset, tz])
  const days = useMemo(() => {
    const out: number[] = []
    let d = weekStart
    for (let i = 0; i < 7; i++) {
      out.push(d)
      d = startOfDayIn(d + DAY + DAY / 2, tz)
    }
    return out
  }, [weekStart, tz])
  const weekEnd = startOfDayIn(days[6] + DAY + DAY / 2, tz)

  // Hour rows from an hour before the earliest window to an hour after the latest; eight to six at least.
  const hours = s.settings.calendar.hours.flat()
  const firstHour = Math.max(0, Math.min(8, ...hours.map((h) => Math.floor(h.start / 60) - 1)))
  const lastHour = Math.min(24, Math.max(18, ...hours.map((h) => Math.ceil(h.end / 60) + 1)))
  const rows = lastHour - firstHour

  const cal = s.calendar
  const items = useMemo(() => {
    const out: Item[] = []
    for (const b of cal.blocks) if (b.end > weekStart && b.start < weekEnd) out.push({ kind: 'block', id: b.id, start: b.start, end: b.end, block: b })
    for (const e of cal.events) if (e.end > weekStart && e.start < weekEnd) out.push({ kind: 'event', id: e.id, start: e.start, end: e.end, event: e })
    for (const x of cal.external) if (x.end > weekStart && x.start < weekEnd && !x.allDay) out.push({ kind: 'external', id: x.id, start: x.start, end: x.end, external: x })
    return out.sort((a, b) => a.start - b.start || a.id.localeCompare(b.id))
  }, [cal, weekStart, weekEnd])
  const ribbon = cal.external.filter((x) => x.allDay && x.end > weekStart && x.start < weekEnd)

  const entryOf = (id: string | null) => (id ? s.entries.find((e) => e.id === id) ?? null : null)
  const ledgerOf = (id: string | null) => (id ? s.ledgers.find((l) => l.id === id) ?? null : null)

  const [adding, setAdding] = useState(false)
  const { sel, setSel } = useListKeys(items.map((i) => i.id), ({ action, id }) => {
    const it = items.find((i) => i.id === id)
    if (action === 'list.go') {
      const entryId = it?.kind === 'block' ? it.block.entryId : it?.kind === 'event' ? it.event.entryId : null
      if (entryId) dispatch({ type: 'desk/deploy', mode: 'pomodoro', entryId })
      return true
    }
    if (action === 'list.clear') {
      const entryId = it?.kind === 'block' ? it.block.entryId : it?.kind === 'event' ? it.event.entryId : null
      if (entryId) dispatch({ type: 'entry/complete', id: entryId })
      return true
    }
    if (action === 'list.delete') {
      if (it?.kind === 'event') dispatch({ type: 'calendar/event-delete', id: it.event.id })
      return true
    }
    return false
  })

  // The week keys, from the keymap's cal scope, on the window like every other tab's.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (keymapOpen()) return
      const typing = (e.target as HTMLElement | null)?.closest?.('input, textarea, select')
      if (typing || e.altKey || e.ctrlKey || e.metaKey) return
      const st = current()
      const a = st ? actionFor(e, 'cal', st.settings) : null
      if (a === 'cal.prevWeek') setWeekOffset((w) => w - 1)
      else if (a === 'cal.nextWeek') setWeekOffset((w) => w + 1)
      else if (a === 'cal.today') setWeekOffset(0)
      else if (a === 'cal.pin') {
        const it = items.find((i) => i.id === sel)
        if (it?.kind === 'block') dispatch({ type: 'calendar/pin', blockId: it.block.id })
        else if (it?.kind === 'event' && it.event.entryId) dispatch({ type: 'calendar/event-delete', id: it.event.id })
      } else if (a === 'cal.new') setAdding(true)
      else if (a === 'cal.ask') document.getElementById('cal-ask')?.focus()
      else return
      e.preventDefault()
      recordUse(a)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [items, sel])

  // Dragging. The pointer is captured by the item; the grid reads the moves. A column under
  // the pointer and the minute within it, snapped to the quarter hour, give the new times.
  const gridRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<{ item: Item; mode: 'move' | 'resize'; grab: number; cols: DOMRect[]; x0: number; y0: number; moved: boolean } | null>(null)
  const [drag, setDrag] = useState<{ id: string; kind: 'block' | 'event'; start: number; end: number } | null>(null)
  const timeAt = (x: number, y: number, cols: DOMRect[]): number | null => {
    if (!cols.length) return null
    let i = cols.findIndex((r) => x >= r.left && x < r.right)
    if (i < 0) i = x < cols[0].left ? 0 : cols.length - 1
    const r = cols[i]
    const minutes = ((y - r.top) / HOUR_PX + firstHour) * 60
    return days[i] + Math.round(minutes / 15) * SNAP
  }
  const grabItem = (e: React.PointerEvent, it: Item, mode: 'move' | 'resize') => {
    if (e.button !== 0 || it.kind === 'external') return
    setSel(it.id)
    const cols = gridRef.current ? Array.from(gridRef.current.querySelectorAll<HTMLElement>('.cal-day')).map((el) => el.getBoundingClientRect()) : []
    const at = timeAt(e.clientX, e.clientY, cols)
    dragRef.current = { item: it, mode, grab: at === null ? 0 : at - it.start, cols, x0: e.clientX, y0: e.clientY, moved: false }
    try {
      ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    } catch {
      // A pointer the browser no longer tracks: the grid still reads the moves that bubble.
    }
    e.stopPropagation()
  }
  const onGridMove = (e: React.PointerEvent) => {
    const d = dragRef.current
    if (!d) return
    if (!d.moved && Math.hypot(e.clientX - d.x0, e.clientY - d.y0) < DRAG_PX) return
    d.moved = true
    const at = timeAt(e.clientX, e.clientY, d.cols)
    if (at === null) return
    const dur = d.item.end - d.item.start
    let start = d.item.start
    let end = d.item.end
    if (d.mode === 'move') {
      start = at - Math.round(d.grab / SNAP) * SNAP
      end = start + dur
    } else end = Math.max(start + SNAP, at)
    setDrag({ id: d.item.id, kind: d.item.kind as 'block' | 'event', start, end })
  }
  const onGridUp = () => {
    const d = dragRef.current
    dragRef.current = null
    if (!d) return
    setDrag((cur) => {
      if (d.moved && cur && (cur.start !== d.item.start || cur.end !== d.item.end)) {
        if (d.item.kind === 'block') dispatch({ type: 'calendar/pin', blockId: d.item.block.id, start: cur.start, end: cur.end })
        else if (d.item.kind === 'event') dispatch({ type: 'calendar/event-update', id: d.item.event.id, patch: { start: cur.start, end: cur.end } })
      }
      return null
    })
  }

  const fmt = (t: number) => new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit', timeZone: tz || undefined }).format(t)
  const fmtDay = (t: number) => new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', timeZone: tz || undefined }).format(t)
  const todayStart = startOfDayIn(now, tz)
  const nowMin = wallClock(now, tz).minutes

  const overflow = cal.overflow.map((o) => ({ ...o, entry: entryOf(o.entryId) })).filter((o) => o.entry)
  const unestimated = openFlow(s).filter((e) => !e.estimateMin && !e.offCalendar)
  const off = openFlow(s).filter((e) => e.offCalendar)
  const selected = items.find((i) => i.id === sel) ?? null

  return (
    <div className="cal">
      <div className="cal-main">
        <header className="cal-head">
          <button type="button" className="icon-btn" aria-label="Previous week" onClick={() => setWeekOffset((w) => w - 1)}><CaretLeft size={16} /></button>
          <h2 className="cal-week">{fmtDay(days[0])} to {fmtDay(days[6])}</h2>
          <button type="button" className="icon-btn" aria-label="Next week" onClick={() => setWeekOffset((w) => w + 1)}><CaretRight size={16} /></button>
          {weekOffset !== 0 && <button type="button" className="btn ghost" onClick={() => setWeekOffset(0)}>Today</button>}
          <button type="button" className="btn ghost" onClick={() => setAdding(true)}>New event</button>
          <span className="cal-planned dim">
            {cal.horizonEnd ? `Planned to ${fmtDay(cal.horizonEnd)}` : 'Not planned yet'}
            {!tz && '  (no zone yet; it is set on the first launch)'}
          </span>
        </header>
        {overflow.length > 0 && (
          <p className="cal-overflow" role="status">
            <Warning size={14} weight="fill" />
            {overflow.length === 1 ? 'One entry does not fit: ' : `${overflow.length} entries do not fit: `}
            <span className="cal-overflow-text">{overflow.map((o, i) => `${i ? ', ' : ''}${o.entry!.title} (${o.kind === 'past-due' ? `${span(o.minutes * MIN)} past its due` : `${span(o.minutes * MIN)} with no room before ${cal.horizonEnd ? fmtDay(cal.horizonEnd) : 'the horizon'}`})`)}</span>
            <button type="button" className="btn ghost small" onClick={() => askCalendar(`Find room for ${overflow.map((o) => `"${o.entry!.title}"`).join(' and ')}`)}><Sparkle size={12} /> Ask the clerk</button>
          </p>
        )}
        <div className={`cal-grid ${drag ? 'is-dragging' : ''}`} ref={gridRef} onPointerMove={onGridMove} onPointerUp={onGridUp} onPointerCancel={onGridUp} style={{ ['--rows' as string]: rows, ['--hour' as string]: `${HOUR_PX}px` }}>
          <div className="cal-corner" />
          {days.map((d, i) => (
            <div key={d} className={`cal-dayhead ${d === todayStart ? 'today' : ''} ${d < todayStart ? 'past' : ''}`}>
              <span className="caps">{DAYS[wallClock(d + DAY / 2, tz).weekday] ?? DAYS[i]}</span>
              <span className="mono num">{fmtDay(d)}</span>
              {ribbon.filter((x) => x.end > d && x.start < d + DAY).map((x) => (
                <span key={x.id} className="cal-allday" title={x.title}>{x.title}</span>
              ))}
            </div>
          ))}
          <div className="cal-hours">
            {Array.from({ length: rows }, (_, i) => (
              <span key={i} className="cal-hour mono num" style={{ top: i * HOUR_PX }}>{String(firstHour + i).padStart(2, '0')}:00</span>
            ))}
          </div>
          {days.map((d) => {
            const dayEnd = d + DAY
            const w = wallClock(d + DAY / 2, tz)
            const windows = s.settings.calendar.hours[w.weekday] ?? []
            const top = (t: number) => ((Math.max(t, d) - d) / MIN / 60 - firstHour) * HOUR_PX
            const height = (a: number, b: number) => Math.max(14, ((Math.min(b, dayEnd) - Math.max(a, d)) / MIN / 60) * HOUR_PX)
            return (
              <div key={d} className={`cal-day ${d === todayStart ? 'today' : ''} ${d < todayStart ? 'past' : ''}`}>
                {windows.map((h, i) => (
                  <div key={i} className="cal-window" style={{ top: (h.start / 60 - firstHour) * HOUR_PX, height: ((h.end - h.start) / 60) * HOUR_PX }} />
                ))}
                {drag && drag.end > d && drag.start < dayEnd && (
                  <div className={`cal-item cal-ghost ${drag.kind === 'block' ? 'cal-block' : 'cal-event'}`} style={{ top: top(drag.start), height: height(drag.start, drag.end) }}>
                    <span className="cal-item-t mono num">{fmt(drag.start)} to {fmt(drag.end)}</span>
                    <span className="cal-item-title">{drag.kind === 'block' ? 'Pin here' : 'Move here'}</span>
                  </div>
                )}
                {items.filter((it) => it.end > d && it.start < dayEnd).map((it) => {
                  const style = { top: top(it.start), height: height(it.start, it.end) }
                  const isSel = it.id === sel
                  const lifted = drag?.id === it.id ? 'lifted' : ''
                  if (it.kind === 'block') {
                    const e = entryOf(it.block.entryId)
                    const l = ledgerOf(e?.ledgerId ?? null)
                    const live = s.desk.block?.entryId === it.block.entryId && s.desk.status !== 'idle'
                    return (
                      <div key={it.id} className={`cal-item cal-block ${isSel ? 'is-selected' : ''} ${it.block.late ? 'late' : ''} ${live ? 'live' : ''} ${lifted}`} style={{ ...style, ...ledgerVars(l) }} data-row={it.id} title={`${e?.title ?? ''} ${fmt(it.start)} to ${fmt(it.end)}. Drag to pin it elsewhere.`} onPointerDown={(ev) => grabItem(ev, it, 'move')}>
                        <span className="cal-item-t mono num">{fmt(it.start)}</span>
                        <span className="cal-item-title">{l && <b className="mono">{l.code} </b>}{e?.title ?? '(gone)'}</span>
                        {it.block.of > 1 && <span className="cal-item-n mono num">{it.block.chunk}/{it.block.of}</span>}
                        {it.block.late && <Warning size={12} weight="fill" className="cal-item-icon" />}
                      </div>
                    )
                  }
                  if (it.kind === 'event') {
                    return (
                      <div key={it.id} className={`cal-item cal-event ${isSel ? 'is-selected' : ''} ${it.event.entryId ? 'pinned' : ''} ${lifted}`} style={style} data-row={it.id} title={`${it.event.title} ${fmt(it.start)} to ${fmt(it.end)}. Drag to move it, the bottom edge to resize it.`} onPointerDown={(ev) => grabItem(ev, it, 'move')}>
                        <span className="cal-item-t mono num">{fmt(it.start)}</span>
                        <span className="cal-item-title">{it.event.title}</span>
                        {it.event.origin === 'clerk' ? <Sparkle size={12} className="cal-item-icon" /> : it.event.entryId ? <PushPin size={12} className="cal-item-icon" /> : <Lock size={12} className="cal-item-icon" />}
                        <span className="cal-resize" aria-hidden onPointerDown={(ev) => grabItem(ev, it, 'resize')} />
                      </div>
                    )
                  }
                  return (
                    <div key={it.id} className={`cal-item cal-external ${it.external.free ? 'free' : ''} ${isSel ? 'is-selected' : ''}`} style={style} data-row={it.id} title={it.external.title} onPointerDown={() => setSel(it.id)}>
                      <span className="cal-item-t mono num">{fmt(it.start)}</span>
                      <span className="cal-item-title">{it.external.title}</span>
                    </div>
                  )
                })}
                {d === todayStart && nowMin / 60 >= firstHour && nowMin / 60 <= lastHour && <div className="cal-now" style={{ top: (nowMin / 60 - firstHour) * HOUR_PX }} />}
              </div>
            )
          })}
        </div>
      </div>
      <aside className="cal-side">
        {adding ? (
          <EventForm tz={tz} now={now} done={() => setAdding(false)} />
        ) : selected ? (
          <Selected s={s} item={selected} fmt={fmt} fmtDay={fmtDay} tz={tz} />
        ) : (
          <>
            <h3 className="side-title caps">The plan</h3>
            <p className="field-help">Entries with an estimate are placed into your hours, earliest due first, in the order of the flow. Your own events are never moved. Select a block with j and k; Enter starts it, p pins it where it is. Drag a block to pin it elsewhere; drag an event to move it, its bottom edge to resize it.</p>
          </>
        )}
        {unestimated.length > 0 && (
          <section className="cal-list">
            <h3 className="side-title caps">Needs an estimate</h3>
            <ul>
              {unestimated.slice(0, 8).map((e) => <li key={e.id}>{e.title}</li>)}
              {unestimated.length > 8 && <li className="dim">and {unestimated.length - 8} more</li>}
            </ul>
          </section>
        )}
        {off.length > 0 && (
          <section className="cal-list">
            <h3 className="side-title caps">Off the calendar</h3>
            <ul>{off.map((e) => <li key={e.id}>{e.title}</li>)}</ul>
          </section>
        )}
        {cal.blocks.length === 0 && unestimated.length === 0 && off.length === 0 && (
          <p className="dim cal-empty"><CalendarBlank size={16} /> Nothing to plan. Capture an entry with an estimate, like ~45.</p>
        )}
        <AskClerk />
      </aside>
    </div>
  )
}

/** Wall clock in the calendar's zone, as the value a datetime-local input wants, and back. */
function toLocal(t: number, tz: string): string {
  const w = wallClock(t, tz)
  return `${w.y}-${String(w.m).padStart(2, '0')}-${String(w.d).padStart(2, '0')}T${String(Math.floor(w.minutes / 60)).padStart(2, '0')}:${String(w.minutes % 60).padStart(2, '0')}`
}
function fromLocal(v: string, tz: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(v)
  if (!m) return null
  return zonedEpoch(tz, Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4]) * 60 + Number(m[5]))
}

/** The knobs the planner reads on an entry, as fields that dispatch entry/update. */
function Knobs({ s, entryId, tz }: { s: MayorlyState; entryId: string; tz: string }) {
  const e = s.entries.find((x) => x.id === entryId)
  if (!e) return null
  const up = (patch: Extract<Action, { type: 'entry/update' }>['patch']) => dispatch({ type: 'entry/update', id: e.id, patch })
  return (
    <div className="cal-knobs">
      <label className="field">
        <span className="field-label caps">Estimate</span>
        <input type="number" min={5} max={1440} step={5} value={e.estimateMin ?? ''} placeholder="min" onChange={(ev) => up({ estimateMin: ev.target.value === '' ? null : Number(ev.target.value) })} />
      </label>
      <label className="field">
        <span className="field-label caps">Due</span>
        <input type="datetime-local" value={e.due ? toLocal(e.due, tz) : ''} onChange={(ev) => up({ due: ev.target.value ? fromLocal(ev.target.value, tz) : null })} />
      </label>
      <label className="field">
        <span className="field-label caps">Not before</span>
        <input type="datetime-local" value={e.notBefore ? toLocal(e.notBefore, tz) : ''} onChange={(ev) => up({ notBefore: ev.target.value ? fromLocal(ev.target.value, tz) : null })} />
      </label>
      <label className="check"><input type="checkbox" checked={!!e.rush} onChange={(ev) => up({ rush: ev.target.checked })} /><span className="check-box" aria-hidden /><span>Up next, ahead of every due</span></label>
      <label className="check"><input type="checkbox" checked={e.splittable !== false} onChange={(ev) => up({ splittable: ev.target.checked })} /><span className="check-box" aria-hidden /><span>May be split into chunks</span></label>
      {e.splittable !== false && (
        <div className="form-row">
          <label className="field"><span className="field-label caps">Chunk min</span><input type="number" min={5} max={1440} step={5} value={e.minChunkMin ?? ''} placeholder={String(s.settings.calendar.minChunkMin)} onChange={(ev) => up({ minChunkMin: ev.target.value === '' ? undefined : Number(ev.target.value) })} /></label>
          <label className="field"><span className="field-label caps">Chunk max</span><input type="number" min={5} max={1440} step={5} value={e.maxChunkMin ?? ''} placeholder="none" onChange={(ev) => up({ maxChunkMin: ev.target.value === '' ? undefined : Number(ev.target.value) })} /></label>
        </div>
      )}
      <label className="check"><input type="checkbox" checked={!!e.offCalendar} onChange={(ev) => up({ offCalendar: ev.target.checked })} /><span className="check-box" aria-hidden /><span>Keep off the calendar</span></label>
    </div>
  )
}

/** A new event of your own: the planner routes around it from the moment it is saved. */
function EventForm({ tz, now, done }: { tz: string; now: number; done: () => void }) {
  const startDefault = Math.ceil(now / (30 * MIN)) * 30 * MIN
  const [title, setTitle] = useState('')
  const [start, setStart] = useState(toLocal(startDefault, tz))
  const [end, setEnd] = useState(toLocal(startDefault + 60 * MIN, tz))
  const [note, setNote] = useState('')
  const a = fromLocal(start, tz)
  const b = fromLocal(end, tz)
  const ok = title.trim() && a !== null && b !== null && b > a
  const save = () => {
    if (!ok || a === null || b === null) return
    dispatch({ type: 'calendar/event-add', title, start: a, end: b, note: note || undefined })
    done()
  }
  return (
    <form className="cal-sel" onSubmit={(ev) => { ev.preventDefault(); save() }} onKeyDown={(ev) => { if (ev.key === 'Escape') done(); ev.stopPropagation() }}>
      <h3 className="side-title caps">New event</h3>
      <p className="field-help">Yours: the planner routes around it and never moves it.</p>
      <label className="field"><span className="field-label caps">Title</span><input autoFocus value={title} onChange={(ev) => setTitle(ev.target.value)} placeholder="Dentist" maxLength={160} /></label>
      <label className="field"><span className="field-label caps">From</span><input type="datetime-local" value={start} onChange={(ev) => setStart(ev.target.value)} /></label>
      <label className="field"><span className="field-label caps">To</span><input type="datetime-local" value={end} onChange={(ev) => setEnd(ev.target.value)} /></label>
      <label className="field"><span className="field-label caps">Note</span><input value={note} onChange={(ev) => setNote(ev.target.value)} placeholder="optional" maxLength={400} /></label>
      <div className="form-actions">
        <button type="submit" className="btn primary" disabled={!ok}>Save</button>
        <button type="button" className="btn ghost" onClick={done}>Cancel</button>
      </div>
    </form>
  )
}

function Selected({ s, item, fmt, fmtDay, tz }: { s: MayorlyState; item: Item; fmt: (t: number) => string; fmtDay: (t: number) => string; tz: string }) {
  const when = `${fmtDay(item.start)}, ${fmt(item.start)} to ${fmt(item.end)}`
  const [editing, setEditing] = useState(false)
  useEffect(() => setEditing(false), [item.id])
  if (item.kind === 'block') {
    const e = s.entries.find((x) => x.id === item.block.entryId)
    if (!e) return null
    const l = s.ledgers.find((x) => x.id === e.ledgerId)
    return (
      <section className="cal-sel">
        <h3 className="side-title caps">{l?.code ?? 'Tray'}  block {item.block.chunk} of {item.block.of}</h3>
        <p className="cal-sel-title">{e.title}</p>
        <p className="field-help">{when}{item.block.late ? '. Past its due.' : ''}</p>
        <div className="form-actions">
          <button type="button" className="btn" onClick={() => dispatch({ type: 'desk/deploy', mode: 'pomodoro', entryId: e.id })}><Play size={14} /> Start now</button>
          <button type="button" className="btn ghost" onClick={() => dispatch({ type: 'calendar/pin', blockId: item.block.id })}><PushPin size={14} /> Pin here</button>
        </div>
        <Knobs s={s} entryId={e.id} tz={tz} />
      </section>
    )
  }
  if (item.kind === 'event') {
    const e = item.event.entryId ? s.entries.find((x) => x.id === item.event.entryId) : null
    if (editing) {
      return <EventEdit event={item.event} tz={tz} done={() => setEditing(false)} />
    }
    return (
      <section className="cal-sel">
        <h3 className="side-title caps">{item.event.origin === 'clerk' ? 'Placed by the clerk' : e ? 'Pinned' : 'Your event'}</h3>
        <p className="cal-sel-title">{item.event.title}</p>
        <p className="field-help">{when}</p>
        {item.event.note && <p className="field-help">{item.event.note}</p>}
        <div className="form-actions">
          {e && <button type="button" className="btn" onClick={() => dispatch({ type: 'desk/deploy', mode: 'pomodoro', entryId: e.id })}><Play size={14} /> Start now</button>}
          <button type="button" className="btn ghost" onClick={() => setEditing(true)}>Edit</button>
          <button type="button" className="btn ghost" onClick={() => dispatch({ type: 'calendar/event-delete', id: item.event.id })}>{e ? 'Unpin' : 'Delete'}</button>
        </div>
        {e && <Knobs s={s} entryId={e.id} tz={tz} />}
      </section>
    )
  }
  return (
    <section className="cal-sel">
      <h3 className="side-title caps">{item.external.free ? 'Outside, free' : 'Outside, busy'}</h3>
      <p className="cal-sel-title">{item.external.title}</p>
      <p className="field-help">{when}. From a subscribed calendar; the planner routes around it.</p>
    </section>
  )
}

function EventEdit({ event, tz, done }: { event: CalEvent; tz: string; done: () => void }) {
  const [title, setTitle] = useState(event.title)
  const [start, setStart] = useState(toLocal(event.start, tz))
  const [end, setEnd] = useState(toLocal(event.end, tz))
  const [note, setNote] = useState(event.note ?? '')
  const a = fromLocal(start, tz)
  const b = fromLocal(end, tz)
  const ok = title.trim() && a !== null && b !== null && b > a
  return (
    <form className="cal-sel" onSubmit={(ev) => { ev.preventDefault(); if (ok && a !== null && b !== null) { dispatch({ type: 'calendar/event-update', id: event.id, patch: { title, start: a, end: b, note } }); done() } }} onKeyDown={(ev) => { if (ev.key === 'Escape') done(); ev.stopPropagation() }}>
      <h3 className="side-title caps">Edit event</h3>
      <label className="field"><span className="field-label caps">Title</span><input autoFocus value={title} onChange={(ev) => setTitle(ev.target.value)} maxLength={160} /></label>
      <label className="field"><span className="field-label caps">From</span><input type="datetime-local" value={start} onChange={(ev) => setStart(ev.target.value)} /></label>
      <label className="field"><span className="field-label caps">To</span><input type="datetime-local" value={end} onChange={(ev) => setEnd(ev.target.value)} /></label>
      <label className="field"><span className="field-label caps">Note</span><input value={note} onChange={(ev) => setNote(ev.target.value)} maxLength={400} /></label>
      <div className="form-actions">
        <button type="submit" className="btn primary" disabled={!ok}>Save</button>
        <button type="button" className="btn ghost" onClick={done}>Cancel</button>
      </div>
    </form>
  )
}
