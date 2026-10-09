import type { Action, HudEvent, MayorlyState } from '../core/index'

// The contract between a Mayorly client (the HUD) and whatever owns the state.
// In Electron that is the main process over IPC; in a plain browser it is an
// in-page engine. A future local sync API would implement the same shape.

/** field: the passive HUD, clicks fall through to your apps. The rest take focus. */
export type UiMode = 'field' | 'plus' | 'deck' | 'capture'

/** Hotkey-driven requests from the shell to the HUD. */
export type Command = 'plus' | 'capture' | 'deck'

export interface DisplayInfo {
  id: number
  label: string
  primary: boolean
  current: boolean
}

export interface Bridge {
  kind: 'electron' | 'web'
  getState(): Promise<MayorlyState>
  dispatch(action: Action): void
  onState(fn: (state: MayorlyState) => void): () => void
  onEvents(fn: (events: HudEvent[]) => void): () => void
  onCommand(fn: (cmd: Command) => void): () => void
  /** Tell the shell which mode the HUD is in so it can make the window clickable and focused. */
  setMode(mode: UiMode): void
  /** Field mode only: the pointer is over an interactive HUD element. */
  setHit(hit: boolean): void
  /** Hotkeys that could not be registered (taken by another app). */
  onHotkeyFailures(fn: (keys: string[]) => void): () => void
}

export const IPC = {
  getState: 'mayorly:get-state',
  dispatch: 'mayorly:dispatch',
  state: 'mayorly:state',
  events: 'mayorly:events',
  command: 'mayorly:command',
  setMode: 'mayorly:set-mode',
  setHit: 'mayorly:set-hit',
  hotkeyFailures: 'mayorly:hotkey-failures',
} as const
