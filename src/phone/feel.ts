import { Haptics, ImpactStyle, NotificationType } from '@capacitor/haptics'
import { onDeskId, type HudEvent, type MayorlyState } from '@core/index'
import { setSoundEnabled, sfx } from '../renderer/src/lib/sfx'

// How the phone answers: a sound, a tap in the hand, and a word to the screens. What the person
// did is read off the desk before and after (a start is a desk that began running, or moved to
// another task while running), and what the desk did on its own arrives as the reducer's events.
// The screens listen: a start takes them to the timer and the clock lands with a pop.

export type Feel = 'start' | 'pause' | 'resume' | 'stop' | 'skip' | 'clear' | 'tomato' | 'harvest' | 'block' | 'capture'

const listeners = new Set<(f: Feel) => void>()
export function onFeel(fn: (f: Feel) => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}
const tell = (f: Feel) => listeners.forEach((fn) => fn(f))

// In a browser Capacitor's Haptics falls back to navigator.vibrate, which is how the review tour
// counts them; on the phone they are the Taptic Engine.
const impact = (style: ImpactStyle) => void Haptics.impact({ style }).catch(() => {})
const notify = (type: NotificationType) => void Haptics.notification({ type }).catch(() => {})
/** A light tap for anything pressed: a tab, a toggle, a row. */
export const tap = () => void Haptics.selectionChanged().catch(() => {})

let lastStart = 0

/** A person is acting: the events this step makes are theirs, already answered by afterAct. */
export function beginAct() {
  lastStart = Date.now()
}

/** After something the person did here: what changed on the desk, felt and heard. */
export function afterAct(before: MayorlyState, after: MayorlyState, kind?: string) {
  setSoundEnabled(after.settings.sound)
  if (kind === 'desk/skip' || kind === 'desk/skipRest') {
    sfx.swap()
    impact(ImpactStyle.Light)
    tell('skip')
    return
  }
  const b = before.desk
  const a = after.desk
  const wasRunning = b.status === 'running'
  const running = a.status === 'running'
  const moved = onDeskId(before) !== onDeskId(after) || b.plan?.mode !== a.plan?.mode
  if ((running && !wasRunning && (b.status === 'idle' || !b.block)) || (running && moved)) {
    lastStart = Date.now()
    sfx.block()
    impact(ImpactStyle.Medium)
    tell('start')
  } else if (running && !wasRunning) {
    lastStart = Date.now()
    sfx.open()
    impact(ImpactStyle.Light)
    tell('resume')
  } else if (wasRunning && a.status === 'paused') {
    sfx.close()
    impact(ImpactStyle.Light)
    tell('pause')
  } else if (b.status !== 'idle' && a.status === 'idle') {
    sfx.swap()
    impact(ImpactStyle.Heavy)
    tell('stop')
  }
}

/** What the desk did: a tomato ripened, an entry was cleared and paid, a block turned over. */
export function afterEvents(events: HudEvent[]) {
  for (const e of events) {
    if (e.type === 'harvest') {
      sfx.cashIn()
      notify(NotificationType.Success)
      tell('harvest')
    } else if (e.type === 'cleared') {
      sfx.clear()
      notify(NotificationType.Success)
      tell('clear')
    } else if (e.type === 'tomato') {
      sfx.tomato()
      impact(ImpactStyle.Light)
      tell('tomato')
    } else if (e.type === 'block' && Date.now() - lastStart > 600) {
      // A block that turned over on its own (focus to rest and back), not one the person just started.
      sfx.block()
      notify(NotificationType.Warning)
      tell('block')
    }
  }
}

export function captured() {
  sfx.tick()
  impact(ImpactStyle.Light)
  tell('capture')
}
