// The Mayorly domain. Nouns follow mayorly-design/docs/01-product-spec.md:
// entries live in ledgers, work happens at the desk, desk time mints tomatoes,
// tomatoes pay coins. Nothing here knows about Electron, the DOM, or pixels.

export type Id = string
export type Ms = number
export type Epoch = number

export type GlyphName =
  | 'scales' | 'music' | 'briefcase' | 'book' | 'code' | 'barbell'
  | 'pen' | 'house' | 'heart' | 'flask' | 'globe' | 'paint' | 'run' | 'game'

/** The colours a ledger can wear; amber is the HUD's own accent and the default. */
export const LEDGER_THEMES = ['amber', 'teal', 'blue', 'green', 'rose', 'slate'] as const
export type LedgerTheme = (typeof LEDGER_THEMES)[number]

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
  /**
   * Off for work you are paid for in money: tomatoes still ripen and count, no coin is minted
   * on ledger time or at the harvest, and nothing is charged. Missing means on.
   */
  pays?: boolean
  /** The ledger's colour on the pet, the shelf and the swap menu. Missing means amber. */
  theme?: LedgerTheme
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
  /** Set when the AI clerk chose the ledger; cleared once you move it, which teaches the clerk a house rule. `unsure` shows as a question mark. */
  clerkFiled?: { ledgerId: Id | null; model: string; confidence: 'sure' | 'unsure' }
  /** Tomatoes grown on this entry and not yet harvested. They pay out as coins when the entry is cleared. */
  tomatoes: number
  /** When the entry was cleared and its tomatoes paid. */
  harvestedAt?: Epoch
  /** The quick drawer: a few lines of your own, and a checklist under the entry. */
  notes?: string
  subtasks?: Subtask[]
}

export interface Subtask {
  id: Id
  text: string
  done: boolean
}

/**
 * A standing instruction to the clerk, in the user's words. Most are learned: when
 * you move an entry the clerk filed, the correction becomes a rule the clerk reads
 * before every filing. Any rule can be edited or removed in Settings.
 */
export interface HouseRule {
  id: Id
  text: string
  createdAt: Epoch
  /** The correction this rule was learned from, if it was. */
  learnedFrom?: { title: string; fromLedgerId: Id | null; toLedgerId: Id | null }
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
export type Mode = 'pomodoro' | 'blitz' | 'superset' | 'couch'

export interface Block {
  kind: 'focus' | 'rest' | 'leisure'
  ledgerId: Id | null
  entryId: Id | null
  /** leisure: what is being consumed. */
  leisureId?: Id | null
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
  /** couch: the entertainment being consumed. */
  leisureId?: Id | null
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
  kind: 'focus' | 'rest' | 'leisure'
  ledgerId: Id | null
  entryId: Id | null
  /** leisure segments: the entertainment being consumed. */
  leisureId?: Id | null
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
  /** The previous session, parked by the quick switch, its clock stopped where it was. */
  holster: HeldSession | null
  /** The entry the desk was on before the last swap: the other half of the quick switch when nothing is parked. */
  previous: { entryId: Id | null; ledgerId: Id | null } | null
}

export interface TokenTx {
  id: Id
  at: Epoch
  /** Positive when earned, negative when spent. */
  amount: number
  reason: 'tomato' | 'harvest' | 'leisure' | 'refund'
  /** Tomatoes this record stands for: one for a tomato, the crop for a harvest. Absent on older records and on spends. */
  tomatoes?: number
  sittingId: Id
  leisureId?: Id
  entryId?: Id
}

/**
 * Entertainment: games, shows, streams, anything with no productive value. Outside
 * the ledgers, never earns, and is bought with coins by the minute on the couch.
 */
export interface LeisureItem {
  id: Id
  title: string
  createdAt: Epoch
  archivedAt: Epoch | null
  /** Context switch rules: cues, in your words, for when to leave this and go do something else. No logic, just the reminder. */
  cues: string[]
}

/** A session parked by the quick switch: its plan, its block with the time already spent on it, and its sitting. */
export interface HeldSession {
  sittingId: Id
  plan: Plan
  block: Block
  bankMs: Ms
}

export interface ClerkLine {
  at: Epoch
  text: string
}

export type HotkeyAction = 'plus' | 'capture' | 'deck' | 'pause' | 'hide' | 'switch' | 'clear' | 'move' | 'drawer'

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
  /** Text size per area, 1 is the design size: the pet's task line, the deck, the swap menu. Per machine. */
  text: { pet: number; deck: number; plus: number }
  /** macOS: the running block's clock beside the menu bar tomato. */
  trayTimer: boolean
  hotkeys: Record<HotkeyAction, string>
  /** In-app keys the user changed, by action id, up to two keys each. Missing ids use the HUD's defaults; syncs with the account. */
  keymap: Record<string, string[]>
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
  houseRules: HouseRule[]
  leisure: LeisureItem[]
  desk: Desk
  settings: Settings
}

export type HudEvent =
  /** A tomato ripened. On an entry it is banked there (coins 0) until the entry is cleared; ledger time pays as it goes. */
  | { type: 'tomato'; at: Epoch; n: number; tokens: number; entryId: Id | null }
  /** An entry was cleared and its tomatoes paid out. */
  | { type: 'harvest'; at: Epoch; entryId: Id; title: string; tomatoes: number; tokens: number }
  | { type: 'block'; at: Epoch; block: Block; started: boolean }
  | { type: 'swap'; at: Epoch; ledgerId: Id | null; entryId: Id | null }
  | { type: 'cleared'; at: Epoch; entryId: Id; title: string }
  | { type: 'sitting-end'; at: Epoch; reason: 'stood' | 'complete' | 'flow-clear'; focusMs: Ms; tomatoes: number; tokens: number }
  | { type: 'notice'; at: Epoch; text: string }
  /** The quick switch: now on `label`, the other session parked. */
  | { type: 'switch'; at: Epoch; label: string; parked: string | null }
  /** You corrected or confirmed a filing; the clerk may ask why, and the answer goes into the rule. */
  | { type: 'clerk-wonders'; at: Epoch; entryId: Id; ruleId: Id | null; title: string; ledgerId: Id | null; fromLedgerId: Id | null; reason: 'moved' | 'confirmed' }

/** Everything impure the reducer needs, passed in so the core stays deterministic. */
export interface Ctx {
  now: Epoch
  newId: () => Id
  random: () => number
}
