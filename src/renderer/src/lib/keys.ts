// Keyboard helpers shared by the HUD.
//
// Keys are matched by what was typed when that is a plain letter or digit, and by key
// position otherwise. With Option held, macOS reports e.key as the character the chord
// composes ('†' for Option+T) or 'Dead' (Option+N), so e.key alone can never match a
// hotkey or a Plus menu key there. e.code still says which key it was.

export const IS_MAC = /Mac|iPhone|iPad/.test(navigator.platform)

/** 't' for KeyT however it was modified, '3' for Digit3, otherwise the key name ('Escape', 'Enter'). */
export function physicalKey(e: KeyboardEvent): string {
  if (e.key.length === 1 && /[a-z0-9]/i.test(e.key)) return e.key.toLowerCase()
  if (e.code.startsWith('Key')) return e.code.slice(3).toLowerCase()
  if (e.code.startsWith('Digit')) return e.code.slice(5)
  return e.key.length === 1 ? e.key.toLowerCase() : e.key
}

/** True when the key part of an accelerator like 'Alt+T' is the key of this event. */
export function matchesAcceleratorKey(e: KeyboardEvent, accelerator: string): boolean {
  const key = (accelerator.split('+').pop() ?? '').toLowerCase()
  if (!key) return false
  if (key.length === 1) return physicalKey(e) === key
  if (key === 'space') return e.code === 'Space'
  if (/^num\d$/.test(key)) return e.code === `Numpad${key.slice(3)}`
  return e.key.toLowerCase() === key || e.code.toLowerCase() === key
}

export const MODIFIER_KEYS = new Set(['Alt', 'Control', 'Meta', 'Shift'])

/** Punctuation and numpad keys by position, as Electron spells them in an accelerator. */
const PUNCTUATION: Record<string, string> = {
  Period: '.', Comma: ',', Slash: '/', Semicolon: ';', Quote: "'", Equal: '=', Minus: '-', BracketLeft: '[', BracketRight: ']', Backquote: '`', Backslash: '\\',
  NumpadAdd: 'numadd', NumpadSubtract: 'numsub', NumpadMultiply: 'nummult', NumpadDivide: 'numdiv', NumpadDecimal: 'numdec',
}

/** The modifiers held in this event, in an accelerator's order and spelling ('Ctrl+Alt'). */
export function modifiersOf(e: KeyboardEvent): string {
  const mods: string[] = []
  if (e.ctrlKey) mods.push('Ctrl')
  if (e.altKey) mods.push('Alt')
  if (e.shiftKey) mods.push('Shift')
  // Electron spells the Windows key Super; Cmd is a Mac key and registers nowhere else.
  if (e.metaKey) mods.push(IS_MAC ? 'Cmd' : 'Super')
  return mods.join('+')
}

/** The key of a global hotkey, by its position, as Electron spells it; null for one it cannot register. */
export function acceleratorKey(e: KeyboardEvent): string | null {
  if (e.code.startsWith('Key') || e.code.startsWith('Digit')) return physicalKey(e).toUpperCase()
  if (/^Numpad\d$/.test(e.code)) return `num${e.code.slice(6)}`
  if (e.code === 'Space') return 'Space'
  if (PUNCTUATION[e.code]) return PUNCTUATION[e.code]
  if (/^F\d{1,2}$/.test(e.key)) return e.key
  if (e.key.startsWith('Arrow')) return e.key.slice(5)
  if (['Enter', 'Tab', 'Backspace', 'Delete', 'Insert', 'Home', 'End', 'PageUp', 'PageDown'].includes(e.key)) return e.key
  return null
}

/** Ctrl, Alt or the Windows key (Cmd on a Mac) is held: Shift alone does not make a global hotkey. */
export const hasHotkeyModifier = (e: KeyboardEvent) => e.ctrlKey || e.altKey || e.metaKey

/**
 * A global hotkey (an Electron accelerator) from a key event: the modifiers held and the key, by its
 * position. Null without Ctrl, Alt or the Windows key (Cmd on a Mac), since a global shortcut on a
 * plain or shifted key would take that key from every app, and for a key the shell cannot register.
 */
export function acceleratorOf(e: KeyboardEvent): string | null {
  const key = hasHotkeyModifier(e) ? acceleratorKey(e) : null
  return key ? `${modifiersOf(e)}+${key}` : null
}

/** Why this key event cannot be a global hotkey, in words, or null when it can. */
export function hotkeyRefusal(e: KeyboardEvent): string | null {
  if (!hasHotkeyModifier(e)) return IS_MAC ? 'Hold Control, Option or Cmd with the key' : 'Hold Ctrl, Alt or the Windows key with the key'
  if (!acceleratorKey(e)) return `The ${e.key === ' ' ? 'Space' : e.key} key cannot be in a hotkey. Press another`
  return null
}

const MAC_NAMES: Record<string, string> = {
  alt: 'Option',
  option: 'Option',
  ctrl: 'Control',
  control: 'Control',
  commandorcontrol: 'Cmd',
  cmdorctrl: 'Cmd',
  cmd: 'Cmd',
  command: 'Cmd',
  super: 'Cmd',
  meta: 'Cmd',
}

/** An accelerator as the keycaps read on this machine. Stored strings keep Electron's cross-platform spelling. */
export function hotkeyLabel(accelerator: string): string {
  if (!IS_MAC) return accelerator
  return accelerator
    .split('+')
    .map((t) => MAC_NAMES[t.toLowerCase()] ?? t)
    .join('+')
}
