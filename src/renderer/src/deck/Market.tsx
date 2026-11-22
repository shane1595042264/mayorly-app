import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion, useAnimationControls } from 'motion/react'
import { ArrowCounterClockwise, Minus, PencilSimple, Plus, Trash } from '@phosphor-icons/react'
import { balance, marketBought, marketList, purchases, MARKET_UNDO_MS, type MarketItem, type MayorlyState } from '@core/index'
import coin from '../assets/coin@1x.png'
import { useListKeys } from '../lib/listkeys'
import { noteOrigin } from '../lib/origin'
import { sfx } from '../lib/sound'
import { dispatch, useNow } from '../store'

// The market: actions bought with coins at a price you set, with no timer. The couch sells
// time by the block; this sells a thing at once (empower the next game, a night off). A card
// shows how near the wallet is to its price; buying takes a press held for a moment (or Enter
// on the selected card), the coins fly off the counter with the couch's falling sound, and an
// Undo stays for ten minutes. One line under the form says what just happened, in a slot that
// is always there, so nothing below it moves.

/** How long the Buy button must be held. */
const HOLD_MS = 650
/** A second purchase this soon after one is a held or doubled key, not a choice. */
const BUY_GAP_MS = 900
/** The notice line keeps what just happened this long. */
const NOTICE_MS = 8000
const TITLE_MAX = 120
const NOTE_MAX = 200
const SUGGESTIONS: { title: string; price: number; note?: string }[] = [
  { title: 'Empower the next game', price: 10, note: 'Play the next match all in' },
  { title: 'Empower the next LeetCode', price: 10, note: 'Solve it in time and it unlocks a reward' },
  { title: 'A movie night', price: 6 },
  { title: 'Takeout dinner', price: 8 },
  { title: 'Sleep in tomorrow', price: 12 },
]

