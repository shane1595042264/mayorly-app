import { LocalNotifications } from '@capacitor/local-notifications'
import type { MayorlyState } from '@core/index'
import { endings } from './endings'
import { native } from './platform'

// The phone rings at every block end while it sits locked. The app cannot run then, so the
// endings are worked out ahead: the same reducer is run forward from now, tick by tick at each
// block's end, the way the desk will really go (auto-start, rests, rounds, a sitting that ends),
// and each ending becomes a local notification. Any change to the desk replaces the lot. A desk
// that runs on another computer rings there, not here.

const IDS = Array.from({ length: 12 }, (_, i) => 1001 + i)

let lastKey = ''
let asked = false

/** Replace the scheduled alarms when the desk's course changed. Cheap to call on every state. */
export async function scheduleAlarms(s: MayorlyState, device: string): Promise<void> {
  if (!native) return
  const d = s.desk
  const here = !d.device || d.device.id === device
  const key = JSON.stringify([d.status, d.block, d.runStartedAt, d.bankMs, d.plan?.step, d.plan?.round, here, d.heldAt, s.settings.autoStartFocus, s.settings.autoStartRest])
  if (key === lastKey) return
  lastKey = key
  try {
    await LocalNotifications.cancel({ notifications: IDS.map((id) => ({ id })) })
    if (!here || d.status !== 'running' || d.heldAt !== null) return
    const list = endings(s, Date.now(), device)
    if (!list.length) return
    if (!asked) {
      asked = true
      const p = await LocalNotifications.checkPermissions()
      if (p.display !== 'granted') await LocalNotifications.requestPermissions()
    }
    await LocalNotifications.schedule({
      notifications: list.map((e, i) => ({
        id: IDS[i],
        title: e.title,
        body: e.body,
        schedule: { at: new Date(e.at), allowWhileIdle: true },
      })),
    })
  } catch (err) {
    console.warn('[notify]', err instanceof Error ? err.message : String(err))
  }
}
