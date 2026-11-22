import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { motion } from 'motion/react'
import { ArrowRight } from '@phosphor-icons/react'
import { hotkeyLabel } from '../lib/keys'
import { CAUSE_LABEL, endLabel, type SwitchRecord } from '../../../shared/switchlog'
import { bridge } from '../bridge'
import { useMayorly } from '../store'

// The switch log (Alt+Shift+H): every time the desk changed task, newest first, with what did
// it: you, an AI prompt, a streamer's death and the numbers it read, the timer, the couch running
// out of coins, the clerk, another computer. A switch that was let go shows as kept. It hangs under
// the pet, over it or beside it where there is room (panelBox); on a Mac it is the shell's own
// window (?switchlog). Esc, the hotkey again or a click outside closes it.

/** The records, newest first, and each new one as it lands. */
function useSwitches(): SwitchRecord[] | null {
  const [list, setList] = useState<SwitchRecord[] | null>(null)
  useEffect(() => {
    const b = bridge.switchLog
    if (!b) {
      setList([])
      return
    }
    let live = true
    void b.get().then((l) => live && setList(l)).catch(() => live && setList([]))
    const off = b.onAdd((r) => setList((l) => [r, ...(l ?? [])].slice(0, 100)))
    return () => {
      live = false
      off()
    }
  }, [])
  return list
}

const clock = (at: number) => {
  const d = new Date(at)
  const today = new Date().toDateString() === d.toDateString()
  const t = d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' })
  return today ? t : `${d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} ${t}`
}

export function SwitchLogApp() {
  const s = useMayorly()
  if (!s) return null
  return <SwitchLog hotkey={s.settings.hotkeys.switchLog} close={() => bridge.switchLog?.close()} />
}

/** `style` places it in the Windows overlay, in the box the Mac gives the log's own window. `where`: which way it opens from the pet. */
export function SwitchLog({ close, hotkey, style, where = 'below' }: { close: () => void; hotkey: string; style?: CSSProperties; where?: 'below' | 'above' | 'beside' }) {
  const list = useSwitches()
  const box = useRef<HTMLElement>(null)
  useEffect(() => box.current?.focus(), [])
  const from = where === 'above' ? 8 : where === 'beside' ? 0 : -8
  return (
    <motion.section
      ref={box}
      className="switch-log"
      style={style}
      data-hit
      tabIndex={-1}
      role="dialog"
      aria-label="Switch log"
      initial={{ opacity: 0, y: from }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: from * 0.75, transition: { duration: 0.12 } }}
      transition={{ type: 'spring', stiffness: 300, damping: 28 }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.preventDefault()
          close()
        }
      }}
    >
      <header className="switch-log-head">
        <h2 className="switch-log-title">Switch log</h2>
        <span className="switch-log-hint">{hotkeyLabel(hotkey)} or Esc closes</span>
      </header>
      {list && list.length === 0 && (
        <p className="switch-log-empty">No switches yet. Each time the desk changes task, it lands here with what moved it.</p>
      )}
      {list && list.length > 0 && (
        <ol className="switch-log-list">
          {list.map((r) => (
            <li key={r.id} className={`switch-log-row cause-${r.cause} ${r.kept ? 'kept' : ''}`}>
              <div className="switch-log-meta">
                <span className="switch-log-cause">{r.kept ? 'Kept' : CAUSE_LABEL[r.cause]}</span>
                <time className="mono num" dateTime={new Date(r.at).toISOString()}>{clock(r.at)}</time>
              </div>
              <p className="switch-log-move">
                {r.kept ? (
                  <span>Stayed on {endLabel(r.to)}</span>
                ) : (
                  <>
                    <span className="switch-log-end">{endLabel(r.from)}</span>
                    <ArrowRight size={12} weight="bold" aria-label="to" />
                    <span className="switch-log-end">{endLabel(r.to)}</span>
                    {r.status !== 'running' && <span className="switch-log-status">{r.status === 'idle' ? 'idle' : 'on hold'}</span>}
                  </>
                )}
              </p>
              <p className="switch-log-why">{r.via}</p>
              {r.detail && (
                <p className="switch-log-detail mono" title={r.detail}>
                  {r.detail}
                </p>
              )}
            </li>
          ))}
        </ol>
      )}
    </motion.section>
  )
}
