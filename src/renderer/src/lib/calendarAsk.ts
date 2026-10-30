// A request for the clerk about the calendar, raised from anywhere (the capture line's /cal),
// carried to the Calendar tab: the app opens the deck, the deck turns to the tab, the tab takes it.

let pending: string | null = null
const subs = new Set<(text: string) => void>()

export function askCalendar(text: string) {
  pending = text
  for (const f of subs) f(text)
}

/** True while a request waits for the Calendar tab to take it. */
export function hasCalendarAsk(): boolean {
  return pending !== null
}

export function takeCalendarAsk(): string | null {
  const t = pending
  pending = null
  return t
}

export function onCalendarAsk(fn: (text: string) => void): () => void {
  subs.add(fn)
  return () => void subs.delete(fn)
}
