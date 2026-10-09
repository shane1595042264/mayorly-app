// The Mayorly domain. Nouns follow mayorly-design/docs/01-product-spec.md:
// entries live in ledgers, work happens at the desk, desk time mints tomatoes,
// tomatoes pay tokens. Nothing here knows about Electron, the DOM, or pixels.

export type Id = string
export type Ms = number
export type Epoch = number

export type GlyphName =
  | 'scales' | 'music' | 'briefcase' | 'book' | 'code' | 'barbell'
  | 'pen' | 'house' | 'heart' | 'flask' | 'globe' | 'paint' | 'run' | 'game'

export interface Ledger {
  id: Id
  name: string
  /** 2-4 uppercase letters, the callsign the HUD shows. */
  code: string
  /** Written inclusion criterion. The clerk files against this, not the name. */
  criterion: string
  glyph: GlyphName
  /** User-made ledgers are locked: the clerk may file into them, never rename, merge or delete. */
  handWritten: boolean
  createdAt: Epoch
}

export interface Entry {
  id: Id
  title: string
  /** null means the entry is still in the mail tray, unfiled. */
  ledgerId: Id | null
  estimateMin: number | null
  /** Position in the flow. Lower runs first. */
  order: number
  createdAt: Epoch
  doneAt: Epoch | null
}

export type SlotTarget = { kind: 'ledger'; ledgerId: Id } | { kind: 'entry'; entryId: Id }

export interface SupersetSlot {
  id: Id
  target: SlotTarget
  minutes: number
}

/** A rotation rule: the desk cycles through slots on its own, round after round. */
export interface Superset {
  id: Id
  name: string
  slots: SupersetSlot[]
  /** 0 means keep rotating until you stand down. */
  rounds: number
  restMin: number
  roundRestMin: number
  order: 'fixed' | 'shuffle'
  /** What happens when the block's entry is cleared before the block ends. */
  onClear: 'next-in-ledger' | 'next-slot'
}

/**
 * pomodoro: one entry, focus and rest cycles (Focus To-Do).
 * blitz: run the flow top to bottom, one entry at a time, timed against its estimate (Blitzit).
 * superset: rotate through a superset's slots automatically.
 */
export type Mode = 'pomodoro' | 'blitz' | 'superset'

export interface Block {
  kind: 'focus' | 'rest'
  ledgerId: Id | null
  entryId: Id | null
  /** null counts up with no end, used by blitz entries that have no estimate. */
  durationMs: Ms | null
  slotIndex: number | null
  round: number
  label: string
}

export interface Plan {
  mode: Mode
  supersetId: Id | null
  /** pomodoro and blitz: the entry the plan is anchored on. */
  anchorEntryId: Id | null
  /** pomodoro: the ledger to stay in when the anchor entry is cleared or absent. */
  anchorLedgerId: Id | null
  round: number
  /** Index into `sequence` for supersets. */
  step: number
  /** Slot order for the current round; shuffled per round when the superset asks. */
  sequence: number[]
  /** Focus blocks finished in this plan, drives the long-rest cadence. */
  focusCount: number
}

export interface Sitting {
  id: Id
  startedAt: Epoch
  endedAt: Epoch | null
  /** Tomato interval locked at the moment you sat down. */
  tomatoMs: Ms
  /** Focus time from closed segments. */
  focusMs: Ms
  tomatoes: number
  tokens: number
}

export interface Segment {
  id: Id
  sittingId: Id
  kind: 'focus' | 'rest'
  ledgerId: Id | null
  entryId: Id | null
  start: Epoch
  end: Epoch | null
}

/** ready = a block is queued and waiting for you to start it (auto-start off). */
export type DeskStatus = 'idle' | 'running' | 'paused' | 'ready'

export interface Desk {
  status: DeskStatus
  sittingId: Id | null
  plan: Plan | null
  block: Block | null
  /** When the current run of the block began; null unless running. */
  runStartedAt: Epoch | null
  /** Block time banked before the current run (pauses split runs). */
  bankMs: Ms
}

export interface TokenTx {
  id: Id
  at: Epoch
  amount: number
  reason: 'tomato'
  sittingId: Id
}

export interface ClerkLine {
  at: Epoch
  text: string
}

export type HotkeyAction = 'plus' | 'capture' | 'deck' | 'pause' | 'hide'

export interface Settings {
  /** Focus length, and the tomato interval. */
  focusMin: number
  shortRestMin: number
  longRestMin: number
  longRestEvery: number
  autoStartFocus: boolean
  autoStartRest: boolean
  sound: boolean
  hudSide: 'right' | 'left'
  hudScale: number
  hotkeys: Record<HotkeyAction, string>
  openAtLogin: boolean
}

export interface MayorlyState {
  schema: 1
  ledgers: Ledger[]
  entries: Entry[]
  supersets: Superset[]
  sittings: Sitting[]
  segments: Segment[]
  tokens: TokenTx[]
  clerkLog: ClerkLine[]
  desk: Desk
  settings: Settings
}

export type HudEvent =
  | { type: 'tomato'; at: Epoch; n: number; tokens: number }
  | { type: 'block'; at: Epoch; block: Block; started: boolean }
  | { type: 'swap'; at: Epoch; ledgerId: Id | null; entryId: Id | null }
  | { type: 'cleared'; at: Epoch; entryId: Id; title: string }
  | { type: 'sitting-end'; at: Epoch; reason: 'stood' | 'complete' | 'flow-clear'; focusMs: Ms; tomatoes: number; tokens: number }
  | { type: 'notice'; at: Epoch; text: string }

/** Everything impure the reducer needs, passed in so the core stays deterministic. */
export interface Ctx {
  now: Epoch
  newId: () => Id
  random: () => number
}
