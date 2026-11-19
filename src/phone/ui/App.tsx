import { useCallback, useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { onFeel, tap } from '../feel'
import { Couch as CouchIcon, GearSix, Plus, SquaresFour, Timer as TimerIcon } from '@phosphor-icons/react'
import { Capture } from './Capture'
import { Couch } from './Couch'
import { Ledgers } from './Ledgers'
import { Picker } from './Picker'
import { Settings } from './Settings'
import { Timer } from './Timer'

// Four places, the desk first, and the inbox in the middle of them: one tap from anywhere to type
// or say a task. The picker and the capture are sheets over whichever place is open.

type Tab = 'desk' | 'ledgers' | 'couch' | 'settings'
const TABS = [
  { id: 'desk', label: 'Desk', icon: TimerIcon },
  { id: 'ledgers', label: 'Ledgers', icon: SquaresFour },
  { id: 'couch', label: 'Couch', icon: CouchIcon },
  { id: 'settings', label: 'Settings', icon: GearSix },
] as const

export function App() {
  const [tab, setTab] = useState<Tab>(() => (new URLSearchParams(location.search).get('tab') as Tab) || 'desk')
  const [picking, setPicking] = useState(() => new URLSearchParams(location.search).has('pick'))
  const closePicker = useCallback(() => setPicking(false), [])
  const [capturing, setCapturing] = useState(() => new URLSearchParams(location.search).has('capture'))
  const closeCapture = useCallback(() => setCapturing(false), [])
  // Starting anything, from any sheet or tab, brings the timer to the front: you see it running.
  useEffect(() => onFeel((f) => {
    if (f !== 'start') return
    setPicking(false)
    setCapturing(false)
    setTab('desk')
  }), [])
  const go = (t: Tab) => {
    if (t !== tab) tap()
    setTab(t)
  }
  return (
    <div className="app">
      <AnimatePresence mode="wait" initial={false}>
        <motion.main
          className="screen"
          key={tab}
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
        >
          {tab === 'desk' && <Timer openPicker={() => setPicking(true)} openSync={() => setTab('settings')} />}
          {tab === 'ledgers' && <Ledgers />}
          {tab === 'couch' && <Couch />}
          {tab === 'settings' && <Settings />}
        </motion.main>
      </AnimatePresence>
      <nav className="tabbar" aria-label="Places">
        {TABS.map((t, i) => (
          <span key={t.id} style={{ display: 'contents' }}>
            {i === 2 && (
              <button type="button" className="tab capture-tab" onClick={() => { tap(); setCapturing(true) }} aria-label="Capture a task">
                <motion.span className="capture-dot" whileTap={{ scale: 0.86, rotate: 90 }} transition={{ type: 'spring', stiffness: 520, damping: 26 }}><Plus size={24} weight="bold" aria-hidden /></motion.span>
              </button>
            )}
            <motion.button type="button" className="tab" aria-current={tab === t.id ? 'page' : undefined} onClick={() => go(t.id)} whileTap={{ scale: 0.9 }}>
              <t.icon size={24} weight={tab === t.id ? 'fill' : 'regular'} aria-hidden />
              {t.label}
              {tab === t.id && <motion.i layoutId="tab-dot" className="tab-dot" transition={{ type: 'spring', stiffness: 500, damping: 34 }} />}
            </motion.button>
          </span>
        ))}
      </nav>
      <AnimatePresence>{picking && <Picker key="picker" onClose={closePicker} />}</AnimatePresence>
      <AnimatePresence>{capturing && <Capture key="capture" onClose={closeCapture} />}</AnimatePresence>
    </div>
  )
}
