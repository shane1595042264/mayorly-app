import { useEffect, useRef, useState } from 'react'
import { motion, useReducedMotion } from 'motion/react'
import { X } from '@phosphor-icons/react'
import { balance, type MayorlyState } from '@core/index'
import type { BuildInfo } from '../../../shared/bridge'
import { bridge } from '../bridge'
import { useShownCoins } from '../lib/coinView'
import { hasCalendarAsk, onCalendarAsk } from '../lib/calendarAsk'
import { onDeckTab, takeDeckTab } from '../lib/deckTab'
import { sfx } from '../lib/sound'
import { actionFor, keymapOpen, recordUse } from '../lib/keymap'
import { current } from '../store'
import { CalendarTab } from './CalendarTab'
import { FlowTab } from './FlowTab'
import { Keymap } from './Keymap'
import { LeisureTab } from './LeisureTab'
import { RecordTab } from './RecordTab'
import { SettingsTab } from './SettingsTab'
import { ShelfTab } from './ShelfTab'
import { SupersetsTab } from './SupersetsTab'
import { WhatsNew } from './WhatsNew'
import { tip } from '../lib/tips'

const TABS = ['Flow', 'Calendar', 'Shelf', 'Supersets', 'Leisure', 'Record', 'Settings'] as const
type Tab = (typeof TABS)[number]

let remembered: Tab = 'Flow'

export function Deck({ s, close, kind }: { s: MayorlyState; close: () => void; kind: 'electron' | 'web' }) {
  // The header's coin count: while coins fly to or from it, it counts as they land.
  const shownCoins = useShownCoins(balance(s))
  // A shelf with no ledgers is where a new install starts.
  const [tab, setTabState] = useState<Tab>(() => {
    const asked = takeDeckTab()
    if (asked && (TABS as readonly string[]).includes(asked)) return (remembered = asked as Tab)
    return hasCalendarAsk() ? 'Calendar' : s.ledgers.length === 0 && remembered === 'Flow' ? 'Shelf' : remembered
  })
  const [keymap, setKeymap] = useState(false)
  // What changed: the first time a build launches on this machine the deck opens on the card.
  // Seen once it is shown, however it is closed, so it never comes back on its own for this build.
  const [news, setNews] = useState<BuildInfo | null>(null)
  useEffect(() => {
    let on = true
    void bridge.whatsNew().then(async (fresh) => {
      if (!fresh || !on) return
      bridge.seenBuild()
      setNews(await bridge.getBuild())
    })
    return () => void (on = false)
  }, [])
  const openNotes = () => void bridge.getBuild().then(setNews)
  // A request for the clerk about the calendar arrives: that tab, now.
  useEffect(() => onCalendarAsk(() => setTab('Calendar')), [])
  // The schedule hotkey with the deck already open: that tab, now.
  useEffect(() => onDeckTab((t) => {
    takeDeckTab()
    if ((TABS as readonly string[]).includes(t)) setTab(t as Tab)
  }), [])
  const closeNotes = () => setNews(null)
  const panel = useRef<HTMLElement>(null)
  useEffect(() => panel.current?.focus(), [])
  const reduce = useReducedMotion()

  /** Which way the last tab change went: the new page slides in from that side. */
  const turn = useRef(1)
  const setTab = (t: Tab) => {
    turn.current = TABS.indexOf(t) >= TABS.indexOf(remembered as Tab) ? 1 : -1
    remembered = t
    setTabState(t)
    sfx.tick()
  }

  // The deck's own keys, from the keymap: close, the tabs, and the Keymap screen itself.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (keymapOpen() || news) return
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
      else if (!a && !e.shiftKey && /^[1-7]$/.test(e.key)) setTab(TABS[Number(e.key) - 1])
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
      {/* Flat at rest: no tilt and no lean toward the pointer, since any 3D turn resamples the
          founder's sprites inside. It still comes up out of the screen as it opens; at z 0 Motion
          writes no transform at all, so every sprite lands on whole pixels. */}
      <motion.section
        className="deck"
        initial={reduce ? false : { z: -120, opacity: 0 }}
        animate={{ z: 0, opacity: 1 }}
        // Springier than it was: it rises a touch past the screen and settles back, Balatro's bounce.
        transition={{ type: 'spring', stiffness: 300, damping: 17 }}
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
            {TABS.map((t, i) => (
              <button key={t} id={`tab-${t}`} role="tab" aria-selected={tab === t} aria-controls="deck-panel" className={`tab caps ${tab === t ? 'on' : ''}`} onClick={() => setTab(t)} {...tip('deck.tab', `open ${t}`, String(i + 1))}>
                {t}
                <span className="tab-n mono num" aria-hidden="true">{i + 1}</span>
                {tab === t && <motion.i layoutId="tab-bar" className="tab-bar" />}
              </button>
            ))}
            <span className="key">E</span>
          </nav>
          <span className="deck-balance">
            <span className="mono num">{shownCoins.toLocaleString()}</span>
            <span className="caps dim">Coins</span>
          </span>
          <button className="deck-close" onClick={close} aria-label="Close deck" {...tip('deck.close', 'close the deck')}>
            <X size={18} />
          </button>
        </header>

        {/* layoutScroll: cards that animate their layout (the market's) stay put while this box scrolls. */}
        {/* Each tab's page slides in from the side you moved toward, past its place and back (the body is
            remade for each tab, so it starts at its top). */}
        <motion.div
          layoutScroll
          key={tab}
          className="deck-body"
          role="tabpanel"
          id="deck-panel"
          aria-labelledby={`tab-${tab}`}
          initial={reduce ? false : { opacity: 0, x: 28 * turn.current }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ type: 'spring', stiffness: 520, damping: 26 }}
        >
          {tab === 'Flow' && <FlowTab s={s} />}
          {tab === 'Calendar' && <CalendarTab s={s} />}
          {tab === 'Shelf' && <ShelfTab s={s} />}
          {tab === 'Supersets' && <SupersetsTab s={s} />}
          {tab === 'Leisure' && <LeisureTab s={s} />}
          {tab === 'Record' && <RecordTab s={s} />}
          {tab === 'Settings' && <SettingsTab s={s} kind={kind} openKeymap={() => setKeymap(true)} openNotes={openNotes} />}
        </motion.div>
        {keymap && <Keymap s={s} close={() => setKeymap(false)} />}
        {news && <WhatsNew build={news} close={closeNotes} />}
      </motion.section>
    </motion.div>
  )
}
