import { useState } from 'react'
import { Play, Trash } from '@phosphor-icons/react'
import { balance, leisureList, leisureSpentMs, leisureTokensSpent, span, type LeisureItem } from '@core/index'
import { act, useMayorly, useNow } from '../store'
import { Coin, Sheet } from './parts'

// The couch: what you would like to spend a coin on. A finished couch block costs one coin,
// leaving early is free, nothing is earned here. The balance is what the desk has paid.

export function Couch() {
  const s = useMayorly()
  const now = useNow(30_000)
  const [title, setTitle] = useState('')
  const [menu, setMenu] = useState<LeisureItem | null>(null)
  const items = leisureList(s)
  const coins = balance(s)
  const add = () => {
    if (!title.trim()) return
    act({ type: 'leisure/add', title })
    setTitle('')
  }
  return (
    <>
      <header className="top">
        <h1 className="title" style={{ flex: 1, padding: 0 }}>Couch</h1>
        <span className="coins num" aria-label={`${coins} coins`}><Coin scale={2} />{coins}</span>
      </header>
      <p className="help" style={{ padding: '2px 4px 14px' }}>A finished block here costs one coin of the {coins} the desk has paid. Leaving early is free.</p>
      <input className="field" value={title} onChange={(e) => setTitle(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && add()} placeholder="Add something to enjoy" aria-label="New couch item" enterKeyHint="done" />
      <div className="list" style={{ marginTop: 10 }}>
        {items.map((x) => {
          const spent = leisureSpentMs(s, x.id, now)
          const paid = leisureTokensSpent(s, x.id)
          return (
            <button type="button" key={x.id} className="row" onClick={() => setMenu(x)}>
              <span className="row-main">
                <span className="row-title">{x.title}</span>
                <span className="row-sub">{spent > 0 ? `${span(spent)} so far, ${paid} ${paid === 1 ? 'coin' : 'coins'}` : 'Not yet'}</span>
              </span>
            </button>
          )
        })}
        {items.length === 0 && <p className="empty">Nothing on the couch list yet.</p>}
      </div>
      {menu && (
        <Sheet title={menu.title} short onClose={() => setMenu(null)}>
          <div className="menu">
            <button type="button" onClick={() => { act({ type: 'desk/select', leisureId: menu.id }); setMenu(null) }}><Play size={20} />Sit down now</button>
            <button type="button" className="danger" onClick={() => { act({ type: 'leisure/delete', id: menu.id }); setMenu(null) }}><Trash size={20} />Remove from the list</button>
          </div>
          {menu.cues.length > 0 && (
            <>
              <h3 className="section-title">Switch when</h3>
              <div className="list">{menu.cues.map((c, i) => <div key={i} className="row"><span className="row-title">{c}</span></div>)}</div>
            </>
          )}
        </Sheet>
      )}
    </>
  )
}
