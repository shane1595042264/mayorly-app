import { Fragment, useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { Couch, Play, Stop, Storefront, Trash } from '@phosphor-icons/react'
import { balance, blockView, clock, leisureList, marketList, leisureSpentMs, leisureTokensSpent, LEISURE_TOKENS_PER_BLOCK, span, type LeisureItem, type MayorlyState } from '@core/index'
import { hotkeyLabel } from '../lib/keys'
import { actionFor, keyLabel, keymapOpen, keysFor, recordUse } from '../lib/keymap'
import { useListKeys } from '../lib/listkeys'
import { current, dispatch, useNow } from '../store'
import { CueCount, CueToggle, Cues } from './Cues'
import { Market } from './Market'

// Entertainment lives here, outside the ledgers: games, shows, streams. The couch runs
// on the same focus and rest cadence as a pomodoro; each completed leisure block costs one coin,
// taken as it starts, rests are free, and nothing is earned.

/**
 * Leisure has two counters: the couch, which sells time by the block on the desk's timer, and the
 * market, which sells a thing at a price you set (Market.tsx). m switches between them.
 */
export function LeisureTab({ s }: { s: MayorlyState }) {
  const [view, setView] = useState<'couch' | 'market'>('couch')
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.altKey || e.ctrlKey || e.metaKey || keymapOpen()) return
      if ((e.target as HTMLElement | null)?.closest?.('input, textarea, select, [contenteditable]')) return
      const st = current()
      if (!st || actionFor(e, 'list', st.settings) !== 'list.market') return
      e.preventDefault()
      recordUse('list.market')
      setView((v) => (v === 'couch' ? 'market' : 'couch'))
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [])
  const couchN = leisureList(s).length
  const marketN = marketList(s).length
  return (
    <div className="leisure-wrap">
      <div className="leisure-switch" role="tablist" aria-label="Leisure">
        {(['couch', 'market'] as const).map((v) => (
          <button key={v} type="button" role="tab" aria-selected={view === v} className={`leisure-switch-btn caps ${view === v ? 'on' : ''}`} onClick={() => setView(v)}>
            {v === 'couch' ? <Couch size={15} /> : <Storefront size={15} />}
            {v === 'couch' ? 'Couch' : 'Market'}
            <span className="leisure-switch-n mono num">{v === 'couch' ? couchN : marketN}</span>
            {view === v && <motion.span layoutId="leisure-switch-bar" className="leisure-switch-bar" transition={{ type: 'spring', stiffness: 420, damping: 34 }} />}
          </button>
        ))}
        <span className="leisure-switch-hint dim small"><i className="key">{keysFor('list.market', s.settings).map(keyLabel).join(' / ')}</i> switches</span>
      </div>
      <AnimatePresence mode="wait" initial={false}>
        <motion.div key={view} className="leisure-view" initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, transition: { duration: 0.08 } }} transition={{ duration: 0.14 }}>
          {view === 'couch' ? <CouchList s={s} /> : <Market s={s} enabled />}
        </motion.div>
      </AnimatePresence>
    </div>
  )
}

