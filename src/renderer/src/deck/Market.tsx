import { useEffect, useRef, useState, type Ref } from 'react'
import { AnimatePresence, motion, useAnimationControls } from 'motion/react'
import { ArrowCounterClockwise, Minus, PencilSimple, Plus, Trash, X } from '@phosphor-icons/react'
import { balance, marketBought, marketList, purchases, MARKET_UNDO_MS, type MarketItem, type MayorlyState } from '@core/index'
import coin from '../assets/coin@1x.png'
import { useShownCoins } from '../lib/coinView'
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
/** A second purchase of the same item this soon is a held or doubled key, not a choice. */
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

/**
 * What the notice line has said, kept for the session rather than the view, so going to the couch
 * and back (which remounts the market) neither forgets a removal nor brings back an old purchase.
 */
const memory: { notice: Notice | null; saidAt: { current: number }; lastBuy: { current: { id: string; at: number } | null } } = {
  notice: null,
  saidAt: { current: 0 },
  lastBuy: { current: null },
}

type Notice =
  | { kind: 'removed'; ids: string[]; title: string; at: number }
  | { kind: 'restored'; title: string; at: number }
  /** `landing`: the card said Buy with coins still in the air, and the real balance said no. */
  | { kind: 'short'; id: string; at: number; landing?: boolean }
  | { kind: 'refunded'; title: string; amount: number; count: number; at: number }

