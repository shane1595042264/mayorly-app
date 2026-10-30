import type { Action, HudEvent, MayorlyState } from '../core/index'

// The contract between a Mayorly client (the HUD) and whatever owns the state.
// In Electron that is the main process over IPC; in a plain browser it is an
// in-page engine. A future local sync API would implement the same shape.

/** field: the passive HUD, clicks fall through to your apps. The rest take focus. */
/** drawer: the quick drawer beside the pet, for what is on the desk. On a Mac it is the shell's own window (?drawer), never this one. */
export type UiMode = 'field' | 'plus' | 'deck' | 'capture' | 'drawer'

/** Hotkey-driven requests from the shell to the HUD. `close` returns to field mode (the window lost focus). */
/** Option+digit while the Plus menu is open: pick that number in the arm you are on; 0 is the couch. */
export type PickCommand = `pick-${0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9}`
/** arm-* and pick-*: Option+arrow or digit while the Plus menu is open, taken by the shell so they land even before the window has the keyboard. */
export type Command = 'plus' | 'capture' | 'deck' | 'drawer' | 'close' | 'move' | 'arm-up' | 'arm-down' | 'arm-left' | 'arm-right' | PickCommand

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

/** Bring-your-own-key AI for the clerk. The key itself never crosses the bridge, only its last four. */
export type AiProvider = 'gemini' | 'openai' | 'anthropic' | 'xai'

export interface AiKeyPublic {
  id: string
  provider: AiProvider
  keyHint: string
  /** Text models this key can use, cheapest first. */
  models: string[]
  /** The cheapest model that answered the key check. */
  defaultModel: string
  preferredModel: string | null
  status: 'ok' | 'failing'
  lastError: string | null
  lastCheckedAt: number
  createdAt: number
}

/** One line of the clerk's proposal for the calendar: what it would do, or why it was refused. */
export interface ArrangementLine {
  text: string
  ok: boolean
  reason?: string
}

/** The clerk's proposal after a request in words, previewed and held by the shell until applied or discarded. */
export interface Arrangement {
  id: string
  /** The clerk's own log line. */
  say: string
  /** What the clerk could not do, in words, or null. */
  ask: string | null
  lines: ArrangementLine[]
  /** Blocks that would move, and blocks that would turn late, if applied. */
  moved: number
  newLate: number
  /** Names it could not pin down: pick one per ref before applying. */
  asks: { ref: string; options: { id: string; title: string }[] }[]
}

/** The clerk's question after you corrected or confirmed a filing. Answering is optional. */
export interface ClerkQuestion {
  entryId: string
  ruleId: string | null
  title: string
  question: string
}

/** A screen effect the shell asks its effects window to play (macOS), or the overlay plays itself (Windows). */
export interface Effect {
  kind: 'cashin'
  /** Coins just paid out. */
  amount: number
  /** The balance after. */
  balance: number
  /** Where the coins start, in the effect window's CSS pixels: the tomato. */
  from: { x: number; y: number }
}

export interface AppInfo {
  version: string
  platform: string
  arch: string
  dataDir: string
  packaged: boolean
  /** The commit this build came from, and when it was built. */
  commit: string
  builtAt: number
}

/** The top section of NOTES.md, stamped into the build. */
export interface BuildNotes {
  title: string
  lines: string[]
}

export interface BuildInfo {
  version: string
  /** Short commit hash, with a trailing + when the tree was dirty. */
  commit: string
  /** Epoch ms of the build; 0 when unstamped. */
  builtAt: number
  notes: BuildNotes | null
}

export interface ClerkNotice {
  phase: 'working' | 'done'
  text: string
}

export interface AiPublic {
  keys: AiKeyPublic[]
  preferredProvider: AiProvider | null
  providers: Record<AiProvider, string>
  usage: { days: number; calls: number; costMicroUsd: number }
}

