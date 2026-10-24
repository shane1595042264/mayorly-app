import { useState } from 'react'
import { CaretDown, CaretRight, Couch, Play, Plus, Stop, Trash, X } from '@phosphor-icons/react'
import { balance, blockView, clock, leisureList, leisureSpentMs, leisureTokensSpent, LEISURE_TOKENS_PER_BLOCK, span, type LeisureItem, type MayorlyState } from '@core/index'
import { hotkeyLabel } from '../lib/keys'
import { dispatch, useNow } from '../store'

// Entertainment lives here, outside the ledgers: games, shows, streams. The couch runs
// on the same focus and rest cadence as a pomodoro; each leisure block costs one token,
// taken as it starts, rests are free, and nothing is earned.

export function LeisureTab({ s }: { s: MayorlyState }) {
  const now = useNow(1000)
  const items = leisureList(s)
  const have = balance(s)
  const v = blockView(s, now)
  const onCouch = v?.block.kind === 'leisure' ? v : null
  const [draft, setDraft] = useState('')
  const [open, setOpen] = useState<string | null>(null)
  const price = LEISURE_TOKENS_PER_BLOCK
  const onItem = onCouch ? items.find((x) => x.id === onCouch.block.leisureId) : null

  const add = () => {
    if (!draft.trim()) return
    dispatch({ type: 'leisure/add', title: draft })
    setDraft('')
  }

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
            Games, shows, streams, anything with no productive value. Outside the ledgers, never earns. Runs like a pomodoro: {s.settings.focusMin} minutes on, {s.settings.shortRestMin} off. Each block costs {price} token, taken as it starts; rests are free.
          </p>
        </form>

        <div className="leisure-buy">
          <span className={`mono num ${have < price ? 'field-error' : 'dim'}`}>{have} tokens banked: {have} {have === 1 ? 'block' : 'blocks'} on the couch</span>
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
                <li key={it.id} className={`row ${live ? 'live leisure-row' : 'leisure-row'} ${expanded ? 'expanded' : ''}`}>
                  <span className="row-n mono num dim">{String(i + 1).padStart(2, '0')}</span>
                  <button className="icon-btn" aria-label={expanded ? 'Hide context switch rules' : 'Show context switch rules'} title="Context switch rules" onClick={() => setOpen(expanded ? null : it.id)}>
                    {expanded ? <CaretDown size={14} /> : <CaretRight size={14} />}
                  </button>
                  <span className="row-title ellipsis">{it.title}{it.cues.length > 0 && <span className="dim mono num">  {it.cues.length} {it.cues.length === 1 ? 'cue' : 'cues'}</span>}</span>
                  <span className="row-time mono num">
                    {spent >= 60_000 ? span(spent) : ''}
                    {tokens > 0 ? `${tokens} tokens` : ''}
                  </span>
                  <span className="row-actions">
                    <button
                      className="icon-btn"
                      aria-label={`Sit down with ${it.title}`}
                      title={have < price ? 'Needs a token: earn one at the desk' : `${s.settings.focusMin} minutes for ${price} token, then a rest`}
                      disabled={have < price || live}
                      onClick={() => dispatch({ type: 'desk/deploy', mode: 'couch', leisureId: it.id })}
                    >
                      <Play size={14} />
                    </button>
                    <button className="icon-btn" aria-label={`Remove ${it.title}`} title="Remove" onClick={() => dispatch({ type: 'leisure/delete', id: it.id })}>
                      <Trash size={14} />
                    </button>
                  </span>
                  {expanded && <Cues item={it} />}
                </li>
              )
            })}
          </ol>
        )}
      </section>
    </div>
  )
}

/**
 * Context switch rules: cues in your words for when to leave this and do something
 * else ("rookie dies in game"). No logic behind them; the app shows them while you
 * are on the couch and the quick switch does the leaving.
 */
function Cues({ item }: { item: LeisureItem }) {
  const [draft, setDraft] = useState('')
  const add = () => {
    if (!draft.trim()) return
    dispatch({ type: 'leisure/cue-add', id: item.id, text: draft })
    setDraft('')
  }
  return (
    <div className="cues">
      <span className="field-label caps">Context switch rules</span>
      {item.cues.length === 0 && <span className="field-help">When should you switch away? A cue, not a rule: "rookie dies in game", "ad break", "queue pops".</span>}
      <ul className="cues-list">
        {item.cues.map((c, i) => (
          <li key={i}>
            <span>{c}</span>
            <button className="icon-btn" aria-label={`Remove cue: ${c}`} title="Remove" onClick={() => dispatch({ type: 'leisure/cue-delete', id: item.id, index: i })}><X size={12} /></button>
          </li>
        ))}
      </ul>
      <div className="ai-add">
        <input value={draft} placeholder="rookie dies in game" onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && add()} />
        <button className="btn" onClick={add} disabled={!draft.trim()}><Plus size={14} /> Add cue</button>
      </div>
    </div>
  )
}
