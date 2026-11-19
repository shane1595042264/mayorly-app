import { useEffect, useRef, useState, type ReactNode } from 'react'
import { ArrowCounterClockwise, Couch, KeyReturn, MagnifyingGlass, Plus, Repeat, Tray, X } from '@phosphor-icons/react'
import {
  findTasks, foldSearch, formatSuperset, leisureList, matchLedger, onDeskId, openFlow, parseSuperset, prefixClerk, recentTasks, tomatoLabel, entryTomatoes,
  type Entry, type FoundTask, type Mode,
} from '@core/index'
import { Glyph } from '../../renderer/src/lib/glyphs'
import { act, useMayorly, useNow } from '../store'
import { captureLine, useClerk } from '../ai'
import { LedgerDot, Sheet, Tomato } from './parts'
import { AnimatePresence, motion } from 'motion/react'
import { captured, tap } from '../feel'

// Picking what the desk is on: every ledger's open entries, the tray, the couch, the saved
// supersets, and a search that adds what it cannot find. A pick sends one desk/select: from an
// idle desk it starts, on a running block it swaps what the block is on and keeps its clock,
// in another mode it starts that mode. Typing a line nothing matches files it by its prefix
// (`legal draft the letter`) and starts it.

const MODES: { id: Mode; label: string }[] = [
  { id: 'pomodoro', label: 'Pomodoro' },
  { id: 'blitz', label: 'Blitz' },
  { id: 'superset', label: 'Superset' },
]