export function Market({ s, enabled }: { s: MayorlyState; enabled: boolean }) {
  const now = useNow(1000)
  // The real balance decides what can be bought; the one shown counts with the coins in the air,
  // like the header and the wallet, so no card runs ahead of them.
  const wallet = balance(s)
  const seen = useShownCoins(wallet)
  const items = marketList(s)
  const log = purchases(s).slice(0, 14)
  const [editing, setEditing] = useState<string | null>(null)
  const [notice, setNoticeState] = useState<Notice | null>(memory.notice)
  useEffect(() => {
    memory.notice = notice
  }, [notice])
  // When something other than a purchase was last said (or cleared): purchases older than that are
  // not gathered into a Bought line again.
  const saidAt = memory.saidAt
  const setNotice = (n: Notice | null | ((n: Notice | null) => Notice | null)) => {
    saidAt.current = Date.now()
    setNoticeState(n)
  }
  const [shake, setShake] = useState<{ id: string; n: number } | null>(null)
  const lastBuy = memory.lastBuy
  // The notice line sticks to the top of the scrolled deck; a sentinel just above it says when.
  const sentinel = useRef<HTMLDivElement>(null)
  const [stuck, setStuck] = useState(false)
  useEffect(() => {
    const el = sentinel.current
    const root = el?.closest('.deck-body')
    if (!el || !root) return
    const io = new IntersectionObserver(([e]) => setStuck(!e.isIntersecting && e.boundingClientRect.top < (e.rootBounds?.top ?? 0) + 30), { root, threshold: 0, rootMargin: '-24px 0px 0px 0px' })
    io.observe(el)
    return () => io.disconnect()
  }, [])
  // How many cards fit in a row, from the grid's width and the cards' least width.
  const grid = useRef<HTMLOListElement>(null)
  const [cols, setCols] = useState(3)
  useEffect(() => {
    const el = grid.current
    if (!el) return
    const measure = () => setCols(Math.max(1, Math.floor((el.clientWidth + 10) / (260 + 10))))
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  // Cards there at the start come in staggered; a card added later waits a beat, until the rows below have moved.
  const listMounted = useRef(false)
  useEffect(() => {
    listMounted.current = true
  }, [])
  // A short is about the count on screen, as the card is: once it covers the item, there is nothing to say.
  const shortItem = notice?.kind === 'short' ? items.find((x) => x.id === notice.id) : undefined
  const shortOf = notice?.kind === 'short' && notice.landing ? wallet : seen
  const live = notice && now - notice.at < NOTICE_MS && (notice.kind !== 'short' || (shortItem && shortOf < shortItem.price)) ? notice : null
  // Purchases in a row since anything else was said gather into one line, like removals.
  const recent = log.filter((p) => !p.refunded && now - p.at < NOTICE_MS && p.at > Math.max(live?.at ?? 0, saidAt.current))
  const bought = recent.length
    ? { list: recent, at: recent[0].at, title: recent.length > 1 ? `${recent.length} items` : recent[0].title, price: recent.reduce((n, p) => n + p.price, 0) }
    : null
  // The newest thing said wins: a purchase, a removal, a refund or a short.
  const shown = live && (!bought || live.at > bought.at) ? live : null

  useEffect(() => {
    if (notice?.kind === 'short' && (!shortItem || shortOf >= shortItem.price)) setNotice(null)
  }, [notice, shortItem, shortOf])

  const short = (it: MarketItem, landing = false) => {
    sfx.nope()
    setShake((x) => ({ id: it.id, n: (x?.n ?? 0) + 1 }))
    setNotice({ kind: 'short', id: it.id, at: Date.now(), landing })
  }
  // A press on a card: the card says what the count on screen says (Buy or Short), and a press does
  // what the card says; the real balance has the last word on the purchase itself.
  const press = (it: MarketItem, from?: Element | null) => {
    // The same card pressed again this soon is a held or doubled key: not a purchase, and not a
    // shortfall either. Another card is another choice.
    if (lastBuy.current?.id === it.id && Date.now() - lastBuy.current.at < BUY_GAP_MS) return
    if (seen < it.price) return short(it)
    buy(it, from)
  }
  /** True when the purchase went through; false when it was a repeat or the coins were not there. */
  const buy = (it: MarketItem, from?: Element | null): boolean => {
    if (lastBuy.current?.id === it.id && Date.now() - lastBuy.current.at < BUY_GAP_MS) return false
    const el = from ?? document.querySelector(`[data-row="${CSS.escape(it.id)}"] .buy`)
    // The card said Buy from the count still landing; the real balance says no, and the line says why.
    if (wallet < it.price) {
      short(it, seen >= it.price)
      return false
    }
    lastBuy.current = { id: it.id, at: Date.now() }
    // A purchase clears another kind of line without counting as something said: purchases in a
    // row since then gather into one Bought line, with one Undo for all of them.
    setNoticeState(null)
    sfx.tick()
    noteOrigin(el)
    dispatch({ type: 'market/buy', id: it.id })
    return true
  }
  // Undo one purchase or several; refunds in a row gather into one line, like removals.
  const undo = (list: { id: string; title: string; price: number; marketId: string | null }[], from: Element) => {
    if (!list.length) return
    sfx.tick()
    noteOrigin(from)
    // Undone, the card may be bought again at once: it is a choice, not a repeat.
    for (const p of list) if (lastBuy.current?.id === p.marketId) lastBuy.current = null
    dispatch({ type: 'market/undo', txIds: list.map((p) => p.id) })
    const amount = list.reduce((n, p) => n + p.price, 0)
    setNotice((n) => {
      const t = Date.now()
      const count = (n?.kind === 'refunded' && t - n.at < NOTICE_MS ? n.count : 0) + list.length
      const sum = (n?.kind === 'refunded' && t - n.at < NOTICE_MS ? n.amount : 0) + amount
      return { kind: 'refunded', title: count > 1 ? `${count} items` : list[0].title, amount: sum, count, at: t }
    })
  }
  // Removals in a row gather into one notice whose Undo puts them all back; each stays in the side
  // column's Removed list for ten minutes in any case.
  const remove = (it: MarketItem) => {
    sfx.drop()
    dispatch({ type: 'market/delete', id: it.id })
    setNotice((n) => {
      const t = Date.now()
      const ids = n?.kind === 'removed' && t - n.at < NOTICE_MS ? [...n.ids, it.id] : [it.id]
      return { kind: 'removed', ids, title: ids.length > 1 ? `${ids.length} items` : it.title, at: t }
    })
  }
  const putBack = (ids: string[], title: string) => {
    sfx.place()
    for (const id of ids) dispatch({ type: 'market/restore', id })
    setNotice({ kind: 'restored', title, at: Date.now() })
  }
  const removed = (s.market ?? []).filter((m) => m.archivedAt !== null && now - m.archivedAt < MARKET_UNDO_MS).sort((a, b) => (b.archivedAt ?? 0) - (a.archivedAt ?? 0))

  // The keyboard: j and k pick a card, Enter buys it (Undo stays), r edits, x removes, n adds.
  const { sel } = useListKeys(items.map((it) => it.id), ({ action, id, e }) => {
    if (action === 'list.new') {
      document.getElementById('market-title')?.focus()
      return true
    }
    const it = id ? items.find((x) => x.id === id) : undefined
    if (!it) return false
    if (action === 'list.go') {
      if (!e.repeat) press(it)
    } else if (action === 'list.delete') {
      // A held x removes one card, not the list.
      if (!e.repeat) remove(it)
    }
    else if (action === 'list.rename') setEditing(it.id)
    else return false
    return true
  }, enabled && editing === null)

  // The quiet line under the form: how much is on sale and how much was bought this week.
  const week = purchases(s).filter((p) => !p.refunded && now - p.at < 7 * 24 * 3600_000).length
  // A suggestion already on sale is not offered again, by where the item came from, so a renamed one stays put;
  // nor one put away with its x, until Bring back.
  const hidden = s.settings.marketHidden ?? []
  const unused = SUGGESTIONS.filter((x) => !hidden.includes(x.title) && !items.some((it) => it.idea === x.title || it.title.toLowerCase() === x.title.toLowerCase()))
  const putAway = SUGGESTIONS.filter((x) => hidden.includes(x.title)).length
  const hideIdea = (title: string) => {
    sfx.drop()
    dispatch({ type: 'settings/update', patch: { marketHidden: [...hidden, title] } })
  }

  return (
    <div className="market">
      <section className="market-main">
        <AddItem />
        <div ref={sentinel} className="market-notice-sentinel" aria-hidden />
        <div className={`market-notice-slot ${stuck ? 'is-stuck' : ''}`} role="status">
          <AnimatePresence initial={false}>
            {bought && !shown ? (
              <motion.div key="bought" className="market-notice is-bought" {...noticeMotion}>
                <span className="caps">Bought</span>
                <span className="market-notice-title">{bought.title}</span>
                <span className="market-minus mono num">-{bought.price}</span>
                <button type="button" className="btn ghost small" onClick={(e) => undo(bought.list, e.currentTarget)}>
                  <ArrowCounterClockwise size={13} /> Undo
                </button>
              </motion.div>
            ) : shown?.kind === 'removed' ? (
              <motion.div key="removed" className="market-notice" {...noticeMotion}>
                <span className="caps">Removed</span>
                <span className="market-notice-title">{shown.title}</span>
                <button type="button" className="btn ghost small" onClick={() => putBack(shown.ids, shown.title)}>
                  <ArrowCounterClockwise size={13} /> Undo
                </button>
              </motion.div>
            ) : shown?.kind === 'short' && shortItem ? (
              <motion.div key="short" className="market-notice is-short" {...noticeMotion}>
                <span className="caps">Short</span>
                <span className="market-notice-title">{shortItem.title}</span>
                <span><b className="mono num">{shortItem.price - shortOf}</b> more {shortItem.price - shortOf === 1 ? 'coin' : 'coins'} {shown.landing ? 'once the coins land' : 'to go'}</span>
              </motion.div>
            ) : shown?.kind === 'restored' ? (
              <motion.div key="restored" className="market-notice" {...noticeMotion}>
                <span className="caps">Back on sale</span>
                <span className="market-notice-title">{shown.title}</span>
              </motion.div>
            ) : shown?.kind === 'refunded' ? (
              <motion.div key="refunded" className="market-notice is-refunded" {...noticeMotion}>
                <span className="caps">Refunded</span>
                <span className="market-notice-title">{shown.title}</span>
                <span className="market-plus mono num">+{shown.amount}</span>
              </motion.div>
            ) : (
              <motion.p key="hint" className="market-notice is-hint" {...noticeMotion}>
                {items.length ? `${items.length} for sale${week ? `, ${week} bought this week` : ''}` : 'Price the things you want in coins, one for each tomato finished at the desk.'}
              </motion.p>
            )}
          </AnimatePresence>
        </div>
        {/* Always there, so the first card enters like the rest. */}
        {(
          <ol className="market-grid" ref={grid}>
            <AnimatePresence initial={false} mode="popLayout">
            {items.map((it, i) => (
              <Card
                // A card that moves to another row fades out at its old place and in at its new one,
                // rather than crossing the row over its neighbours; within a row it slides.
                key={`${it.id}@${Math.floor(i / cols)}`}
                it={it}
                index={i}
                s={s}
                wallet={wallet}
                seen={seen}
                now={now}
                selected={sel === it.id}
                editing={editing === it.id}
                shake={shake?.id === it.id ? shake.n : 0}
                buy={buy}
                short={() => short(it)}
                enterDelay={listMounted.current ? 0.12 : Math.min(i, 8) * 0.035}
                edit={() => setEditing(it.id)}
                done={() => setEditing(null)}
                remove={() => remove(it)}
              />
            ))}
            </AnimatePresence>
          </ol>
        )}
        {(unused.length > 0 || putAway > 0 || items.length === 0) && (
          <motion.div layout="position" transition={{ type: 'spring', stiffness: 900, damping: 60 }} className={`market-ideas ${items.length ? '' : 'is-first'}`}>
            {items.length === 0 && <p className="empty-title">Nothing for sale yet.</p>}
            {unused.length > 0 && <span className="field-label caps">{items.length ? 'More ideas' : 'Start with one of these'}</span>}
            <div className="market-suggest">
              <AnimatePresence initial={false} mode="popLayout">
                {unused.map((x) => (
                  // An idea is added as it is with its +, then edited on its card like anything else; x puts it away.
                  <motion.span
                    key={x.title}
                    layout="position"
                    className="market-chip-wrap"
                    exit={{ opacity: 0, scale: 0.94, transition: { duration: 0.12 } }}
                    transition={{ type: 'spring', stiffness: 700, damping: 50 }}
                  >
                    <button type="button" className="market-chip" title="Put it up for sale" onClick={() => { sfx.place(); dispatch({ type: 'market/add', ...x, idea: x.title }) }}>
                      <Plus size={12} />
                      <span>{x.title}</span>
                      <span className="market-chip-price mono num"><img src={coin} alt="" />{x.price}</span>
                    </button>
                    <button type="button" className="market-chip-x" aria-label={`Put away the idea ${x.title}`} title="Not for me" onClick={() => hideIdea(x.title)}>
                      <X size={12} />
                    </button>
                  </motion.span>
                ))}
              </AnimatePresence>
              {putAway > 0 && (
                <motion.button layout="position" type="button" className="market-ideas-back" onClick={() => { sfx.tick(); dispatch({ type: 'settings/update', patch: { marketHidden: hidden.filter((t) => !SUGGESTIONS.some((x) => x.title === t)) } }) }}>
                  <ArrowCounterClockwise size={12} /> Bring back {putAway} {putAway === 1 ? 'idea' : 'ideas'}
                </motion.button>
              )}
            </div>
          </motion.div>
        )}
      </section>

      <aside className="market-side">
        <Wallet n={wallet} />
        <p className="field-help wallet-help">One coin for every tomato finished at the desk. The couch spends one for each tomato of its time; the market, what you priced.</p>
        <h3 className="side-title caps">Bought</h3>
        {log.length === 0 ? (
          <p className="dim small">Nothing bought yet.</p>
        ) : (
          <ol className="market-log">
            {log.map((p) => (
              <li key={p.id} className={p.refunded ? 'refunded' : ''}>
                <span className="market-log-title ellipsis" title={p.title}>{p.title}</span>
                {p.refunded ? <s className="market-refunded mono num" title="Refunded">-{p.price}</s> : <span className="market-minus mono num">-{p.price}</span>}
                <span className="market-log-ago">{ago(now - p.at)}</span>
                {!p.refunded && now - p.at < MARKET_UNDO_MS ? (
                  <button type="button" className="icon-btn" aria-label={`Undo buying ${p.title}`} title="Undo: the coins come back" onClick={(e) => undo([p], e.currentTarget)}>
                    <ArrowCounterClockwise size={13} />
                  </button>
                ) : (
                  <span />
                )}
              </li>
            ))}
          </ol>
        )}
        {removed.length > 0 && (
          <>
            <h3 className="side-title caps market-removed-title">Removed</h3>
            <ol className="market-log">
              {removed.map((m) => (
                <li key={m.id}>
                  <span className="market-log-title ellipsis dim" title={m.title}>{m.title}</span>
                  <span className="market-removed-price mono num">{m.price}</span>
                  <span className="market-log-ago">{ago(now - (m.archivedAt ?? now))}</span>
                  <button type="button" className="icon-btn" aria-label={`Put back ${m.title}`} title="Put back on sale" onClick={() => putBack([m.id], m.title)}>
                    <ArrowCounterClockwise size={13} />
                  </button>
                </li>
              ))}
            </ol>
          </>
        )}
      </aside>
    </div>
  )
}

/**
 * The notice lines are stacked in their slot: the old one leaves upward and is mostly gone before
 * the new one rises in from below, so their words never sit on each other.
 */
const noticeMotion = {
  initial: { opacity: 0, y: 6 },
  animate: { opacity: 1, y: 0, transition: { delay: 0.06, duration: 0.16 } },
  exit: { opacity: 0, y: -6, transition: { duration: 0.09 } },
}

/** The balance, which springs when it changes and sits still when it does not, and counts with coins in the air. */
function Wallet({ n: actual }: { n: number }) {
  const n = useShownCoins(actual)
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
  /** For the list's presence: a card leaving is taken out of the layout at once, so the rest slide into place. */
  ref?: Ref<HTMLLIElement>
  it: MarketItem
  index: number
  s: MayorlyState
  /** The real balance: it decides what a press does and what the card says. */
  wallet: number
  /** The count on screen, which the meter follows while coins are in the air. */
  seen: number
  now: number
  selected: boolean
  editing: boolean
  shake: number
  buy: (it: MarketItem, from?: Element | null) => boolean
  short: () => void
  enterDelay: number
  edit: () => void
  done: () => void
  remove: () => void
}

function Card({ ref, it, s, seen, now, selected, editing, shake, buy, short, enterDelay, edit, done, remove }: CardProps) {
  // Everything the card says follows the count on screen, so nothing on it runs ahead of the coins.
  const can = seen >= it.price
  const bought = marketBought(s, it.id)
  const times = Math.floor(seen / it.price)
  const controls = useAnimationControls()
  useEffect(() => {
    if (shake) void controls.start({ x: [0, -7, 7, -4, 4, 0], transition: { duration: 0.36 } })
  }, [shake, controls])
  return (
    <motion.li
      ref={ref}
      layout="position"
      className={`market-card ${can ? '' : 'is-short'} ${selected ? 'is-selected' : ''} ${editing ? 'is-editing' : ''}`}
      data-row={it.id}
      aria-current={selected ? 'true' : undefined}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      // A leaving card goes under the ones sliding into its place, and goes quickly.
      exit={{ opacity: 0, scale: 0.96, zIndex: 0, transition: { duration: 0.12 } }}
      transition={{ delay: enterDelay, type: 'spring', stiffness: 300, damping: 28, layout: { type: 'tween', duration: 0.18, ease: 'easeOut' } }}
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
            {/* Always one line, empty or not, so every card's meter sits at the same height. */}
            <p className="market-note" title={it.note}>{it.note ?? ''}</p>
            <div className="market-meter" aria-hidden>
              <motion.span initial={false} animate={{ scaleX: Math.min(1, seen / it.price) }} transition={{ type: 'spring', stiffness: 200, damping: 30 }} />
            </div>
            <p className="market-stat">{bought.count ? `Bought ${bought.count}x, last ${ago(now - (bought.lastAt ?? now))}` : 'Never bought'}</p>
            <div className="market-foot">
              <span className={`market-need ${can ? '' : 'is-short'}`}>
                {can ? (times > 1 ? `${times}x in the wallet` : 'In the wallet') : <>Need <b className="mono num">{it.price - seen}</b> more</>}
              </span>
              <span className="market-tools">
                <button type="button" className="icon-btn" aria-label={`Edit ${it.title}`} title="Edit (r)" onClick={edit}><PencilSimple size={14} /></button>
                <button type="button" className="icon-btn" aria-label={`Remove ${it.title}`} title="Remove (x)" onClick={remove}><Trash size={14} /></button>
              </span>
              <HoldToBuy can={can} label={it.title} bought={bought.count} onBuy={(el) => buy(it, el)} onShort={short} />
            </div>
          </>
        )}
      </motion.div>
    </motion.li>
  )
}

