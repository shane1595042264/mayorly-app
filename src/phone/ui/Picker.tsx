import { useState } from 'react'
import { Couch, Plus, Repeat, Tray } from '@phosphor-icons/react'
import {
  findTasks, formatSuperset, leisureList, onDeskId, openFlow, parseSuperset, tomatoLabel, entryTomatoes,
  type Entry, type Mode,
} from '@core/index'
import { Glyph } from '../../renderer/src/lib/glyphs'
import { act, useMayorly, useNow } from '../store'
import { LedgerDot, Sheet } from './parts'

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
  const [q, setQ] = useState('')
  const [ssLine, setSsLine] = useState('')
  const [ssError, setSsError] = useState<string | null>(null)
  const onDesk = onDeskId(s)
  const flow = openFlow(s)

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
    act({ type: 'entry/capture', text, start: true })
    onClose()
  }
  const saveSuperset = () => {
    const r = parseSuperset(ssLine, s.ledgers, () => crypto.randomUUID())
    if (!r.ok) return setSsError(r.error)
    act({ type: 'superset/save', superset: r.superset })
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
        {crop > 0 && <span className="row-end num"><b>{tomatoLabel(crop)}</b></span>}
      </button>
    )
  }

  const found = q.trim() ? findTasks(s, q, 12) : null

  return (
    <Sheet title="Pick a task" onClose={onClose}>
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
      <div className="seg" role="radiogroup" aria-label="Mode" style={{ marginTop: 10 }}>
        {MODES.map((m) => (
          <button type="button" key={m.id} role="radio" aria-checked={mode === m.id} onClick={() => setMode(m.id)}>{m.label}</button>
        ))}
      </div>

      {found ? (
        <>
          <h3 className="section-title">Matches</h3>
          <div className="list">
            {found.map((f) => (f.kind === 'entry' ? entryRow(f.entry) : (
              <button type="button" key={f.item.id} className="row" onClick={() => pickLeisure(f.item.id)}>
                <span className="glyph"><Couch size={18} /></span>
                <span className="row-main"><span className="row-title">{f.item.title}</span><span className="row-sub">Couch</span></span>
              </button>
            )))}
            <button type="button" className="row add" onClick={add}>
              <span className="glyph"><Plus size={18} /></span>
              <span className="row-main"><span className="row-title">Add and start “{q.trim()}”</span><span className="row-sub">Filed by its first word if that names a ledger</span></span>
            </button>
          </div>
        </>
      ) : mode === 'superset' ? (
        <>
          <h3 className="section-title">Supersets</h3>
          <div className="list">
            {s.supersets.map((ss) => (
              <button type="button" key={ss.id} className="row" onClick={() => { act({ type: 'desk/deploy', mode: 'superset', supersetId: ss.id }); onClose() }}>
                <span className="glyph"><Repeat size={18} /></span>
                <span className="row-main">
                  <span className="row-title">{ss.name || 'Superset'}</span>
                  <span className="row-sub">{formatSuperset(ss, s.ledgers, s.entries)}</span>
                </span>
              </button>
            ))}
            {s.supersets.length === 0 && <p className="empty">No supersets yet. Write one below.</p>}
          </div>
          <label className="label" htmlFor="ss">New superset</label>
          <input id="ss" className="field" value={ssLine} onChange={(e) => setSsLine(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && saveSuperset()} placeholder="legal 25, dance 20 x3" enterKeyHint="done" autoCapitalize="none" />
          {ssError ? <p className="error">{ssError}</p> : <p className="help">Ledger codes or names with minutes, then the rounds.</p>}
        </>
      ) : (
        <>
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
        </>
      )}
    </Sheet>
  )
}
