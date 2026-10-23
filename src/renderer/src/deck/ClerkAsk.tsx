import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import type { ClerkQuestion } from '../../../shared/bridge'
import clerkSprite from '../assets/tomato@1x.png'
import { bridge } from '../bridge'
import { dispatch } from '../store'

// After you correct or confirm a filing, the clerk asks one question. The card stays
// five seconds, longer once you start typing; Enter answers, Esc or the timer lets it go.
// The sprite is the tomato until the clerk character (char.clerk in mayorly-assets)
// is drawn; it is one file to swap.

const LINGER_MS = 5000

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

  return (
    <AnimatePresence>
      {q && (
        <motion.div
          key={q.entryId + q.question}
          className="clerk-ask"
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 10, transition: { duration: 0.15 } }}
          transition={{ type: 'spring', stiffness: 260, damping: 26 }}
          role="dialog"
          aria-label="The clerk asks"
          onPointerDown={(e) => e.stopPropagation()}
        >
          <img className="clerk-ask-sprite" src={clerkSprite} alt="" />
          <div className="clerk-ask-body">
            <p className="clerk-ask-q">{q.question}</p>
            <input
              autoFocus
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
