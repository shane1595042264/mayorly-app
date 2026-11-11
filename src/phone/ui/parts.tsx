import { useEffect, type ReactNode } from 'react'
import { Minus, Plus } from '@phosphor-icons/react'
import type { Ledger } from '@core/index'
import tomatoPng from '../../renderer/src/assets/tomato@1x.png'
import coinPng from '../../renderer/src/assets/coin@1x.png'
import { THEME_COLORS } from '../../renderer/src/lib/themes'

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
  return (
    <>
      <div className="sheet-back" onClick={onClose} />
      <div className={`sheet ${short ? 'short' : ''}`} role="dialog" aria-label={title}>
        <div className="sheet-head">
          <h2>{title}</h2>
          {action}
          <button type="button" className="btn" onClick={onClose}>Done</button>
        </div>
        <div className="sheet-body">{children}</div>
      </div>
    </>
  )
}

export function Toggle({ on, onChange, label }: { on: boolean; onChange: (on: boolean) => void; label: string }) {
  return <button type="button" role="switch" aria-checked={on} aria-label={label} className="toggle" onClick={() => onChange(!on)} />
}

export function Stepper({ value, min, max, step = 1, unit, onChange, label }: { value: number; min: number; max: number; step?: number; unit?: string; onChange: (n: number) => void; label: string }) {
  return (
    <span className="stepper" role="group" aria-label={label}>
      <button type="button" aria-label={`Less ${label}`} disabled={value <= min} onClick={() => onChange(Math.max(min, value - step))}><Minus size={16} /></button>
      <span>{value}{unit ? ` ${unit}` : ''}</span>
      <button type="button" aria-label={`More ${label}`} disabled={value >= max} onClick={() => onChange(Math.min(max, value + step))}><Plus size={16} /></button>
    </span>
  )
}

/** A row with a label on the left and a control on the right, for settings. */
export function SettingRow({ title, sub, children }: { title: string; sub?: string; children: ReactNode }) {
  return (
    <div className="row">
      <div className="row-main">
        <span className="row-title">{title}</span>
        {sub && <span className="row-sub">{sub}</span>}
      </div>
      {children}
    </div>
  )
}
