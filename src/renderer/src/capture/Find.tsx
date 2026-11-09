import { Fragment, useMemo, useState } from 'react'
import { motion } from 'motion/react'
import { MagnifyingGlass, Plus } from '@phosphor-icons/react'
import { balance, findTasks, LEISURE_TOKENS_PER_BLOCK, recentTasks, type FoundTask, type MayorlyState } from '@core/index'
import { actionFor, keyLabel, keysFor, recordUse } from '../lib/keymap'
import { dispatch } from '../store'
import { plan } from './Capture'

// Search and capture in one line. Typing narrows the open tasks and the couch list; Enter starts
// the one selected. A line nothing matches is a new task, read the way the capture box reads it.

type Row = FoundTask | { kind: 'new' }

const rowId = (i: number) => `find-row-${i}`
const titleOf = (f: FoundTask) => (f.kind === 'entry' ? f.entry.title : f.item.title)

export function Find({ s, close }: { s: MayorlyState; close: () => void }) {
  const [text, setText] = useState('')
  const [picked, setPicked] = useState(0)
  const query = text.trim()
  const create = useMemo(() => plan(text, s), [text, s])
  const rows = useMemo<Row[]>(() => {
    if (query.startsWith('/')) return [{ kind: 'new' }]
    const found = findTasks(s, query)
    const exact = found.some((f) => titleOf(f).toLowerCase() === query.toLowerCase())
    return [...found, ...(query && !exact ? [{ kind: 'new' } as const] : [])]
  }, [s, query])
  const at = Math.min(picked, Math.max(0, rows.length - 1))
  // With nothing typed the list starts with what was used last, and says so.
  const recent = query ? 0 : recentTasks(s).length

  const start = (row: Row | undefined) => {
    if (!row) return
    if (row.kind === 'entry') dispatch({ type: 'desk/select', entryId: row.entry.id, ledgerId: row.entry.ledgerId })
    else if (row.kind === 'leisure') dispatch({ type: 'desk/select', leisureId: row.item.id })
    else {
      const go = create.start ?? create.run
      if (!go) return
      go()
    }
    close()
  }

  const onKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.nativeEvent.isComposing) return
    if (e.key === 'Escape') return close()
    const action = actionFor(e.nativeEvent, 'find', s.settings)
    if (!action || (action === 'find.start' && e.repeat)) return
    e.preventDefault()
    recordUse(action)
    if (action === 'find.start') start(rows[at])
    else if (rows.length) setPicked((at + (action === 'find.down' ? 1 : rows.length - 1)) % rows.length)
  }

  const label = (id: string) => keysFor(id, s.settings).map(keyLabel).join(' / ')
  const coins = balance(s)

  return (
    <motion.div
      className="capture find"
      initial={{ opacity: 0, y: -18 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -12, transition: { duration: 0.15 } }}
      transition={{ type: 'spring', stiffness: 260, damping: 26 }}
    >
      <label className="capture-label caps" htmlFor="find-input">Find or start</label>
      <div className="capture-line">
        <MagnifyingGlass size={18} weight="bold" className="capture-caret" aria-hidden />
        <input
          id="find-input"
          autoFocus
          spellCheck={false}
          autoComplete="off"
          role="combobox"
          aria-expanded={rows.length > 0}
          aria-controls="find-list"
          aria-activedescendant={rows.length ? rowId(at) : undefined}
          value={text}
          onChange={(e) => {
            setText(e.target.value)
            setPicked(0)
          }}
          onKeyDown={onKey}
          placeholder="Search your tasks, or type a new one"
        />
      </div>
      <div className="capture-under">
        {rows.length === 0 ? (
          <p className="capture-preview">Nothing open yet. Type a task to create and start it.</p>
        ) : (
          <ul className="find-list" id="find-list" role="listbox" aria-label="Tasks">
            {rows.map((row, i) => {
              const key = row.kind === 'entry' ? row.entry.id : row.kind === 'leisure' ? row.item.id : 'new'
              const props = {
                id: rowId(i),
                role: 'option' as const,
                'aria-selected': i === at,
                className: `find-row ${i === at ? 'is-on' : ''}`,
                onPointerMove: () => setPicked(i),
                onClick: () => start(row),
              }
              const heading = recent === 0 ? null : i === 0 ? 'Recent' : i === recent ? 'Flow' : null
              const titled = (li: React.ReactNode) => (
                <Fragment key={key}>
                  {heading && <li role="presentation" className="find-section caps">{heading}</li>}
                  {li}
                </Fragment>
              )
              if (row.kind === 'new') {
                return (
                  <li key={key} {...props}>
                    <Plus size={14} weight="bold" className="find-code" aria-hidden />
                    <span className="find-title">{query.startsWith('/') ? 'Run' : 'Create and start'}</span>
                    <span className={`find-meta tone-${create.tone}`}>{create.text}</span>
                  </li>
                )
              }
              if (row.kind === 'leisure') {
                const onCouch = s.desk.block?.leisureId === row.item.id
                return titled(
                  <li {...props}>
                    <span className="find-code">COUCH</span>
                    <span className="find-title">{row.item.title}</span>
                    <span className={`find-meta ${coins < LEISURE_TOKENS_PER_BLOCK ? 'tone-error' : ''}`}>
                      {onCouch ? 'On the desk' : coins < LEISURE_TOKENS_PER_BLOCK ? 'No coin' : `${LEISURE_TOKENS_PER_BLOCK} coin`}
                    </span>
                  </li>,
                )
              }
              const ledger = s.ledgers.find((l) => l.id === row.entry.ledgerId)
              const onDesk = s.desk.block?.entryId === row.entry.id
              return titled(
                <li {...props}>
                  <span className="find-code">{ledger?.code ?? 'TRAY'}</span>
                  <span className="find-title">{row.entry.title}</span>
                  <span className="find-meta">{onDesk ? 'On the desk' : row.entry.estimateMin ? `${row.entry.estimateMin}m` : ''}</span>
                </li>,
              )
            })}
          </ul>
        )}
        <footer className="hint-row">
          <span><i className="key">{label('find.start')}</i> Start</span>
          <span><i className="key">{label('find.up')}</i> <i className="key">{label('find.down')}</i> Choose</span>
          <span><i className="key">Esc</i> Close</span>
        </footer>
      </div>
    </motion.div>
  )
}