const ago = (ms: number) => {
  const m = Math.floor(ms / 60_000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.floor(h / 24)
  return d < 30 ? `${d}d ago` : `${Math.floor(d / 30)}mo ago`
}

type Notice =
  | { kind: 'removed'; id: string; title: string; at: number }
  | { kind: 'short'; id: string; at: number }
  | { kind: 'refunded'; title: string; amount: number; at: number }

export function Market({ s, enabled }: { s: MayorlyState; enabled: boolean }) {
  const now = useNow(1000)
  const wallet = balance(s)
  const items = marketList(s)
  const log = purchases(s).slice(0, 14)
  const [editing, setEditing] = useState<string | null>(null)
  const [notice, setNotice] = useState<Notice | null>(null)
  const [shake, setShake] = useState<{ id: string; n: number } | null>(null)
  const lastBuy = useRef(0)
  const latest = log[0]
  const bought = latest && !latest.refunded && now - latest.at < NOTICE_MS ? latest : null
  // A short is about the wallet now: once it covers the item, there is nothing to say.
  const shortItem = notice?.kind === 'short' ? items.find((x) => x.id === notice.id) : undefined
  const live = notice && now - notice.at < NOTICE_MS && (notice.kind !== 'short' || (shortItem && wallet < shortItem.price)) ? notice : null
  // The newest thing said wins: a purchase, a removal, a refund or a short.
  const shown = live && (!bought || live.at > bought.at) ? live : null

  const buy = (it: MarketItem, from?: Element | null) => {
    // A second press this soon is a held or doubled key: not a purchase, and not a shortfall either.
    if (Date.now() - lastBuy.current < BUY_GAP_MS) return
    const el = from ?? document.querySelector(`[data-row="${CSS.escape(it.id)}"] .buy`)
    if (wallet < it.price) {
      sfx.nope()
      setShake((x) => ({ id: it.id, n: (x?.n ?? 0) + 1 }))
      setNotice({ kind: 'short', id: it.id, at: Date.now() })
      return
    }
    lastBuy.current = Date.now()
    setNotice(null)
    noteOrigin(el)
    dispatch({ type: 'market/buy', id: it.id })
  }
  const undo = (p: { id: string; title: string; price: number }, from: Element) => {
    noteOrigin(from)
    dispatch({ type: 'market/undo', txId: p.id })
    setNotice({ kind: 'refunded', title: p.title, amount: p.price, at: Date.now() })
  }
  const remove = (it: MarketItem) => {
    dispatch({ type: 'market/delete', id: it.id })
    setNotice({ kind: 'removed', id: it.id, title: it.title, at: Date.now() })
  }

  // The keyboard: j and k pick a card, Enter buys it (Undo stays), r edits, x removes, n adds.
  const { sel } = useListKeys(items.map((it) => it.id), ({ action, id, e }) => {
    if (action === 'list.new') {
      document.getElementById('market-title')?.focus()
      return true
    }
    const it = id ? items.find((x) => x.id === id) : undefined
    if (!it) return false
    if (action === 'list.go') {
      if (!e.repeat) buy(it)
    } else if (action === 'list.delete') remove(it)
    else if (action === 'list.rename') setEditing(it.id)
    else return false
    return true
  }, enabled && editing === null)

  // A suggestion already on sale is not offered again, by where the item came from, so a renamed one stays put.
  const unused = SUGGESTIONS.filter((x) => !items.some((it) => it.idea === x.title || it.title.toLowerCase() === x.title.toLowerCase()))

  return (
    <div className="market">
      <section className="market-main">
        <AddItem />
        <div className="market-notice-slot" role="status">
          <AnimatePresence initial={false}>
            {bought && !shown ? (
              <motion.div key={`b${bought.id}`} className="market-notice is-bought" {...noticeMotion}>
                <span className="caps">Bought</span>
                <span className="market-notice-title">{bought.title}</span>
                <span className="market-minus mono num">-{bought.price}</span>
                <button type="button" className="btn ghost small" onClick={(e) => undo(bought, e.currentTarget)}>
                  <ArrowCounterClockwise size={13} /> Undo
                </button>
              </motion.div>
            ) : shown?.kind === 'removed' ? (
              <motion.div key={`r${shown.at}`} className="market-notice" {...noticeMotion}>
                <span className="caps">Removed</span>
                <span className="market-notice-title">{shown.title}</span>
                <button type="button" className="btn ghost small" onClick={() => { dispatch({ type: 'market/restore', id: shown.id }); setNotice(null) }}>
                  <ArrowCounterClockwise size={13} /> Undo
                </button>
              </motion.div>
            ) : shown?.kind === 'short' && shortItem ? (
              <motion.div key={`s${shown.at}`} className="market-notice is-short" {...noticeMotion}>
                <span className="caps">Short</span>
                <span className="market-notice-title">{shortItem.title}</span>
                <span><b className="mono num">{shortItem.price - wallet}</b> more {shortItem.price - wallet === 1 ? 'coin' : 'coins'} to go</span>
              </motion.div>
            ) : shown?.kind === 'refunded' ? (
              <motion.div key={`u${shown.at}`} className="market-notice is-refunded" {...noticeMotion}>
                <span className="caps">Refunded</span>
                <span className="market-notice-title">{shown.title}</span>
                <span className="market-plus mono num">+{shown.amount}</span>
              </motion.div>
            ) : (
              <motion.p key="hint" className="market-notice is-hint" {...noticeMotion}>
                {items.length ? 'Hold Buy, or pick a card with j and k and press Enter. Undo stays for ten minutes.' : 'Price the things you want in coins, one for each tomato finished at the desk.'}
              </motion.p>
            )}
          </AnimatePresence>
        </div>
        {items.length > 0 && (
          <ol className="market-grid">
            <AnimatePresence initial={false}>
            {items.map((it, i) => (
              <Card
                key={it.id}
                it={it}
                index={i}
                s={s}
                wallet={wallet}
                now={now}
                selected={sel === it.id}
                editing={editing === it.id}
                shake={shake?.id === it.id ? shake.n : 0}
                buy={buy}
                edit={() => setEditing(it.id)}
                done={() => setEditing(null)}
                remove={() => remove(it)}
              />
            ))}
            </AnimatePresence>
          </ol>
        )}
        {unused.length > 0 && (
          <div className={`market-ideas ${items.length ? '' : 'is-first'}`}>
            {items.length === 0 && <p className="empty-title">Nothing for sale yet.</p>}
            <span className="field-label caps">{items.length ? 'More ideas' : 'Start with one of these'}</span>
            <div className="market-suggest">
              {unused.map((x) => (
                <button key={x.title} type="button" className="market-chip" onClick={() => dispatch({ type: 'market/add', ...x, idea: x.title })}>
                  <Plus size={12} />
                  <span>{x.title}</span>
                  <span className="market-chip-price mono num"><img src={coin} alt="" />{x.price}</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </section>

      <aside className="market-side">
        <Wallet n={wallet} />
        <p className="field-help wallet-help">One coin for every tomato finished at the desk. The couch spends one a block; the market, what you priced.</p>
        <h3 className="side-title caps">Bought</h3>
        {log.length === 0 ? (
          <p className="dim small">Nothing bought yet.</p>
        ) : (
          <ol className="market-log">
            {log.map((p) => (
              <li key={p.id} className={p.refunded ? 'refunded' : ''}>
                <span className="market-log-title ellipsis" title={p.title}>{p.title}</span>
                <span className="market-minus mono num">{p.refunded ? 'refunded' : `-${p.price}`}</span>
                <span className="market-log-ago mono num">{ago(now - p.at)}</span>
                {!p.refunded && now - p.at < MARKET_UNDO_MS ? (
                  <button type="button" className="icon-btn" aria-label={`Undo buying ${p.title}`} title="Undo: the coins come back" onClick={(e) => undo(p, e.currentTarget)}>
                    <ArrowCounterClockwise size={13} />
                  </button>
                ) : (
                  <span />
                )}
              </li>
            ))}
          </ol>
        )}
      </aside>
    </div>
  )
}

/** The notice lines are stacked in their slot, so a new one crossfades over the old with no empty frame. */
const noticeMotion = {
  initial: { opacity: 0, y: -3 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, transition: { duration: 0.16 } },
  transition: { duration: 0.18 },
}

/** The balance, which springs when it changes and sits still when it does not. */
function Wallet({ n }: { n: number }) {
  const first = useRef(true)
  useEffect(() => {
    first.current = false
  }, [])
  return (
    <div className="wallet">
      <img className="wallet-coin" src={coin} alt="" />
      <div className="wallet-text">
        <motion.span key={n} className="wallet-n mono num" initial={first.current ? false : { y: -6, opacity: 0.4 }} animate={{ y: 0, opacity: 1 }} transition={{ type: 'spring', stiffness: 400, damping: 24 }}>
          {n.toLocaleString()}
        </motion.span>
        <span className="wallet-label caps">{n === 1 ? 'coin' : 'coins'} to spend</span>
      </div>
    </div>
  )
}

interface CardProps {
  it: MarketItem
  index: number
  s: MayorlyState
  wallet: number
  now: number
  selected: boolean
  editing: boolean
  shake: number
  buy: (it: MarketItem, from?: Element | null) => void
  edit: () => void
  done: () => void
  remove: () => void
}

function Card({ it, index, s, wallet, now, selected, editing, shake, buy, edit, done, remove }: CardProps) {
  const can = wallet >= it.price
  const bought = marketBought(s, it.id)
  const times = Math.floor(wallet / it.price)
  const controls = useAnimationControls()
  useEffect(() => {
    if (shake) void controls.start({ x: [0, -7, 7, -4, 4, 0], transition: { duration: 0.36 } })
  }, [shake, controls])
  return (
    <motion.li
      layout="position"
      className={`market-card ${can ? '' : 'is-short'} ${selected ? 'is-selected' : ''} ${editing ? 'is-editing' : ''}`}
      data-row={it.id}
      aria-current={selected ? 'true' : undefined}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.96, transition: { duration: 0.16 } }}
      transition={{ delay: Math.min(index, 8) * 0.035, type: 'spring', stiffness: 300, damping: 28, layout: { type: 'spring', stiffness: 380, damping: 34 } }}
    >
      <motion.div className="market-card-in" animate={controls}>
        {editing ? (
          <EditItem it={it} done={done} />
        ) : (
          <>
            <div className="market-card-head">
              <span className="market-title" title={it.title}>{it.title}</span>
              <span className="market-price mono num"><img src={coin} alt="" />{it.price}</span>
            </div>
            {it.note && <p className="market-note" title={it.note}>{it.note}</p>}
            <div className="market-meter" aria-hidden>
              <motion.span initial={false} animate={{ scaleX: Math.min(1, wallet / it.price) }} transition={{ type: 'spring', stiffness: 200, damping: 30 }} />
            </div>
            <p className="market-stat">{bought.count ? `Bought ${bought.count}x, last ${ago(now - (bought.lastAt ?? now))}` : 'Never bought'}</p>
            <div className="market-foot">
              <span className={`market-need ${can ? '' : 'is-short'}`}>
                {can ? (times > 1 ? `${times}x in the wallet` : 'In the wallet') : <>Need <b className="mono num">{it.price - wallet}</b> more</>}
              </span>
              <span className="market-tools">
                <button type="button" className="icon-btn" aria-label={`Edit ${it.title}`} title="Edit (r)" onClick={edit}><PencilSimple size={14} /></button>
                <button type="button" className="icon-btn" aria-label={`Remove ${it.title}`} title="Remove (x)" onClick={remove}><Trash size={14} /></button>
              </span>
              <HoldToBuy can={can} label={it.title} bought={bought.count} onBuy={(el) => buy(it, el)} />
            </div>
          </>
        )}
      </motion.div>
    </motion.li>
  )
}

/** Buy by holding: the fill runs across the button and the purchase lands when it is full. Enter or Space buys at once. Short, a press only says so. */
function HoldToBuy({ can, label, bought, onBuy }: { can: boolean; label: string; bought: number; onBuy: (el: HTMLElement) => void }) {
  const [p, setP] = useState(0)
  const hold = useRef<{ start: number; raf: number } | null>(null)
  const btn = useRef<HTMLButtonElement>(null)
  // A purchase however it was made (a hold, Enter on the card): the button fills and says Bought for a moment.
  const seen = useRef(bought)
  useEffect(() => {
    if (bought <= seen.current) {
      seen.current = bought
      return
    }
    seen.current = bought
    setP(1)
    const t = setTimeout(() => setP(0), 320)
    return () => clearTimeout(t)
  }, [bought])
  const stop = () => {
    if (hold.current) cancelAnimationFrame(hold.current.raf)
    hold.current = null
    setP(0)
  }
  useEffect(() => stop, [])
  const tick = () => {
    const h = hold.current
    if (!h) return
    const q = Math.min(1, (performance.now() - h.start) / HOLD_MS)
    setP(q)
    if (q >= 1) {
      hold.current = null
      if (btn.current) onBuy(btn.current)
      setTimeout(() => setP(0), 220)
      return
    }
    h.raf = requestAnimationFrame(tick)
  }
  const text = p >= 1 ? 'Bought' : p > 0 ? 'Hold' : can ? 'Buy' : 'Short'
  return (
    <button
      ref={btn}
      type="button"
      className={`buy ${p > 0 ? 'is-holding' : ''} ${can ? '' : 'is-short'}`}
      aria-label={`Buy ${label}`}
      aria-disabled={!can}
      title={can ? 'Hold to buy, or press Enter' : 'Not enough coins yet'}
      style={{ ['--p' as string]: p }}
      onPointerDown={(e) => {
        if (e.button !== 0) return
        if (!can) return onBuy(e.currentTarget)
        try {
          e.currentTarget.setPointerCapture(e.pointerId)
        } catch {
          /* the pointer is already gone: the hold still runs until it is let go */
        }
        hold.current = { start: performance.now(), raf: requestAnimationFrame(tick) }
      }}
      onPointerUp={stop}
      onPointerCancel={stop}
      onLostPointerCapture={() => { if (hold.current) stop() }}
      onKeyDown={(e) => {
        if (e.key !== 'Enter' && e.key !== ' ') return
        e.preventDefault()
        e.stopPropagation()
        if (!e.repeat) onBuy(e.currentTarget)
      }}
    >
      <span className="buy-label caps">{text}</span>
      <span className="buy-fill" aria-hidden><span className="buy-label caps">{text}</span></span>
    </button>
  )
}

/** Whole coins, 1 to 999. The box holds what is typed and settles it on leaving; the steps stop at the ends. */
function PriceInput({ value, set }: { value: number; set: (n: number) => void }) {
  const [draft, setDraft] = useState(String(value))
  useEffect(() => setDraft(String(value)), [value])
  const clamp = (n: number) => Math.min(999, Math.max(1, Math.round(n) || 1))
  const settle = () => {
    const n = clamp(Number(draft))
    set(n)
    setDraft(String(n))
  }
  return (
    <span className="price-input">
      <button type="button" className="icon-btn" aria-label="One coin less" disabled={value <= 1} onClick={() => set(clamp(value - 1))}><Minus size={13} /></button>
      <img src={coin} alt="" />
      <input
        className="mono num"
        inputMode="numeric"
        maxLength={3}
        value={draft}
        aria-label="Price in coins"
        onChange={(e) => {
          const d = e.target.value.replace(/\D/g, '').slice(0, 3)
          setDraft(d)
          if (d) set(clamp(Number(d)))
        }}
        onBlur={settle}
      />
      <button type="button" className="icon-btn" aria-label="One coin more" disabled={value >= 999} onClick={() => set(clamp(value + 1))}><Plus size={13} /></button>
    </span>
  )
}

function AddItem() {
  const [title, setTitle] = useState('')
  const [price, setPrice] = useState(10)
  const [note, setNote] = useState('')
  const add = () => {
    if (!title.trim()) return
    dispatch({ type: 'market/add', title, price, note })
    setTitle('')
    setNote('')
    setPrice(10)
  }
  return (
    <form className="market-add" onSubmit={(e) => { e.preventDefault(); add() }}>
      <label htmlFor="market-title" className="field-label caps">Put something up for sale</label>
      <div className="market-add-row">
        <input id="market-title" value={title} maxLength={TITLE_MAX} onChange={(e) => setTitle(e.target.value)} placeholder="Empower the next game" spellCheck={false} autoComplete="off" />
        <PriceInput value={price} set={setPrice} />
        <button type="submit" className="btn" disabled={!title.trim()}><Plus size={14} /> Add</button>
      </div>
      <input className="market-add-note" value={note} maxLength={NOTE_MAX} onChange={(e) => setNote(e.target.value)} placeholder="When it is allowed, in your words (optional): after a LeetCode solved in time" spellCheck={false} autoComplete="off" />
    </form>
  )
}

function EditItem({ it, done }: { it: MarketItem; done: () => void }) {
  const [title, setTitle] = useState(it.title)
  const [price, setPrice] = useState(it.price)
  const [note, setNote] = useState(it.note ?? '')
  const save = () => {
    dispatch({ type: 'market/update', id: it.id, patch: { title, price, note } })
    done()
  }
  return (
    <form className="market-edit" onSubmit={(e) => { e.preventDefault(); save() }} onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); done() } }}>
      <input autoFocus value={title} maxLength={TITLE_MAX} onChange={(e) => setTitle(e.target.value)} aria-label="Title" spellCheck={false} />
      <input value={note} maxLength={NOTE_MAX} onChange={(e) => setNote(e.target.value)} placeholder="When it is allowed (optional)" aria-label="Note" spellCheck={false} />
      <div className="market-edit-foot">
        <PriceInput value={price} set={setPrice} />
        <span className="grow" />
        <button type="button" className="btn ghost small" onClick={done}>Cancel</button>
        <button type="submit" className="btn small" disabled={!title.trim()}>Save</button>
      </div>
    </form>
  )
}