export interface Bridge {
  kind: 'electron' | 'web'
  getState(): Promise<MayorlyState>
  /** Resolves when the main process has reduced it; rejects when it could not. */
  dispatch(action: Action): Promise<unknown>
  onState(fn: (state: MayorlyState) => void): () => void
  onEvents(fn: (events: HudEvent[]) => void): () => void
  onCommand(fn: (cmd: Command) => void): () => void
  /** Tell the shell which mode the HUD is in so it can make the window clickable and focused. */
  setMode(mode: UiMode): void
  /** Field mode only: the pointer is over an interactive HUD element. */
  setHit(hit: boolean): void
  /** macOS: the hover caption is its own click-through window beside the pet; null hides it. */
  setCaption(text: string | null): void
  /** The caption window's own page: the text to show and which side of the pet it sits on. */
  onCaption(fn: (caption: { text: string; side: 'left' | 'right' }) => void): () => void
  /** The shell's layout: asked for on mount, and pushed whenever the pet changes side or is dragged. */
  getLayout(): Promise<Layout>
  onLayout(fn: (layout: Layout) => void): () => void
  /** Accounts: Google sign-in through the system browser, state synced to mayorly-api. */
  accountsAvailable(): Promise<boolean>
  getAccount(): Promise<Account | null>
  signIn(): Promise<Account>
  signOut(): Promise<void>
  /** Removes the account and its document from the server, then signs out here. */
  deleteAccount(): Promise<void>
  /** Every session of the account stops working, this one included. */
  signOutEverywhere(): Promise<void>
  /** A line for the shell's log file: the renderer has no file of its own. */
  log(level: 'warn' | 'error', message: string): void
  /** Version, platform and where the data lives. */
  getInfo(): Promise<AppInfo>
  /** This build: version, commit, build time and its notes. */
  getBuild(): Promise<BuildInfo>
  /** True the first time this build runs on this machine, until seenBuild. */
  whatsNew(): Promise<boolean>
  /** The notes were shown; do not show them again for this build. */
  seenBuild(): void
  /** Writes the whole state as JSON where the user says; the path, or null when cancelled. */
  exportState(): Promise<string | null>
  /** Replaces the state with a JSON export the user picks, after a backup. */
  importState(): Promise<{ ok: boolean; message: string }>
  onAccount(fn: (account: Account | null) => void): () => void
  onSync(fn: (status: SyncStatus) => void): () => void
  /** The AI clerk's keys and settings. Every call returns the whole public state. */
  ai: {
    get(): Promise<AiPublic>
    addKey(key: string): Promise<AiPublic>
    removeKey(id: string): Promise<AiPublic>
    recheckKey(id: string): Promise<AiPublic>
    setPreferredModel(id: string, model: string | null): Promise<AiPublic>
    setPreferredProvider(provider: AiProvider | null): Promise<AiPublic>
    /** Send everything in the tray to the clerk now. */
    sweepTray(): Promise<void>
    /** The clerk picks a glyph name for a ledger from the catalogue, skipping names other ledgers wear. Null without a key or an answer. */
    pickGlyph(name: string, criterion: string, options: string[], taken: string[]): Promise<string | null>
    /** A request in words about the calendar. The proposal is held by the shell; null when the clerk could not read it or has no key. */
    arrange(request: string): Promise<Arrangement | null>
    /** Apply a held proposal, with a pick per unresolved name. False when it expired or a pick is missing. */
    applyArrangement(id: string, picks: Record<string, string>): Promise<boolean>
    discardArrangement(id: string): void
  }
  onAi(fn: (ai: AiPublic) => void): () => void
  /** What the clerk is doing right now, for the pet to say. */
  onClerk(fn: (n: ClerkNotice) => void): () => void
  onClerkAsk(fn: (q: ClerkQuestion) => void): () => void
  /** Keyboard move: on, the pet window takes the keyboard; off, it gives it back. */
  setMoving(on: boolean): void
  /** Move the tomato by this many points (macOS; the overlay ignores it elsewhere). */
  nudge(dx: number, dy: number): void
  /** Put the tomato in a corner of the work area: 1 top left, 2 top right, 3 bottom left, 4 bottom right. */
  snap(corner: 1 | 2 | 3 | 4): void
  /** The effects page: play this. */
  onEffect(fn: (e: Effect) => void): () => void
  /** The effects page is done; the shell may hide the window. */
  effectDone(): void
  /** The drawer page (macOS) is done: Esc, or nothing to show. The shell hides its window. */
  closeDrawer(): void
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
  setCaption: 'mayorly:set-caption',
  caption: 'mayorly:caption',
  accountsAvailable: 'mayorly:accounts-available',
  getAccount: 'mayorly:get-account',
  signIn: 'mayorly:sign-in',
  signOut: 'mayorly:sign-out',
  deleteAccount: 'mayorly:delete-account',
  signOutEverywhere: 'mayorly:sign-out-everywhere',
  log: 'mayorly:log',
  getInfo: 'mayorly:get-info',
  getBuild: 'mayorly:get-build',
  whatsNew: 'mayorly:whats-new',
  seenBuild: 'mayorly:seen-build',
  exportState: 'mayorly:export-state',
  importState: 'mayorly:import-state',
  account: 'mayorly:account',
  sync: 'mayorly:sync',
  aiGet: 'mayorly:ai-get',
  aiAddKey: 'mayorly:ai-add-key',
  aiRemoveKey: 'mayorly:ai-remove-key',
  aiRecheckKey: 'mayorly:ai-recheck-key',
  aiPreferredModel: 'mayorly:ai-preferred-model',
  aiPreferredProvider: 'mayorly:ai-preferred-provider',
  aiSweep: 'mayorly:ai-sweep',
  aiPickGlyph: 'mayorly:ai-pick-glyph',
  aiArrange: 'mayorly:ai-arrange',
  aiApplyArrangement: 'mayorly:ai-apply-arrangement',
  aiDiscardArrangement: 'mayorly:ai-discard-arrangement',
  ai: 'mayorly:ai',
  clerk: 'mayorly:clerk',
  clerkAsk: 'mayorly:clerk-ask',
  moving: 'mayorly:moving',
  nudge: 'mayorly:nudge',
  snap: 'mayorly:snap',
  effect: 'mayorly:effect',
  effectDone: 'mayorly:effect-done',
  drawerClose: 'mayorly:drawer-close',
  hotkeyFailures: 'mayorly:hotkey-failures',
} as const
