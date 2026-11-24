import type { Calendar, HoursWindow } from './model'
import type { HotkeyAction, MayorlyState, Settings } from './model'
import { DEFAULT_ALARMS, sanitiseAlarms } from './alarms'
import { focusFromLog, reconcileTomatoes, settleCouch, settleLegacyCoins, untangle } from './accounting'

export const DEFAULT_HOTKEYS: Record<HotkeyAction, string> = {
  plus: 'Alt+T',
  capture: 'Alt+N',
  find: 'Alt+F',
  deck: 'Alt+M',
  pause: 'Alt+P',
  skipRest: 'Alt+R',
  hide: 'Alt+H',
  switch: 'Alt+Q',
  clear: 'Alt+C',
  move: 'Alt+G',
  drawer: 'Alt+Shift+R',
  schedule: 'Alt+S',
  scheduled: 'Alt+I',
  gaming: 'Alt+Shift+G',
  switchLog: 'Alt+Shift+H',
}

/** Nine to five, minutes from midnight. */
const WORKDAY: HoursWindow[] = [{ start: 9 * 60, end: 17 * 60 }]

export const DEFAULT_SETTINGS: Settings = {
  focusMin: 25,
  shortRestMin: 5,
  longRestMin: 15,
  longRestEvery: 4,
  autoStartFocus: true,
  autoStartRest: true,
  sound: true,
  impact: {
    styles: { switch: 'ripple', done: 'shockwave', rest: 'tide', work: 'sweep', start: 'edges', pause: 'edges', resume: 'edges', stop: 'tide', tomato: 'edges' },
    everyScreen: false,
    words: true,
  },
  alarms: DEFAULT_ALARMS,
  hudSide: 'right',
  hudScale: 1,
  text: { pet: 1, deck: 1, plus: 1 },
  calendar: { tz: '', hours: [[], WORKDAY, WORKDAY, WORKDAY, WORKDAY, WORKDAY, []], breakMin: 0, minChunkMin: 25, horizonDays: 7, spill: true, defaultMin: 30, mode: 'done', work: { hours: [[], [], [], [], [], [], []], ledgerIds: [], usHolidays: true }, sessionMin: 30, sessionMax: 120 },
  trayTimer: false,
  hotkeys: DEFAULT_HOTKEYS,
  keymap: {},
  openAtLogin: false,
  gaming: false,
  autoSwitch: { aiPrompt: true, streamDeath: true, streamMute: true, streamOpen: true, streamAd: true, leaguePlay: true },
  clerk: { createLedgers: true, consolidate: true, minConfidence: null, allow: { settings: 'ask', recipes: 'ask' } },
  marketHidden: [],
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
    houseRules: [],
    recipes: [],
    leisure: [],
    market: [],
    trash: [],
    desk: { status: 'idle', sittingId: null, plan: null, block: null, runStartedAt: null, bankMs: 0, holster: null, previous: null, device: null, heldAt: null },
    settings: { ...DEFAULT_SETTINGS, hotkeys: { ...DEFAULT_HOTKEYS }, calendar: { ...DEFAULT_SETTINGS.calendar, hours: DEFAULT_SETTINGS.calendar.hours.map((d) => d.map((w) => ({ ...w }))), work: { hours: [[], [], [], [], [], [], []], ledgerIds: [], usHolidays: true } } },
    calendar: emptyCalendar(),
  }
}

export function emptyCalendar(): Calendar {
  return { events: [], external: [], feeds: [], blocks: [], overflow: [], plannedAt: null, horizonEnd: null }
}

/** First run: the three ledgers from the founder's brief and one rotation across them. */
/** A new install: an empty shelf and a tray. The ledgers are the user's to write. */
export function firstRunState(now: number, _newId: () => string): MayorlyState {
  const s = emptyState()
  s.clerkLog = [{ at: now, text: 'hall opened: shelf empty, tray open' }]
  return s
}

/** Three ledgers, a rotation and a log line: the demo and the tests start here. */
export function sampleState(now: number, newId: () => string): MayorlyState {
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

/**
 * The auto switch rules of a save. 0.1.66 kept the Claude rule as `claudeSwitch`, 0.1.67 and 0.1.68
 * as `autoSwitch.claude`, 0.1.69 and 0.1.70 as `autoSwitch.aiBreak`; turned off there, it starts off.
 */
function autoSwitchOf(s: Partial<Settings> | undefined): Settings['autoSwitch'] {
  const rules = s?.autoSwitch as (Partial<Settings['autoSwitch']> & { aiBreak?: unknown; claude?: unknown }) | undefined
  const old = rules?.aiBreak ?? rules?.claude ?? (s as { claudeSwitch?: unknown } | undefined)?.claudeSwitch
  return { aiPrompt: typeof rules?.aiPrompt === 'boolean' ? rules.aiPrompt : old !== false, streamDeath: rules?.streamDeath !== false, streamMute: rules?.streamMute !== false, streamOpen: rules?.streamOpen !== false, streamAd: rules?.streamAd !== false, leaguePlay: rules?.leaguePlay !== false }
}

/** Bring older or partial saves up to the current shape. Never drops user data. */
export function migrate(raw: unknown): MayorlyState | null {
  if (!raw || typeof raw !== 'object') return null
  const x = raw as Partial<MayorlyState>
  if (x.schema !== 1) return null
  const base = emptyState()
  return focusFromLog(reconcileTomatoes(settleCouch(untangle(settleLegacyCoins({
    ...base,
    ...x,
    desk: { ...base.desk, ...x.desk },
    leisure: (x.leisure ?? []).map((it) => ({ ...it, cues: Array.isArray(it.cues) ? it.cues : [] })),
    entries: (x.entries ?? []).map((e) => ({ ...e, tomatoes: Number.isFinite(e.tomatoes) ? e.tomatoes : 0 })),
    trash: (Array.isArray(x.trash) ? x.trash : []).filter((t) => t && typeof t.id === 'string' && Number.isFinite(t.deletedAt)).map((t) => ({ ...t, tomatoes: Number.isFinite(t.tomatoes) ? t.tomatoes : 0 })),
    settings: { ...base.settings, ...x.settings, autoSwitch: autoSwitchOf(x.settings), alarms: sanitiseAlarms(x.settings?.alarms), hotkeys: { ...DEFAULT_HOTKEYS, ...x.settings?.hotkeys }, calendar: { ...base.settings.calendar, ...x.settings?.calendar }, clerk: { ...base.settings.clerk, ...x.settings?.clerk, allow: { ...base.settings.clerk.allow, ...x.settings?.clerk?.allow } } },
    calendar: { ...emptyCalendar(), ...x.calendar },
    recipes: Array.isArray(x.recipes) ? x.recipes : [],
    market: (Array.isArray(x.market) ? x.market : []).filter((m) => m && typeof m.id === 'string' && Number.isFinite(m.price)),
  } as MayorlyState)))))
}
