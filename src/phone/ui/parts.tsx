import { useEffect, type ReactNode } from 'react'
import { motion, useDragControls, type PanInfo } from 'motion/react'
import { Minus, Plus } from '@phosphor-icons/react'
import type { Ledger } from '@core/index'
import tomatoPng from '../../renderer/src/assets/tomato@1x.png'
import coinPng from '../../renderer/src/assets/coin@1x.png'
import { THEME_COLORS } from '../../renderer/src/lib/themes'
import { tap } from '../feel'

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
export function Sheet({ title, onClose, short, action, children }: { title: string; onClose: () => void; short?: boolean; action?: ReactNode; children: ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  // Pulled down by its head far enough, or flicked, it goes; otherwise it springs back.
  const drag = useDragControls()
  const release = (_: unknown, info: PanInfo) => {
    if (info.offset.y > 110 || info.velocity.y > 650) onClose()
  }
  return (
    <>
      <motion.div className="sheet-back" onClick={onClose} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }} />
      <motion.div
        className={`sheet ${short ? 'short' : ''}`}
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
        <div className="sheet-body">{children}</div>
      </motion.div>
    </>
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
      <span><motion.span key={value} style={{ display: 'inline-block' }} initial={{ y: -8, opacity: 0 }} animate={{ y: 0, opacity: 1 }}>{value}</motion.span>{unit ? ` ${unit}` : ''}</span>
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
