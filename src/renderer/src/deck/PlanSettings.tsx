import { useState } from 'react'
import type { HoursWindow, MayorlyState, PlanMode, WorkSchedule } from '@core/index'
import { dispatch } from '../store'

// How the calendar is planned: your hours, your job's hours, session lengths, range and
// mode. The same fields in Settings and in the Calendar tab's own panel.

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
const minutesOf = (t: string) => {
  const [h, m] = t.split(':').map(Number)
  return Number.isFinite(h) && Number.isFinite(m) ? h * 60 + m : NaN
}
const RANGES: [number, string][] = [[1, 'This day'], [2, 'A day ahead'], [7, 'The week ahead'], [14, 'Two weeks']]
const MODES: [PlanMode, string][] = [['done', 'Get it done'], ['rotate', 'Rotate']]
const length = (m: number) => (m % 60 === 0 ? `${m / 60} h` : m > 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m} min`)

/** One window a day; the reducer keeps any extra ones a request added. */
function HoursGrid({ hours, onChange, fresh, name }: { hours: HoursWindow[][]; onChange: (h: HoursWindow[][]) => void; fresh: HoursWindow; name: string }) {
  const setDay = (d: number, w: HoursWindow | null) => onChange(hours.map((list, i) => (i === d ? (w ? [w, ...list.slice(1)] : []) : list)))
  return (
    <div className="hours-grid">
      {DAY_NAMES.map((day, d) => {
        const w = hours[d]?.[0]
        return (
          <div key={day} className="hours-row">
            <label className="check">
              <input type="checkbox" checked={!!w} onChange={(e) => setDay(d, e.target.checked ? fresh : null)} aria-label={`${name} on ${day}`} />
              <span className="check-box" aria-hidden />
              <span className="hours-day caps">{day}</span>
            </label>
            {w ? (
              <>
                <input type="time" value={hhmm(w.start)} onChange={(e) => { const m = minutesOf(e.target.value); if (Number.isFinite(m)) setDay(d, { start: m, end: Math.max(m + 15, w.end) }) }} aria-label={`${name} ${day} start`} />
                <span className="dim">to</span>
                <input type="time" value={hhmm(w.end)} onChange={(e) => { const m = minutesOf(e.target.value); if (Number.isFinite(m)) setDay(d, { start: Math.min(w.start, m - 15), end: m }) }} aria-label={`${name} ${day} end`} />
              </>
            ) : (
              <span className="dim">off</span>
            )}
          </div>
        )
      })}
    </div>
  )
}

/** Minutes, typed freely and clamped to the five-minute grid on commit. */
function Minutes({ label, value, min, max, onChange }: { label: string; value: number; min: number; max: number; onChange: (n: number) => void }) {
  const [text, setText] = useState<string | null>(null)
  const commit = () => {
    if (text === null) return
    const n = Math.min(max, Math.max(min, Math.round(Number(text) / 5) * 5 || min))
    setText(null)
    if (n !== value) onChange(n)
  }
  return (
    <label className="field">
      <span className="field-label caps">{label}</span>
      <input className="mono num" type="number" min={min} max={max} step={5} value={text ?? String(value)} onFocus={(e) => { setText(String(value)); e.target.select() }} onChange={(e) => setText(e.target.value)} onBlur={commit} onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} />
      <span className="field-help">{length(value)}</span>
    </label>
  )
}

/** The calendar settings and what changes them, shared by every part below. */
function usePlan(s: MayorlyState) {
  const c = s.settings.calendar
  const set = (patch: Partial<typeof c>) => dispatch({ type: 'settings/update', patch: { calendar: { ...c, ...patch } } })
  const setWork = (patch: Partial<WorkSchedule>) => {
    const work = { ...c.work, ...patch }
    // The first work day: the ledgers for paid work are the likely work ledgers.
    if (patch.hours && work.ledgerIds.length === 0 && !c.work.hours.some((d) => d.length)) work.ledgerIds = s.ledgers.filter((l) => l.pays === false).map((l) => l.id)
    set({ work })
  }
  const hasWork = c.work.hours.some((d) => d.length > 0)
  return { c, set, setWork, hasWork }
}

/** What each part is for, in words: the Calendar tab shows it over the part, Settings beside it. */
export const PLAN_HELP = {
  work: "Your job's hours. The clerk plans only entries from the work ledgers here, and nothing else. You can still work on anything, any time. To take a day off, click that day's work on the calendar.",
  hours: (s: MayorlyState) => {
    const c = s.settings.calendar
    return `When the clerk may plan your own entries${c.work.hours.some((d) => d.length > 0) ? ', outside work' : ''}. Kept in ${c.tz || "this machine's zone"} and synced with the account.`
  },
  sessions: "Planned time is sessions, not pomodoros, back to back. The clerk picks each entry's length between these when it files it; an entry without an estimate gets the shortest.",
}

export function WorkFields({ s }: { s: MayorlyState }) {
  const { c, setWork, hasWork } = usePlan(s)
  const toggleLedger = (id: string) => setWork({ ledgerIds: c.work.ledgerIds.includes(id) ? c.work.ledgerIds.filter((x) => x !== id) : [...c.work.ledgerIds, id] })
  return (
    <>
      <HoursGrid name="Work" hours={c.work.hours} onChange={(hours) => setWork({ hours })} fresh={{ start: 7 * 60, end: 16 * 60 }} />
      {hasWork && (
        <>
          <div className="work-ledgers" role="group" aria-label="Work ledgers">
            <span className="field-label caps">Work ledgers</span>
            <div className="chips">
              {s.ledgers.map((l) => (
                <button key={l.id} type="button" className={`chip ${c.work.ledgerIds.includes(l.id) ? 'on' : ''}`} aria-pressed={c.work.ledgerIds.includes(l.id)} onClick={() => toggleLedger(l.id)} title={l.name}>
                  <b className="mono">{l.code}</b> {l.name}
                </button>
              ))}
            </div>
            {c.work.ledgerIds.length === 0 && <span className="field-help">None chosen: work time stays empty on the plan.</span>}
          </div>
          <label className="check">
            <input type="checkbox" checked={c.work.usHolidays} onChange={(e) => setWork({ usHolidays: e.target.checked })} />
            <span className="check-box" aria-hidden />
            <span>No work on US federal holidays</span>
          </label>
        </>
      )}
    </>
  )
}

export function HoursFields({ s }: { s: MayorlyState }) {
  const { c, set } = usePlan(s)
  return <HoursGrid name="Your hours" hours={c.hours} onChange={(hours) => set({ hours })} fresh={{ start: 9 * 60, end: 17 * 60 }} />
}

export function SessionFields({ s }: { s: MayorlyState }) {
  const { c, set } = usePlan(s)
  return (
    <div className="form-row">
      <Minutes label="Shortest" value={c.sessionMin} min={5} max={480} onChange={(n) => set({ sessionMin: n, sessionMax: Math.max(n, c.sessionMax) })} />
      <Minutes label="Longest" value={c.sessionMax} min={5} max={480} onChange={(n) => set({ sessionMax: n, sessionMin: Math.min(n, c.sessionMin) })} />
    </div>
  )
}

/** How far ahead, in what order, and whether work may run past its due. */
export function PlanFields({ s }: { s: MayorlyState }) {
  const { c, set } = usePlan(s)
  return (
    <>
      <div className="form-row">
        <div className="field">
          <span className="field-label caps">Plan</span>
          <div className="seg" role="radiogroup" aria-label="How far the clerk plans">
            {RANGES.map(([days, label]) => (
              <button key={days} role="radio" aria-checked={c.horizonDays === days} className={c.horizonDays === days ? 'on' : ''} onClick={() => set({ horizonDays: days })}>{label}</button>
            ))}
          </div>
          <span className="field-help">{RANGES.some(([d]) => d === c.horizonDays) ? 'How far ahead the plan reaches. What does not fit waits.' : `${c.horizonDays} days, including today.`}</span>
        </div>
        <div className="field">
          <span className="field-label caps">Mode</span>
          <div className="seg" role="radiogroup" aria-label="Planning mode">
            {MODES.map(([mode, label]) => (
              <button key={mode} role="radio" aria-checked={c.mode === mode} className={c.mode === mode ? 'on' : ''} onClick={() => set({ mode })}>{label}</button>
            ))}
          </div>
          <span className="field-help">{c.mode === 'rotate' ? 'One entry per ledger in turn, then the rest. Up next goes first. Rotation can delay a due; Get it done puts deadlines first.' : "Earliest due first, up next ahead of all, the flow's order after."}</span>
        </div>
      </div>
      <label className="check" title="On, work keeps being placed past its due and is marked late. Off, nothing is placed past a due and the rest is reported as no room.">
        <input type="checkbox" checked={c.spill} onChange={(e) => set({ spill: e.target.checked })} />
        <span className="check-box" aria-hidden />
        <span>Keep placing past a due, marked late</span>
      </label>
    </>
  )
}

/** All of it in one column: the Calendar tab's own panel. Settings lays the same parts out as rows. */
export function PlanSettings({ s }: { s: MayorlyState }) {
  return (
    <div className="plan-settings">
      <div data-setting="work schedule, work hours, job, holidays, day off">
        <h4 className="field-label caps">Work</h4>
        <p className="field-help">{PLAN_HELP.work}</p>
        <WorkFields s={s} />
      </div>
      <div data-setting="your hours, planner hours, available">
        <h4 className="field-label caps">Your hours</h4>
        <p className="field-help">{PLAN_HELP.hours(s)}</p>
        <HoursFields s={s} />
      </div>
      <div data-setting="sessions, session length, shortest, longest">
        <h4 className="field-label caps">Sessions</h4>
        <p className="field-help">{PLAN_HELP.sessions}</p>
        <SessionFields s={s} />
      </div>
      <PlanFields s={s} />
    </div>
  )
}
