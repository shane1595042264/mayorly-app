import { useCallback, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { span, type HudEvent } from '@core/index'
import { current, useHudEvents } from '../store'

interface Line {
  id: number
  score?: string
  text: string
}

let seq = 0

/** Kill-feed style event lines: what the desk just did, gone in a few seconds. */
export function Feed() {
  const [lines, setLines] = useState<Line[]>([])

  const push = useCallback((l: Omit<Line, 'id'>) => {
    const id = ++seq
    setLines((cur) => [...cur.slice(-4), { ...l, id }])
    setTimeout(() => setLines((cur) => cur.filter((x) => x.id !== id)), 6000)
  }, [])

  const code = (id: string | null) => current()?.ledgers.find((l) => l.id === id)?.code ?? 'FREE'

  useHudEvents(
    useCallback(
      (events: HudEvent[]) => {
        for (const e of events) {
          if (e.type === 'tomato') push({ score: `+${e.tokens}`, text: e.n === 3 ? `Tomato ${e.n}  long-grind bonus` : `Tomato ${e.n}` })
          else if (e.type === 'swap') push({ text: `Swap  ${code(e.ledgerId)}` })
          else if (e.type === 'cleared') push({ text: `Cleared  ${e.title}` })
          else if (e.type === 'notice') push({ text: e.text })
          else if (e.type === 'sitting-end' && e.focusMs > 0) push({ text: `Sitting  ${span(e.focusMs)}  ${e.tomatoes} tomatoes` })
        }
      },
      [push],
    ),
  )

  return (
    <ol className="feed" aria-live="polite">
      <AnimatePresence initial={false}>
        {lines.map((l) => (
          <motion.li
            key={l.id}
            layout
            initial={{ opacity: 0, x: 28 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, transition: { duration: 0.4 } }}
            transition={{ type: 'spring', stiffness: 220, damping: 26 }}
          >
            {l.score && <b className="num">{l.score}</b>}
            <span>{l.text}</span>
          </motion.li>
        ))}
      </AnimatePresence>
    </ol>
  )
}
