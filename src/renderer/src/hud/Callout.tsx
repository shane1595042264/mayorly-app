import { useCallback, useRef, useState } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { clock, span, type HudEvent } from '@core/index'
import { sfx } from '../lib/sound'
import { current, useHudEvents } from '../store'

interface Shout {
  id: number
  kicker: string
  title: string
  detail: string
}

/** Centre-screen announcement when the desk changes what you are doing. */
/** Shown in field mode only; inside the Plus menu the slab itself shows the change. */
export function Callout({ quiet }: { quiet: boolean }) {
  const [shout, setShout] = useState<Shout | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const reduce = useReducedMotion()

  const show = (x: Omit<Shout, 'id'>) => {
    setShout({ ...x, id: Date.now() })
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => setShout(null), 2200)
  }

  useHudEvents(
    useCallback(
      (events: HudEvent[]) => {
        const s = current()
        if (!s) return
        for (const e of events) {
          if (e.type === 'block') {
            const b = e.block
            const ledger = s.ledgers.find((l) => l.id === b.ledgerId)
            const entry = s.entries.find((x) => x.id === b.entryId)
            const length = b.durationMs ? clock(b.durationMs) : 'open'
            if (b.kind === 'rest') {
              show({ kicker: 'Stand easy', title: b.label, detail: `${length}${e.started ? '' : '   waiting for you'}` })
            } else {
              const mode = s.desk.plan?.mode
              show({
                kicker: mode === 'superset' ? `Round ${b.round}` : mode === 'blitz' ? 'Blitz' : 'Focus',
                title: ledger?.name ?? b.label,
                detail: `${entry ? entry.title + '   ' : ''}${length}${e.started ? '' : '   ready'}`,
              })
            }
            sfx.block()
          } else if (e.type === 'sitting-end') {
            const title = e.reason === 'complete' ? 'Rotation complete' : e.reason === 'flow-clear' ? 'Flow clear' : 'Stood down'
            show({ kicker: 'Sitting', title, detail: `${span(e.focusMs)}   ${e.tomatoes} tomatoes   +${e.tokens} tokens` })
          } else if (e.type === 'tomato') {
            sfx.tomato()
          } else if (e.type === 'swap') {
            sfx.swap()
          }
        }
      },
      [],
    ),
  )

  return (
    <div className="callout-wrap" aria-live="assertive">
      <AnimatePresence mode="wait">
        {shout && !quiet && (
          <motion.div
            key={shout.id}
            className="callout"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8, transition: { duration: 0.35 } }}
            transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
          >
            <div className="callout-kicker caps">{shout.kicker}</div>
            <motion.div
              className="callout-title"
              initial={reduce ? false : { letterSpacing: '0.6em', opacity: 0 }}
              animate={{ letterSpacing: '0.1em', opacity: 1 }}
              transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
            >
              {shout.title}
            </motion.div>
            <div className="callout-detail">{shout.detail}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
