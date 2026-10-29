// The keymap: every in-app key, by scope, with its default; what the user changed lives in
// settings.keymap and syncs with the account. The global hotkeys (settings.hotkeys) stay
// Electron accelerators owned by the shell; the Keymap screen shows them under Anywhere.
import type { HotkeyAction, Settings } from '@core/index'
import { IS_MAC, MODIFIER_KEYS, physicalKey } from './keys'

export type Scope = 'global' | 'plus' | 'capture' | 'deck' | 'list' | 'shelf' | 'move' | 'keymap'

export interface KeyDef {
  id: string
  scope: Scope
  label: string
  /** Default keys, primary first, at most two. */
  keys: string[]
  /** Shown, not rebindable: a range of keys, or this screen's own. */
  fixed?: boolean
  /** The two keys are the ends of a range. */
  range?: boolean
  /** A word on what it does, when the label is not enough. */
  note?: string
}

export const SCOPES: { id: Scope; title: string; blurb: string }[] = [
  { id: 'global', title: 'Anywhere', blurb: 'System-wide, with a modifier, so no other app sees them.' },
  { id: 'plus', title: 'Swap menu', blurb: 'While the swap menu is open, with the swap key\'s modifier still held or not. Keys by position.' },
  { id: 'capture', title: 'Capture box', blurb: 'While typing a line.' },
  { id: 'deck', title: 'Deck', blurb: 'While the deck is open.' },
  { id: 'list', title: 'Lists', blurb: 'The flow, a ledger, the supersets, the couch list. Keys act on the selected row.' },
  { id: 'shelf', title: 'Shelf', blurb: 'The nine bays.' },
  { id: 'move', title: 'Moving the tomato', blurb: 'After the move hotkey, until Enter.' },
  { id: 'keymap', title: 'This screen', blurb: '' },
]

export const GLOBAL_ACTIONS: [HotkeyAction, string][] = [
  ['plus', 'Swap menu'],
  ['capture', 'Capture'],
  ['deck', 'Deck'],
  ['pause', 'Hold and resume'],
  ['hide', 'Hide the HUD'],
  ['switch', 'Switch to the other session'],
  ['clear', 'Clear the entry on the desk'],
  ['move', 'Move the tomato by keyboard'],
]

