import { describe, expect, it } from 'vitest'
import { reduce, sampleState, type MayorlyState } from '../core/index'
import { looksLikeInstruction, normaliseKey, parseInstruction, permit, resolveInstruction } from './instruct'
import { recipeRunsOn } from './windows'

const now = Date.parse('2026-11-17T20:00:00Z')
let n = 0
const ctx = { now, newId: () => `id${++n}`, random: () => 0.5, device: 'here' }
const base = (): MayorlyState => {
  let s = sampleState(now, ctx.newId)
  s = reduce(s, { type: 'settings/update', patch: { calendar: { ...s.settings.calendar, tz: 'America/Chicago' } } }, ctx).state
  return s
}
const apply = (s: MayorlyState, actions: unknown[]) => actions.reduce<MayorlyState>((st, a) => reduce(st, a as never, ctx).state, s)

describe('an instruction', () => {
  it('is told apart from a task by its first words, or by a leading !', () => {
    expect(looksLikeInstruction('set work schedule to workdays 7am to 4pm')).toBe(true)
    expect(looksLikeInstruction('auto create task everyday PRO: CWILL {date}')).toBe(true)
    expect(looksLikeInstruction('in the future i want to press alt+H to create a task')).toBe(true)
    expect(looksLikeInstruction('! file taxes reminder rule')).toBe(true)
    expect(looksLikeInstruction('legal: reply to the landlord ~20')).toBe(false)
    expect(looksLikeInstruction('reply to the landlord')).toBe(false)
    // A bare verb is a task: these went to the clerk, and Find could neither start nor add them.
    for (const task of ['make an app for twitch chat overlay', 'switch phone plans', 'change the oil', 'set up the new monitor', 'daily standup notes', 'block out the garage', 'every day is leg day video', 'turn in the essay']) {
      expect(looksLikeInstruction(task), task).toBe(false)
    }
    for (const order of ['set my work hours to 9 to 5', 'change sessions to 45 minutes', 'make a shortcut alt+H for a 16 tomato task', 'every workday create PRO: CWILL {date}', 'automatically create a task every morning', 'take friday off', 'switch my work schedule to 8 to 4']) {
      expect(looksLikeInstruction(order), order).toBe(true)
    }
  })

  it('sets work hours with an undo that puts the old ones back', () => {
    const s = base()
    const legal = s.ledgers[0]
    const plan = resolveInstruction(parseInstruction(`{"kind":"ops","say":"work set","ops":[{"op":"work","days":[1,2,3,4,5],"start":"07:00","end":"16:00","ledgers":["${legal.code}"]}]}`)!, s, now, () => 'r1')
    expect(plan.kind).toBe('steps')
    expect(plan.steps[0]).toMatchObject({ scope: 'settings', says: `Work Monday to Friday, 7 AM to 4 PM; work ledgers ${legal.code}` })
    const after = apply(s, plan.steps[0].actions)
    expect(after.settings.calendar.work.hours[1]).toEqual([{ start: 420, end: 960 }])
    expect(after.settings.calendar.work.hours[0]).toEqual([])
    expect(after.settings.calendar.work.ledgerIds).toEqual([legal.id])
    const back = apply(after, plan.steps[0].undo)
    expect(back.settings.calendar.work).toEqual(s.settings.calendar.work)
  })

  it('makes a daily recipe and a key recipe, and says when the key is already taken', () => {
    const s = base()
    const ids = ['r1', 'r2']
    const plan = resolveInstruction({ kind: 'ops', ops: [
      { op: 'recipe', name: 'CWILL every workday', when: { kind: 'daily', days: 'workdays', at: '06:00', holidays: false }, line: 'PRO: CWILL {date}', estimateMin: null, start: false },
      { op: 'recipe', name: 'CWILL on a key', when: { kind: 'key', key: 'alt+h' }, line: 'PRO: CWILL {date}', estimateMin: 400 },
    ] }, s, now, () => ids.shift()!)
    expect(plan.steps.map((x) => x.scope)).toEqual(['recipes', 'recipes'])
    expect(plan.steps[0].says).toBe('Every workday, not on holidays, at 6 AM: add "PRO: CWILL {date}"')
    expect(plan.steps[1].says).toContain('Alt+H is Hide the HUD on this computer now')
    expect(plan.steps[1].actions[0]).toMatchObject({ type: 'recipe/add', recipe: { id: 'r2', when: { kind: 'key', key: 'Alt+H' }, start: true, estimateMin: 400 } })
    const after = apply(s, plan.steps.flatMap((x) => x.actions))
    expect(after.recipes.map((r) => r.id)).toEqual(['r1', 'r2'])
    expect(apply(after, plan.steps.flatMap((x) => x.undo)).recipes).toEqual([])
  })

  it('is a task when the clerk says so, a calendar request goes on, and nonsense is refused', () => {
    const s = base()
    expect(resolveInstruction({ kind: 'task', ops: [] }, s, now, () => 'x').kind).toBe('task')
    const cal = resolveInstruction({ kind: 'ops', ops: [{ op: 'calendar', ask: 'block friday afternoon for dance' }] }, s, now, () => 'x')
    expect(cal).toMatchObject({ kind: 'steps', calendarAsk: 'block friday afternoon for dance', steps: [] })
    const bad = resolveInstruction({ kind: 'ops', ops: [{ op: 'work', days: [], start: '9', end: 'x' }, { op: 'launch' }] }, s, now, () => 'x')
    expect(bad).toMatchObject({ kind: 'none', refused: ['work hours I could not read'] })
  })

  it('is done, asked about or refused by its kind, as the permissions say', () => {
    const s = base()
    const plan = resolveInstruction({ kind: 'ops', ops: [{ op: 'dayOff', date: '2026-11-20', off: true }, { op: 'recipe', when: { kind: 'key', key: 'Alt+J' }, line: 'x' }] }, s, now, () => 'r')
    expect(permit(plan, { settings: 'auto', recipes: 'ask' }).steps.map((x) => x.status)).toEqual(['done', 'ask'])
    expect(permit(plan, { settings: 'never', recipes: 'auto' }).steps.map((x) => x.status)).toEqual(['never', 'done'])
  })

  it('reads keys as Electron writes them', () => {
    expect(normaliseKey('alt+h')).toBe('Alt+H')
    expect(normaliseKey('Option+Shift+7')).toBe('Alt+Shift+7')
    expect(normaliseKey('⌥H')).toBe('Alt+H')
    expect(normaliseKey('H')).toBeNull()
    expect(normaliseKey('Alt+F12')).toBeNull()
  })
})

