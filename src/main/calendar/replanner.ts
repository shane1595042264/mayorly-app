import { powerMonitor } from 'electron'
import type { Action } from '@core/index'
import { machineZone, windowsFor } from '../../shared/windows'
import type { Engine } from '../engine'

// The planner's trigger, in one place. After anything that can change the plan (entries,
// events, outside calendars, calendar settings, a merge from the server), once a minute,
// and on waking, main expands the work hours in the calendar's zone and asks the reducer
// to replan. The reducer returns the same state when nothing moved, so a quiet tick costs
// nothing downstream. Coalesced so a burst of edits plans once.

const DAY = 86_400_000
const SETTLE_MS = 250
const EVERY_MS = 60_000
const TRIGGERS = ['entry/', 'calendar/', 'schedule/apply', 'settings/update', 'sync/', 'ledger/delete']

export function installReplanner(engine: Engine) {
  let timer: NodeJS.Timeout | null = null
  const replan = () => {
    timer = null
    const cal = engine.state.settings.calendar
    if (!cal.tz) {
      // First run on this machine: the hours are written in its zone from now on.
      engine.dispatch({ type: 'settings/update', patch: { calendar: { ...cal, tz: machineZone() } } })
      return
    }
    const now = Date.now()
    const horizonEnd = now + cal.horizonDays * DAY
    engine.dispatch({ type: 'schedule/replan', windows: windowsFor(cal, now, cal.horizonDays + 1), horizonEnd })
  }
  const soon = () => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(replan, SETTLE_MS)
  }
  engine.onAction((action: Action) => {
    if (action.type === 'schedule/replan' || action.type === 'desk/tick') return
    if (TRIGGERS.some((t) => action.type.startsWith(t))) soon()
  })
  setInterval(replan, EVERY_MS)
  powerMonitor.on('resume', soon)
  soon()
  return { replan }
}
