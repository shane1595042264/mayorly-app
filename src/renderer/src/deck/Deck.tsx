import { useEffect, useRef, useState } from 'react'
import { motion, useReducedMotion, useTransform } from 'motion/react'
import { X } from '@phosphor-icons/react'
import { balance, type MayorlyState } from '@core/index'
import { useLean } from '../lib/parallax'
import { sfx } from '../lib/sound'
import { actionFor, keymapOpen, recordUse } from '../lib/keymap'
import { current } from '../store'
import { FlowTab } from './FlowTab'
import { Keymap } from './Keymap'
import { LeisureTab } from './LeisureTab'
import { RecordTab } from './RecordTab'
import { SettingsTab } from './SettingsTab'
import { ShelfTab } from './ShelfTab'
import { SupersetsTab } from './SupersetsTab'

const TABS = ['Flow', 'Shelf', 'Supersets', 'Leisure', 'Record', 'Settings'] as const
type Tab = (typeof TABS)[number]

let remembered: Tab = 'Flow'

export function Deck({ s, close, kind }: { s: MayorlyState; close: () => void; kind: 'electron' | 'web' }) {
  // A shelf with no ledgers is where a new install starts.
  const [tab, setTabState] = useState<Tab>(() => (s.ledgers.length === 0 && remembered === 'Flow' ? 'Shelf' : remembered))
  const [keymap, setKeymap] = useState(false)
  const panel = useRef<HTMLElement>(null)
  useEffect(() => panel.current?.focus(), [])
  const reduce = useReducedMotion()
  const lean = useLean(1.4)
  const rotateX = useTransform(lean.rotateX, (r) => 3 + r)
  const rotateY = lean.rotateY

  const setTab = (t: Tab) => {
    remembered = t
    setTabState(t)
    sfx.tick()
  }

  // The deck's own keys, from the keymap: close, the tabs, and the Keymap screen itself.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (keymapOpen()) return
      const typing = (e.target as HTMLElement | null)?.closest?.('input, textarea, select')
      if (typing) {
        if (e.key === 'Escape') (typing as HTMLElement).blur()
        return
      }
      if (e.altKey || e.ctrlKey || e.metaKey) return
      const st = current()
      const a = st ? actionFor(e, 'deck', st.settings) : null
      const i = TABS.indexOf(remembered)
      if (a === 'deck.close') close()
      else if (a === 'deck.prevTab') setTab(TABS[(i + TABS.length - 1) % TABS.length])
      else if (a === 'deck.nextTab') setTab(TABS[(i + 1) % TABS.length])
      else if (a === 'deck.keymap') setKeymap(true)
      else if (!a && !e.shiftKey && /^[1-6]$/.test(e.key)) setTab(TABS[Number(e.key) - 1])
      else return
      e.preventDefault()
      recordUse(a ?? 'deck.tab')
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
        role="dialog"
        aria-modal="true"
        aria-label="Deck"
        tabIndex={-1}
        ref={panel}
      >
        <header className="deck-head">
          <span className="deck-mark caps">Mayorly</span>
          <nav className="tabs" role="tablist">
            <span className="key">Q</span>
            {TABS.map((t) => (
              <button key={t} id={`tab-${t}`} role="tab" aria-selected={tab === t} aria-controls="deck-panel" className={`tab caps ${tab === t ? 'on' : ''}`} onClick={() => setTab(t)}>
                {t}
                {tab === t && <motion.i layoutId="tab-bar" className="tab-bar" />}
              </button>
            ))}
            <span className="key">E</span>
          </nav>
          <span className="deck-balance">
            <span className="mono num">{balance(s).toLocaleString()}</span>
            <span className="caps dim">Coins</span>
          </span>
          <button className="deck-close" onClick={close} aria-label="Close deck">
            <X size={18} />
          </button>
        </header>

        <div className="deck-body" role="tabpanel" id="deck-panel" aria-labelledby={`tab-${tab}`}>
          {tab === 'Flow' && <FlowTab s={s} />}
          {tab === 'Shelf' && <ShelfTab s={s} />}
          {tab === 'Supersets' && <SupersetsTab s={s} />}
          {tab === 'Leisure' && <LeisureTab s={s} />}
          {tab === 'Record' && <RecordTab s={s} />}
          {tab === 'Settings' && <SettingsTab s={s} kind={kind} openKeymap={() => setKeymap(true)} />}
        </div>
        {keymap && <Keymap s={s} close={() => setKeymap(false)} />}
      </motion.section>
    </motion.div>
  )
}
