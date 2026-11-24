import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { AnimatePresence, motion, type TransformProperties } from 'motion/react'
import { art, specOf } from '../lib/art'
import { Pixel, PixelAnim } from '../lib/Pixel'
import { PixelNumber } from '../lib/PixelNumber'
import { setShownCoins } from '../lib/coinView'
import { sfx } from '../lib/sound'
import { Wobble } from './Wobble'

// The harvest, seen: coins fly from the tomato to a counter in the top right, the
// balance counts up as they land, a last ding, and it all fades. Pointer events never
// reach it. The coin is the founder's hand-drawn icon.coin at whole-pixel scale.
// `out` is the couch's coin, taken: the counter shows the balance before, a coin leaves
// it for the tomato, the count goes down as it lands, and the sound falls instead of rising.
// Once the founder draws the coin turning (icon.coin.spin), each flying coin plays that strip
// and only travels, on whole pixels; until then it turns and swells by CSS as it always has.
// Balatro's money: every coin that lands hits. The counter jolts and flashes, its number hops,
// sparks burst from it and a little +1 flies off; the last coin slams the whole amount in, big,
// letters dancing. Spending does the same in red. The jolt is whole pixels on the CSS `translate`
// property, apart from Motion's own transform, and the founder's coin and digits are never scaled.

interface Props {
  amount: number
  /** The balance after. */
  balance: number
  from: { x: number; y: number }
  out?: boolean
  /** A count already on screen (the open deck's): the coins fly to or from it and no counter of its own shows. */
  anchor?: { x: number; y: number } | null
  /** The highest the arc may go, in CSS pixels: the open deck's top edge. */
  ceiling?: number
  /** Where the count starts: the number on screen when another flight was still landing. */
  startAt?: number | null
  onDone: () => void
}

/** More coins than this fly as this many; the counter still adds the whole amount. */
const MAX_COINS = 8
const FLIGHT_MS = 720
const STAGGER_MS = 90
/** The coins at 2x, 32 px, in the air and on the counter. */
const COIN_SCALE = 2
/** The drawn spin's speed: four frames, two and a half turns a second. */
const SPIN_FPS = 10
/** The counter's number in the founder's digits: 18x24 a glyph, about the height of its 30 px text. */
const COUNT_SCALE = 3

/** The sparks a landing throws: which way and how far, the same every time. */
const SPARKS = Array.from({ length: 10 }, (_, k) => {
  const a = (k / 10) * Math.PI * 2 + (k % 3) * 0.21
  const len = 34 + ((k * 23) % 5) * 9
  return { dx: Math.round(Math.cos(a) * len), dy: Math.round(Math.sin(a) * len) - 10, r: (k * 47) % 180 }
})
const BURST_MS = 700

/** Plays a stylesheet animation again from its start. */
function restart(el: Element | null | undefined, cls: string) {
  if (!el) return
  el.classList.remove(cls)
  void (el as HTMLElement).offsetWidth
  el.classList.add(cls)
}

const whole = (v: string | number | undefined): number => Math.round(parseFloat(String(v ?? 0)) || 0)
/** Motion's translation on whole pixels and nothing else, so a drawn coin never lands between two. */
const wholePixels = (t: TransformProperties): string => {
  const x = whole(t.x)
  const y = whole(t.y)
  return x || y ? `translate(${x}px, ${y}px)` : 'none'
}

