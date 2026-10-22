import { globalShortcut } from 'electron'
import type { HotkeyAction } from '@core/index'

// Modifier-combo global shortcuts. Registration fails quietly in Electron when
// another app owns the combo, so failures are collected and shown on the HUD.
// macOS: these go through Carbon hot keys, which need no Accessibility permission.
// Never add media keys or an event tap here; both would trigger that prompt.

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

/**
 * macOS 15.0 and 15.1 refused every hot key whose only modifiers were Option and Shift;
 * 15.2 relaxed it. When that is the whole story, the HUD should not blame another app.
 */
export function refusedAsOptionOnly(failed: string[]): boolean {
  if (process.platform !== 'darwin' || failed.length === 0) return false
  const [major, minor] = process.getSystemVersion().split('.').map(Number)
  if (major !== 15 || minor > 1) return false
  return failed.every((a) => /^((Alt|Option|Shift)\+)+[^+]+$/i.test(a))
}
