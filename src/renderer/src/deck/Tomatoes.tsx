import tomato from '../assets/tomato@1x.png'

/**
 * Tomatoes grown on an entry, the founder's sprite as the unit: "2", or "2.2" while the next
 * ripens under the desk. Nothing shows until the first tenth.
 */
export function Tomatoes({ n, showZero = false }: { n: number; showZero?: boolean }) {
  const tenths = Math.floor(n * 10 + 1e-6)
  if (tenths < 1 && !showZero) return null
  const label = tenths % 10 === 0 ? String(tenths / 10) : (tenths / 10).toFixed(1)
  return (
    <span className="row-tomatoes num" title="Tomatoes from this entry's recorded focus time">
      {label}
      <img className="mini-tomato" src={tomato} alt="tomatoes" draggable={false} />
    </span>
  )
}
