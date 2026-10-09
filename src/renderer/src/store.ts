import { useEffect, useState, useSyncExternalStore } from 'react'
import type { Action, HudEvent, MayorlyState } from '@core/index'
import { bridge } from './bridge'

let state: MayorlyState | null = null
const subs = new Set<() => void>()
const set = (s: MayorlyState) => {
  state = s
  subs.forEach((f) => f())
}
void bridge.getState().then(set)
bridge.onState(set)

const eventSubs = new Set<(e: HudEvent[]) => void>()
bridge.onEvents((e) => eventSubs.forEach((f) => f(e)))

export function useMayorly(): MayorlyState | null {
  return useSyncExternalStore(
    (f) => {
      subs.add(f)
      return () => subs.delete(f)
    },
    () => state,
  )
}

export const dispatch = (a: Action) => bridge.dispatch(a)

/** Latest snapshot, for event handlers that must not close over a stale render. */
export const current = () => state

export function useHudEvents(fn: (e: HudEvent[]) => void) {
  useEffect(() => {
    eventSubs.add(fn)
    return () => void eventSubs.delete(fn)
  }, [fn])
}

/** Wall clock, re-rendering at `ms` intervals aligned to the second. */
export function useNow(ms = 250): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), ms)
    return () => clearInterval(id)
  }, [ms])
  return now
}
