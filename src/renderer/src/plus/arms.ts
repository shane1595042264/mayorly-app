import type { Command } from '../../../shared/bridge'

// The four arms of the Plus menu and the one path that points at one of them: a key in
// the menu, or the shell's Option+arrow while the menu is open (pressed in the same
// breath as Option+T, before the window has the keyboard). The menu subscribes; a point
// made before it mounts waits as a hint it takes on mount.

export type Arm = 'ledger' | 'entry' | 'mode' | 'orders'

/** Keys in the menu, by position: arrows or WASD. */
export const ARM_KEYS: Record<string, Arm> = {
  ArrowUp: 'ledger', w: 'ledger', ArrowLeft: 'entry', a: 'entry', ArrowRight: 'mode', d: 'mode', ArrowDown: 'orders', s: 'orders',
}

export const ARM_OF_COMMAND: Partial<Record<Command, Arm>> = { 'arm-up': 'ledger', 'arm-left': 'entry', 'arm-right': 'mode', 'arm-down': 'orders' }

let hint: Arm | null = null
const subs = new Set<(a: Arm) => void>()

export function pointArm(a: Arm) {
  hint = a
  for (const f of subs) f(a)
}

/** The arm pointed at, once: the menu takes it on mount, and clears it whenever it handles a point itself. */
export function takeArmHint(): Arm | null {
  const h = hint
  hint = null
  return h
}

export function onArm(fn: (a: Arm) => void): () => void {
  subs.add(fn)
  return () => void subs.delete(fn)
}