function CouchList({ s }: { s: MayorlyState }) {
  const now = useNow(1000)
  const items = leisureList(s)
  const have = balance(s)
  const v = blockView(s, now)
  const onCouch = v?.block.kind === 'leisure' ? v : null
  const [draft, setDraft] = useState('')
  const [open, setOpen] = useState<string | null>(null)
  const [renaming, setRenaming] = useState<string | null>(null)
  const price = LEISURE_TOKENS_PER_BLOCK
  const onItem = onCouch ? items.find((x) => x.id === onCouch.block.leisureId) : null

  const add = () => {
    if (!draft.trim()) return
    dispatch({ type: 'leisure/add', title: draft })
    setDraft('')
  }

  // The keyboard: Enter sits down with the selected row, x removes it, Space shows its cues.
  const { sel } = useListKeys(items.map((it) => it.id), ({ action, id }) => {
    if (action === 'list.new') {
      document.getElementById('leisure-add')?.focus()
      return true
    }
    const it = id ? items.find((x) => x.id === id) : undefined
    if (!it) return false
    const live = onCouch?.block.leisureId === it.id
    if (action === 'list.go') {
      if (have >= price && !live) dispatch({ type: 'desk/deploy', mode: 'couch', leisureId: it.id })
    } else if (action === 'list.delete') dispatch({ type: 'leisure/delete', id: it.id })
    else if (action === 'list.cues') setOpen((o) => (o === it.id ? null : it.id))
    else if (action === 'list.rename') setRenaming(it.id)
    else return false
    return true
  })

  return (
    <div className="leisure">
      <section className="flow-main">
        <form className="flow-add" onSubmit={(e) => { e.preventDefault(); add() }}>
          <label htmlFor="leisure-add" className="field-label caps">Entertainment</label>
          <div className="flow-add-row">
            <input id="leisure-add" value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="civilization 6" spellCheck={false} autoComplete="off" />
            <button type="submit" className="btn" disabled={!draft.trim()}>Add</button>
          </div>
          <p className="field-help">
            Games, shows, streams, anything with no productive value. Outside the ledgers, never earns. Runs like a pomodoro: {s.settings.focusMin} minutes on, {s.settings.shortRestMin} off. Each completed block costs {price} coin; rests are free, and a block left early costs nothing.
          </p>
        </form>

        <div className="leisure-buy">
          <span className={`mono num ${have < price ? 'field-error' : 'dim'}`}>{have} {have === 1 ? 'coin' : 'coins'} banked: {have} {have === 1 ? 'block' : 'blocks'} on the couch</span>
        </div>

        {onCouch && (
          <div className="leisure-live-wrap">
            <div className="leisure-live">
              <Couch size={18} />
              <span className="caps">On the couch</span>
              <span className="ellipsis">{onCouch.block.label}</span>
              <span className="mono num">{onCouch.remainingMs !== null ? clock(onCouch.remainingMs) : ''}</span>
              <button className="btn ghost" onClick={() => dispatch({ type: 'desk/standDown' })}><Stop size={14} /> Get up</button>
            </div>
            {onItem && onItem.cues.length > 0 && (
              <p className="leisure-cues-live">
                <span className="caps dim">Switch when</span> {onItem.cues.join('  ·  ')}
                {s.desk.holster && <span className="dim">   {hotkeyLabel(s.settings.hotkeys.switch)} goes back to {s.desk.holster.block.label}</span>}
              </p>
            )}
          </div>
        )}

        {items.length === 0 ? (
          <div className="empty">
            <p className="empty-title">Nothing on the couch list.</p>
            <p>Add a game or a show above. The clerk also sends entertainment it recognises here instead of a ledger.</p>
          </div>
        ) : (
          <ol className="flow-list">
            {items.map((it, i) => {
              const spent = leisureSpentMs(s, it.id, now)
              const tokens = leisureTokensSpent(s, it.id)
              const live = onCouch?.block.leisureId === it.id
              const expanded = open === it.id
              return (
                <Fragment key={it.id}>
                <li className={`row leisure-row ${live ? 'live' : ''} ${expanded ? 'expanded' : ''} ${sel === it.id ? 'is-selected' : ''}`} data-row={it.id} aria-current={sel === it.id ? 'true' : undefined}>
                  <span className="row-n mono num dim">{String(i + 1).padStart(2, '0')}</span>
                  <CueToggle open={expanded} onToggle={() => setOpen(expanded ? null : it.id)} />
                  {renaming === it.id ? (
                    <Rename item={it} done={() => setRenaming(null)} />
                  ) : (
                    <span className="row-title ellipsis" onDoubleClick={() => setRenaming(it.id)} title="Double-click to rename">
                      {it.title}
                      <CueCount cues={it.cues} />
                    </span>
                  )}
                  <span className="row-time mono num" title="Time on the couch, and the coins its finished blocks cost (a block left early is free)">
                    {spent >= 60_000 && <span>{span(spent)}</span>}
                    {tokens > 0 && <span className="row-paid">{tokens} {tokens === 1 ? 'coin' : 'coins'} paid</span>}
                  </span>
                  <span className="row-actions">
                    <button
                      className="icon-btn"
                      aria-label={`Sit down with ${it.title}`}
                      title={have < price ? 'Needs a coin: earn one at the desk' : `${s.settings.focusMin} minutes for ${price} coin, then a rest`}
                      disabled={have < price || live}
                      onClick={() => dispatch({ type: 'desk/deploy', mode: 'couch', leisureId: it.id })}
                    >
                      <Play size={14} />
                    </button>
                    <button className="icon-btn" aria-label={`Remove ${it.title}`} title="Remove" onClick={() => dispatch({ type: 'leisure/delete', id: it.id })}>
                      <Trash size={14} />
                    </button>
                  </span>
                </li>
                {expanded && <Cues id={it.id} title={it.title} cues={it.cues} live={live} example="rookie dies in game" />}
                </Fragment>
              )
            })}
          </ol>
        )}
      </section>
    </div>
  )
}

function Rename({ item, done }: { item: LeisureItem; done: () => void }) {
  const [title, setTitle] = useState(item.title)
  return (
    <input
      className="row-edit"
      autoFocus
      value={title}
      onChange={(ev) => setTitle(ev.target.value)}
      onBlur={() => {
        done()
        if (title.trim() && title !== item.title) dispatch({ type: 'leisure/update', id: item.id, patch: { title } })
      }}
      onKeyDown={(ev) => {
        if (ev.key === 'Enter') (ev.target as HTMLInputElement).blur()
        if (ev.key === 'Escape') {
          setTitle(item.title)
          done()
        }
      }}
    />
  )
}

