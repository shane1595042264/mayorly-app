import { useEffect, useState } from 'react'
import { bridge } from '../bridge'

// The caption window's whole page (macOS): one line beside the pet, fed over IPC.
// The window is click-through, so the box hugs the tomato's side and the rest is air.

export function CaptionApp() {
  const [c, setC] = useState<{ text: string; side: 'left' | 'right' }>({ text: '', side: 'right' })
  useEffect(() => bridge.onCaption(setC), [])
  if (!c.text) return null
  return (
    <div className={`caption-page side-${c.side}`}>
      <p className="pet-sign is-caption caption-float" role="status">{c.text}</p>
    </div>
  )
}