export const KEYS: KeyDef[] = [
  { id: 'plus.ledger', scope: 'plus', label: 'Ledger arm', keys: ['ArrowUp', 'w'], note: 'Also with the swap key, in the same breath' },
  { id: 'plus.entry', scope: 'plus', label: 'Entry arm', keys: ['ArrowLeft', 'a'], note: 'Also with the swap key, in the same breath' },
  { id: 'plus.mode', scope: 'plus', label: 'Mode arm', keys: ['ArrowRight', 'd'], note: 'Also with the swap key, in the same breath' },
  { id: 'plus.orders', scope: 'plus', label: 'Orders arm', keys: ['ArrowDown', 's'], note: 'Also with the swap key, in the same breath' },
  { id: 'plus.prev', scope: 'plus', label: 'Cycle to the previous item', keys: ['q'] },
  { id: 'plus.next', scope: 'plus', label: 'Cycle to the next item', keys: ['e'] },
  { id: 'plus.pick', scope: 'plus', label: 'Pick an item by number', keys: ['1', '9'], fixed: true, range: true, note: 'In the arm you are on; every item shows its number' },
  { id: 'plus.apply', scope: 'plus', label: 'Apply the item', keys: ['Enter', 'Space'] },
  { id: 'plus.deck', scope: 'plus', label: 'Open the deck', keys: ['Tab'] },
  { id: 'plus.close', scope: 'plus', label: 'Close the menu', keys: ['Escape'] },

  { id: 'capture.file', scope: 'capture', label: 'File the line', keys: ['Enter'], fixed: true, note: 'To its ledger by prefix, else the clerk, else the tray' },
  { id: 'capture.start', scope: 'capture', label: 'File it and start it now', keys: [IS_MAC ? 'Cmd+Enter' : 'Ctrl+Enter'], fixed: true, note: 'A running focus block swaps to it, the clock where it is; otherwise a pomodoro starts on it. The clerk files it after.' },
  { id: 'capture.keep', scope: 'capture', label: 'File and keep the box open', keys: ['Shift+Enter'], fixed: true },

  { id: 'deck.close', scope: 'deck', label: 'Close the deck', keys: ['Escape'] },
  { id: 'deck.prevTab', scope: 'deck', label: 'Previous tab', keys: ['q'] },
  { id: 'deck.nextTab', scope: 'deck', label: 'Next tab', keys: ['e'] },
  { id: 'deck.tab', scope: 'deck', label: 'Jump to a tab', keys: ['1', '6'], fixed: true, range: true, note: 'In tab order' },
  { id: 'deck.keymap', scope: 'deck', label: 'Keymap', keys: ['?'] },

  { id: 'list.down', scope: 'list', label: 'Next row', keys: ['j', 'ArrowDown'] },
  { id: 'list.up', scope: 'list', label: 'Previous row', keys: ['k', 'ArrowUp'] },
  { id: 'list.top', scope: 'list', label: 'First row', keys: ['g'] },
  { id: 'list.bottom', scope: 'list', label: 'Last row', keys: ['G'] },
  { id: 'list.go', scope: 'list', label: 'Deploy on the row', keys: ['Enter'], note: 'A pomodoro on the entry; on the couch list, sit down' },
  { id: 'list.clear', scope: 'list', label: 'Clear the entry', keys: ['c'] },
  { id: 'list.delete', scope: 'list', label: 'Delete the row', keys: ['x'] },
  { id: 'list.rename', scope: 'list', label: 'Rename', keys: ['r'] },
  { id: 'list.ledgerNext', scope: 'list', label: 'File to the next ledger', keys: [']'] },
  { id: 'list.ledgerPrev', scope: 'list', label: 'File to the previous ledger', keys: ['['] },
  { id: 'list.moveDown', scope: 'list', label: 'Move the row down', keys: ['J'], note: 'The flow' },
  { id: 'list.moveUp', scope: 'list', label: 'Move the row up', keys: ['K'], note: 'The flow' },
  { id: 'list.new', scope: 'list', label: 'New entry', keys: ['n'], note: 'Puts the cursor in the box' },
  { id: 'list.cues', scope: 'list', label: 'Context switch rules', keys: ['Space'], note: 'The couch list' },
  { id: 'list.blitz', scope: 'list', label: 'Blitz the flow', keys: ['b'] },
  { id: 'list.sort', scope: 'list', label: 'Auto-classify the tray', keys: ['s'] },

  { id: 'shelf.left', scope: 'shelf', label: 'Bay to the left', keys: ['h', 'ArrowLeft'] },
  { id: 'shelf.right', scope: 'shelf', label: 'Bay to the right', keys: ['l', 'ArrowRight'] },
  { id: 'shelf.up', scope: 'shelf', label: 'Bay above', keys: ['k', 'ArrowUp'] },
  { id: 'shelf.down', scope: 'shelf', label: 'Bay below', keys: ['j', 'ArrowDown'] },
  { id: 'shelf.open', scope: 'shelf', label: 'Open the ledger', keys: ['Enter'], note: 'On the empty bay, write one' },
  { id: 'shelf.edit', scope: 'shelf', label: 'Edit the ledger', keys: ['r'] },
  { id: 'shelf.new', scope: 'shelf', label: 'Write a ledger', keys: ['n'] },
  { id: 'shelf.back', scope: 'shelf', label: 'Back to the shelf', keys: ['Backspace'], note: 'From inside a ledger' },
  { id: 'shelf.focus', scope: 'shelf', label: 'Focus here, no entry', keys: ['f'], note: 'From inside a ledger' },

  { id: 'move.left', scope: 'move', label: 'Left', keys: ['h', 'ArrowLeft'], note: 'Shift goes far' },
  { id: 'move.down', scope: 'move', label: 'Down', keys: ['j', 'ArrowDown'], note: 'Shift goes far' },
  { id: 'move.up', scope: 'move', label: 'Up', keys: ['k', 'ArrowUp'], note: 'Shift goes far' },
  { id: 'move.right', scope: 'move', label: 'Right', keys: ['l', 'ArrowRight'], note: 'Shift goes far' },
  { id: 'move.corner', scope: 'move', label: 'A corner', keys: ['1', '4'], fixed: true, range: true, note: 'Top left, top right, bottom left, bottom right' },
  { id: 'move.done', scope: 'move', label: 'Done', keys: ['Enter', 'Escape'], note: 'So does any key not listed here' },

  { id: 'keymap.search', scope: 'keymap', label: 'Search', keys: ['/'], fixed: true },
  { id: 'keymap.move', scope: 'keymap', label: 'Select a row', keys: ['j', 'k'], fixed: true, note: 'Or the arrows' },
  { id: 'keymap.bind', scope: 'keymap', label: 'Change the key', keys: ['Enter'], fixed: true, note: 'Then press the new key. Shift+Enter sets the second key' },
  { id: 'keymap.reset', scope: 'keymap', label: 'Back to the default', keys: ['Backspace'], fixed: true },
  { id: 'keymap.close', scope: 'keymap', label: 'Close', keys: ['Escape'], fixed: true },
]

const DEF = new Map(KEYS.map((d) => [d.id, d]))

/** Shift on a US layout, for an event that reports the unshifted character (synthetic events do). */
const SHIFTED: Record<string, string> = {
  Slash: '?', Comma: '<', Period: '>', Semicolon: ':', Quote: '"', BracketLeft: '{', BracketRight: '}', Backslash: '|',
  Minus: '_', Equal: '+', Backquote: '~', Digit1: '!', Digit2: '@', Digit3: '#', Digit4: '$', Digit5: '%', Digit6: '^', Digit7: '&', Digit8: '*', Digit9: '(', Digit0: ')',
}

