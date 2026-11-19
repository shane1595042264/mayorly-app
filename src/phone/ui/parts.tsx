import { useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { motion, useDragControls, type PanInfo } from 'motion/react'
import { Minus, Plus } from '@phosphor-icons/react'
import type { Ledger } from '@core/index'
import tomatoPng from '../../renderer/src/assets/tomato@1x.png'
import coinPng from '../../renderer/src/assets/coin@1x.png'
import { THEME_COLORS } from '../../renderer/src/lib/themes'
import { tap } from '../feel'
import { dismissToast } from '../toast'

/** The founder's 16px drawings, only ever at whole multiples. */
export function Tomato({ scale = 1 }: { scale?: number }) {
  return <img className="px" src={tomatoPng} width={16 * scale} height={16 * scale} alt="" />
}
export function Coin({ scale = 1 }: { scale?: number }) {
  return <img className="px" src={coinPng} width={16 * scale} height={16 * scale} alt="" />
}

export function LedgerDot({ ledger }: { ledger: Ledger | null | undefined }) {
  return <i className="dot" style={ledger ? { background: THEME_COLORS[ledger.theme ?? 'amber'] } : undefined} aria-hidden />
}

/** A panel from the bottom: the picker, a form, a menu. Done closes it. */
export function Sheet({ title, onClose, short, action, className, children }: { title: string; onClose: () => void; short?: boolean; action?: ReactNode; className?: string; children: ReactNode }) {
  // A sheet opening sends any toast away, so nothing ever sits over a sheet's buttons.
  useEffect(() => dismissToast(), [])
  useEffect(() => {
    // A search field with something in it takes the first Escape to empty itself.
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLInputElement | null
      if (e.key !== 'Escape' || e.defaultPrevented || (t?.dataset?.escClears !== undefined && t.value)) return
      onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  // Pulled down by its head far enough, or flicked, it goes; otherwise it springs back.
  const drag = useDragControls()
  // The body drags the sheet too when it has nothing to scroll, as an iOS sheet does; a body that
  // scrolls keeps its scrolling, and on the phone pulling it past its top (the rubber band) closes it.
  const body = useRef<HTMLDivElement>(null)
  const [fits, setFits] = useState(true)
  useEffect(() => {
    const el = body.current
    if (!el) return
    const check = () => setFits(el.scrollHeight <= el.clientHeight + 1)
    check()
    const ro = new ResizeObserver(check)
    ro.observe(el)
    for (const c of Array.from(el.children)) ro.observe(c)
    return () => ro.disconnect()
  }, [])
  const fromBody = (e: React.PointerEvent) => {
    if (!fits || (e.target as HTMLElement).closest('input, textarea, select')) return
    drag.start(e)
  }
  const release = (_: unknown, info: PanInfo) => {
    if (info.offset.y > 110 || info.velocity.y > 650) onClose()
  }
  // Drawn at the root of the page, so a sheet opened inside a screen never moves with that
  // screen when the tab changes; it slides down where it is.
  return createPortal(
    <>
      <motion.div className="sheet-back" onClick={onClose} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }} />
      <motion.div
        className={`sheet ${short ? 'short' : ''} ${className ?? ''}`}
        role="dialog"
        aria-label={title}
        initial={{ y: '100%' }}
        animate={{ y: 0 }}
        exit={{ y: '100%' }}
        transition={{ type: 'spring', stiffness: 420, damping: 40 }}
        drag="y"
        dragControls={drag}
        dragListener={false}
        dragConstraints={{ top: 0, bottom: 0 }}
        dragElastic={{ top: 0.05, bottom: 0.9 }}
        onDragEnd={release}
      >
        <div className="sheet-head" onPointerDown={(e) => drag.start(e)} style={{ touchAction: 'none' }}>
          <i className="sheet-grip" aria-hidden />
          <h2>{title}</h2>
          {action}
          <motion.button type="button" className="btn" onClick={onClose} whileTap={{ scale: 0.92 }}>Done</motion.button>
        </div>
        <div
          ref={body}
          className="sheet-body"
          onPointerDown={fromBody}
          onScroll={(e) => { if (e.currentTarget.scrollTop < -80) onClose() }}
          style={{ touchAction: fits ? 'none' : undefined }}
        >
          {children}
        </div>
      </motion.div>
    </>,
    document.body,
  )
}

export function Toggle({ on, onChange, label }: { on: boolean; onChange: (on: boolean) => void; label: string }) {
  return (
    <motion.button type="button" role="switch" aria-checked={on} aria-label={label} className="toggle" onClick={() => { tap(); onChange(!on) }} whileTap={{ scale: 0.92 }}>
      <motion.i className="toggle-knob" layout transition={{ type: 'spring', stiffness: 700, damping: 32 }} />
    </motion.button>
  )
}

export function Stepper({ value, min, max, step = 1, unit, onChange, label }: { value: number; min: number; max: number; step?: number; unit?: string; onChange: (n: number) => void; label: string }) {
  return (
    <span className="stepper" role="group" aria-label={label}>
      <motion.button type="button" aria-label={`Less ${label}`} disabled={value <= min} whileTap={{ scale: 0.82 }} onClick={() => { tap(); onChange(Math.max(min, value - step)) }}><Minus size={16} /></motion.button>
      <span><motion.span key={value} style={{ display: 'inline-block' }} initial={{ y: -6, opacity: 0.35 }} animate={{ y: 0, opacity: 1 }}>{value}</motion.span>{unit ? ` ${unit}` : ''}</span>
      <motion.button type="button" aria-label={`More ${label}`} disabled={value >= max} whileTap={{ scale: 0.82 }} onClick={() => { tap(); onChange(Math.min(max, value + step)) }}><Plus size={16} /></motion.button>
    </span>
  )
}

/** A row with a label on the left and a control on the right, for settings. */
export function SettingRow({ title, sub, children }: { title: string; sub?: string; children: ReactNode }) {
  return (
    <div className="row">
      <div className="row-main">
        <span className="row-title">{title}</span>
        {sub && <span className="row-sub wrap">{sub}</span>}
      </div>
      {children}
    </div>
  )
}
