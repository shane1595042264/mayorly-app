import { AnimatePresence, motion } from 'motion/react'
import { Check } from '@phosphor-icons/react'
import { blockView, objectives, type MayorlyState } from '@core/index'
import type { UiMode } from '../../../shared/bridge'
import { useNow } from '../store'

/** Superset slots as conquest-style objectives across the top of the screen. */
export function Objectives({ s, mode }: { s: MayorlyState; mode: UiMode }) {
  const now = useNow(1000)
  const obj = objectives(s)
  const progress = blockView(s, now)?.progress ?? 0
  const show = obj && mode !== 'deck'

  return (
    <AnimatePresence>
      {show && (
        <motion.section
          className="objectives"
          initial={{ opacity: 0, y: -16 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -16 }}
          transition={{ type: 'spring', stiffness: 140, damping: 22 }}
          aria-label="Superset rotation"
        >
          <div className="obj-name caps">
            <span>{obj.name}</span>
            <span className="mono num dim">
              R{obj.round}
              {obj.rounds ? `/${obj.rounds}` : ''}
            </span>
          </div>
          <ol className="obj-row">
            {obj.slots.map((o) => (
              <li key={o.key} className={`obj obj-${o.state}`}>
                <span className="obj-box">
                  {o.state === 'done' ? <Check size={14} weight="bold" /> : o.letter}
                  {o.state === 'active' && <i className="obj-fill" style={{ transform: `scaleX(${progress})` }} />}
                </span>
                <span className="obj-code mono">{o.code}</span>
                <span className="obj-min mono num">{o.minutes}m</span>
              </li>
            ))}
          </ol>
        </motion.section>
      )}
    </AnimatePresence>
  )
}
