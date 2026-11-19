import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { announce, captured, tap } from '../feel'
import { Broom, Microphone, Play, Stop } from '@phosphor-icons/react'
import { captureLine, clearNotice, sweepTray, useClerk } from '../ai'
import { dictationAvailable, listen } from '../dictation'
import { act, useMayorly } from '../store'
import { findTasks, foldSearch, onDeskId, prefixClerk } from '@core/index'
import { Sheet } from './parts'

// The inbox, one tap from anywhere: type a line or say it, and the clerk files it into a ledger
// (or onto the couch). Add keeps the sheet open for the next line; Add and start puts it on the
// desk at once and the clerk moves it afterwards. With no AI key, the line is filed by its first
// word when that names a ledger, else it waits in the tray.

export function Capture({ onClose }: { onClose: () => void }) {
  const s = useMayorly()
  const { ai, notice } = useClerk()
  const [text, setText] = useState('')
  const [listening, setListening] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const stopRef = useRef<(() => Promise<void>) | null>(null)
  const field = useRef<HTMLTextAreaElement>(null)
  const keys = ai?.keys.filter((k) => k.status === 'ok').length ?? 0
  const tray = s.entries.filter((e) => e.ledgerId === null && e.doneAt === null).length
  const canTalk = dictationAvailable()
  const existing = text.trim().length >= 3 ? findTasks(s, text, 3) : []
  // Under the buttons, so they never move as you type; held as they were once one is tapped.
  const [leaving, setLeaving] = useState<typeof existing | null>(null)
  const shown = leaving ?? existing
  // The line is exactly a task you already have: Add and Return start that task, never a copy.
  const same = existing.find((f) => foldSearch(f.kind === 'entry' ? f.entry.title : f.item.title) === foldSearch(prefixClerk.file(text.trim(), s.ledgers).title || text))
  const acting = useRef(false)
  const startExisting = (f: NonNullable<typeof same>) => {
    if (acting.current) return
    acting.current = true
    tap()
    const onDesk = (f.kind === 'entry' ? f.entry.id : f.item.id) === onDeskId(s)
    act(f.kind === 'entry' ? { type: 'desk/select', entryId: f.entry.id, ledgerId: f.entry.ledgerId } : { type: 'desk/select', leisureId: f.item.id })
    if (onDesk) announce('start')
    onClose()
  }

  useEffect(() => {
    clearNotice()
    // A sheet that opens to talk should not throw up the keyboard over the microphone.
    if (!canTalk) field.current?.focus()
    return () => void stopRef.current?.()
  }, [canTalk])

  const toggleMic = async () => {
    setError(null)
    if (listening) {
      await stopRef.current?.()
      return
    }
    const before = text.trim() ? `${text.trim()} ` : ''
    try {
      stopRef.current = await listen((heard, final) => {
        setText(before + heard)
        if (final) {
          setListening(false)
          stopRef.current = null
        }
      })
      setListening(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  const add = async (start: boolean) => {
    const line = text.trim()
    // One press is one line: a second Return before the first is filed adds nothing.
    if (!line || busy || acting.current) return
    if (same) return startExisting(same)
    if (listening) await stopRef.current?.()
    setBusy(true)
    acting.current = true
    setText('')
    captured()
    try {
      await captureLine(line, start)
    } finally {
      setBusy(false)
      // Add keeps the sheet open for the next line; Add and start has closed it for good.
      if (!start) acting.current = false
    }
    if (start) onClose()
  }

  return (
    <Sheet title="Capture" short className="capture-sheet" onClose={onClose}>
      <textarea
        ref={field}
        className="field capture-field"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault()
            void add(false)
          }
        }}
        placeholder={listening ? 'Listening' : canTalk ? 'Type a task, or tap the microphone and say it' : 'Type a task'}
        aria-label="Task to capture"
        enterKeyHint="done"
        rows={3}
      />
      <div className="capture-actions">
        {canTalk && (
          <motion.button type="button" className={`mic ${listening ? 'on' : ''}`} onClick={() => void toggleMic()} aria-label={listening ? 'Stop listening' : 'Say a task'} aria-pressed={listening} whileTap={{ scale: 0.88 }}>
            {listening && [0, 0.6].map((d) => (
              <motion.i key={d} className="mic-ring" initial={{ scale: 1, opacity: 0.55 }} animate={{ scale: 1.9, opacity: 0 }} transition={{ duration: 1.2, repeat: Infinity, delay: d, ease: 'easeOut' }} />
            ))}
            <AnimatePresence mode="popLayout" initial={false}>
              <motion.span key={listening ? 'stop' : 'mic'} style={{ display: 'grid' }} initial={{ scale: 0.4, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.4, opacity: 0 }}>
                {listening ? <Stop size={26} weight="fill" /> : <Microphone size={26} weight="fill" />}
              </motion.span>
            </AnimatePresence>
          </motion.button>
        )}
        <motion.button type="button" className="btn white" disabled={!text.trim() || busy} onClick={() => void add(false)} whileTap={{ scale: 0.94 }}>{same ? 'Start it' : 'Add'}</motion.button>
{!same && <motion.button type="button" className="btn" disabled={!text.trim() || busy} onClick={() => void add(true)} whileTap={{ scale: 0.94 }}><Play size={16} weight="fill" />Add and start</motion.button>}
      </div>
      {error && <p className="error">{error}</p>}
      {/* A line that is already a task offers that task, so Capture never makes a second copy. */}
      <AnimatePresence initial={false}>
        {shown.length > 0 && !listening && (
          <motion.div key="existing" className="capture-existing" initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}>
            <h3 className="section-title">Already on your list</h3>
            <div className="list">
              {shown.map((f) => {
                const id = f.kind === 'entry' ? f.entry.id : f.item.id
                const title = f.kind === 'entry' ? f.entry.title : f.item.title
                const where = f.kind === 'entry' ? s.ledgers.find((l) => l.id === f.entry.ledgerId)?.name ?? 'Tray' : 'Couch'
                return (
                  <motion.button type="button" key={id} className="row" whileTap={{ scale: 0.98 }} onClick={() => { setLeaving(existing); startExisting(f) }}>
                    <span className="glyph"><Play size={16} weight="fill" /></span>
                    <span className="row-main"><span className="row-title">{title}</span><span className="row-sub">{id === onDeskId(s) ? 'On the desk now' : `${where} · start`}</span></span>
                  </motion.button>
                )
              })}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      <AnimatePresence mode="wait" initial={false}>
        <motion.p key={notice?.text ?? 'hint'} className={`help capture-note ${notice ? 'said' : ''}`} aria-live="polite" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.2 }}>
          {notice ? notice.text : keys > 0 ? 'The clerk files it into a ledger, or onto the couch.' : 'Without an AI key, start with a ledger and a colon, like legal: call the notary, or tag it #legal; the rest waits in the tray.'}
        </motion.p>
      </AnimatePresence>
      {keys > 0 && tray > 0 && (
        <button type="button" className="btn" style={{ marginTop: 12 }} onClick={() => void sweepTray()}>
          <Broom size={16} />Sort the tray, {tray} waiting
        </button>
      )}
    </Sheet>
  )
}
