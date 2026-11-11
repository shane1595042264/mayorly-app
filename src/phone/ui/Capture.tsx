import { useEffect, useRef, useState } from 'react'
import { Broom, Microphone, Play, Stop } from '@phosphor-icons/react'
import { captureLine, clearNotice, sweepTray, useClerk } from '../ai'
import { dictationAvailable, listen } from '../dictation'
import { useMayorly } from '../store'
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
    if (!line || busy) return
    if (listening) await stopRef.current?.()
    setBusy(true)
    setText('')
    try {
      await captureLine(line, start)
    } finally {
      setBusy(false)
    }
    if (start) onClose()
  }

  return (
    <Sheet title="Capture" short onClose={onClose}>
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
          <button type="button" className={`mic ${listening ? 'on' : ''}`} onClick={() => void toggleMic()} aria-label={listening ? 'Stop listening' : 'Say a task'} aria-pressed={listening}>
            {listening ? <Stop size={26} weight="fill" /> : <Microphone size={26} weight="fill" />}
          </button>
        )}
        <button type="button" className="btn white" disabled={!text.trim() || busy} onClick={() => void add(false)}>Add</button>
        <button type="button" className="btn" disabled={!text.trim() || busy} onClick={() => void add(true)}><Play size={16} weight="fill" />Add and start</button>
      </div>
      {error && <p className="error">{error}</p>}
      <p className="help capture-note" aria-live="polite">
        {notice ? notice.text : keys > 0 ? 'The clerk files it into a ledger, or onto the couch.' : 'Without an AI key, a first word that names a ledger files it; the rest waits in the tray. Add a key in Settings.'}
      </p>
      {keys > 0 && tray > 0 && (
        <button type="button" className="btn" style={{ marginTop: 12 }} onClick={() => void sweepTray()}>
          <Broom size={16} />Sort the tray, {tray} waiting
        </button>
      )}
    </Sheet>
  )
}