/** Buy by holding: the fill runs across the button and the purchase lands when it is full. Enter or Space buys at once. Short, a press only says so. */
function HoldToBuy({ can, label, bought, onBuy, onShort }: { can: boolean; label: string; bought: number; onBuy: (el: HTMLElement) => boolean; onShort: () => void }) {
  const [p, setP] = useState(0)
  const hold = useRef<{ start: number; raf: number } | null>(null)
  const btn = useRef<HTMLButtonElement>(null)
  // A purchase however it was made (a hold, Enter on the card): the button fills and says Bought for
  // a moment. The timer outlives a change of count, so an Undo straight after never leaves it full.
  const seen = useRef(bought)
  const flash = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [draining, setDraining] = useState(false)
  useEffect(() => {
    const more = bought > seen.current
    seen.current = bought
    if (!more) return
    setP(1)
    if (flash.current) clearTimeout(flash.current)
    flash.current = setTimeout(() => setP(0), 320)
  }, [bought])
  useEffect(() => () => { if (flash.current) clearTimeout(flash.current) }, [])
  // Let go early: the fill drains back with Hold still on it, so the button says what it wanted.
  const stop = () => {
    if (hold.current) cancelAnimationFrame(hold.current.raf)
    const early = hold.current !== null
    hold.current = null
    if (early) {
      setDraining(true)
      setTimeout(() => setDraining(false), 260)
    }
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
      // Bought only when it was: a hold the real balance refused drains back like an early release.
      if (btn.current && onBuy(btn.current)) {
        setTimeout(() => setP(0), 220)
      } else {
        setDraining(true)
        setTimeout(() => setDraining(false), 260)
        setP(0)
      }
      return
    }
    h.raf = requestAnimationFrame(tick)
  }
  const text = p >= 1 ? 'Bought' : p > 0 || draining ? 'Hold' : can ? 'Buy' : 'Short'
  return (
    <button
      ref={btn}
      type="button"
      className={`buy ${p > 0 ? 'is-holding' : ''} ${draining ? 'is-draining' : ''} ${can ? '' : 'is-short'}`}
      aria-label={`Buy ${label}`}
      aria-disabled={!can}
      title={can ? 'Hold to buy, or press Enter' : 'Not enough coins yet'}
      style={{ ['--p' as string]: p }}
      // A mouse press never takes the keyboard: Enter always means the card picked with j and k.
      onMouseDown={(e) => e.preventDefault()}
      onPointerDown={(e) => {
        if (e.button !== 0) return
        if (!can) return onShort()
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
        if (e.repeat) return
        if (can) onBuy(e.currentTarget)
        else onShort()
      }}
    >
      <span className="buy-label caps">{text}</span>
      <span className="buy-fill" aria-hidden><span className="buy-label caps">{text}</span></span>
    </button>
  )
}