export function Picker({ onClose }: { onClose: () => void }) {
  const live = useMayorly()
  // Once a pick is made the sheet keeps showing what it showed as it slides away: no row flips,
  // moves or appears under the finger.
  const frozen = useRef<typeof live | null>(null)
  const s = frozen.current ?? live
  const freeze = () => { frozen.current = live }
  const now = useNow(5000)
  const running = s.desk.status !== 'idle' && !!s.desk.block
  // A pick during a rest starts a pomodoro (the reducer's rule), so the picker says Pomodoro then.
  const resting = running && s.desk.block?.kind === 'rest'
  const currentMode: Mode = resting || s.desk.plan?.mode === 'couch' ? 'pomodoro' : s.desk.plan?.mode ?? 'pomodoro'
  const [mode, setMode] = useState<Mode>(currentMode)
  // One list per mode, whatever was tapped before: in Superset the saved supersets, and while one
  // runs the tasks first, since a pick then takes the slot that is running.
  const inSuperset = running && currentMode === 'superset'
  const runningSet = inSuperset ? s.supersets.find((x) => x.id === s.desk.plan?.supersetId) ?? null : null
  const [q, setQ] = useState('')
  // The search takes the keyboard as the sheet opens (App focused a stand-in inside the tap, so
  // iOS keeps the keyboard up as focus moves here).
  const field = useRef<HTMLInputElement>(null)
  useEffect(() => { field.current?.focus({ preventScroll: true }) }, [])
  // A new search starts at the top, so what Return starts is always in sight.
  useEffect(() => { field.current?.closest('.sheet-body')?.scrollTo({ top: 0 }) }, [q])
  const [ssLine, setSsLine] = useState('')
  const [ssError, setSsError] = useState<string | null>(null)
  const onDesk = onDeskId(s)
  const keys = (useClerk().ai?.keys.filter((k) => k.status === 'ok').length ?? 0) > 0
  const flow = openFlow(s)
  // The sheet keeps the height it opened with, so a line added from it does not stretch it as it leaves.
  const [short] = useState(() => s.ledgers.length === 0 && flow.length === 0)

  // The mode goes with the pick only when it is a change, so a swap keeps the block's clock.
  // A task picked with Superset chosen and none running has no superset to go into: it starts a
  // pomodoro, as the list under the search says.
  const taskMode: Mode = mode === 'superset' && !inSuperset ? 'pomodoro' : mode
  const withMode = () => (!running || taskMode !== currentMode ? { mode: taskMode } : {})
  const pickEntry = (e: Entry) => {
    if (e.id === onDesk) tap()
    freeze()
    act({ type: 'desk/select', entryId: e.id, ledgerId: e.ledgerId, ...withMode() })
    onClose()
  }
  const pickLeisure = (id: string) => {
    freeze()
    act({ type: 'desk/select', leisureId: id })
    onClose()
  }
  const add = () => {
    const text = q.trim()
    if (!text || !preview.title) return tap()
    freeze()
    void captureLine(text, true)
    onClose()
  }
  const saveSuperset = () => {
    const r = parseSuperset(ssLine, s.ledgers, () => crypto.randomUUID())
    if (!r.ok) return setSsError(r.error)
    act({ type: 'superset/save', superset: r.superset })
    captured()
    // The new superset is the last row; bring it into view.
    setTimeout(() => document.querySelector('.sheet .ss-list > :last-child')?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 60)
    setSsLine('')
    setSsError(null)
  }

  const entryRow = (e: Entry) => {
    const crop = entryTomatoes(s, e.id, now)
    return (
      <button type="button" key={e.id} className={`row ${e.id === onDesk ? 'on' : ''}`} onClick={() => pickEntry(e)}>
        <span className="row-main">
          <span className="row-title">{e.title}</span>
          {e.estimateMin ? <span className="row-sub">{e.estimateMin} min</span> : null}
        </span>
        {crop >= 0.1 && <span className="row-end num row-crop"><Tomato /><b>{tomatoLabel(crop)}</b></span>}
      </button>
    )
  }

  // The search: open tasks and the couch (the one on the desk last), then cleared tasks from the
  // last month and saved supersets by name. Twelve open matches show; more are counted.
  const words = foldSearch(q.replace(/^#?\S+:\s*/, (m) => (matchLedger(m.replace(/[#:\s]/g, ''), s.ledgers) ? '' : m))).split(' ').filter(Boolean)
  const searching = !!q.trim()
  const hits = searching ? findTasks(s, q, 60) : []
  const ordered = [...hits.filter((f) => idOf(f) !== onDesk), ...hits.filter((f) => idOf(f) === onDesk)]
  const found = searching ? ordered.slice(0, 12) : null
  const more = ordered.length - (found?.length ?? 0)
  const monthAgo = now - 30 * 86_400_000
  const holds = (title: string) => words.length > 0 && words.every((w) => foldSearch(title).includes(w))
  const cleared = searching ? s.entries.filter((e) => e.doneAt !== null && e.doneAt >= monthAgo && holds(e.title)).sort((a, b) => b.doneAt! - a.doneAt!).slice(0, 3) : []
  const sets = searching ? s.supersets.filter((x) => holds(x.name)) : []
  // What Return starts: the first open task, else a superset or a cleared task by that name, else
  // the task already on the desk, and only when nothing at all matches, a new line.
  const top: FoundTask | null = found?.[0] && idOf(found[0]) !== onDesk ? found[0] : null
  const target = top ? 'task' : sets[0] ? 'set' : cleared[0] ? 'cleared' : found?.[0] ? 'desk' : 'add'
  // How a new line would be filed: its ledger by prefix, its estimate, else the clerk or the tray.
  // The preview asks the same rules the reducer files by, so it says exactly where the line goes.
  const preview = (() => {
    const f = prefixClerk.file(q.trim(), s.ledgers)
    const ledger = s.ledgers.find((l) => l.id === f.ledgerId)
    const named = !!ledger || !!f.leisure
    const where = f.leisure ? 'Couch, one coin a block' : ledger ? ledger.name : keys ? 'The clerk files it' : 'Tray'
    // How to file by ledger is said once, on the only row, when nothing else matches.
    const hint = !named && !keys && s.ledgers[0] && (hits.length === 0) ? `; ${s.ledgers[0].code.toLowerCase()}: files it in ${s.ledgers[0].name}` : ''
    return { title: f.title, sub: `${where}${f.estimateMin ? `, ${f.estimateMin} min` : ''}${hint}` }
  })()
  // A line that is exactly a task you have (open or cleared) is not offered as a new one.
  const exact = [...hits.map((f) => (f.kind === 'entry' ? f.entry.title : f.item.title)), ...cleared.map((e) => e.title)].some((t) => foldSearch(t) === foldSearch(preview.title))
  const recent = !searching ? recentTasks(s, 6).filter((f) => idOf(f) !== onDesk).slice(0, 3) : []
  const supersets = (
        <>
          <h3 className="section-title">Supersets</h3>
          <div className="list ss-list">
            {s.supersets.map((ss) => (
              <button type="button" key={ss.id} className="row" onClick={() => { act({ type: 'desk/deploy', mode: 'superset', supersetId: ss.id }); onClose() }}>
                <span className="glyph"><Repeat size={18} /></span>
                <span className="row-main">
                  <span className="row-title">{ss.name || 'Superset'}{ss.id === runningSet?.id ? ', running' : ''}</span>
                  <span className="row-sub">{formatSuperset(ss, s.ledgers, s.entries).replace(/ rest (\d+)/, ', rest $1').replace(/ rr (\d+)/, ', long rest $1')}</span>
                </span>
              </button>
            ))}
            {s.supersets.length === 0 && <p className="empty">No supersets yet. Write one below.</p>}
          </div>
          <label className="label" htmlFor="ss">New superset</label>
          <input id="ss" className="field" value={ssLine} onChange={(e) => { setSsLine(e.target.value); setSsError(null) }} onKeyDown={(e) => e.key === 'Enter' && saveSuperset()} placeholder="legal 25, dance 20 x3" enterKeyHint="done" autoCapitalize="none" />
          {ssError ? <p className="error">{ssError}</p> : <p className="help">Ledger codes or names with minutes, then the rounds.</p>}
        </>
  )

  const pick = (f: FoundTask) => (f.kind === 'entry' ? pickEntry(f.entry) : pickLeisure(f.item.id))
  const reopen = (e: Entry) => {
    freeze()
    act({ type: 'entry/reopen', id: e.id })
    act({ type: 'desk/select', entryId: e.id, ledgerId: e.ledgerId, ...withMode() })
    onClose()
  }
  const deploySet = (id: string) => { freeze(); act({ type: 'desk/deploy', mode: 'superset', supersetId: id }); onClose() }
  const enter = () => {
    if (!searching) return tap()
    if (target === 'task' && top) return pick(top)
    if (target === 'set') return deploySet(sets[0].id)
    if (target === 'cleared') return reopen(cleared[0])
    if (target === 'desk' && found?.[0]) return pick(found[0])
    add()
  }
  const resultRow = (key: string, i: number, icon: ReactNode, title: string, sub: string, onClick: () => void, opts: { on?: boolean; end?: ReactNode; add?: boolean } = {}) => (
    <motion.button type="button" key={key} className={`row search-row ${opts.on ? 'on' : ''} ${opts.add ? 'add' : ''}`} onClick={onClick} initial={{ opacity: 0.3, y: 6 }} animate={{ opacity: 1, y: 0, transition: { duration: 0.18, delay: Math.min(i, 8) * 0.02, ease: [0.22, 1, 0.36, 1] } }} whileTap={{ scale: 0.98 }}>
      <span className="glyph">{icon}</span>
      <span className="row-main">
        <span className="row-title">{opts.add ? title : marked(title, words)}</span>
        {/* The subtitle is marked only for a word the title does not show (a ledger name, "tray"). */}
        <span className="row-sub">{opts.add ? sub : marked(sub, words.filter((w) => w.length >= 2 && !foldSearch(title).includes(w)))}</span>
      </span>
      {opts.end}
    </motion.button>
  )
  const returnMark = <span className="return-mark" aria-label="Return picks this"><KeyReturn size={16} /></span>

  return (
    <Sheet title="Pick a task" short={short} onClose={onClose}>
      <div className="picker-head">
      <label className="search-field">
        <MagnifyingGlass size={18} className="search-icon" aria-hidden />
        <input
          ref={field}
          data-esc-clears=""
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') enter()
            // Escape empties the search first; a second Escape closes the sheet.
            if (e.key === 'Escape' && q) { e.preventDefault(); setQ('') }
          }}
          placeholder="Find or add a task"
          aria-label="Find or add a task"
          enterKeyHint="go"
          autoCapitalize="sentences"
          autoCorrect="off"
        />
        <AnimatePresence initial={false}>
          {searching && (
            <motion.button key="clear" type="button" className="search-clear" aria-label="Clear the search" initial={{ scale: 0.4, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.4, opacity: 0 }} whileTap={{ scale: 0.85 }} onMouseDown={(e) => e.preventDefault()} onClick={() => { tap(); setQ(''); field.current?.focus() }}>
              <X size={14} weight="bold" />
            </motion.button>
          )}
        </AnimatePresence>
      </label>
      <div className="seg pilled" role="radiogroup" aria-label="Mode" style={{ marginTop: 10 }}>
        {MODES.map((m) => (
          <button type="button" key={m.id} role="radio" aria-checked={mode === m.id} onClick={() => { tap(); setMode(m.id) }}>
            {mode === m.id && <motion.i layoutId="mode-pill" className="seg-pill" transition={{ type: 'spring', stiffness: 520, damping: 38 }} />}
            <span>{m.label}</span>
          </button>
        ))}
      </div>
      </div>

      {found ? (
        <>
          <h3 className="section-title">{found.length || cleared.length || sets.length ? 'Matches' : 'Nothing matches'}</h3>
          <div className="list">
            {/* Rows come in with a short rise; a row that no longer matches is gone at once, so no
                two rows are ever drawn over each other while you type. */}
              {found.map((f, i) => {
                if (f.kind === 'leisure') return resultRow(f.item.id, i, <Couch size={18} />, f.item.title, f.item.id === onDesk ? 'On the desk now' : 'Couch, one coin a block', () => pick(f), { on: f.item.id === onDesk, end: top === f || (target === 'desk' && i === 0) ? returnMark : null })
                const e = f.entry
                const l = s.ledgers.find((x) => x.id === e.ledgerId)
                const crop = entryTomatoes(s, e.id, now)
                const sub = e.id === onDesk ? 'On the desk now' : `${l?.name ?? 'Tray'}${e.estimateMin ? `, ${e.estimateMin} min` : ''}`
                const end = top === f || (target === 'desk' && i === 0) ? returnMark : crop >= 0.1 ? <span className="row-end num row-crop"><Tomato /><b>{tomatoLabel(crop)}</b></span> : null
                return resultRow(e.id, i, l ? <span className="glyph-dot" style={{ color: 'var(--muted)' }}><Glyph name={l.glyph} size={18} /><LedgerDot ledger={l} /></span> : <Tray size={18} />, e.title, sub, () => pick(f), { on: e.id === onDesk, end })
              })}
              {sets.map((x, i) => resultRow(`set-${x.id}`, found.length + i, <Repeat size={18} />, x.name || 'Superset', x.id === runningSet?.id ? 'Superset, running now' : 'Superset, starts at its first slot', () => (x.id === runningSet?.id ? (tap(), onClose()) : deploySet(x.id)), { end: target === 'set' && i === 0 ? returnMark : null }))}
              {cleared.map((e, i) => resultRow(`done-${e.id}`, found.length + sets.length + i, <ArrowCounterClockwise size={18} />, e.title, `Cleared ${new Date(e.doneAt!).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}, reopens it`, () => reopen(e), { end: target === 'cleared' && i === 0 ? returnMark : null }))}
              {preview.title && !exact && resultRow('add', found.length + sets.length + cleared.length, <Plus size={18} />, `Add and start “${preview.title}”`, preview.sub, add, { add: true, end: target === 'add' ? returnMark : null })}
          </div>
          {more > 0 && <p className="help" style={{ padding: '10px 4px 0' }}>{found.length} of {ordered.length} shown. Keep typing to narrow it.</p>}
        </>
      ) : mode === 'superset' && !inSuperset ? (
        supersets
      ) : (
        <>
          <AnimatePresence initial={false}>
            {resting && (
              <motion.p key="rest-hint" className="help" style={{ padding: '14px 4px 0', overflow: 'hidden' }} initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}>
                A pick ends the rest and starts a pomodoro.
              </motion.p>
            )}
            {inSuperset && mode === 'superset' && (
              <motion.p key="slot-hint" className="help" style={{ padding: '14px 4px 0', overflow: 'hidden' }} initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}>
                A pick goes into the slot of {runningSet?.name || 'the superset'} that is running.
              </motion.p>
            )}
          </AnimatePresence>
          {recent.length > 0 && (
            <section>
              <h3 className="section-title">Recent</h3>
              <div className="list">
                {recent.map((f) => (f.kind === 'entry' ? entryRow(f.entry) : (
                  <button type="button" key={f.item.id} className="row" onClick={() => pickLeisure(f.item.id)}>
                    <span className="row-main"><span className="row-title">{f.item.title}</span><span className="row-sub">Couch</span></span>
                  </button>
                )))}
              </div>
            </section>
          )}
          {s.ledgers.map((l) => {
            const entries = flow.filter((e) => e.ledgerId === l.id)
            return (
              <section key={l.id}>
                <h3 className="section-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <LedgerDot ledger={l} /><Glyph name={l.glyph} size={15} />{l.name}
                </h3>
                <div className="list">
                  {entries.map(entryRow)}
                  {entries.length === 0 && (
                    <button type="button" className="row add" onClick={() => { act({ type: 'desk/select', ledgerId: l.id, ...withMode() }); onClose() }}>
                      <span className="row-main"><span className="row-title">Ledger time</span><span className="row-sub">No open entries; the time still counts</span></span>
                    </button>
                  )}
                </div>
              </section>
            )
          })}
          {flow.some((e) => e.ledgerId === null) && (
            <section>
              <h3 className="section-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}><Tray size={15} />Tray</h3>
              <div className="list">{flow.filter((e) => e.ledgerId === null).map(entryRow)}</div>
            </section>
          )}
          {leisureList(s).length > 0 && (
            <section>
              <h3 className="section-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}><Couch size={15} />Couch, one coin a block</h3>
              <div className="list">
                {leisureList(s).map((x) => (
                  <button type="button" key={x.id} className={`row ${x.id === onDesk ? 'on' : ''}`} onClick={() => pickLeisure(x.id)}>
                    <span className="row-main"><span className="row-title">{x.title}</span></span>
                  </button>
                ))}
              </div>
            </section>
          )}
          {s.ledgers.length === 0 && flow.length === 0 && <p className="empty" style={{ marginTop: 16 }}>Nothing here yet. Type a task above to add it and start.</p>}
          {inSuperset && mode === 'superset' && supersets}
        </>
      )}
    </Sheet>
  )
}

