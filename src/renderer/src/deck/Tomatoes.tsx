import { tomatoLabel } from '@core/index'
import tomato from '../assets/tomato@1x.png'

/**
 * Tomatoes grown on an entry, the founder's sprite as the unit: "2", or "2.2" while the next
 * ripens under the desk. Nothing shows until the first tenth.
 */
export function Tomatoes({ n, showZero = false }: { n: number; showZero?: boolean }) {
  const label = tomatoLabel(n)
  if (label === '0' && !showZero) return null
  return (
    <span className="row-tomatoes num" title="Tomatoes from this entry's recorded focus time">
      {label}
      <img className="mini-tomato" src={tomato} alt="tomatoes" draggable={false} />
    </span>
  )
}