/** Whole coins, 1 to 999. The box holds what is typed and settles it on leaving; the steps stop at the ends. */
/** `onDraft` hears whether the box holds a number, so a form can wait while it is empty. */
function PriceInput({ value, set, onDraft }: { value: number; set: (n: number) => void; onDraft?: (ok: boolean) => void }) {
  const [draft, setDraft] = useState(String(value))
  useEffect(() => setDraft(String(value)), [value])
  useEffect(() => onDraft?.(/^\d+$/.test(draft)), [draft])
  // The price when the box was entered: a box emptied and left goes back to it, not to a digit typed on the way.
  const was = useRef(value)
  const clamp = (n: number) => Math.min(999, Math.max(1, Math.round(n) || 1))
  const settle = () => {
    if (!/^\d+$/.test(draft)) {
      set(was.current)
      return setDraft(String(was.current))
    }
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
          // A number typed is the price at once (Add and Save read it); an empty box commits nothing.
          if (d) set(clamp(Number(d)))
        }}
        onFocus={() => { was.current = value }}
        onBlur={settle}
      />
      {!/^\d+$/.test(draft) && <span className="price-need" role="alert">A price is needed</span>}
      <button type="button" className="icon-btn" aria-label="One coin more" disabled={value >= 999} onClick={() => set(clamp(value + 1))}><Plus size={13} /></button>
    </span>
  )
}