export function CashIn({ amount, balance, from, out: spend = false, anchor = null, ceiling = 8, startAt = null, onDone }: Props) {
  const start = startAt ?? (spend ? balance + amount : balance - amount)
  // Coins go the way the count goes: a purchase landing on a refund still rising flies in.
  const out = start === balance ? spend : start > balance
  // Coins for the distance the count has to travel: none when an Undo came before any coin landed.
  const coins = start === balance ? 0 : Math.max(1, Math.min(MAX_COINS, Math.abs(balance - start)))
  // The arc over the flight: high to the corner counter, low to a count in the open deck, and never off the screen.
  const lift = anchor ? 36 : 140
  const [shown, setShown] = useState(start)
  // With the deck open its own counts (the header, the wallet) say what the coins say until they land.
  useEffect(() => {
    if (!anchor) return
    setShownCoins(shown)
  }, [anchor, shown])
  useEffect(() => () => setShownCoins(null), [])
  const [landed, setLanded] = useState(0)
  const [bursts, setBursts] = useState<{ seq: number; n: number }[]>([])
  const shownRef = useRef(start)
  const [gone, setGone] = useState(false)
  const target = useRef<HTMLDivElement>(null)
  const [to, setTo] = useState<{ x: number; y: number } | null>(null)

  useEffect(() => {
    if (anchor) return setTo(anchor)
    const r = target.current?.getBoundingClientRect()
    if (r) setTo({ x: r.left + r.width / 2, y: r.top + r.height / 2 })
  }, [])

  // Each landing moves the count by its share; the last one rounds to the exact balance. And it hits.
  const land = (i: number) => {
    if (out) sfx.coinOut(i)
    else sfx.coin(i)
    setLanded((n) => n + 1)
    const next = i === coins - 1 ? balance : Math.round(start + ((balance - start) * (i + 1)) / coins)
    const share = Math.abs(next - shownRef.current)
    shownRef.current = next
    setShown(next)
    setBursts((b) => [...b.slice(-5), { seq: i, n: share }])
    setTimeout(() => setBursts((b) => b.filter((x) => x.seq !== i)), BURST_MS)
    const counter = target.current
    restart(counter, 'is-hit')
    const num = counter?.querySelector('.cashin-num')
    // The founder's digits only hop, on whole pixels; text may swell.
    restart(num, num?.classList.contains('px-num') ? 'is-hop' : 'is-pop')
    if (anchor) restart(document.querySelector('.deck-balance .num'), 'is-pop')
  }

  useEffect(() => {
    if (landed < coins) return
    if (anchor) setShownCoins(null)
    if (coins === 0) {
      // Nothing to fly: an Undo that came before any coin landed. The count is already right.
      onDone()
      return
    }
    if (out) sfx.spend()
    else sfx.cashIn()
    const t = setTimeout(() => setGone(true), 1100)
    return () => clearTimeout(t)
  }, [landed, coins])

  // The drawn spin, once it exists; until then the plain coin turns by CSS.
  const spin = !!art('icon.coin.spin')
  const spinFrames = specOf('icon.coin.spin').frames

  return (
    <div className="cashin" aria-live="polite">
      <AnimatePresence onExitComplete={onDone}>
        {!gone && !anchor && (
          <motion.div
            key="counter"
            ref={target}
            className={`cashin-counter ${out ? 'is-spend' : ''}`}
            initial={{ opacity: 0, y: -10 }}
            // Never scaled: the coin and the digits are drawn on whole pixels. (The 6% swell a landing
            // once asked for never played: a spring only goes from its first keyframe to its last.)
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8, transition: { duration: 0.35 } }}
            transition={{ type: 'spring', stiffness: 260, damping: 22 }}
            transformTemplate={wholePixels}
          >
            <Pixel id="icon.coin" scale={COIN_SCALE} className="cashin-coin-icon" />
            <PixelNumber
              text={String(shown)}
              scale={COUNT_SCALE}
              className="cashin-num"
              fallback={<span className="cashin-num num">{shown.toLocaleString()}</span>}
            />
            <span className={`mono num ${out ? 'cashin-minus' : 'cashin-plus'}`}>{out ? `-${amount}` : `+${amount}`}</span>
          </motion.div>
        )}
        {!gone && to && Array.from({ length: coins }, (_, i) => {
          const x = out ? [to.x - 16, (from.x + to.x) / 2 - 16 + (i % 2 ? 40 : -40), from.x - 16] : [from.x - 16, (from.x + to.x) / 2 - 16 + (i % 2 ? 40 : -40), to.x - 16]
          const y = out ? [to.y - 16, Math.max(ceiling, Math.min(from.y, to.y) - lift - i * 12), from.y - 16] : [from.y - 16, Math.max(ceiling, Math.min(from.y, to.y) - lift - i * 12), to.y - 16]
          const timing = { duration: FLIGHT_MS / 1000, delay: (i * STAGGER_MS) / 1000, ease: 'easeInOut' as const, times: [0, 0.5, 1] }
          // The drawn spin: the strip turns the coin, and the coin only travels. Each starts on its own
          // frame, so a handful of coins never turn in step.
          if (spin) {
            return (
              <motion.span
                key={`c${i}`}
                className="cashin-coin is-spin"
                initial={{ x: from.x - 16, y: from.y - 16, opacity: 0 }}
                animate={{ x, y, opacity: [0, 1, 1, 0] }}
                transition={timing}
                transformTemplate={wholePixels}
                onAnimationComplete={() => land(i)}
              >
                <PixelAnim id="icon.coin.spin" scale={COIN_SCALE} fps={SPIN_FPS} style={{ display: 'block', animationDelay: `${-(i % spinFrames) / SPIN_FPS}s` }} />
              </motion.span>
            )
          }
          return (
            <motion.img
              key={`c${i}`}
              className="cashin-coin"
              src={art('icon.coin')}
              alt=""
              initial={{ x: from.x - 16, y: from.y - 16, opacity: 0, scale: 0.6, rotate: 0 }}
              animate={{
                x,
                y,
                opacity: [0, 1, 1, 0],
                // Into a count in the deck the coins shrink as they arrive, so its digits stay readable.
                scale: anchor && !out ? [0.6, 1.1, 0.4] : anchor ? [0.4, 1.1, 0.7] : [0.6, 1.1, 0.7],
                rotate: [0, 180 + i * 20, 360 + i * 20],
              }}
              transition={timing}
              onAnimationComplete={() => land(i)}
            />
          )
        })}
      </AnimatePresence>
      {to && bursts.map((b) => (
        <span key={b.seq} className={`cashin-burst ${out ? 'is-out' : ''}`} style={{ left: to.x, top: to.y }}>
          {SPARKS.map((sp, k) => (
            <i key={k} className="cashin-spark" style={{ '--dx': `${sp.dx}px`, '--dy': `${sp.dy}px`, '--r': `${sp.r}deg`, animationDelay: `${(k % 3) * 12}ms` } as CSSProperties} />
          ))}
          {b.n > 0 && <b className="cashin-chip mono">{out ? '-' : '+'}{b.n}</b>}
        </span>
      ))}
      {to && coins > 0 && landed >= coins && !gone && (
        <span className={`cashin-total ${out ? 'is-out' : ''} ${anchor ? 'is-deck' : ''}`} style={{ left: to.x, top: to.y }}>
          <Wobble text={`${out ? '-' : '+'}${amount}`} />
        </span>
      )}
    </div>
  )
}
