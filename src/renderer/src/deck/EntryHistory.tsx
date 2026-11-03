import { useEffect, useRef, useState } from 'react'
import { ArrowCounterClockwise, ArrowLeft, Check, Trash } from '@phosphor-icons/react'
import { entryActivity, entrySpentMs, entryTomatoes, span, TRASH_KEEP_MS, type Entry, type MayorlyState, type Subtask, type TrashedEntry } from '@core/index'
import { actionFor, keymapOpen, recordUse } from '../lib/keymap'
import { useListKeys } from '../lib/listkeys'
import { current, dispatch, useNow } from '../store'
import { Tomatoes } from './Tomatoes'

// The history: everything ever cleared, with its time, its tomatoes and what it said when it
// was cleared; and the trash, where a deleted entry waits thirty days with all of that. Nothing
// is lost by looking. j and k walk the rows, Enter opens one, u restores (a cleared entry back
// into the flow, a deleted one out of the trash), x deletes, t turns to the trash and back,
// / searches, Backspace goes back, like from inside a ledger.

type View = 'cleared' | 'trash'
const DAY = 86_400_000

const when = (at: number) => new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(at)
const whenFull = (at: number) => new Intl.DateTimeFormat(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(at)

export function EntryHistory({ s, ledgerId, initialOpen, back }: { s: MayorlyState; ledgerId?: string; initialOpen?: string; back: () => void }) {
  const now = useNow(5000)
  const [view, setView] = useState<View>('cleared')
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState<string | null>(initialOpen || null)
  const search = useRef<HTMLInputElement>(null)

  const inLedger = (e: Entry) => !ledgerId || e.ledgerId === ledgerId
  const cleared = s.entries.filter((e) => e.doneAt !== null && inLedger(e)).sort((a, b) => b.doneAt! - a.doneAt!)
  const trash = s.trash.filter(inLedger).sort((a, b) => b.deletedAt - a.deletedAt)
  const rows: Entry[] = view === 'cleared' ? cleared : trash
  const needle = query.trim().toLowerCase()
  const shown = needle ? rows.filter((e) => [e.title, e.notes ?? '', ...(e.subtasks ?? []).map((t) => t.text)].join(' ').toLowerCase().includes(needle)) : rows
  const ledger = ledgerId ? s.ledgers.find((l) => l.id === ledgerId) : null

  const restore = (e: Entry) => dispatch(view === 'trash' ? { type: 'entry/restore', id: e.id } : { type: 'entry/reopen', id: e.id })
  const remove = (e: Entry) => dispatch(view === 'trash' ? { type: 'trash/drop', id: e.id } : { type: 'entry/delete', id: e.id })
  const show = (v: View) => {
    setView(v)
    setOpen(null)
  }

  const { sel, setSel } = useListKeys(shown.map((e) => e.id), ({ action, id }) => {
    const e = id ? shown.find((x) => x.id === id) : undefined
    if (action === 'list.trash') {
      show(view === 'trash' ? 'cleared' : 'trash')
      return true
    }
    if (action === 'list.search') {
      search.current?.focus()
      return true
    }
    if (!e) return false
    if (action === 'list.go') setOpen((o) => (o === e.id ? null : e.id))
    else if (action === 'list.restore') restore(e)
    else if (action === 'list.delete') remove(e)
    else return false
    return true
  })
  useEffect(() => {
    if (initialOpen) setSel(initialOpen)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Backspace goes back, as from inside a ledger; not while typing in the search box.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (keymapOpen() || e.altKey || e.ctrlKey || e.metaKey) return
      if ((e.target as HTMLElement | null)?.closest?.('input, textarea, select')) return
      const st = current()
      const a = st ? actionFor(e, 'shelf', st.settings) : null
      if (a !== 'shelf.back') return
      e.preventDefault()
      recordUse(a)
      back()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [back])

  return (
    <section className="history" aria-label="History">
      <header className="history-head">
        <button type="button" className="btn ghost" onClick={back}><ArrowLeft size={14} /> Back</button>
        <h3 className="side-title caps">{ledger ? `${ledger.name}, history` : 'History'}</h3>
        <div className="seg" role="radiogroup" aria-label="Cleared or the trash">
          <button type="button" role="radio" aria-checked={view === 'cleared'} className={view === 'cleared' ? 'on' : ''} onClick={() => show('cleared')}>Cleared <span className="mono num dim">{cleared.length}</span></button>
          <button type="button" role="radio" aria-checked={view === 'trash'} className={view === 'trash' ? 'on' : ''} onClick={() => show('trash')}>Trash <span className="mono num dim">{trash.length}</span></button>
        </div>
        <input
          ref={search}
          type="search"
          className="history-search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search title, notes, checklist"
          aria-label="Search the history"
          spellCheck={false}
          onKeyDown={(e) => {
            if (e.key === 'Escape' || e.key === 'Enter') {
              e.currentTarget.blur()
              e.stopPropagation()
            }
          }}
        />
      </header>
      <p className="field-help">
        {view === 'trash'
          ? 'A deleted entry waits here thirty days with its time and its tomatoes, then goes for good. u restores it, x drops it now.'
          : 'Everything cleared, with its time, its tomatoes and what it said when it was cleared. u reopens an entry into the flow, x moves it to the trash.'}
        {` j and k walk the rows, Enter opens one, t turns to the ${view === 'trash' ? 'cleared' : 'trash'}, / searches, Backspace goes back.`}
      </p>
      {shown.length === 0 && <p className="dim small">{needle ? 'Nothing matches.' : view === 'trash' ? 'The trash is empty.' : 'Nothing cleared yet.'}</p>}
      <ol className="flow-list history-list">
        {shown.map((e) => {
          const t = view === 'trash' ? (e as TrashedEntry) : null
          const code = s.ledgers.find((l) => l.id === e.ledgerId)?.code ?? 'TRY'
          const isOpen = open === e.id
          const left = t ? Math.max(0, Math.ceil((t.deletedAt + TRASH_KEEP_MS - now) / DAY)) : 0
          return (
            <li
              key={e.id}
              className={`row done history-row ${sel === e.id ? 'is-selected' : ''} ${isOpen ? 'is-open' : ''}`}
              data-row={e.id}
              aria-current={sel === e.id ? 'true' : undefined}
              onClick={() => {
                setSel(e.id)
                setOpen(isOpen ? null : e.id)
              }}
            >
              <span className="mono dim row-n">{code}</span>
              <span className="row-title">{e.title}</span>
              <span className="history-when mono num dim">{t ? `deleted ${when(t.deletedAt)}, ${left} ${left === 1 ? 'day' : 'days'} left` : `cleared ${when(e.doneAt!)}`}</span>
              <span className="row-time mono num">
                <Tomatoes n={entryTomatoes(s, e.id, now)} showZero />
                {span(entrySpentMs(s, e.id, now))}
              </span>
              <span className="row-actions">
                <button type="button" className="icon-btn" aria-label={t ? `Restore ${e.title}` : `Reopen ${e.title}`} title={t ? 'Restore (u)' : 'Reopen into the flow (u)'} onClick={(ev) => { ev.stopPropagation(); restore(e) }}>
                  <ArrowCounterClockwise size={14} />
                </button>
                <button type="button" className="icon-btn" aria-label={t ? `Drop ${e.title} for good` : `Delete ${e.title}`} title={t ? 'Gone for good (x)' : 'To the trash (x)'} onClick={(ev) => { ev.stopPropagation(); remove(e) }}>
                  <Trash size={14} />
                </button>
              </span>
              {isOpen && <Detail s={s} e={e} now={now} />}
            </li>
          )
        })}
      </ol>
    </section>
  )
}

/** What the entry says and what the desk recorded on it, oldest at the bottom. */
function Detail({ s, e, now }: { s: MayorlyState; e: Entry; now: number }) {
  const activity = entryActivity(s, e)
  return (
    <div className="history-detail" onClick={(ev) => ev.stopPropagation()}>
      <div>
        <h4 className="field-label caps">Notes</h4>
        <p className="history-notes">{e.notes?.trim() ? e.notes : 'None.'}</p>
        <h4 className="field-label caps">Checklist</h4>
        <Checklist subtasks={e.subtasks} />
      </div>
      <div>
        <h4 className="field-label caps">Record</h4>
        <ol className="history-activity">
          {activity.map((a) => {
            const then = a.kind === 'cleared' && a.snapshot && ((a.snapshot.notes ?? '') !== (e.notes ?? '') || JSON.stringify(a.snapshot.subtasks ?? []) !== JSON.stringify(e.subtasks ?? [])) ? a.snapshot : null
            return (
              <li key={a.id}>
                <span className="mono num dim">{whenFull(a.at)}</span>
                <span>
                  {a.kind === 'focus' ? `Desk, ${span(Math.max(0, (a.segment.end ?? now) - a.at))}` : a.kind === 'created' ? 'Captured' : a.kind === 'cleared' ? 'Cleared' : 'Reopened'}
                  {then && (
                    <span className="history-then">
                      <span className="dim">As it was then: </span>
                      {then.notes?.trim() ? <span className="history-notes">{then.notes}</span> : <span className="dim">no notes</span>}
                      <Checklist subtasks={then.subtasks} />
                    </span>
                  )}
                </span>
              </li>
            )
          })}
        </ol>
      </div>
    </div>
  )
}

function Checklist({ subtasks }: { subtasks?: Subtask[] }) {
  if (!subtasks?.length) return <p className="dim small">None.</p>
  return (
    <ul className="history-checklist">
      {subtasks.map((t) => (
        <li key={t.id} className={t.done ? 'done' : ''}>
          <span className="history-tick" aria-label={t.done ? 'Done' : 'Open'}>{t.done ? <Check size={12} /> : null}</span>
          <span>{t.text}</span>
        </li>
      ))}
    </ul>
  )
}
