import { useEffect, useState } from 'react'
import { motion, useReducedMotion, useTransform } from 'motion/react'
import { X } from '@phosphor-icons/react'
import { balance, type MayorlyState } from '@core/index'
import { useLean } from '../lib/parallax'
import { sfx } from '../lib/sound'
import { FlowTab } from './FlowTab'
import { RecordTab } from './RecordTab'
import { SettingsTab } from './SettingsTab'
import { ShelfTab } from './ShelfTab'
import { SupersetsTab } from './SupersetsTab'

const TABS = ['Flow', 'Shelf', 'Supersets', 'Record', 'Settings'] as const
type Tab = (typeof TABS)[number]

let remembered: Tab = 'Flow'

export function Deck({ s, close, kind }: { s: MayorlyState; close: () => void; kind: 'electron' | 'web' }) {
  const [tab, setTabState] = useState<Tab>(remembered)
  const reduce = useReducedMotion()
  const lean = useLean(1.4)
  const rotateX = useTransform(lean.rotateX, (r) => 3 + r)
  const rotateY = lean.rotateY

  const setTab = (t: Tab) => {
    remembered = t
    setTabState(t)
    sfx.tick()
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = (e.target as HTMLElement)?.closest?.('input, textarea, select')
      if (e.key === 'Escape') {
        if (typing) (typing as HTMLElement).blur()
        else close()
        return
      }
      if (typing || e.altKey || e.ctrlKey) return
      const i = TABS.indexOf(remembered)
      if (e.key === 'q' || e.key === 'Q') setTab(TABS[(i + TABS.length - 1) % TABS.length])
      if (e.key === 'e' || e.key === 'E') setTab(TABS[(i + 1) % TABS.length])
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [close])

  return (
    <motion.div
      className="deck-wrap"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, transition: { duration: 0.18 } }}
      onMouseDown={(e) => e.target === e.currentTarget && close()}
    >
      <motion.section
        className="deck"
        style={{ rotateX, rotateY }}
        initial={reduce ? false : { z: -120, opacity: 0 }}
        animate={{ z: 0, opacity: 1 }}
        transition={{ type: 'spring', stiffness: 180, damping: 24 }}
        aria-label="Deck"
      >
        <header className="deck-head">
          <span className="deck-mark caps">Mayorly</span>
          <nav className="tabs" role="tablist">
            <span className="key">Q</span>
            {TABS.map((t) => (
              <button key={t} role="tab" aria-selected={tab === t} className={`tab caps ${tab === t ? 'on' : ''}`} onClick={() => setTab(t)}>
                {t}
                {tab === t && <motion.i layoutId="tab-bar" className="tab-bar" />}
              </button>
            ))}
            <span className="key">E</span>
          </nav>
          <span className="deck-balance">
            <span className="mono num">{balance(s).toLocaleString()}</span>
            <span className="caps dim">Tokens</span>
          </span>
          <button className="deck-close" onClick={close} aria-label="Close deck">
            <X size={18} />
          </button>
        </header>

        <div className="deck-body">
          {tab === 'Flow' && <FlowTab s={s} />}
          {tab === 'Shelf' && <ShelfTab s={s} />}
          {tab === 'Supersets' && <SupersetsTab s={s} />}
          {tab === 'Record' && <RecordTab s={s} />}
          {tab === 'Settings' && <SettingsTab s={s} kind={kind} />}
        </div>
      </motion.section>
    </motion.div>
  )
}
