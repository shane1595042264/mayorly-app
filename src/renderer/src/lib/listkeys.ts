import { useEffect, useRef, useState } from 'react'
import type { Id, MayorlyState } from '@core/index'
import { current } from '../store'
import { actionFor, keymapOpen, recordUse } from './keymap'

// Keyboard on a list: j and k pick a row, the other list keys act on it. The list says
// what each action does and returns false for one it has no use for. A list laid out as a grid
// (`spatial`) moves by where its rows are on screen, h j k l and the arrows alike.

/**
 * The control the Tab key last moved to. Its own Enter and Space are its own: a button reached with
 * Tab is pressed, not the row picked with j and k. A pointer press, or moving the list's selection,
 * ends that, so after a click Enter still means the row.
 */
let tabbed: Element | null = null
let tabbing = false
if (typeof window !== 'undefined') {
  window.addEventListener('keydown', (e) => { if (e.key === 'Tab') tabbing = true }, true)
  window.addEventListener('focusin', (e) => { tabbed = tabbing ? (e.target as Element) : null; tabbing = false }, true)
  window.addEventListener('pointerdown', () => { tabbed = null; tabbing = false }, true)
}
const CONTROL = 'button, a[href], summary, [role="button"], [role="tab"], input[type="checkbox"]'

type Dir = 'up' | 'down' | 'left' | 'right'
const DIRS: Record<string, Dir> = { 'list.down': 'down', 'list.up': 'up', 'list.left': 'left', 'list.right': 'right' }

/** The row nearest `from` in that direction on screen, or null at the edge. */
function nearest(ids: Id[], from: Id, dir: Dir): Id | null {
  const box = (id: Id) => document.querySelector(`[data-row="${CSS.escape(id)}"]`)?.getBoundingClientRect()
  const a = box(from)
  if (!a) return null
  const ax = a.left + a.width / 2, ay = a.top + a.height / 2
  // Something in line with the row (sharing its height for left and right, its width for up and
  // down) wins over anything off to the side; only with nothing in line does a move go diagonal.
  let best: { id: Id; inLine: boolean; score: number } | null = null
  for (const id of ids) {
    if (id === from) continue
    const b = box(id)
    if (!b || !b.width) continue
    const beyond = dir === 'down' ? b.top >= a.bottom - 2 : dir === 'up' ? b.bottom <= a.top + 2 : dir === 'right' ? b.left >= a.right - 2 : b.right <= a.left + 2
    if (!beyond) continue
    const dx = b.left + b.width / 2 - ax, dy = b.top + b.height / 2 - ay
    const along = dir === 'down' ? dy : dir === 'up' ? -dy : dir === 'right' ? dx : -dx
    if (along <= 0) continue
    const across = dir === 'down' || dir === 'up' ? Math.abs(dx) : Math.abs(dy)
    const inLine = dir === 'down' || dir === 'up' ? b.left < a.right && b.right > a.left : b.top < a.bottom && b.bottom > a.top
    const score = along + across * 2
    if (!best || (inLine && !best.inLine) || (inLine === best.inLine && score < best.score)) best = { id, inLine, score }
  }
  // Left and right never leave the line; up and down may, to the nearest thing above or below.
  if (best && !best.inLine && (dir === 'left' || dir === 'right')) return null
  return best?.id ?? null
}

export interface ListKey {
  action: string
  /** The selected row, or null when none is. */
  id: Id | null
  index: number
  e: KeyboardEvent
}

export function useListKeys(ids: Id[], on: (k: ListKey) => boolean | void, enabled = true, opts: { spatial?: boolean } = {}) {
  const enabledRef = useRef(enabled)
  enabledRef.current = enabled
  const spatial = useRef(!!opts.spatial)
  spatial.current = !!opts.spatial
  const [sel, setSelState] = useState<Id | null>(null)
  // A held key repeats faster than React renders, so the selection is read and written through a ref too.
  const selRef = useRef<Id | null>(null)
  const setSel = (id: Id | null) => {
    selRef.current = id
    setSelState(id)
  }
  const idsRef = useRef(ids)
  idsRef.current = ids
  const onRef = useRef(on)
  onRef.current = on
  const lastIndex = useRef(-1)
  const key = ids.join('\u0000')

  // The selection stays on a real row; when its row goes, it stays at the same place.
  useEffect(() => {
    if (!sel) return
    const i = ids.indexOf(sel)
    if (i >= 0) {
      lastIndex.current = i
      return
    }
    setSel(ids.length ? ids[Math.min(Math.max(lastIndex.current, 0), ids.length - 1)] : null)
  }, [key, sel])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!enabledRef.current) return
      if (keymapOpen() || e.altKey || e.ctrlKey || e.metaKey) return
      if ((e.target as HTMLElement | null)?.closest?.('input, textarea, select, [contenteditable]')) return
      const t = e.target as Element | null
      if ((e.key === 'Enter' || e.key === ' ') && t && t === tabbed && t.matches?.(CONTROL)) return
      const s = current()
      if (!s) return
      const action = actionFor(e, 'list', s.settings)
      if (!action) return
      const list = idsRef.current
      const cur = selRef.current
      const i = cur ? list.indexOf(cur) : -1
      let handled = true
      const dir = DIRS[action]
      // Moving the selection takes the keyboard back from a control reached with Tab.
      if (dir && tabbed) {
        if (document.activeElement === tabbed) (tabbed as HTMLElement).blur()
        tabbed = null
      }
      if (dir && spatial.current) {
        const next = i >= 0 ? nearest(list, cur as Id, dir) : list[0] ?? null
        if (next) setSel(next)
      } else if (dir === 'left' || dir === 'right') handled = false
      else if (action === 'list.down') setSel(list[Math.min(i + 1, list.length - 1)] ?? null)
      else if (action === 'list.up') setSel(list[Math.max(i - 1, 0)] ?? null)
      else if (action === 'list.top') setSel(list[0] ?? null)
      else if (action === 'list.bottom') setSel(list[list.length - 1] ?? null)
      else handled = onRef.current({ action, id: i >= 0 ? cur : null, index: i, e }) !== false
      if (handled) {
        e.preventDefault()
        recordUse(action)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  useEffect(() => {
    if (sel) reveal(document.querySelector(`[data-row="${CSS.escape(sel)}"]`))
  }, [sel])

  return { sel, setSel }
}

/** Scroll the element's own scroll container just enough to show it. Never the page: the stage must not move. */
export function reveal(el: Element | null) {
  if (!(el instanceof HTMLElement)) return
  let box: HTMLElement | null = el.parentElement
  while (box && !/(auto|scroll)/.test(getComputedStyle(box).overflowY)) box = box.parentElement
  if (!box) return
  const r = el.getBoundingClientRect()
  const b = box.getBoundingClientRect()
  // Room for anything stuck to the top of the box (the market's notice line), as it declares.
  const pad = 8 + (parseFloat(getComputedStyle(box).scrollPaddingTop) || 0)
  if (r.top < b.top + pad) box.scrollTop -= b.top + pad - r.top
  else if (r.bottom > b.bottom - pad) box.scrollTop += r.bottom - (b.bottom - pad)
}

/** The ledger after (or before) this one, the tray included, round and round. */
export function cycleLedger(s: MayorlyState, ledgerId: Id | null, dir: 1 | -1): Id | null {
  const ring: (Id | null)[] = [null, ...s.ledgers.map((l) => l.id)]
  const i = ring.indexOf(ledgerId)
  return ring[(i + dir + ring.length) % ring.length]
}
