import { useEffect, useState } from 'react'
import type { Effect } from '../../../shared/bridge'
import { bridge } from '../bridge'
import { CashIn } from './CashIn'
import { SwitchPulse } from './SwitchPulse'

// The effects window's whole page (macOS): plays what the shell sends, then says it is done.

export function EffectsApp() {
  const [effect, setEffect] = useState<(Effect & { seq: number }) | null>(null)
  useEffect(() => {
    let seq = 0
    return bridge.onEffect((e) => setEffect({ ...e, seq: ++seq }))
  }, [])
  if (!effect) return null
  const done = () => {
    setEffect(null)
    bridge.effectDone()
  }
  if (effect.kind === 'pulse') return <SwitchPulse key={effect.seq} color={effect.color} onDone={done} />
  return (
    <CashIn
      key={effect.seq}
      amount={effect.amount}
      balance={effect.balance}
      from={effect.from}
      out={effect.out}
      onDone={done}
    />
  )
}
