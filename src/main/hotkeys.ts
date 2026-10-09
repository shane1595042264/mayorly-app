import { globalShortcut } from 'electron'
import type { HotkeyAction } from '@core/index'

// Modifier-combo global shortcuts. Registration fails quietly in Electron when
// another app owns the combo, so failures are collected and shown on the HUD.

export function registerHotkeys(
  keys: Record<HotkeyAction, string>,
  handlers: Record<HotkeyAction, () => void>,
): string[] {
  globalShortcut.unregisterAll()
  const failed: string[] = []
  for (const action of Object.keys(handlers) as HotkeyAction[]) {
    const accel = keys[action]
    if (!accel) continue
    let ok = false
    try {
      ok = globalShortcut.register(accel, handlers[action])
    } catch {
      ok = false
    }
    if (!ok) failed.push(accel)
  }
  return failed
}
