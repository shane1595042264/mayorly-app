// Where the next harvest's coins start: the control that cleared the entry, noted just before
// the dispatch, because the row is gone from the page by the time the event comes back.

let origin: { x: number; y: number; at: number } | null = null

export function noteOrigin(el: Element | null | undefined) {
  const r = el?.getBoundingClientRect()
  if (r) origin = { x: r.left + r.width / 2, y: r.top + r.height / 2, at: Date.now() }
}

/** The noted origin, once, if it is fresh. */
export function takeOrigin(): { x: number; y: number } | null {
  const o = origin
  origin = null
  return o && Date.now() - o.at < 2000 ? { x: o.x, y: o.y } : null
}
