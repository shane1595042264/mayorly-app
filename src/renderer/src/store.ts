import { useEffect, useState, useSyncExternalStore } from 'react'
import type { Action, HudEvent, MayorlyState } from '@core/index'
import type { Account, AiPublic, SyncStatus } from '../../shared/bridge'
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

export const dispatch = (a: Action) =>
  bridge.dispatch(a).catch((e: unknown) => {
    bridge.log('error', `dispatch ${a.type}: ${e instanceof Error ? e.message : String(e)}`)
  })

/** Latest snapshot, for event handlers that must not close over a stale render. */
export const current = () => state

export function useHudEvents(fn: (e: HudEvent[]) => void) {
  useEffect(() => {
    eventSubs.add(fn)
    return () => void eventSubs.delete(fn)
  }, [fn])
}

// The account and the sync status, pushed by the shell.
let account: Account | null = null
let sync: SyncStatus = { phase: 'off', at: null, revision: 0 }
const accountSubs = new Set<() => void>()
void bridge.getAccount().then((a) => { account = a; accountSubs.forEach((f) => f()) })
bridge.onAccount((a) => { account = a; accountSubs.forEach((f) => f()) })
bridge.onSync((s) => { sync = s; accountSubs.forEach((f) => f()) })
const subAccount = (f: () => void) => {
  accountSubs.add(f)
  return () => void accountSubs.delete(f)
}
export const useAccount = () => useSyncExternalStore(subAccount, () => account)

// The AI clerk's public state: keys by hint, models, usage. Pushed after every change.
let ai: AiPublic = { keys: [], preferredProvider: null, providers: { gemini: 'Google Gemini', openai: 'OpenAI', anthropic: 'Anthropic Claude', xai: 'xAI Grok' }, usage: { days: 30, calls: 0, costMicroUsd: 0 } }
const aiSubs = new Set<() => void>()
void bridge.ai.get().then((a) => { ai = a; aiSubs.forEach((f) => f()) })
bridge.onAi((a) => { ai = a; aiSubs.forEach((f) => f()) })
export const useAi = () => useSyncExternalStore((f) => { aiSubs.add(f); return () => void aiSubs.delete(f) }, () => ai)
/** True when a working key exists, so capture can say the clerk will file by AI. */
export const aiOn = () => ai.keys.some((k) => k.status === 'ok')
export const useSyncStatus = () => useSyncExternalStore(subAccount, () => sync)

/** Wall clock, re-rendering at `ms` intervals aligned to the second. */
export function useNow(ms = 250): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), ms)
    return () => clearInterval(id)
  }, [ms])
  return now
}
