import { useCallback, useState } from 'react'
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
  return (
    <div className="app">
      <main className="screen" key={tab}>
        {tab === 'desk' && <Timer openPicker={() => setPicking(true)} openSync={() => setTab('settings')} />}
        {tab === 'ledgers' && <Ledgers />}
        {tab === 'couch' && <Couch />}
        {tab === 'settings' && <Settings />}
      </main>
      <nav className="tabbar" aria-label="Places">
        {TABS.map((t, i) => (
          <span key={t.id} style={{ display: 'contents' }}>
            {i === 2 && (
              <button type="button" className="tab capture-tab" onClick={() => setCapturing(true)} aria-label="Capture a task">
                <span className="capture-dot"><Plus size={24} weight="bold" aria-hidden /></span>
              </button>
            )}
            <button type="button" className="tab" aria-current={tab === t.id ? 'page' : undefined} onClick={() => setTab(t.id)}>
              <t.icon size={24} weight={tab === t.id ? 'fill' : 'regular'} aria-hidden />
              {t.label}
            </button>
          </span>
        ))}
      </nav>
      {picking && <Picker onClose={closePicker} />}
      {capturing && <Capture onClose={closeCapture} />}
    </div>
  )
}
