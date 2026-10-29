import type { Command, PickCommand } from '../../../shared/bridge'

// The four arms of the Plus menu and the one path that points at one of them: a key in
// the menu, or the shell's Option+arrow while the menu is open (pressed in the same
// breath as Option+T, before the window has the keyboard). The menu subscribes; a point
// made before it mounts waits as a hint it takes on mount.

export type Arm = 'ledger' | 'entry' | 'mode' | 'orders'

/** The keymap actions that point at an arm (plus.* in lib/keymap.ts). */
export const ARM_OF_ACTION: Record<string, Arm> = { 'plus.ledger': 'ledger', 'plus.entry': 'entry', 'plus.mode': 'mode', 'plus.orders': 'orders' }

export const ARM_OF_COMMAND: Partial<Record<Command, Arm>> = { 'arm-up': 'ledger', 'arm-left': 'entry', 'arm-right': 'mode', 'arm-down': 'orders' }

export function isPick(c: Command): c is PickCommand {
  return c.startsWith('pick-')
}

let hint: Arm | null = null
const subs = new Set<(a: Arm) => void>()

// A number: that item in the arm you are on, 0 the couch. Same path, same hint.
let pickHint: number | null = null
const pickSubs = new Set<(n: number) => void>()

export function pointPick(n: number) {
  pickHint = n
  for (const f of pickSubs) f(n)
}

export function takePickHint(): number | null {
  const h = pickHint
  pickHint = null
  return h
}

export function onPick(fn: (n: number) => void): () => void {
  pickSubs.add(fn)
  return () => void pickSubs.delete(fn)
}

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
