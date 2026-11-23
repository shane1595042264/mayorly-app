import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import type { ClerkQuestion } from '../../../shared/bridge'
import { art } from '../lib/art'
import { Pixel } from '../lib/Pixel'
import { bridge } from '../bridge'
import { dispatch } from '../store'
import { ui9Frame } from './ui9'

// After you correct or confirm a filing, the clerk asks one question. The card stays
// five seconds, longer once you start typing; Enter answers, Esc or the timer lets it go.
// The sprite is the founder's icon.clerk at 3x, the tomato until that is drawn. The card
// is his parchment panel at the same 3x, the glass card until that is drawn.

const LINGER_MS = 5000

// The parchment's green corner triangles reach one pixel past the standard 8 (row 3 and column 3
// run to x and y 8), so at 8 the edges would carry a green pixel at each end and stretch it into a
// bar. At 9 every edge and the centre are one colour along their length and stretch clean.
const PARCHMENT_SLICE = 9

export function ClerkAsk() {
  const [q, setQ] = useState<ClerkQuestion | null>(null)
  const [text, setText] = useState('')
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const dismiss = () => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
    setQ(null)
    setText('')
  }
  const arm = () => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(dismiss, LINGER_MS)
  }

  useEffect(() => bridge.onClerkAsk((next) => {
    setQ(next)
    setText('')
    arm()
  }), [])

  const answer = () => {
    if (q && text.trim()) dispatch({ type: 'rule/explain', entryId: q.entryId, ruleId: q.ruleId, text })
    dismiss()
  }

  const frame = ui9Frame('ui9.panel.parchment', 3, { slice: PARCHMENT_SLICE, fill: true })

  return (
    <AnimatePresence>
      {q && (
        <motion.div
          key={q.entryId + q.question}
          className={`clerk-ask ${frame ? 'is-parchment' : ''}`}
          style={frame}
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 10, transition: { duration: 0.15 } }}
          transition={{ type: 'spring', stiffness: 260, damping: 26 }}
          role="dialog"
          aria-label="The clerk asks"
          onPointerDown={(e) => e.stopPropagation()}
        >
          <Pixel id="icon.clerk" scale={3} className="clerk-ask-sprite" fallback={<img className="clerk-ask-sprite" src={art('icon.tomato')} alt="" />} />
          <div className="clerk-ask-body">
            <p className="clerk-ask-q">{q.question}</p>
            <input
              autoFocus={document.activeElement === null || document.activeElement === document.body}
              value={text}
              placeholder="Care to explain? Optional."
              onChange={(e) => {
                setText(e.target.value)
                if (timer.current) clearTimeout(timer.current)
                timer.current = null
              }}
              onFocus={() => { if (!text) arm() }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') answer()
                if (e.key === 'Escape') dismiss()
                e.stopPropagation()
              }}
            />
          </div>
          <button className="btn ghost" onClick={dismiss}>Skip</button>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
