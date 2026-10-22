import type { Action, HudEvent, MayorlyState } from '../core/index'

// The contract between a Mayorly client (the HUD) and whatever owns the state.
// In Electron that is the main process over IPC; in a plain browser it is an
// in-page engine. A future local sync API would implement the same shape.

/** field: the passive HUD, clicks fall through to your apps. The rest take focus. */
export type UiMode = 'field' | 'plus' | 'deck' | 'capture'

/** Hotkey-driven requests from the shell to the HUD. */
export type Command = 'plus' | 'capture' | 'deck'

/** How the shell lays the HUD out. Compact: the window is only the pet and what it unfolds (macOS). */
export interface Layout {
  compact: boolean
  /** Which screen edge the pet is nearer, so the card unfolds toward the centre. */
  side: 'left' | 'right'
  /** The window is being dragged by its tomato; nothing unfolds until it settles. */
  dragging: boolean
}

export interface DisplayInfo {
  id: number
  label: string
  primary: boolean
  current: boolean
}

/** Hotkeys that could not be registered, and why when the shell knows. */
export interface HotkeyFailures {
  keys: string[]
  /** macOS 15.0 and 15.1 refused combos whose only modifiers were Option and Shift. */
  reason?: 'option-only'
}

/** The signed-in account, from the sync server. */
export interface Account {
  email: string
  name: string | null
  avatarUrl: string | null
}

export interface SyncStatus {
  /** off: not signed in. idle: in step as of `at`. */
  phase: 'off' | 'idle' | 'syncing' | 'error'
  at: number | null
  revision: number
  message?: string
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
  /** The shell's layout: asked for on mount, and pushed whenever the pet changes side or is dragged. */
  getLayout(): Promise<Layout>
  onLayout(fn: (layout: Layout) => void): () => void
  /** Accounts: Google sign-in through the system browser, state synced to mayorly-api. */
  accountsAvailable(): Promise<boolean>
  getAccount(): Promise<Account | null>
  signIn(): Promise<Account>
  signOut(): Promise<void>
  onAccount(fn: (account: Account | null) => void): () => void
  onSync(fn: (status: SyncStatus) => void): () => void
  /** Hotkeys that could not be registered (taken by another app, or refused by the OS). */
  onHotkeyFailures(fn: (failures: HotkeyFailures) => void): () => void
}

export const IPC = {
  getState: 'mayorly:get-state',
  dispatch: 'mayorly:dispatch',
  state: 'mayorly:state',
  events: 'mayorly:events',
  command: 'mayorly:command',
  setMode: 'mayorly:set-mode',
  setHit: 'mayorly:set-hit',
  layout: 'mayorly:layout',
  getLayout: 'mayorly:get-layout',
  accountsAvailable: 'mayorly:accounts-available',
  getAccount: 'mayorly:get-account',
  signIn: 'mayorly:sign-in',
  signOut: 'mayorly:sign-out',
  account: 'mayorly:account',
  sync: 'mayorly:sync',
  hotkeyFailures: 'mayorly:hotkey-failures',
} as const
