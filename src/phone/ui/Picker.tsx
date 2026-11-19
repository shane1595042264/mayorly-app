import { useEffect, useRef, useState, type ReactNode } from 'react'
import { ArrowCounterClockwise, Couch, KeyReturn, MagnifyingGlass, Plus, Repeat, Tray, X } from '@phosphor-icons/react'
import {
  findTasks, foldSearch, formatSuperset, oneEdit, parseEstimate, startOfDay, leisureList, matchLedger, onDeskId, openFlow, parseSuperset, prefixClerk, recentTasks, tomatoLabel, entryTomatoes,
  type Entry, type FoundTask, type Mode,
} from '@core/index'
import { Glyph } from '../../renderer/src/lib/glyphs'
import { act, useMayorly, useNow } from '../store'
import { captureLine, useClerk } from '../ai'
import { LedgerDot, Sheet, Tomato } from './parts'
import { AnimatePresence, motion } from 'motion/react'
import { announce, captured, tap } from '../feel'

// Picking what the desk is on: every ledger's open entries, the tray, the couch, the saved
// supersets, and a search that adds what it cannot find. A pick sends one desk/select: from an
// idle desk it starts, on a running block it swaps what the block is on and keeps its clock,
// in another mode it starts that mode. Typing a line nothing matches files it by its prefix
// (`legal: draft the letter`) and starts it.

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
  // A picker acts once: a second Return or tap while the sheet leaves does nothing.
  const freeze = () => {
    if (frozen.current) return false
    frozen.current = live
    return true
  }
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
  // Picking what is already on the desk resumes it in place and still takes you to the timer.
  const pickEntry = (e: Entry) => {
    const same = e.id === onDesk
    if (!freeze()) return
    if (same) tap()
    act({ type: 'desk/select', entryId: e.id, ledgerId: e.ledgerId, ...withMode() })
    if (same) announce('start')
    onClose()
  }
  const pickLeisure = (id: string) => {
    if (!freeze()) return
    act({ type: 'desk/select', leisureId: id })
    if (id === onDesk) announce('start')
    onClose()
  }
  const add = () => {
    const text = q.trim()
    if (!text || !preview.title) return tap()
    if (!freeze()) return
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
  const words = foldSearch(parseEstimate(q).rest.replace(/^#?\S+:\s*/, (m) => (matchLedger(m.replace(/[#:\s]/g, ''), s.ledgers) || /^#?tray:?\s*$/i.test(m) ? '' : m))).split(' ').filter(Boolean)
  const searching = !!q.trim()
  const hits = searching ? findTasks(s, q, 60) : []
  const ordered = [...hits.filter((f) => idOf(f) !== onDesk), ...hits.filter((f) => idOf(f) === onDesk)]
  const found = searching ? ordered.slice(0, 12) : null
  const more = ordered.length - (found?.length ?? 0)
  const monthAgo = now - 30 * 86_400_000
  const holds = (title: string) => words.length > 0 && words.every((w) => foldSearch(title).includes(w))
  // A search that is just a ledger's name or code ("legal", "car:") offers that ledger's own time
  // and what was cleared in it lately, so a ledger with nothing open is not a dead end.
  const namedLedger = /^#?[^\s:]+:?$/.test(q.trim()) ? matchLedger(q.trim().replace(/[#:]/g, ''), s.ledgers) : null
  const cleared = searching ? s.entries.filter((e) => e.doneAt !== null && e.doneAt >= monthAgo && (holds(e.title) || (!!namedLedger && e.ledgerId === namedLedger.id))).sort((a, b) => b.doneAt! - a.doneAt!).slice(0, 3) : []
  const sets = searching ? s.supersets.filter((x) => holds(x.name)) : []
  // What Return starts: the first open task, else a superset or a cleared task by that name, else
  // the task already on the desk, and only when nothing at all matches, a new line.
  const top: FoundTask | null = found?.[0] && idOf(found[0]) !== onDesk ? found[0] : null
  // A new line is offered only when it reads as a task: four letters or more, not a ledger's name.
  const nothing = hits.length === 0 && cleared.length === 0 && sets.length === 0
  const couchWord = ['couch', 'leisure'].includes(foldSearch(q))
  const canAdd = (foldSearch(q).length >= 4 || (nothing && foldSearch(q).length >= 3)) && !namedLedger && !couchWord
  // Any row that matches is what you meant; a new line is offered only when nothing does.
  const showAdd = canAdd && nothing
  const target = top ? 'task' : sets[0] ? 'set' : cleared[0] ? 'cleared' : found?.[0] ? 'desk' : namedLedger ? 'ledger' : showAdd ? 'add' : 'none'
  // How a new line would be filed: its ledger by prefix, its estimate, else the clerk or the tray.
  // The preview asks the same rules the reducer files by, so it says exactly where the line goes.
  const preview = (() => {
    const f = prefixClerk.file(q.trim(), s.ledgers)
    const ledger = s.ledgers.find((l) => l.id === f.ledgerId)
    const named = !!ledger || !!f.leisure
    const where = f.leisure ? 'Goes to the couch, one coin a block' : ledger ? `Goes to ${ledger.name}` : keys ? 'The clerk files it' : 'Goes to the tray'
    // How to file by ledger is a line of its own under the list, shown when nothing matched.
    // A first word that names a ledger, typed without its colon, gets the hint for that ledger.
    const first = matchLedger(q.trim().split(/\s+/)[0] ?? '', s.ledgers)
    const shown = first ?? s.ledgers[0]
    const hint = !named && !keys && shown ? `Start with ${(first ? q.trim().split(/\s+/)[0] : shown.code).toLowerCase()}: to file it in ${shown.name}.` : ''
    return { title: f.title, sub: `${where}${f.estimateMin && !f.leisure ? `, ${f.estimateMin} min` : ''}`, hint }
  })()
  // A line that is exactly a task you have (open or cleared) is not offered as a new one.
  const exact = [...hits.map((f) => (f.kind === 'entry' ? f.entry.title : f.item.title)), ...cleared.map((e) => e.title)].some((t) => foldSearch(t) === foldSearch(preview.title))
  // Recent is a shortcut for a long list; in a short one it only repeats the rows under it.
  const recent = !searching && flow.length > 8 ? recentTasks(s, 6).filter((f) => idOf(f) !== onDesk).slice(0, 3) : []
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
    if (!freeze()) return
    act({ type: 'entry/reopen', id: e.id })
    act({ type: 'desk/select', entryId: e.id, ledgerId: e.ledgerId, ...withMode() })
    onClose()
  }
  const deploySet = (id: string) => { if (!freeze()) return; act({ type: 'desk/deploy', mode: 'superset', supersetId: id }); onClose() }
  // The superset already running is where you are: Return or a tap only takes you to the timer.
  const toTimer = () => {
    if (!freeze()) return
    tap()
    announce('start')
    onClose()
  }
  const pickLedger = (id: string) => {
    if (!freeze()) return
    act({ type: 'desk/select', ledgerId: id, ...withMode() })
    onClose()
  }
  // Return lights the row it starts for a moment, then starts it, so you see what it took.
  const [flash, setFlash] = useState<string | null>(null)
  const enter = () => {
    if (!searching || target === 'none') return tap()
    const go: [string, () => void] =
      target === 'task' && top ? [idOf(top), () => pick(top)]
      : target === 'set' ? [`set-${sets[0].id}`, () => (sets[0].id === runningSet?.id ? toTimer() : deploySet(sets[0].id))]
      : target === 'cleared' ? [`done-${cleared[0].id}`, () => reopen(cleared[0])]
      : target === 'desk' && found?.[0] ? [idOf(found[0]), () => pick(found[0])]
      : target === 'ledger' && namedLedger ? ['lt', () => pickLedger(namedLedger.id)]
      : ['add', add]
    if (frozen.current || flash) return
    setFlash(go[0])
    setTimeout(go[1], 60)
  }
  const resultRow = (key: string, i: number, icon: ReactNode, title: string, sub: string, onClick: () => void, opts: { on?: boolean; end?: ReactNode; add?: boolean } = {}) => (
    <motion.button type="button" key={key} className={`row search-row ${opts.on ? 'on' : ''} ${opts.add ? 'add' : ''} ${flash === key ? 'pressing' : ''}`} onClick={onClick} initial={{ opacity: 0.3, y: 6 }} animate={{ opacity: 1, y: 0, transition: { duration: 0.18, delay: Math.min(i, 8) * 0.02, ease: [0.22, 1, 0.36, 1] } }} whileTap={{ scale: 0.98 }}>
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
    <Sheet title="Pick a task" short={short} className="picker-sheet" onClose={onClose}>
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
            {mode === m.id && <motion.i layoutId="mode-pill" layoutDependency={mode} className="seg-pill" transition={{ type: 'spring', stiffness: 520, damping: 38 }} />}
            <span>{m.label}</span>
          </button>
        ))}
      </div>
      </div>

      {/* What a pick will do here, said above the list whether you are searching or not, so the
          first letter typed never shifts the rows. */}
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
        {searching && mode === 'superset' && !inSuperset && (
          <motion.p key="no-set" className="help" style={{ padding: '12px 4px 0', overflow: 'hidden' }} initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}>
            No superset is running, so a task picked here starts a pomodoro.
          </motion.p>
        )}
      </AnimatePresence>

      {found ? (
        <>
          <h3 className="section-title">{found.length || cleared.length || sets.length ? 'Matches' : 'Nothing matches'}</h3>
          {couchWord && !hits.length && <p className="empty">The couch list is empty. Add to it with couch: and what you would enjoy, like couch: watch an episode.</p>}
          {!preview.title && !found.length && <p className="empty">Type what the task is, then the estimate: call the notary ~30m.</p>}
          <div className="list">
            {/* Rows come in with a short rise; a row that no longer matches is gone at once, so no
                two rows are ever drawn over each other while you type. */}
              {found.map((f, i) => {
                if (f.kind === 'leisure') return resultRow(f.item.id, i, <Couch size={18} />, f.item.title, f.item.id === onDesk ? 'On the desk now' : 'Couch, one coin a block', () => pick(f), { on: f.item.id === onDesk, end: top === f || (target === 'desk' && i === 0) ? returnMark : null })
                const e = f.entry
                const l = s.ledgers.find((x) => x.id === e.ledgerId)
                const crop = entryTomatoes(s, e.id, now)
                // A search by ledger code (lgl) shows the code, so the mark shows why the row is here.
                const byCode = !!l && words.some((w) => w.length >= 2 && l.code.toLowerCase().startsWith(w) && !foldSearch(e.title).includes(w))
                const sub = e.id === onDesk ? 'On the desk now' : `${l ? `${l.name}${byCode ? ` (${l.code})` : ''}` : 'Tray'}${e.estimateMin ? `, ${e.estimateMin} min` : ''}`
                const end = top === f || (target === 'desk' && i === 0) ? returnMark : crop >= 0.1 ? <span className="row-end num row-crop"><Tomato /><b>{tomatoLabel(crop)}</b></span> : null
                return resultRow(e.id, i, l ? <span className="glyph-dot" style={{ color: 'var(--muted)' }}><Glyph name={l.glyph} size={18} /><LedgerDot ledger={l} /></span> : <Tray size={18} />, e.title, sub, () => pick(f), { on: e.id === onDesk, end })
              })}
              {sets.map((x, i) => resultRow(`set-${x.id}`, found.length + i, <Repeat size={18} />, x.name || 'Superset', x.id === runningSet?.id ? 'Superset, running now' : 'Superset, starts at its first slot', () => (x.id === runningSet?.id ? toTimer() : deploySet(x.id)), { end: target === 'set' && i === 0 ? returnMark : null }))}
              {cleared.map((e, i) => resultRow(`done-${e.id}`, found.length + sets.length + i, <ArrowCounterClockwise size={18} />, e.title, `Cleared ${e.doneAt! >= startOfDay(now) ? 'today' : new Date(e.doneAt!).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}, reopens it`, () => reopen(e), { end: target === 'cleared' && i === 0 ? returnMark : null }))}
              {namedLedger && resultRow('lt', found.length + sets.length + cleared.length, <span className="glyph-dot" style={{ color: 'var(--muted)' }}><Glyph name={namedLedger.glyph} size={18} /><LedgerDot ledger={namedLedger} /></span>, 'Ledger time', `${namedLedger.name}, the time counts to the ledger itself`, () => pickLedger(namedLedger.id), { end: target === 'ledger' ? returnMark : null })}
              {preview.title && showAdd && !exact && resultRow('add', found.length + sets.length + cleared.length, <Plus size={18} />, `Add and start “${preview.title}”`, preview.sub, add, { add: true, end: target === 'add' ? returnMark : null })}
          </div>
          {!found.length && !cleared.length && !sets.length && !namedLedger && preview.hint && canAdd && <p className="help" style={{ padding: '10px 4px 0' }}>{preview.hint}</p>}
          {more > 0 && <p className="help" style={{ padding: '10px 4px 0' }}>{found.length} of {ordered.length} shown. Keep typing to narrow it.</p>}
        </>
      ) : mode === 'superset' && !inSuperset ? (
        supersets
      ) : (
        <>
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
export function marked(title: string, words: string[]): ReactNode {
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
    // Every place the word appears, not only the first.
    let found = false
    for (let f = folded.indexOf(w); f >= 0; f = folded.indexOf(w, f + w.length)) {
      // A word of one or two letters lights only where a word starts, never mid-word.
      if (w.length <= 2 && f > 0 && folded[f - 1] !== ' ') continue
      marks.push([at[f], at[f + w.length - 1] + 1])
      found = true
    }
    if (found) continue
    // A typo: mark the word it was near, so it shows why the row is here.
    if (w.length < 4) continue
    let p = 0
    for (const t of folded.split(' ')) {
      const near = oneEdit(w, t) || oneEdit(w, t.slice(0, w.length)) || oneEdit(w, t.slice(0, w.length + 1))
      if (near && t) { marks.push([at[p], at[p + Math.min(t.length, w.length + 1) - 1] + 1]); break }
      p += t.length + 1
    }
  }
  if (!marks.length) return title
  marks.sort((a, b) => a[0] - b[0])
  // Runs next to each other (only a space between) read as one.
  for (let k = marks.length - 1; k > 0; k--) {
    if (/^\s*$/.test(title.slice(marks[k - 1][1], marks[k][0]))) {
      marks[k - 1] = [marks[k - 1][0], Math.max(marks[k - 1][1], marks[k][1])]
      marks.splice(k, 1)
    }
  }
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
