import { useCallback, useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { onFeel, tap } from '../feel'
import { Couch as CouchIcon, GearSix, Plus, SquaresFour, Timer as TimerIcon } from '@phosphor-icons/react'
import { Capture } from './Capture'
import { Couch } from './Couch'
import { Ledgers } from './Ledgers'
import { Picker } from './Picker'
import { Settings } from './Settings'
import { Timer } from './Timer'
import { dismissToast, showToast, useToast } from '../toast'
import { blockView, clock } from '@core/index'
import { current, useMayorly, useNow } from '../store'

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
  // Each opening is a new picker, so a quick reopen never brings back the last search.
  const [opens, setOpens] = useState(0)
  const kbProxy = useRef<HTMLInputElement>(null)
  const openPicker = () => {
    tap()
    kbProxy.current?.focus({ preventScroll: true })
    setOpens((n) => n + 1)
    setPicking(true)
  }
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
  // A block that turns over while another place is open is said in a toast, not only heard.
  const tabRef = useRef(tab)
  tabRef.current = tab
  useEffect(() => onFeel((f) => {
    if (f !== 'block' || tabRef.current === 'desk') return
    setTimeout(() => {
      const s = current()
      const b = s.desk.block
      if (!b || s.desk.status === 'idle') return
      const title = s.entries.find((e) => e.id === b.entryId)?.title ?? s.leisure.find((x) => x.id === b.leisureId)?.title
      const mins = b.durationMs ? `, ${Math.round(b.durationMs / 60_000)} min` : ''
      showToast(b.kind === 'rest' ? `${b.label || 'Rest'}${mins}` : `${b.kind === 'leisure' ? 'Couch' : 'Focus'}${title ? `: ${title}` : mins}`)
    }, 0)
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
          {tab === 'desk' && <Timer openPicker={openPicker} openSync={() => setTab('settings')} />}
          {tab === 'ledgers' && <Ledgers home={home} onSearch={openPicker} />}
          {tab === 'couch' && <Couch onSearch={openPicker} />}
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
              {t.id === 'desk' && tab !== 'desk' ? <DeskLabel /> : t.label}
              {tab === t.id && <motion.i layoutId="tab-dot" className="tab-dot" transition={{ type: 'spring', stiffness: 500, damping: 34 }} />}
            </motion.button>
          </span>
        ))}
      </nav>
      {/* One toast at a time: the last leaves before the next comes, never text over text. */}
      <AnimatePresence mode="wait">
        {toast && (
          <motion.div key={toast.id} className="toast" role="status" initial={{ clipPath: 'inset(50% 50% 50% 50% round 14px)', y: 10 }} animate={{ clipPath: 'inset(0% 0% 0% 0% round 14px)', y: 0, transition: { type: 'spring', stiffness: 520, damping: 34, delay: 0.22 } }} exit={{ clipPath: 'inset(50% 0% 50% 0% round 14px)', transition: { duration: 0.16 } }} transition={{ type: 'spring', stiffness: 520, damping: 34 }}>
            <span>{toast.text}</span>
            {toast.undo && <motion.button type="button" whileTap={{ scale: 0.92 }} onClick={() => { tap(); toast.undo?.(); dismissToast() }}>Undo</motion.button>}
          </motion.div>
        )}
      </AnimatePresence>
      {/* A stand-in field focused inside the tap that opens the picker: iOS raises the keyboard only
          for a focus a touch made, and keeps it up as focus moves on to the picker's search. */}
      <input ref={kbProxy} className="kb-proxy" aria-hidden tabIndex={-1} />
      <AnimatePresence>{picking && <Picker key={`picker-${opens}`} onClose={closePicker} />}</AnimatePresence>
      <AnimatePresence>{capturing && <Capture key="capture" onClose={closeCapture} />}</AnimatePresence>
    </div>
  )
}

/** Off the desk, the Desk tab shows what is left of the block, so a running clock is always in sight. */
function DeskLabel() {
  const s = useMayorly()
  const now = useNow(1000)
  const v = blockView(s, now)
  if (!v || s.desk.status === 'idle') return <>Desk</>
  const left = v.block.durationMs === null ? null : Math.max(0, v.block.durationMs - v.elapsedMs)
  const paused = s.desk.status !== 'running'
  return <span className={`tab-live num ${paused ? 'paused' : ''} ${v.block.kind === 'rest' ? 'rest' : ''}`}>{left === null ? clock(v.elapsedMs, false) : clock(left)}</span>
}
