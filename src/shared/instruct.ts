import { type Action, type ClerkAllow, type HotkeyAction, type MayorlyState, type Recipe, type RecipeWhen } from '../core/index'
import { dayKey, wallClock } from './windows'

// An instruction typed into Alt+N: the clerk reads it into a few typed steps, and this file
// turns those into reducer actions, each with its undo, under the permission for its kind.
// Nothing here writes state; main applies what may be done at once and the capture box asks
// about the rest. A calendar request goes to the calendar's own clerk, which shows its plan.

/** Lines that read as orders about how Mayorly works, not things to do. A line that only looks like one is filed as a task by the clerk. */
const LOOKS_LIKE = /^(set|change|make|turn|switch|add a (recipe|rule|shortcut|hotkey)|auto(matically)?\b|every|each|daily|whenever|from now on|in the future|when i press|create a (shortcut|hotkey|recipe|rule)|no work|i('m| am)? off|take (today|tomorrow|monday|tuesday|wednesday|thursday|friday|[a-z]+day) off|block|clear my|move my|my work( schedule)?|work (schedule|hours) )/i

/** True when a captured line should go to the clerk as an instruction first. A leading "!" forces it; "do:" too. */
export function looksLikeInstruction(text: string): boolean {
  const t = text.trim()
  return /^(!|do:)/i.test(t) || LOOKS_LIKE.test(t)
}

export const stripInstruction = (text: string) => text.trim().replace(/^(!|do:)\s*/i, '')

export type InstructionScope = 'settings' | 'recipes'

export interface InstructionStep {
  scope: InstructionScope
  /** What it does, in plain words. */
  says: string
  actions: Action[]
  undo: Action[]
  /** Filled in by main: done (applied, may be undone), ask (waiting for Apply), never (not allowed). */
  status?: 'done' | 'ask' | 'never'
}

export interface InstructionPlan {
  /** task: the clerk read the line as something to do; it is filed as one. */
  kind: 'steps' | 'task' | 'none'
  say: string
  steps: InstructionStep[]
  /** For the calendar's own clerk, which shows what it would do before doing it. */
  calendarAsk: string | null
  /** Things the clerk could not do, in plain words. */
  refused: string[]
  model?: string
}

const DAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
const minutesOf = (v: unknown): number | null => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(v ?? '').trim())
  if (!m) return null
  const n = Number(m[1]) * 60 + Number(m[2])
  return n >= 0 && n <= 1440 ? n : null
}
const clock = (m: number) => {
  const h = Math.floor(m / 60) % 24
  const mm = m % 60
  return `${h % 12 || 12}${mm ? `:${String(mm).padStart(2, '0')}` : ''} ${h < 12 ? 'AM' : 'PM'}`
}

export const INSTRUCT_SYSTEM = [
  'You are the clerk of Mayorly, a personal task app whose first rule is zero friction. The user typed an instruction into the capture line.',
  'Turn it into operations. Reply with JSON only: {"kind": "ops" or "task", "say": one short line in machine-log voice, "ops": [...]}.',
  'kind is "task" when the line is something the user has to do rather than an instruction about how Mayorly works; ops is then empty.',
  'Operations:',
  '{"op": "work", "days": [weekday numbers, 0 is Sunday], "start": "HH:MM", "end": "HH:MM", "ledgers": [ledger codes] or null}: the job\'s work hours; days not listed have no work; ledgers are the work ledgers, null keeps them.',
  '{"op": "dayOff", "date": "YYYY-MM-DD", "off": true or false}: no work that day, or work back on.',
  '{"op": "sessions", "min": minutes or null, "max": minutes or null}: the shortest and longest planned session.',
  '{"op": "recipe", "name": a few words, "when": {"kind": "daily", "days": "workdays", "weekdays" or "everyday", "at": "HH:MM", "holidays": true or false} or {"kind": "key", "key": "Alt+H"}, "line": the entry as typed into the capture line, "estimateMin": minutes or null, "start": true or false}: something to add again on its own.',
  'For a recipe: line keeps a ledger prefix such as "PRO: " when the user gave one, and writes the date as {date} wherever the user wants today\'s date (date.today(), today, the date). workdays means the work schedule\'s days (Monday to Friday without one); holidays false skips US federal holidays. at is when the entry is added; without a time given use 06:00. A key recipe has start true unless the user says otherwise, and its key is written like Alt+H. One tomato is the focus length given below; an estimate in tomatoes is that many times it, in minutes.',
  '{"op": "calendar", "ask": the request in the user\'s words}: anything about placing, moving or blocking time on the calendar.',
  'Use only these operations. When part of the instruction cannot be done with them, leave it out and say so in say.',
].join(' ')