/**
 * One key event as a key name: 'j', 'G' (Shift+g), '?', 'Space', 'ArrowDown', 'Shift+Enter',
 * 'Ctrl+k'. Shift is in the character for printable keys and spelled out for the rest.
 * With Option held, macOS reports the composed character, so the key position is used.
 */
export function keyOf(e: KeyboardEvent, opts?: { ignoreAlt?: boolean }): string | null {
  if (MODIFIER_KEYS.has(e.key)) return null
  const mods: string[] = []
  if (e.ctrlKey) mods.push('Ctrl')
  // The swap menu: the swap key's Option may still be down, and must not change what the key is.
  if (e.altKey && !opts?.ignoreAlt) mods.push('Alt')
  if (e.metaKey) mods.push('Cmd')
  let k: string
  if (e.key === ' ' || e.code === 'Space') k = 'Space'
  else if (e.altKey && (e.code.startsWith('Key') || e.code.startsWith('Digit'))) {
    const p = physicalKey(e)
    k = e.shiftKey ? p.toUpperCase() : p
  } else if (e.key.length === 1) k = e.shiftKey ? (SHIFTED[e.code] ?? e.key) : e.key
  else {
    k = e.key
    if (e.shiftKey) mods.push('Shift')
  }
  return [...mods, k].join('+')
}

/** The same key without Shift: 'G' is 'g', 'Shift+Enter' is 'Enter'. */
export function unshift(key: string): string {
  const parts = key.split('+').filter((p) => p !== 'Shift')
  const last = parts[parts.length - 1]
  if (last.length === 1 && /[A-Z]/.test(last)) parts[parts.length - 1] = last.toLowerCase()
  return parts.join('+')
}

const NAMES: Record<string, string> = {
  ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right', Escape: 'Esc', Delete: 'Del', ' ': 'Space',
}

/** A key as it reads on a keycap: 'J', 'Shift+J', 'Down', 'Esc', '?'. */
export function keyLabel(key: string): string {
  const parts = key.split('+')
  const last = parts.pop() ?? ''
  if (last.length === 1 && /[A-Z]/.test(last)) parts.push('Shift', last)
  else if (last.length === 1) parts.push(last.toUpperCase())
  else parts.push(NAMES[last] ?? last)
  return parts.join('+')
}

/** The keys bound to an action: the user's, else the default. */
export function keysFor(id: string, settings: Settings): string[] {
  const o = settings.keymap?.[id]
  if (o && o.length) return o
  return DEF.get(id)?.keys ?? []
}

/** The action in this scope that the event's key is bound to, or null. Ranges (tabs, corners) are the caller's. */
export function actionFor(e: KeyboardEvent, scope: Scope, settings: Settings, opts?: { ignoreShift?: boolean; ignoreAlt?: boolean }): string | null {
  const k = keyOf(e, opts)
  if (!k) return null
  const alt = opts?.ignoreShift ? unshift(k) : null
  for (const d of KEYS) {
    if (d.scope !== scope || d.range) continue
    const keys = keysFor(d.id, settings)
    if (keys.includes(k) || (alt !== null && keys.includes(alt))) return d.id
  }
  return null
}

/** Scopes whose keys can be live at the same time, so a shared key is a real clash. */
export function scopesOverlap(a: Scope, b: Scope): boolean {
  if (a === b) return true
  const inDeck = new Set<Scope>(['deck', 'list', 'shelf'])
  return inDeck.has(a) && inDeck.has(b)
}

/** Other in-app actions that would fire on the same key. */
export function conflictsOf(id: string, keys: string[], settings: Settings): KeyDef[] {
  const me = DEF.get(id)
  if (!me) return []
  return KEYS.filter((d) => d.id !== id && !d.range && scopesOverlap(d.scope, me.scope) && keysFor(d.id, settings).some((k) => keys.includes(k)))
}

// ---- which screen owns the keyboard ----

let modal = false
/** The Keymap screen is open: every other key handler stands down. */
export const keymapOpen = () => modal
export const setKeymapOpen = (on: boolean) => { modal = on }

// ---- how often each action is used, for ranking; this machine only ----

const USE_KEY = 'mayorly.keyuse.v1'
let uses: Record<string, number> | null = null
function loadUses(): Record<string, number> {
  if (uses) return uses
  try {
    uses = JSON.parse(localStorage.getItem(USE_KEY) ?? '{}') as Record<string, number>
  } catch {
    uses = {}
  }
  return uses
}
export function recordUse(id: string) {
  const u = loadUses()
  u[id] = (u[id] ?? 0) + 1
  try {
    localStorage.setItem(USE_KEY, JSON.stringify(u))
  } catch {
    // Private mode or a full store: the ranking is a convenience.
  }
}
export const usesOf = (id: string) => loadUses()[id] ?? 0