const idOf = (f: FoundTask) => (f.kind === 'entry' ? f.entry.id : f.item.id)

/**
 * A title with the searched words drawn bright and bold. The words are matched against the title
 * folded the way search folds it (no punctuation), and mapped back, so "followup" lights up
 * "follow-up".
 */
function marked(title: string, words: string[]): ReactNode {
  if (!words.length) return title
  let folded = ''
  const at: number[] = []
  for (let i = 0; i < title.length; i++) {
    const c = title[i]
    if (/['\u2018\u2019-]/.test(c)) continue
    if (/[\p{L}\p{N}]/u.test(c)) { folded += c.toLowerCase(); at.push(i) }
    else if (!folded.endsWith(' ')) { folded += ' '; at.push(i) }
  }
  const marks: [number, number][] = []
  for (const w of words) {
    const f = folded.indexOf(w)
    if (f >= 0) marks.push([at[f], at[f + w.length - 1] + 1])
  }
  if (!marks.length) return title
  marks.sort((a, b) => a[0] - b[0])
  const out: ReactNode[] = []
  let i = 0
  for (const [a, b] of marks) {
    if (a < i) continue
    if (a > i) out.push(title.slice(i, a))
    out.push(<b key={a} className="hit">{title.slice(a, b)}</b>)
    i = b
  }
  if (i < title.length) out.push(title.slice(i))
  return out
}
