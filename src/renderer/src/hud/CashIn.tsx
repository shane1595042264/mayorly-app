import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import coin from '../assets/coin@1x.png'
import { sfx } from '../lib/sound'

// The harvest, seen: coins fly from the tomato to a counter in the top right, the
// balance counts up as they land, a last ding, and it all fades. Pointer events never
// reach it. The coin is the founder's hand-drawn icon.coin at whole-pixel scale.

interface Props {
  amount: number
  balance: number
  from: { x: number; y: number }
  onDone: () => void
}

/** More coins than this fly as this many; the counter still adds the whole amount. */
const MAX_COINS = 8
const FLIGHT_MS = 720
const STAGGER_MS = 90

export function CashIn({ amount, balance, from, onDone }: Props) {
  const coins = Math.max(1, Math.min(MAX_COINS, amount))
  const [shown, setShown] = useState(balance - amount)
  const [landed, setLanded] = useState(0)
  const [gone, setGone] = useState(false)
  const target = useRef<HTMLDivElement>(null)
  const [to, setTo] = useState<{ x: number; y: number } | null>(null)

  useEffect(() => {
    const r = target.current?.getBoundingClientRect()
    if (r) setTo({ x: r.left + r.width / 2, y: r.top + r.height / 2 })
  }, [])

  // Each landing adds its share; the last one rounds to the exact balance.
  const land = (i: number) => {
    sfx.coin(i)
    setLanded((n) => n + 1)
    setShown(i === coins - 1 ? balance : Math.round(balance - amount + ((i + 1) / coins) * amount))
  }

  useEffect(() => {
    if (landed < coins) return
    sfx.cashIn()
    const t = setTimeout(() => setGone(true), 1100)
    return () => clearTimeout(t)
  }, [landed, coins])

  return (
    <div className="cashin" aria-live="polite">
      <AnimatePresence onExitComplete={onDone}>
        {!gone && (
          <motion.div
            key="counter"
            ref={target}
            className="cashin-counter"
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0, scale: landed > 0 && landed < coins ? [1, 1.06, 1] : 1 }}
            exit={{ opacity: 0, y: -8, transition: { duration: 0.35 } }}
            transition={{ type: 'spring', stiffness: 260, damping: 22 }}
          >
            <img className="cashin-coin-icon" src={coin} alt="" />
            <span className="cashin-num num">{shown.toLocaleString()}</span>
            <span className="cashin-plus mono num">+{amount}</span>
          </motion.div>
        )}
        {!gone && to && Array.from({ length: coins }, (_, i) => (
          <motion.img
            key={`c${i}`}
            className="cashin-coin"
            src={coin}
            alt=""
            initial={{ x: from.x - 16, y: from.y - 16, opacity: 0, scale: 0.6, rotate: 0 }}
            animate={{
              x: [from.x - 16, (from.x + to.x) / 2 - 16 + (i % 2 ? 40 : -40), to.x - 16],
              y: [from.y - 16, Math.min(from.y, to.y) - 140 - i * 12, to.y - 16],
              opacity: [0, 1, 1, 0],
              scale: [0.6, 1.1, 0.7],
              rotate: [0, 180 + i * 20, 360 + i * 20],
            }}
            transition={{ duration: FLIGHT_MS / 1000, delay: (i * STAGGER_MS) / 1000, ease: 'easeInOut', times: [0, 0.5, 1] }}
            onAnimationComplete={() => land(i)}
          />
        ))}
      </AnimatePresence>
    </div>
  )
}
