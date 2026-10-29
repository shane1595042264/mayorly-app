import { useEffect, useRef, useState } from 'react'
import { motion } from 'motion/react'
import { Check, Plus, X } from '@phosphor-icons/react'
import { blockView, type MayorlyState } from '@core/index'
import { dispatch } from '../store'

// The quick drawer: what is on the desk, with room to write under it. An entry gets a few
// lines of notes and a checklist; a leisure item gets its context switch rules. It drops
// down (or up) from the pet, never the whole deck. Esc or a click outside closes it.

export function Drawer({ s, close }: { s: MayorlyState; close: () => void }) {
  const v = blockView(s, Date.now())
  const entry = v?.entry ?? null
  const leisure = v?.block.kind === 'leisure' ? s.leisure.find((x) => x.id === v.block.leisureId) ?? null : null
  const ledger = v?.ledger ?? null
  const box = useRef<HTMLDivElement>(null)

  return (
    <motion.section
      ref={box}
      className="drawer"
      role="dialog"
      aria-label="Quick drawer"
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -6, transition: { duration: 0.12 } }}
      transition={{ type: 'spring', stiffness: 300, damping: 28 }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.preventDefault()
          close()
        }
        e.stopPropagation()
      }}
    >
      {leisure ? (
        <>
          <header className="drawer-head">
            <span className="drawer-kicker caps">Couch</span>
            <h2 className="drawer-title">{leisure.title}</h2>
          </header>
          <p className="drawer-label caps">Switch when</p>
          <Lines
            items={leisure.cues ?? []}
            placeholder="A rule, in your words: one game, then the desk"
            onAdd={(text) => dispatch({ type: 'leisure/cue-add', id: leisure.id, text })}
            onEdit={(i, text) => dispatch({ type: 'leisure/cue-edit', id: leisure.id, index: i, text })}
            onDelete={(i) => dispatch({ type: 'leisure/cue-delete', id: leisure.id, index: i })}
          />
        </>
      ) : entry ? (
        <>
          <header className="drawer-head">
            <span className="drawer-kicker caps">{ledger?.code ?? 'Tray'}</span>
            <h2 className="drawer-title">{entry.title}</h2>
          </header>
          <Notes key={entry.id} id={entry.id} text={entry.notes ?? ''} />
          <p className="drawer-label caps">Checklist</p>
          <Lines
            items={(entry.subtasks ?? []).map((t) => t.text)}
            done={(entry.subtasks ?? []).map((t) => t.done)}
            placeholder="A step"
            onAdd={(text) => dispatch({ type: 'entry/subtask-add', id: entry.id, text })}
            onEdit={(i, text) => dispatch({ type: 'entry/subtask-edit', id: entry.id, subId: entry.subtasks![i].id, text })}
            onToggle={(i) => dispatch({ type: 'entry/subtask-toggle', id: entry.id, subId: entry.subtasks![i].id })}
            onDelete={(i) => dispatch({ type: 'entry/subtask-delete', id: entry.id, subId: entry.subtasks![i].id })}
          />
        </>
      ) : (
        <>
          <header className="drawer-head">
            <span className="drawer-kicker caps">Desk</span>
            <h2 className="drawer-title">{v ? v.block.label : 'Nothing on the desk'}</h2>
          </header>
          <p className="drawer-empty">{v ? 'Ledger time, no entry: nothing to write under.' : 'Deploy something first; the drawer is for what is on the desk.'}</p>
        </>
      )}
      <footer className="drawer-foot hint-row">
        <span><i className="key">Enter</i> Add</span>
        <span><i className="key">Esc</i> Close</span>
      </footer>
    </motion.section>
  )
}

function Notes({ id, text }: { id: string; text: string }) {
  const [value, setValue] = useState(text)
  useEffect(() => setValue(text), [text])
  const commit = () => {
    if (value.trim() !== text.trim()) dispatch({ type: 'entry/note', id, text: value })
  }
  return (
    <textarea
      className="drawer-notes"
      value={value}
      placeholder="Notes"
      rows={3}
      spellCheck={false}
      onChange={(e) => setValue(e.target.value)}
      onBlur={commit}
    />
  )
}

/** A short editable list: click a line to edit it, Enter in the last box adds one. */
function Lines(props: {
  items: string[]
  done?: boolean[]
  placeholder: string
  onAdd: (text: string) => void
  onEdit: (i: number, text: string) => void
  onToggle?: (i: number) => void
  onDelete: (i: number) => void
}) {
  const { items, done, placeholder, onAdd, onEdit, onToggle, onDelete } = props
  const [draft, setDraft] = useState('')
  return (
    <ol className="drawer-lines">
      {items.map((text, i) => (
        <li key={i} className={`drawer-line ${done?.[i] ? 'done' : ''}`}>
          {onToggle && (
            <button type="button" className={`drawer-tick ${done?.[i] ? 'on' : ''}`} aria-label={done?.[i] ? 'Not done' : 'Done'} onClick={() => onToggle(i)}>
              {done?.[i] && <Check size={12} weight="bold" />}
            </button>
          )}
          <Line text={text} onCommit={(t) => onEdit(i, t)} />
          <button type="button" className="icon-btn drawer-x" aria-label="Remove" onClick={() => onDelete(i)}>
            <X size={13} />
          </button>
        </li>
      ))}
      <li className="drawer-line drawer-add">
        <Plus size={13} className="drawer-plus" aria-hidden />
        <input
          autoFocus
          value={draft}
          placeholder={placeholder}
          spellCheck={false}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && draft.trim()) {
              e.preventDefault()
              onAdd(draft)
              setDraft('')
            }
          }}
        />
      </li>
    </ol>
  )
}

function Line({ text, onCommit }: { text: string; onCommit: (t: string) => void }) {
  const [value, setValue] = useState(text)
  useEffect(() => setValue(text), [text])
  return (
    <input
      className="drawer-text"
      value={value}
      spellCheck={false}
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => { if (value.trim() && value.trim() !== text) onCommit(value) }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
      }}
    />
  )
}
