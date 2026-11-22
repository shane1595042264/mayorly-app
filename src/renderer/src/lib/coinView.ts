import { useSyncExternalStore } from 'react'

// The coin count while coins are in the air. The state already holds the new balance the moment
// a purchase or a harvest lands in the reducer; the counts on screen (the deck's header, the
// market's wallet) show what the flying coins say instead, counting as they land, and fall back
// to the state once the last one has. CashIn sets it; nothing else does.

let shown: number | null = null
const subs = new Set<() => void>()

export function setShownCoins(n: number | null) {
  if (n === shown) return
  shown = n
  for (const f of subs) f()
}

/** The count in flight right now, or null when no coins are in the air. */
export const shownCoins = () => shown

/** The balance to show: the count in flight if there is one, else the real one. */
export function useShownCoins(actual: number): number {
  const v = useSyncExternalStore(
    (f) => {
      subs.add(f)
      return () => subs.delete(f)
    },
    () => shown,
  )
  return v ?? actual
}