/** What the clerk needs to know to read an instruction: today, the shelf, the schedule, the keys in use. */
export function instructContext(s: MayorlyState, now: number): string {
  const cal = s.settings.calendar
  const w = wallClock(now, cal.tz)
  const week = (days: { start: number; end: number }[][]) => days.map((d, i) => (d.length ? `${DAY[i]} ${d.map((h) => `${hhmm(h.start)}-${hhmm(h.end)}`).join(',')}` : null)).filter(Boolean).join('; ')
  const codes = (ids: string[]) => ids.map((id) => s.ledgers.find((l) => l.id === id)?.code).filter(Boolean).join(', ')
  return [
    `Today: ${DAY[w.weekday]} ${dayKey(now, cal.tz)}, ${hhmm(w.minutes)} (${cal.tz || 'local time'}).`,
    `Ledgers: ${s.ledgers.map((l) => `${l.code} (${l.name})`).join(', ') || 'none'}.`,
    `Work hours: ${week(cal.work.hours) || 'none set'}; work ledgers: ${codes(cal.work.ledgerIds) || 'none'}; ${cal.work.usHolidays ? 'no work on US federal holidays' : 'holidays are workdays'}.`,
    `Sessions: ${cal.sessionMin} to ${cal.sessionMax} minutes. One tomato is ${s.settings.focusMin} minutes.`,
    `Keys in use: ${Object.values(s.settings.hotkeys).join(', ')}${s.recipes.some((r) => r.when.kind === 'key') ? `, ${s.recipes.flatMap((r) => (r.when.kind === 'key' ? [r.when.key] : [])).join(', ')}` : ''}.`,
    s.recipes.length ? `Recipes: ${s.recipes.map((r) => r.name).join('; ')}.` : '',
  ].filter(Boolean).join('\n')
}

interface RawAnswer { kind?: unknown; say?: unknown; ops?: unknown }

