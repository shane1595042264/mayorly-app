import { useState } from 'react'
import { Couch, Plus, Repeat, Tray } from '@phosphor-icons/react'
import {
  findTasks, formatSuperset, leisureList, onDeskId, openFlow, parseSuperset, tomatoLabel, entryTomatoes,
  type Entry, type Mode,
} from '@core/index'
import { Glyph } from '../../renderer/src/lib/glyphs'
import { act, useMayorly, useNow } from '../store'
import { captureLine, useClerk } from '../ai'
import { LedgerDot, Sheet } from './parts'
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
  const s = useMayorly()
  const now = useNow(5000)
  const running = s.desk.status !== 'idle' && !!s.desk.block
  const currentMode: Mode = s.desk.plan?.mode === 'couch' ? 'pomodoro' : s.desk.plan?.mode ?? 'pomodoro'
  const [mode, setMode] = useState<Mode>(currentMode)
  // One list per mode, whatever was tapped before: in Superset the saved supersets, and while one
  // runs the tasks first, since a pick then takes the slot that is running.
  const inSuperset = running && currentMode === 'superset'
  const runningSet = inSuperset ? s.supersets.find((x) => x.id === s.desk.plan?.supersetId) ?? null : null
  const [q, setQ] = useState('')
  const [ssLine, setSsLine] = useState('')
  const [ssError, setSsError] = useState<string | null>(null)
  const onDesk = onDeskId(s)
  const keys = (useClerk().ai?.keys.filter((k) => k.status === 'ok').length ?? 0) > 0
  const flow = openFlow(s)
  // The sheet keeps the height it opened with, so a line added from it does not stretch it as it leaves.
  const [short] = useState(() => s.ledgers.length === 0 && flow.length === 0)

  // The mode goes with the pick only when it is a change, so a swap keeps the block's clock.
  const withMode = () => (!running || mode !== currentMode ? { mode } : {})
  const pickEntry = (e: Entry) => {
    act({ type: 'desk/select', entryId: e.id, ledgerId: e.ledgerId, ...withMode() })
    onClose()
  }
  const pickLeisure = (id: string) => {
    act({ type: 'desk/select', leisureId: id })
    onClose()
  }
  const add = () => {
    const text = q.trim()
    if (!text) return
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
        {crop >= 0.1 && <span className="row-end num"><b>{tomatoLabel(crop)}</b></span>}
      </button>
    )
  }

  const found = q.trim() ? findTasks(s, q, 12) : null
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

  return (
    <Sheet title="Pick a task" short={short} onClose={onClose}>
      <input
        className="field"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && (found?.[0] ? (found[0].kind === 'entry' ? pickEntry(found[0].entry) : pickLeisure(found[0].item.id)) : add())}
        placeholder="Find or add a task"
        aria-label="Find or add a task"
        enterKeyHint="go"
        autoCapitalize="sentences"
      />
      <div className="seg pilled" role="radiogroup" aria-label="Mode" style={{ marginTop: 10 }}>
        {MODES.map((m) => (
          <button type="button" key={m.id} role="radio" aria-checked={mode === m.id} onClick={() => { tap(); setMode(m.id) }}>
            {mode === m.id && <motion.i layoutId="mode-pill" className="seg-pill" transition={{ type: 'spring', stiffness: 520, damping: 38 }} />}
            <span>{m.label}</span>
          </button>
        ))}
      </div>

      {found ? (
        <>
          <h3 className="section-title">{found.length ? 'Matches' : 'Nothing matches'}</h3>
          <div className="list">
            {found.map((f) => (f.kind === 'entry' ? entryRow(f.entry) : (
              <button type="button" key={f.item.id} className="row" onClick={() => pickLeisure(f.item.id)}>
                <span className="glyph"><Couch size={18} /></span>
                <span className="row-main"><span className="row-title">{f.item.title}</span><span className="row-sub">Couch</span></span>
              </button>
            )))}
            <button type="button" className="row add" onClick={add}>
              <span className="glyph"><Plus size={18} /></span>
              <span className="row-main"><span className="row-title">Add and start “{q.trim()}”</span><span className="row-sub">{keys ? 'The clerk files it' : 'legal: or #legal files it, else the tray'}</span></span>
            </button>
          </div>
        </>
      ) : mode === 'superset' && !inSuperset ? (
        supersets
      ) : (
        <>
          <AnimatePresence initial={false}>
            {inSuperset && mode === 'superset' && (
              <motion.p key="slot-hint" className="help" style={{ padding: '14px 4px 0', overflow: 'hidden' }} initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}>
                A pick goes into the slot of {runningSet?.name || 'the superset'} that is running.
              </motion.p>
            )}
          </AnimatePresence>
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
