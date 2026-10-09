import type { HotkeyAction, MayorlyState, Settings } from './model'

export const DEFAULT_HOTKEYS: Record<HotkeyAction, string> = {
  plus: 'Alt+T',
  capture: 'Alt+N',
  deck: 'Alt+M',
  pause: 'Alt+P',
  hide: 'Alt+H',
}

export const DEFAULT_SETTINGS: Settings = {
  focusMin: 25,
  shortRestMin: 5,
  longRestMin: 15,
  longRestEvery: 4,
  autoStartFocus: true,
  autoStartRest: true,
  sound: true,
  hudSide: 'right',
  hudScale: 1,
  hotkeys: DEFAULT_HOTKEYS,
  openAtLogin: false,
}

export function emptyState(): MayorlyState {
  return {
    schema: 1,
    ledgers: [],
    entries: [],
    supersets: [],
    sittings: [],
    segments: [],
    tokens: [],
    clerkLog: [],
    desk: { status: 'idle', sittingId: null, plan: null, block: null, runStartedAt: null, bankMs: 0 },
    settings: { ...DEFAULT_SETTINGS, hotkeys: { ...DEFAULT_HOTKEYS } },
  }
}

/** First run: the three ledgers from the founder's brief and one rotation across them. */
export function firstRunState(now: number, newId: () => string): MayorlyState {
  const s = emptyState()
  const legal = newId()
  const dance = newId()
  const career = newId()
  s.ledgers = [
    { id: legal, name: 'Legal', code: 'LGL', criterion: 'Contracts, filings, immigration, anything with a lawyer or a form.', glyph: 'scales', handWritten: true, createdAt: now },
    { id: dance, name: 'Dance', code: 'DNC', criterion: 'Practice, drills, choreography, battle prep.', glyph: 'music', handWritten: true, createdAt: now },
    { id: career, name: 'Career', code: 'CAR', criterion: 'Job applications, resume, interview prep, networking.', glyph: 'briefcase', handWritten: true, createdAt: now },
  ]
  s.supersets = [
    {
      id: newId(),
      name: 'Daily rotation',
      slots: [
        { id: newId(), target: { kind: 'ledger', ledgerId: legal }, minutes: 25 },
        { id: newId(), target: { kind: 'ledger', ledgerId: dance }, minutes: 25 },
        { id: newId(), target: { kind: 'ledger', ledgerId: career }, minutes: 25 },
      ],
      rounds: 3,
      restMin: 5,
      roundRestMin: 15,
      order: 'fixed',
      onClear: 'next-in-ledger',
    },
  ]
  s.clerkLog = [{ at: now, text: 'shelf opened: LGL DNC CAR (hand-written, locked)' }]
  return s
}

/** Bring older or partial saves up to the current shape. Never drops user data. */
export function migrate(raw: unknown): MayorlyState | null {
  if (!raw || typeof raw !== 'object') return null
  const x = raw as Partial<MayorlyState>
  if (x.schema !== 1) return null
  const base = emptyState()
  return {
    ...base,
    ...x,
    desk: { ...base.desk, ...x.desk },
    settings: { ...base.settings, ...x.settings, hotkeys: { ...DEFAULT_HOTKEYS, ...x.settings?.hotkeys } },
  } as MayorlyState
}
