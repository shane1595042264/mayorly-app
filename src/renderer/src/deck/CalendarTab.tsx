import { useMemo, useState } from 'react'
import { CalendarBlank, CaretLeft, CaretRight, Lock, Play, PushPin, Sparkle, Warning } from '@phosphor-icons/react'
import { openFlow, span, type CalBlock, type CalEvent, type ExternalEvent, type MayorlyState } from '@core/index'
import { startOfDayIn, wallClock, zonedEpoch } from '../../../shared/windows'
import { actionFor, recordUse } from '../lib/keymap'
import { useListKeys } from '../lib/listkeys'
import { ledgerVars } from '../lib/themes'
import { current, dispatch, useNow } from '../store'

// The calendar: a week of the plan. Blocks are what the planner placed (derived, redrawn on
// every replan), events are yours and never move, outside events are busy time from Google.
// Read with j and k, deploy with Enter; [ and ] turn the week, t comes back to today. The
// planner's own doing shows in the banner: what does not fit, and why.

const MIN = 60_000
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

  const { sel } = useListKeys(items.map((i) => i.id), ({ action, id }) => {
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

  // The week keys, from the keymap's cal scope.
  const onKey = (e: React.KeyboardEvent) => {
    const typing = (e.target as HTMLElement | null)?.closest?.('input, textarea, select')
    if (typing) return
    const st = current()
    const a = st ? actionFor(e.nativeEvent, 'cal', st.settings) : null
    if (a === 'cal.prevWeek') setWeekOffset((w) => w - 1)
    else if (a === 'cal.nextWeek') setWeekOffset((w) => w + 1)
    else if (a === 'cal.today') setWeekOffset(0)
    else if (a === 'cal.pin') {
      const it = items.find((i) => i.id === sel)
      if (it?.kind === 'block') dispatch({ type: 'calendar/pin', blockId: it.block.id })
      else if (it?.kind === 'event' && it.event.entryId) dispatch({ type: 'calendar/event-delete', id: it.event.id })
    } else return
    e.preventDefault()
    recordUse(a)
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
    <div className="cal" onKeyDown={onKey} tabIndex={-1}>
      <div className="cal-main">
        <header className="cal-head">
          <button type="button" className="icon-btn" aria-label="Previous week" onClick={() => setWeekOffset((w) => w - 1)}><CaretLeft size={16} /></button>
          <h2 className="cal-week">{fmtDay(days[0])} to {fmtDay(days[6])}</h2>
          <button type="button" className="icon-btn" aria-label="Next week" onClick={() => setWeekOffset((w) => w + 1)}><CaretRight size={16} /></button>
          {weekOffset !== 0 && <button type="button" className="btn ghost" onClick={() => setWeekOffset(0)}>Today</button>}
          <span className="cal-planned dim">
            {cal.horizonEnd ? `Planned to ${fmtDay(cal.horizonEnd)}` : 'Not planned yet'}
            {!tz && '  (no zone yet; it is set on the first launch)'}
          </span>
        </header>
        {overflow.length > 0 && (
          <p className="cal-overflow" role="status">
            <Warning size={14} weight="fill" />
            {overflow.length === 1 ? 'One entry does not fit: ' : `${overflow.length} entries do not fit: `}
            {overflow.map((o, i) => `${i ? ', ' : ''}${o.entry!.title} (${o.kind === 'past-due' ? `${span(o.minutes * MIN)} past its due` : `${span(o.minutes * MIN)} with no room before ${cal.horizonEnd ? fmtDay(cal.horizonEnd) : 'the horizon'}`})`)}
          </p>
        )}
        <div className="cal-grid" style={{ ['--rows' as string]: rows, ['--hour' as string]: `${HOUR_PX}px` }}>
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
                {items.filter((it) => it.end > d && it.start < dayEnd).map((it) => {
                  const style = { top: top(it.start), height: height(it.start, it.end) }
                  const isSel = it.id === sel
                  if (it.kind === 'block') {
                    const e = entryOf(it.block.entryId)
                    const l = ledgerOf(e?.ledgerId ?? null)
                    const live = s.desk.block?.entryId === it.block.entryId && s.desk.status !== 'idle'
                    return (
                      <div key={it.id} className={`cal-item cal-block ${isSel ? 'is-selected' : ''} ${it.block.late ? 'late' : ''} ${live ? 'live' : ''}`} style={{ ...style, ...ledgerVars(l) }} data-row={it.id} title={`${e?.title ?? ''} ${fmt(it.start)} to ${fmt(it.end)}`}>
                        <span className="cal-item-t mono num">{fmt(it.start)}</span>
                        <span className="cal-item-title">{l && <b className="mono">{l.code} </b>}{e?.title ?? '(gone)'}</span>
                        {it.block.of > 1 && <span className="cal-item-n mono num">{it.block.chunk}/{it.block.of}</span>}
                        {it.block.late && <Warning size={12} weight="fill" className="cal-item-icon" />}
                      </div>
                    )
                  }
                  if (it.kind === 'event') {
                    return (
                      <div key={it.id} className={`cal-item cal-event ${isSel ? 'is-selected' : ''} ${it.event.entryId ? 'pinned' : ''}`} style={style} data-row={it.id} title={`${it.event.title} ${fmt(it.start)} to ${fmt(it.end)}`}>
                        <span className="cal-item-t mono num">{fmt(it.start)}</span>
                        <span className="cal-item-title">{it.event.title}</span>
                        {it.event.origin === 'clerk' ? <Sparkle size={12} className="cal-item-icon" /> : it.event.entryId ? <PushPin size={12} className="cal-item-icon" /> : <Lock size={12} className="cal-item-icon" />}
                      </div>
                    )
                  }
                  return (
                    <div key={it.id} className={`cal-item cal-external ${it.external.free ? 'free' : ''} ${isSel ? 'is-selected' : ''}`} style={style} data-row={it.id} title={it.external.title}>
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
        {selected ? (
          <Selected s={s} item={selected} fmt={fmt} fmtDay={fmtDay} />
        ) : (
          <>
            <h3 className="side-title caps">The plan</h3>
            <p className="field-help">Entries with an estimate are placed into your hours, earliest due first, in the order of the flow. Your own events are never moved. Select a block with j and k; Enter starts it, p pins it where it is.</p>
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
      </aside>
    </div>
  )
}

function Selected({ s, item, fmt, fmtDay }: { s: MayorlyState; item: Item; fmt: (t: number) => string; fmtDay: (t: number) => string }) {
  const when = `${fmtDay(item.start)}, ${fmt(item.start)} to ${fmt(item.end)}`
  if (item.kind === 'block') {
    const e = s.entries.find((x) => x.id === item.block.entryId)
    if (!e) return null
    const l = s.ledgers.find((x) => x.id === e.ledgerId)
    return (
      <section className="cal-sel">
        <h3 className="side-title caps">{l?.code ?? 'Tray'}  block {item.block.chunk} of {item.block.of}</h3>
        <p className="cal-sel-title">{e.title}</p>
        <p className="field-help">{when}{item.block.late ? '. Past its due.' : ''}</p>
        <p className="field-help">{e.estimateMin ? `${e.estimateMin}m estimated` : ''}{e.due ? `, due ${fmtDay(e.due)} ${fmt(e.due)}` : ''}</p>
        <div className="form-actions">
          <button type="button" className="btn" onClick={() => dispatch({ type: 'desk/deploy', mode: 'pomodoro', entryId: e.id })}><Play size={14} /> Start now</button>
          <button type="button" className="btn ghost" onClick={() => dispatch({ type: 'calendar/pin', blockId: item.block.id })}><PushPin size={14} /> Pin here</button>
        </div>
      </section>
    )
  }
  if (item.kind === 'event') {
    const e = item.event.entryId ? s.entries.find((x) => x.id === item.event.entryId) : null
    return (
      <section className="cal-sel">
        <h3 className="side-title caps">{item.event.origin === 'clerk' ? 'Placed by the clerk' : e ? 'Pinned' : 'Your event'}</h3>
        <p className="cal-sel-title">{item.event.title}</p>
        <p className="field-help">{when}</p>
        {item.event.note && <p className="field-help">{item.event.note}</p>}
        <div className="form-actions">
          {e && <button type="button" className="btn" onClick={() => dispatch({ type: 'desk/deploy', mode: 'pomodoro', entryId: e.id })}><Play size={14} /> Start now</button>}
          <button type="button" className="btn ghost" onClick={() => dispatch({ type: 'calendar/event-delete', id: item.event.id })}>{e ? 'Unpin' : 'Delete'}</button>
        </div>
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

export { zonedEpoch }
