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
import { dismissToast, useToast } from '../toast'

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
  const toast = useToast()
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
  // Which way a tab change slides: toward the tab's place in the bar.
  const [dir, setDir] = useState(1)
  const order = TABS.map((t) => t.id as Tab)
  // Tapping the tab you are on takes that place back to its top: the shelf from inside a ledger.
  const [home, setHome] = useState(0)
  const go = (t: Tab) => {
    if (t === tab) {
      tap()
      setHome((n) => n + 1)
      document.querySelector('.stage > .screen')?.scrollTo({ top: 0, behavior: 'smooth' })
      return
    }
    tap()
    setDir(order.indexOf(t) > order.indexOf(tab) ? 1 : -1)
    setTab(t)
  }
  useEffect(() => onFeel((f) => {
    if (f === 'start') setDir(-1)
  }), [])
  // A sheet opening sends the toast away, so nothing sits over the sheet's buttons.
  useEffect(() => { if (picking || capturing) dismissToast() }, [picking, capturing])
  return (
    <div className="app">
      <div className="stage">
      <AnimatePresence initial={false} custom={dir}>
        <motion.main
          className="screen"
          key={tab}
          custom={dir}
          variants={{
            // The new screen slides across on its own ground, over the old one, which slips back
            // and dims: an iOS push, so the two never mix into one picture.
            enter: (d: number) => ({ x: `${d * 100}%`, zIndex: 2 }),
            center: { x: '0%', zIndex: 2, transition: { type: 'spring', stiffness: 360, damping: 38 } },
            leave: (d: number) => ({ x: `${d * -28}%`, opacity: 0.4, zIndex: 1, transition: { type: 'spring', stiffness: 360, damping: 38 } }),
          }}
          initial="enter"
          animate="center"
          exit="leave"
        >
          {tab === 'desk' && <Timer openPicker={() => { tap(); setPicking(true) }} openSync={() => setTab('settings')} />}
          {tab === 'ledgers' && <Ledgers home={home} />}
          {tab === 'couch' && <Couch />}
          {tab === 'settings' && <Settings />}
        </motion.main>
      </AnimatePresence>
      </div>
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
      <AnimatePresence>
        {toast && (
          <motion.div key={toast.id} className="toast" role="status" initial={{ opacity: 0, y: 24, scale: 0.96 }} animate={{ opacity: 1, y: 0, scale: 1, transition: { type: 'spring', stiffness: 520, damping: 34, delay: 0.22 } }} exit={{ opacity: 0, y: 12, transition: { duration: 0.14 } }} transition={{ type: 'spring', stiffness: 520, damping: 34 }}>
            <span>{toast.text}</span>
            {toast.undo && <motion.button type="button" whileTap={{ scale: 0.92 }} onClick={() => { tap(); toast.undo?.(); dismissToast() }}>Undo</motion.button>}
          </motion.div>
        )}
      </AnimatePresence>
      <AnimatePresence>{picking && <Picker key="picker" onClose={closePicker} />}</AnimatePresence>
      <AnimatePresence>{capturing && <Capture key="capture" onClose={closeCapture} />}</AnimatePresence>
    </div>
  )
}
