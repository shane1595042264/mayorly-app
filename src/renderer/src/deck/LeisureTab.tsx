import { useState } from 'react'
import { Couch, Play, Stop, Trash } from '@phosphor-icons/react'
import { balance, blockView, clock, leisureList, leisureSpentMs, leisureTokensSpent, LEISURE_TOKENS_PER_MIN, span, type MayorlyState } from '@core/index'
import { dispatch, useNow } from '../store'

// Entertainment lives here, outside the ledgers: games, shows, streams. It is bought
// with tokens earned at the desk, a token a minute, and consumed on the couch as a
// countdown that earns nothing. Leaving early gives the unused minutes back.

const PRESETS = [15, 25, 30, 45, 60]

export function LeisureTab({ s }: { s: MayorlyState }) {
  const now = useNow(1000)
  const items = leisureList(s)
  const have = balance(s)
  const v = blockView(s, now)
  const onCouch = v?.block.kind === 'leisure' ? v : null
  const [draft, setDraft] = useState('')
  const [minutes, setMinutes] = useState(30)
  const price = minutes * LEISURE_TOKENS_PER_MIN

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
            Games, shows, streams, anything with no productive value. Outside the ledgers, never earns. Bought with tokens, {LEISURE_TOKENS_PER_MIN} a minute; what you do not use comes back.
          </p>
        </form>

        <div className="leisure-buy">
          <span className="field-label caps">Minutes</span>
          <div className="seg" role="radiogroup" aria-label="Minutes to buy">
            {PRESETS.map((m) => (
              <button key={m} role="radio" aria-checked={minutes === m} className={minutes === m ? 'on' : ''} onClick={() => setMinutes(m)}>{m}</button>
            ))}
          </div>
          <span className={`mono num ${have < price ? 'field-error' : 'dim'}`}>{price} tokens, {have} banked</span>
        </div>

        {onCouch && (
          <div className="leisure-live">
            <Couch size={18} />
            <span className="caps">On the couch</span>
            <span className="ellipsis">{onCouch.block.label}</span>
            <span className="mono num">{onCouch.remainingMs !== null ? clock(onCouch.remainingMs) : ''}</span>
            <button className="btn ghost" onClick={() => dispatch({ type: 'desk/standDown' })}><Stop size={14} /> Get up</button>
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
              return (
                <li key={it.id} className={`row ${live ? 'live leisure-row' : 'leisure-row'}`}>
                  <span className="row-n mono num dim">{String(i + 1).padStart(2, '0')}</span>
                  <Couch size={16} className="dim" aria-hidden />
                  <span className="row-title ellipsis">{it.title}</span>
                  <span className="row-time mono num">
                    {spent >= 60_000 ? span(spent) : ''}
                    {tokens > 0 ? `${tokens} tokens` : ''}
                  </span>
                  <span className="row-actions">
                    <button
                      className="icon-btn"
                      aria-label={`Buy ${minutes} minutes of ${it.title}`}
                      title={have < price ? `Needs ${price} tokens` : `Buy ${minutes} minutes for ${price} tokens and start`}
                      disabled={have < price || live}
                      onClick={() => dispatch({ type: 'desk/deploy', mode: 'couch', leisureId: it.id, minutes })}
                    >
                      <Play size={14} />
                    </button>
                    <button className="icon-btn" aria-label={`Remove ${it.title}`} title="Remove" onClick={() => dispatch({ type: 'leisure/delete', id: it.id })}>
                      <Trash size={14} />
                    </button>
                  </span>
                </li>
              )
            })}
          </ol>
        )}
      </section>
    </div>
  )
}
