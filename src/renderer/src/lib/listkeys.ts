import { useEffect, useRef, useState } from 'react'
import type { Id, MayorlyState } from '@core/index'
import { current } from '../store'
import { actionFor, keymapOpen, recordUse } from './keymap'

// Keyboard on a list: j and k pick a row, the other list keys act on it. The list says
// what each action does and returns false for one it has no use for.

export interface ListKey {
  action: string
  /** The selected row, or null when none is. */
  id: Id | null
  index: number
  e: KeyboardEvent
}

export function useListKeys(ids: Id[], on: (k: ListKey) => boolean | void) {
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
      if (keymapOpen() || e.altKey || e.ctrlKey || e.metaKey) return
      if ((e.target as HTMLElement | null)?.closest?.('input, textarea, select, [contenteditable]')) return
      const s = current()
      if (!s) return
      const action = actionFor(e, 'list', s.settings)
      if (!action) return
      const list = idsRef.current
      const cur = selRef.current
      const i = cur ? list.indexOf(cur) : -1
      let handled = true
      if (action === 'list.down') setSel(list[Math.min(i + 1, list.length - 1)] ?? null)
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
  const pad = 8
  if (r.top < b.top + pad) box.scrollTop -= b.top + pad - r.top
  else if (r.bottom > b.bottom - pad) box.scrollTop += r.bottom - (b.bottom - pad)
}

/** The ledger after (or before) this one, the tray included, round and round. */
export function cycleLedger(s: MayorlyState, ledgerId: Id | null, dir: 1 | -1): Id | null {
  const ring: (Id | null)[] = [null, ...s.ledgers.map((l) => l.id)]
  const i = ring.indexOf(ledgerId)
  return ring[(i + dir + ring.length) % ring.length]
}
