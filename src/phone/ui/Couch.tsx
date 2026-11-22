import { useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { rowIn } from './motion'
import { MagnifyingGlass, Play, Trash } from '@phosphor-icons/react'
import { balance, onDeskId, leisureList, leisureSpentMs, leisureTokensSpent, span, type LeisureItem } from '@core/index'
import { act, useMayorly, useNow } from '../store'
import { captured } from '../feel'
import { Coin, Sheet } from './parts'

// The couch: what you would like to spend a coin on. Every tomato of couch time costs one coin,
// however it is split up; nothing is earned here. The balance is what the desk has paid.

export function Couch({ onSearch }: { onSearch?: () => void }) {
  const s = useMayorly()
  const now = useNow(30_000)
  const [title, setTitle] = useState('')
  const [menu, setMenu] = useState<LeisureItem | null>(null)
  // Removing asks for a second tap, as deleting an entry does.
  const [removing, setRemoving] = useState(false)
  const sitting = !!menu && s.desk.status !== 'idle' && onDeskId(s) === menu.id
  const items = leisureList(s)
  const coins = balance(s)
  const add = () => {
    if (!title.trim()) return
    act({ type: 'leisure/add', title })
    captured()
    setTitle('')
  }
  return (
    <>
      <header className="top">
        <h1 className="title" style={{ flex: 1, padding: 0 }}>Couch</h1>
        {onSearch && <motion.button type="button" className="btn icon-btn" aria-label="Find a task and start it" onClick={onSearch} whileTap={{ scale: 0.9 }}><MagnifyingGlass size={18} /></motion.button>}
        <span className="coins num" aria-label={`${coins} coins`}><Coin scale={1} />{coins}</span>
      </header>
      <p className="help" style={{ padding: '2px 4px 14px' }}>{coins > 0 ? `Every tomato of time here costs one coin of the ${coins} the desk has paid, however it is split up.` : 'Every tomato of time here costs one coin, and the desk pays one for every tomato.'}</p>
      <input className="field" value={title} onChange={(e) => setTitle(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && add()} placeholder="Add something to enjoy" aria-label="New couch item" enterKeyHint="done" />
      <div className="list" style={{ marginTop: 10 }}>
        <AnimatePresence initial={false}>
        {items.map((x, i) => {
          const spent = leisureSpentMs(s, x.id, now)
          const paid = leisureTokensSpent(s, x.id)
          return (
            <motion.button type="button" key={x.id} className="row" onClick={() => { setRemoving(false); setMenu(x) }} {...rowIn(i)}>
              <span className="row-main">
                <span className="row-title">{x.title}</span>
                <span className="row-sub">{spent > 0 ? `${span(spent)} so far, ${paid} ${paid === 1 ? 'coin' : 'coins'}` : 'Not yet'}</span>
              </span>
            </motion.button>
          )
        })}
        </AnimatePresence>
        {items.length === 0 && title.length === 0 && <p className="empty">Nothing on the couch list yet.</p>}
      </div>
      <AnimatePresence>{menu && (
        <Sheet key="couch-menu" title={menu.title} short onClose={() => setMenu(null)}>
          <div className="menu">
            {sitting ? <button type="button" disabled><Play size={20} />On the desk now</button> : <button type="button" onClick={() => { act({ type: 'desk/select', leisureId: menu.id }); setMenu(null) }}><Play size={20} />Sit down now</button>}
            {/* What is on the desk is not taken off the list under it; stand down first. */}
            <button type="button" className="danger" disabled={sitting} onClick={() => (removing ? (act({ type: 'leisure/delete', id: menu.id }), setMenu(null), setRemoving(false)) : setRemoving(true))}><Trash size={20} />{sitting ? 'Stand down to remove it' : removing ? 'Tap again to remove it' : 'Remove from the list'}</button>
          </div>
          {menu.cues.length > 0 && (
            <>
              <h3 className="section-title">Switch when</h3>
              <div className="list">{menu.cues.map((c, i) => <div key={i} className="row"><span className="row-title">{c}</span></div>)}</div>
            </>
          )}
        </Sheet>
      )}</AnimatePresence>
    </>
  )
}
