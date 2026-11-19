import { useSyncExternalStore } from 'react'

// One line at the foot of the screen for a few seconds, after something that takes work away
// (a clear, a delete), with the act that puts it back. A new toast replaces the last.

export interface Toast { id: number; text: string; undo?: () => void }

let current: Toast | null = null
let timer: ReturnType<typeof setTimeout> | null = null
const subs = new Set<() => void>()
const emit = () => subs.forEach((f) => f())

export function showToast(text: string, undo?: () => void, ms = 4000) {
  current = { id: (current?.id ?? 0) + 1, text, undo }
  if (timer) clearTimeout(timer)
  timer = setTimeout(dismissToast, ms)
  emit()
}

export function dismissToast() {
  if (timer) clearTimeout(timer)
  timer = null
  current = null
  emit()
}

export function useToast(): Toast | null {
  return useSyncExternalStore((f) => (subs.add(f), () => void subs.delete(f)), () => current)
}
