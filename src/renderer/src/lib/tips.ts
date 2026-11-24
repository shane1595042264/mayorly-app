import type { HotkeyAction, Settings } from '@core/index'
import { GLOBAL_ACTIONS, KEYS, keyLabel, keysFor } from './keymap'
import { hotkeyLabel, physicalKey } from './keys'

// Tips: a control a key also does says which, so a click on it can show that key (hud/Tips.tsx).
// `tip(id)` goes on the control: an in-app key's id from the keymap ('deck.tab', 'list.go'), or
// 'hotkey:<action>' for a global one. The key shown is the one bound now, so a changed key shows
// as changed. A key with a range ('deck.tab', 1 to 7) names its own with `key`.

export function tip(id: string, does?: string, key?: string): Record<string, string> {
  return { 'data-tip': id, ...(does ? { 'data-tip-does': does } : {}), ...(key ? { 'data-tip-key': key } : {}) }
}

export interface TipCard {
  /** The control's tip id and key together: the same tip twice in a row is not nagged about. */
  id: string
  /** How each key reads on screen. */
  keys: string[]
  /** The keys as bound, to know when one of them is pressed. */
  raw: string[]
  does: string
  /** A global hotkey's action: its use arrives as a command, never as a key in the page. */
  hotkey: HotkeyAction | null
}

const lower = (s: string) => s.charAt(0).toLowerCase() + s.slice(1)

/** What a control's tip says, from its attributes and the keys bound now; null when it names no key. */
export function describeTip(el: HTMLElement, settings: Settings): TipCard | null {
  const id = el.dataset.tip
  if (!id) return null
  if (id.startsWith('hotkey:')) {
    const action = id.slice(7) as HotkeyAction
    const accel = settings.hotkeys[action]
    if (!accel) return null
    const label = GLOBAL_ACTIONS.find(([a]) => a === action)?.[1] ?? action
    return { id, keys: [hotkeyLabel(accel)], raw: [accel], does: el.dataset.tipDoes ?? lower(label), hotkey: action }
  }
  const def = KEYS.find((k) => k.id === id)
  if (!def) return null
  const raw = el.dataset.tipKey ? el.dataset.tipKey.split(' ') : keysFor(id, settings).slice(0, 1)
  if (!raw.length) return null
  return { id: `${id}:${raw.join(' ')}`, keys: raw.map(keyLabel), raw, does: el.dataset.tipDoes ?? lower(def.label), hotkey: null }
}

/** Whether a key press is one of an in-app tip's keys ('3', 'q', 'Enter', 'Shift+Enter', 'G'). */
export function pressesTip(e: KeyboardEvent, raw: string[]): boolean {
  return raw.some((k) => {
    const parts = k.split('+')
    const key = parts.pop() ?? ''
    const mods = new Set(parts.map((p) => p.toLowerCase()))
    if (mods.has('shift') !== e.shiftKey && key.length > 1) return false
    if ((mods.has('ctrl') || mods.has('control')) !== e.ctrlKey) return false
    if ((mods.has('cmd') || mods.has('meta')) !== e.metaKey) return false
    // A capital is its own key (G is Shift+g); anything else matches by position too (Option on a Mac).
    if (key.length === 1) return /[A-Z]/.test(key) ? e.key === key : e.key === key || physicalKey(e) === key
    return e.key === key
  })
}