function AddItem() {
  const [title, setTitle] = useState('')
  const [price, setPrice] = useState(10)
  // An emptied price box holds Add back; each add starts the box afresh at 10.
  const [priceOk, setPriceOk] = useState(true)
  const [round, setRound] = useState(0)
  const [note, setNote] = useState('')
  const add = () => {
    if (!title.trim()) return
    if (!priceOk) return sfx.nope()
    sfx.place()
    dispatch({ type: 'market/add', title, price, note })
    setTitle('')
    setNote('')
    setPrice(10)
    setRound((n) => n + 1)
  }
  return (
    <form
      className="market-add"
      onSubmit={(e) => { e.preventDefault(); add() }}
      onKeyDown={(e) => {
        if (e.key !== 'Enter' || (e.target as HTMLElement).tagName !== 'INPUT') return
        e.preventDefault()
        add()
      }}
    >
      <label htmlFor="market-title" className="field-label caps">Put something up for sale</label>
      <div className="market-add-row">
        <input id="market-title" value={title} maxLength={TITLE_MAX} onChange={(e) => setTitle(e.target.value)} placeholder="Empower the next game" spellCheck={false} autoComplete="off" />
        <PriceInput key={round} value={price} set={setPrice} onDraft={setPriceOk} />
        <button type="submit" className="btn" disabled={!title.trim() || !priceOk}><Plus size={14} /> Add</button>
      </div>
      <input className="market-add-note" value={note} maxLength={NOTE_MAX} onChange={(e) => setNote(e.target.value)} placeholder="When it is allowed, in your words (optional): after a LeetCode solved in time" spellCheck={false} autoComplete="off" />
    </form>
  )
}