describe('a recipe', () => {
  it('makes its entry once a day, with the month and day, and the year only when the title is taken', () => {
    let s = base()
    s = reduce(s, { type: 'ledger/create', name: 'Professional', code: 'PRO', criterion: 'work' } as never, ctx).state
    s = reduce(s, { type: 'recipe/add', recipe: { id: 'cw', name: 'CWILL', when: { kind: 'daily', days: 'workdays', at: 360, holidays: false }, line: 'PRO: CWILL {date}', estimateMin: 480, start: false, enabled: true, createdAt: now } }, ctx).state
    s = reduce(s, { type: 'recipe/run', id: 'cw', day: '2026-11-17' }, ctx).state
    s = reduce(s, { type: 'recipe/run', id: 'cw', day: '2026-11-17' }, ctx).state
    const made = s.entries.filter((e) => e.id === 'recipe:cw:2026-11-17')
    expect(made).toHaveLength(1)
    expect(made[0]).toMatchObject({ title: 'CWILL 11/17', estimateMin: 480, ledgerId: s.ledgers.find((l) => l.code === 'PRO')!.id })
    // A year later the same month and day is taken: the year is added.
    s = reduce(s, { type: 'recipe/run', id: 'cw', day: '2027-11-17' }, ctx).state
    expect(s.entries.find((e) => e.id === 'recipe:cw:2027-11-17')?.title).toBe('CWILL 11/17/2027')
    // Deleted that day: it stays deleted.
    s = reduce(s, { type: 'entry/delete', id: 'recipe:cw:2026-11-17' }, ctx).state
    s = reduce(s, { type: 'recipe/run', id: 'cw', day: '2026-11-17' }, ctx).state
    expect(s.entries.some((e) => e.id === 'recipe:cw:2026-11-17')).toBe(false)
  })

  it('on a key, puts the entry on the desk', () => {
    let s = base()
    s = reduce(s, { type: 'recipe/add', recipe: { id: 'k', name: 'key', when: { kind: 'key', key: 'Alt+J' }, line: 'standup {date}', estimateMin: null, start: true, enabled: true, createdAt: now } }, ctx).state
    s = reduce(s, { type: 'recipe/run', id: 'k', day: '2026-11-17', start: true }, ctx).state
    expect(s.desk.block?.entryId).toBe('recipe:k:2026-11-17')
    expect(s.entries.find((e) => e.id === 'recipe:k:2026-11-17')?.title).toBe('standup 11/17')
  })

  it('refuses a recipe it could not run', () => {
    let s = base()
    s = reduce(s, { type: 'recipe/add', recipe: { id: 'b', name: '', when: { kind: 'key', key: 'H' }, line: 'x', estimateMin: null, start: true, enabled: true, createdAt: now } }, ctx).state
    s = reduce(s, { type: 'recipe/add', recipe: { id: 'c', name: '', when: { kind: 'daily', days: 'workdays', at: 360, holidays: false }, line: '   ', estimateMin: null, start: false, enabled: true, createdAt: now } }, ctx).state
    expect(s.recipes).toEqual([])
  })

  it('runs on workdays from the schedule, not on holidays unless kept', () => {
    const cal = { ...base().settings.calendar, work: { hours: [[], ...Array.from({ length: 5 }, () => [{ start: 420, end: 960 }]), []], ledgerIds: [], usHolidays: true } }
    const thanksgiving = Date.parse('2026-11-26T18:00:00Z')
    const friday = Date.parse('2026-11-27T18:00:00Z')
    const saturday = Date.parse('2026-11-28T18:00:00Z')
    const when = { days: 'workdays' as const, holidays: false }
    expect(recipeRunsOn(cal, [], when, thanksgiving)).toBe(false)
    expect(recipeRunsOn(cal, [], when, friday)).toBe(true)
    expect(recipeRunsOn(cal, [], when, saturday)).toBe(false)
    expect(recipeRunsOn(cal, [{ day: '2026-11-27', off: true, at: 1 }], when, friday)).toBe(false)
    expect(recipeRunsOn(cal, [], { days: 'everyday', holidays: false }, saturday)).toBe(true)
  })
})
