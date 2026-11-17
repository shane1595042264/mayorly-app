// A tab the deck should open on, asked for from outside it (the schedule hotkey): the app opens
// the deck, and the deck turns to the tab, whether it was open already or opens for it.

let pending: string | null = null
const subs = new Set<(tab: string) => void>()

export function requestDeckTab(tab: string) {
  pending = tab
  for (const f of subs) f(tab)
}

/** The tab asked for, once; null when nothing waits. */
export function takeDeckTab(): string | null {
  const t = pending
  pending = null
  return t
}

export function onDeckTab(fn: (tab: string) => void): () => void {
  subs.add(fn)
  return () => void subs.delete(fn)
}