function EditItem({ it, done }: { it: MarketItem; done: () => void }) {
  const [title, setTitle] = useState(it.title)
  const [price, setPrice] = useState(it.price)
  // Save waits on an emptied price box, as Add does.
  const [priceOk, setPriceOk] = useState(true)
  const [note, setNote] = useState(it.note ?? '')
  const save = () => {
    // An empty title or price is not saved: the box stays open and says so.
    if (!title.trim() || !priceOk) return sfx.nope()
    sfx.tick()
    dispatch({ type: 'market/update', id: it.id, patch: { title, price, note } })
    done()
  }
  return (
    <form
      className="market-edit"
      onSubmit={(e) => { e.preventDefault(); save() }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.stopPropagation()
          done()
        } else if (e.key === 'Enter' && (e.target as HTMLElement).tagName === 'INPUT') {
          e.preventDefault()
          save()
        }
      }}
    >
      {/* Two rows, as the card shows it; Enter saves rather than starting a new line. */}
      <textarea
        autoFocus
        rows={2}
        value={title}
        maxLength={TITLE_MAX}
        onChange={(e) => setTitle(e.target.value.replace(/\n/g, ' '))}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            save()
          }
        }}
        aria-label="Title"
        placeholder="A title is needed"
        spellCheck={false}
      />
      <input value={note} maxLength={NOTE_MAX} onChange={(e) => setNote(e.target.value)} placeholder="When it is allowed (optional)" aria-label="Note" spellCheck={false} />
      <div className="market-edit-foot">
        <PriceInput value={price} set={setPrice} onDraft={setPriceOk} />
        <span className="market-edit-actions">
          <button type="button" className="btn ghost small" onClick={done}>Cancel</button>
          <button type="submit" className="btn small" disabled={!title.trim() || !priceOk}>Save</button>
        </span>
      </div>
    </form>
  )
}
