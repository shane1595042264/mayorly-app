const pad = (n: number) => String(n).padStart(2, '0')

/** 1499000 -> "24:59", 3720000 -> "1:02:00". Rounds up so a countdown never shows 00:00 early. */
export function clock(ms: number, roundUp = true): string {
  const total = Math.max(0, roundUp ? Math.ceil(ms / 1000) : Math.floor(ms / 1000))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`
}

/** 5400000 -> "1h 30m", 300000 -> "5m", 20000 -> "0m". */
export function span(ms: number): string {
  const min = Math.floor(ms / 60_000)
  const h = Math.floor(min / 60)
  const m = min % 60
  if (h === 0) return `${m}m`
  return m === 0 ? `${h}h` : `${h}h ${m}m`
}