/** The model's JSON, or null when there was none. */
export function parseInstruction(text: string): RawAnswer | null {
  const body = text.replace(/```(?:json)?/gi, '')
  const m = body.match(/\{[\s\S]*\}/)
  if (!m) return null
  try {
    const j = JSON.parse(m[0]) as RawAnswer
    return j && typeof j === 'object' ? j : null
  } catch {
    return null
  }
}

/** The built-in action a key belongs to on this machine, if any. */
export function keyOwner(s: MayorlyState, key: string): HotkeyAction | null {
  const k = key.toLowerCase()
  const hit = (Object.entries(s.settings.hotkeys) as [HotkeyAction, string][]).find(([, v]) => v.toLowerCase() === k)
  return hit ? hit[0] : null
}

const HOTKEY_NAMES: Partial<Record<HotkeyAction, string>> = { hide: 'Hide the HUD', clear: 'Clear the entry', pause: 'Hold and resume', find: 'Find', deck: 'Deck', capture: 'Capture', plus: 'Swap menu', switch: 'Switch tasks', move: 'Move the tomato', skipRest: 'Skip rest', drawer: 'Quick drawer', schedule: 'The schedule', scheduled: 'Go to what is scheduled' }

/**
 * The clerk's answer as steps: each op checked against the state, turned into actions with
 * their undo. `newId` names a new recipe. Ops that make no sense are refused in words.
 */
export function resolveInstruction(raw: RawAnswer, s: MayorlyState, now: number, newId: () => string): InstructionPlan {
  const say = typeof raw.say === 'string' ? raw.say.trim().slice(0, 200) : ''
  if (raw.kind === 'task') return { kind: 'task', say, steps: [], calendarAsk: null, refused: [] }
  const ops = Array.isArray(raw.ops) ? raw.ops.slice(0, 6) : []
  const steps: InstructionStep[] = []
  const refused: string[] = []
  let calendarAsk: string | null = null
  const cal = s.settings.calendar
  const code = (c: unknown) => s.ledgers.find((l) => l.code.toLowerCase() === String(c ?? '').toLowerCase()) ?? null
  const calendarAction = (next: typeof cal): Action => ({ type: 'settings/update', patch: { calendar: next } })
  let working = cal
  for (const o of ops as Record<string, unknown>[]) {
    if (!o || typeof o !== 'object') continue
    if (o.op === 'work') {
      const days = Array.isArray(o.days) ? [...new Set(o.days.map(Number).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))].sort() : []
      const start = minutesOf(o.start)
      const end = minutesOf(o.end)
      if (!days.length || start === null || end === null || end <= start) {
        refused.push('work hours I could not read')
        continue
      }
      const ledgerIds = Array.isArray(o.ledgers) ? o.ledgers.map(code).filter((l) => l !== null).map((l) => l!.id) : null
      const hours = Array.from({ length: 7 }, (_, d) => (days.includes(d) ? [{ start, end }] : []))
      const keep = ledgerIds && ledgerIds.length ? ledgerIds : working.work.ledgerIds.length ? working.work.ledgerIds : s.ledgers.filter((l) => l.pays === false).map((l) => l.id)
      const next = { ...working, work: { ...working.work, hours, ledgerIds: keep } }
      const names = days.length === 5 && days.join() === '1,2,3,4,5' ? 'Monday to Friday' : days.map((d) => DAY[d]).join(', ')
      const ledgers = keep.map((id) => s.ledgers.find((l) => l.id === id)?.code).filter(Boolean).join(', ')
      steps.push({ scope: 'settings', says: `Work ${names}, ${clock(start)} to ${clock(end)}${ledgers ? `; work ledgers ${ledgers}` : '; no work ledgers yet'}`, actions: [calendarAction(next)], undo: [calendarAction(working)] })
      working = next
    } else if (o.op === 'dayOff') {
      const day = String(o.date ?? '')
      if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) {
        refused.push('a day I could not read')
        continue
      }
      const off = o.off !== false
      const had = s.calendar.workMarks?.find((m) => m.day === day)
      steps.push({
        scope: 'settings',
        says: off ? `No work on ${day}` : `Work back on for ${day}`,
        actions: [{ type: 'calendar/work-day', day, off }],
        undo: [{ type: 'calendar/work-day', day, off: had ? had.off : !off }],
      })
    } else if (o.op === 'sessions') {
      const n = (v: unknown) => (v === null || v === undefined || !Number.isFinite(Number(v)) ? null : Math.round(Number(v) / 5) * 5)
      const min = n(o.min) ?? working.sessionMin
      const max = n(o.max) ?? working.sessionMax
      if (min < 5 || max < min || max > 480) {
        refused.push('session lengths out of range')
        continue
      }
      const next = { ...working, sessionMin: min, sessionMax: max }
      steps.push({ scope: 'settings', says: `Sessions ${min} to ${max} minutes`, actions: [calendarAction(next)], undo: [calendarAction(working)] })
      working = next
    } else if (o.op === 'recipe') {
      const r = recipeOf(o, now, newId)
      if (!r) {
        refused.push('a recipe I could not read')
        continue
      }
      let says = r.when.kind === 'daily'
        ? `${r.when.days === 'workdays' ? 'Every workday' : r.when.days === 'weekdays' ? 'Every weekday' : 'Every day'}${r.when.days !== 'everyday' && !r.when.holidays ? ', not on holidays,' : ''} at ${clock(r.when.at)}: add "${r.line}"`
        : `${r.when.key.replace(/^Alt\+/, 'Alt+')}: add "${r.line}"${r.start ? ' and start it' : ''}`
      if (r.estimateMin) says += `, ${r.estimateMin % s.settings.focusMin === 0 ? `${r.estimateMin / s.settings.focusMin} tomatoes` : `${r.estimateMin} minutes`}`
      if (r.when.kind === 'key') {
        const owner = keyOwner(s, r.when.key)
        if (owner) says += `. ${r.when.key} is ${HOTKEY_NAMES[owner] ?? owner} on this computer now; the recipe takes it, so give that another key in Settings`
      }
      steps.push({ scope: 'recipes', says, actions: [{ type: 'recipe/add', recipe: r }], undo: [{ type: 'recipe/remove', id: r.id }] })
    } else if (o.op === 'calendar') {
      const ask = String(o.ask ?? '').trim().slice(0, 300)
      if (ask) calendarAsk = calendarAsk ? `${calendarAsk}; ${ask}` : ask
    }
  }
  const kind = steps.length || calendarAsk ? 'steps' : 'none'
  return { kind, say, steps, calendarAsk, refused }
}

function recipeOf(o: Record<string, unknown>, now: number, newId: () => string): Recipe | null {
  const line = String(o.line ?? '').trim().slice(0, 160)
  const w = o.when as Record<string, unknown> | undefined
  let when: RecipeWhen | null = null
  if (w?.kind === 'daily') {
    const at = minutesOf(w.at) ?? 6 * 60
    when = { kind: 'daily', days: w.days === 'weekdays' || w.days === 'everyday' ? w.days : 'workdays', at: Math.min(at, 1439), holidays: !!w.holidays }
  } else if (w?.kind === 'key') {
    const key = normaliseKey(String(w.key ?? ''))
    if (key) when = { kind: 'key', key }
  }
  if (!line || !when) return null
  const est = Number(o.estimateMin)
  return {
    id: newId(),
    name: String(o.name ?? '').trim().slice(0, 80) || line,
    when,
    line,
    estimateMin: Number.isFinite(est) && est > 0 ? Math.round(est) : null,
    start: when.kind === 'key' ? o.start !== false : false,
    enabled: true,
    createdAt: now,
  }
}

/** "alt+h", "Option+H", "⌥H" and the like, as Electron's accelerator: Alt+H. One letter or digit, at least one modifier. */
export function normaliseKey(v: string): string | null {
  const parts = v.replace(/⌥/g, 'Alt+').replace(/⌘/g, 'CmdOrCtrl+').replace(/⇧/g, 'Shift+').split('+').map((p) => p.trim()).filter(Boolean)
  const key = parts.pop()
  if (!key || !/^[a-z0-9]$/i.test(key)) return null
  const mods = parts.map((p) => {
    const m = p.toLowerCase()
    return m === 'option' || m === 'opt' || m === 'alt' ? 'Alt' : m === 'shift' ? 'Shift' : m === 'ctrl' || m === 'control' ? 'Ctrl' : m === 'cmd' || m === 'command' || m === 'cmdorctrl' ? 'CmdOrCtrl' : null
  })
  if (!mods.length || mods.some((m) => m === null)) return null
  return [...new Set(mods)].join('+') + '+' + key.toUpperCase()
}

/** Each step's status under the clerk's permissions. */
export function permit(plan: InstructionPlan, allow: Record<InstructionScope, ClerkAllow>): InstructionPlan {
  return { ...plan, steps: plan.steps.map((st) => ({ ...st, status: allow[st.scope] === 'auto' ? 'done' : allow[st.scope] === 'never' ? 'never' : 'ask' })) }
}
