import { useEffect, useState, useSyncExternalStore } from 'react'
import type { Action, MayorlyState } from '@core/index'
import type { PhoneEngine } from './engine'

// The screens read the engine's state and send it what the person does. Nothing a screen
// keeps for itself matters after a restart: picks in progress, an open sheet, a draft.

let engine: PhoneEngine | null = null

export function setEngine(e: PhoneEngine) {
  engine = e
}

export function useMayorly(): MayorlyState {
  return useSyncExternalStore((f) => engine!.on(f), () => engine!.state)
}

/** A person did this, here: the phone runs the desk from now on. */
export function act(action: Action) {
  engine?.act(action)
}

export function current(): MayorlyState {
  return engine!.state
}

export function deviceId(): string {
  return engine?.deviceId ?? ''
}

/** The clock for anything on screen that counts: every second, or slower. */
export function useNow(every = 1000): number {
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), every)
    return () => clearInterval(id)
  }, [every])
  return now
}
