import { useEffect, useRef, useState } from 'react'
import type { Effect } from '../../../shared/bridge'
import { bridge } from '../bridge'
import { CashIn } from './CashIn'
import { ImpactLayer } from './Impact'
import { lastImpact, withEffect } from '../../../shared/impact'

// An effects window's whole page (every Mac effect, and an impact on a screen the Windows overlay is
// not on): plays what the shell sends, and says it is done once nothing is left playing. A harvest
// and the impact of the task done arrive together and play together.

type Playing = Effect & { seq: number }

export function EffectsApp() {
  const [playing, setPlaying] = useState<Playing[]>([])
  const had = useRef(false)
  useEffect(() => {
    let seq = 0
    return bridge.onEffect((e) => setPlaying((list) => withEffect(list, { ...e, seq: ++seq })))
  }, [])
  useEffect(() => {
    if (playing.length) had.current = true
    else if (had.current) {
      had.current = false
      bridge.effectDone()
    }
  }, [playing.length])
  const finish = (seq: number) => setPlaying((list) => list.filter((x) => x.seq !== seq))
  const speaks = lastImpact(playing)
  return (
    <>
      {playing.map((e) =>
        e.kind === 'impact' ? (
          <ImpactLayer key={e.seq} effect={e} words={e.words && e.seq === speaks} onDone={() => finish(e.seq)} />
        ) : (
          <CashIn key={e.seq} amount={e.amount} balance={e.balance} from={e.from} out={e.out} onDone={() => finish(e.seq)} />
        ),
      )}
    </>
  )
}
