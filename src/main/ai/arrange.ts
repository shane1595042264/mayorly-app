import { entrySpentMs, openFlow, reduce, type ClerkCommand, type Ctx, type Id, type MayorlyState } from '@core/index'
import type { Arrangement, ArrangementLine } from '../../shared/bridge'
import { wallClock, windowsFor, zonedEpoch } from '../../shared/windows'

// The clerk listening: a request in words becomes typed commands the reducer checks. The
// model sees the plan in plain lines and answers JSON naming entries by title; this file
// turns titles into ids (exact, prefix, substring, then a token overlap that must clear a
// margin, else it asks), wall clock into epochs in the calendar's zone, and drops what is
// in the past. Nothing the model wrote reaches the reducer except a ClerkCommand with ids.

const MIN = 60_000
const DAY = 24 * 60 * MIN
export const PROPOSAL_TTL_MS = 5 * MIN

export interface RawCommand {
  op: string
  ref?: string
  than?: string
  minutes?: number
  at?: string | null
  start?: string
  on?: boolean
  place?: string
  splittable?: boolean
  minChunkMin?: number
  maxChunkMin?: number
  title?: string
}

export interface RawAnswer {
  commands: RawCommand[]
  ask: string | null
  log: string
}

export const ARRANGE_SYSTEM = [
  'You are the clerk of Mayorly, a personal ledger system. The user keeps entries with time estimates; a planner places them into work hours around fixed events, earliest due first, in the order of the flow.',
  'You cannot move or change events the user made. You may only change an entry\'s estimate, due, not-before, rush (up next), order, splitting, keep it off the calendar, place it at a time, let the planner place it again, or block a stretch of time with a title on the user\'s request.',
  'Reply with JSON only: {"commands": [...], "ask": string or null, "log": string}. At most 10 commands. Name entries by their title exactly as listed, in "ref". Times are the user\'s wall clock as "YYYY-MM-DD HH:MM", no zone.',
  'Ops: estimate {ref, minutes}; due {ref, at or null}; notBefore {ref, at or null}; rush {ref, on}; order {ref, place: first|last|before|after, than?: ref}; split {ref, splittable, minChunkMin?, maxChunkMin?}; off {ref, on}; place {ref, start, minutes}; unplace {ref}; block {title, start, minutes}.',
  'When the request cannot be met with these, say so in ask and send no commands. When a name is unclear, say which in ask. log: one line in machine-log voice about what you did, no feelings, no advice.',
].join(' ')

/** The plan in lines the model can read: now, hours, entries, fixed events, overflow. */
export function describeForClerk(s: MayorlyState, now: number): string {
  const cal = s.settings.calendar
  const tz = cal.tz
  const stamp = (t: number) => {
    const w = wallClock(t, tz)
    return `${w.y}-${String(w.m).padStart(2, '0')}-${String(w.d).padStart(2, '0')} ${String(Math.floor(w.minutes / 60)).padStart(2, '0')}:${String(w.minutes % 60).padStart(2, '0')}`
  }
  const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
  const hours = cal.hours.map((d, i) => (d.length ? `${dayNames[i]} ${d.map((h) => `${hhmm(h.start)}-${hhmm(h.end)}`).join(',')}` : null)).filter(Boolean).join('; ')
  const lines: string[] = [`Now: ${dayNames[wallClock(now, tz).weekday]} ${stamp(now)}`, `Work hours: ${hours || 'none set'}`]
  const flow = openFlow(s)
  lines.push(`Entries (${flow.length}), in flow order:`)
  for (const e of flow.slice(0, 40)) {
    const l = s.ledgers.find((x) => x.id === e.ledgerId)
    const spent = Math.floor(entrySpentMs(s, e.id, now) / MIN)
    const blocks = s.calendar.blocks.filter((b) => b.entryId === e.id && b.end > now && b.start < now + 7 * DAY).map((b) => `${stamp(b.start)}-${hhmm(wallClock(b.end, tz).minutes)}`)
    const bits = [l ? l.code : 'TRAY', e.estimateMin ? `est ${e.estimateMin}m` : 'no estimate', spent ? `spent ${spent}m` : null, e.due ? `due ${stamp(e.due)}` : null, e.notBefore ? `not before ${stamp(e.notBefore)}` : null, e.rush ? 'up next' : null, e.offCalendar ? 'off calendar' : null, e.splittable === false ? 'one piece' : null, blocks.length ? `blocks ${blocks.join(' ')}` : null].filter(Boolean)
    lines.push(`- "${e.title}" ${bits.join(', ')}`)
  }
  if (flow.length > 40) lines.push(`- and ${flow.length - 40} more`)
  const fixed = [...s.calendar.events.filter((x) => x.end > now && x.start < now + 7 * DAY).map((x) => `- "${x.title}" ${stamp(x.start)}-${hhmm(wallClock(x.end, tz).minutes)} [${x.origin === 'user' ? 'yours' : 'clerk'}${x.entryId ? ', pin' : ''}]`), ...s.calendar.external.filter((x) => !x.allDay && !x.free && x.end > now && x.start < now + 7 * DAY).map((x) => `- "${x.title}" ${stamp(x.start)}-${hhmm(wallClock(x.end, tz).minutes)} [outside]`)]
  if (fixed.length) lines.push('Fixed events this week (cannot be moved):', ...fixed.slice(0, 40))
  if (s.calendar.overflow.length) {
    lines.push('Not fitting:')
    for (const o of s.calendar.overflow) {
      const e = s.entries.find((x) => x.id === o.entryId)
      if (e) lines.push(`- "${e.title}" ${o.kind === 'past-due' ? `${o.minutes}m past its due` : `${o.minutes}m with no room`}`)
    }
  }
  return lines.join('\n')
}

const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`

/** The model's JSON, or null when there was none. Unknown ops and fields are dropped, the list capped at 10. */
export function parseAnswer(text: string): RawAnswer | null {
  const m = text.replace(/```json|```/g, '').match(/\{[\s\S]*\}/)
  if (!m) return null
  try {
    const j = JSON.parse(m[0]) as Partial<RawAnswer>
    const ops = new Set(['estimate', 'due', 'notBefore', 'rush', 'order', 'split', 'off', 'place', 'unplace', 'block'])
    const commands = (Array.isArray(j.commands) ? j.commands : []).filter((c) => c && typeof c === 'object' && ops.has(String((c as RawCommand).op))).slice(0, 10) as RawCommand[]
    return { commands, ask: typeof j.ask === 'string' && j.ask.trim() ? j.ask.trim().slice(0, 240) : null, log: typeof j.log === 'string' ? j.log.trim().slice(0, 200) : '' }
  } catch {
    return null
  }
}

/** "YYYY-MM-DD HH:MM" in the zone, as an epoch; null when it is not that shape. */
export function wallToEpoch(v: unknown, tz: string): number | null {
  if (typeof v !== 'string') return null
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{1,2}):(\d{2})/.exec(v.trim())
  if (!m) return null
  return zonedEpoch(tz, Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4]) * 60 + Number(m[5]))
}

const norm = (t: string) => t.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim()
function dice(a: string, b: string): number {
  const ta = new Set(norm(a).split(' ').filter(Boolean))
  const tb = new Set(norm(b).split(' ').filter(Boolean))
  if (!ta.size || !tb.size) return 0
  let both = 0
  for (const t of ta) if (tb.has(t)) both++
  return (2 * both) / (ta.size + tb.size)
}

/** The open entry a title refers to: one id, or a short list to ask about, or nothing. */
export function resolveRef(ref: string, s: MayorlyState): { id: Id } | { options: Id[] } | null {
  const flow = openFlow(s)
  const r = norm(ref)
  if (!r) return null
  const exact = flow.filter((e) => norm(e.title) === r)
  if (exact.length === 1) return { id: exact[0].id }
  const prefix = flow.filter((e) => norm(e.title).startsWith(r))
  if (prefix.length === 1) return { id: prefix[0].id }
  const sub = flow.filter((e) => norm(e.title).includes(r) || r.includes(norm(e.title)))
  if (sub.length === 1) return { id: sub[0].id }
  const scored = flow.map((e) => ({ id: e.id, score: dice(r, e.title) })).sort((a, b) => b.score - a.score)
  if (scored[0] && scored[0].score >= 0.6 && (!scored[1] || scored[0].score - scored[1].score >= 0.15)) return { id: scored[0].id }
  const options = (sub.length ? sub.map((e) => e.id) : scored.filter((x) => x.score > 0).map((x) => x.id)).slice(0, 3)
  return options.length ? { options } : null
}

export interface Draft {
  raw: RawCommand
  /** The command once every ref resolved; null while a ref waits on a pick. */
  command: ClerkCommand | null
  line: ArrangementLine
  /** Refs still to pick, with their choices. */
  pending: { ref: string; options: Id[] }[]
}

/** Each raw command as a draft: resolved, refused with a reason, or waiting on a name. */
export function draftCommands(answer: RawAnswer, s: MayorlyState, now: number): Draft[] {
  const tz = s.settings.calendar.tz
  const titleOf = (id: Id) => s.entries.find((e) => e.id === id)?.title ?? id
  const out: Draft[] = []
  for (const raw of answer.commands) {
    const refuse = (text: string, reason: string): Draft => ({ raw, command: null, line: { text, ok: false, reason }, pending: [] })
    const pending: { ref: string; options: Id[] }[] = []
    let entryId: Id | null = null
    let thanId: Id | null = null
    if (raw.op !== 'block') {
      const r = resolveRef(String(raw.ref ?? ''), s)
      if (!r) {
        out.push(refuse(`${raw.op} "${raw.ref ?? ''}"`, 'no such entry'))
        continue
      }
      if ('id' in r) entryId = r.id
      else pending.push({ ref: String(raw.ref), options: r.options })
    }
    if (raw.op === 'order' && (raw.place === 'before' || raw.place === 'after')) {
      const r = resolveRef(String(raw.than ?? ''), s)
      if (!r) {
        out.push(refuse(`order "${raw.ref}" ${raw.place} "${raw.than ?? ''}"`, 'no such entry'))
        continue
      }
      if ('id' in r) thanId = r.id
      else pending.push({ ref: String(raw.than), options: r.options })
    }
    const name = entryId ? titleOf(entryId) : `"${raw.ref ?? ''}"`
    const build = (eid: Id | null, tid: Id | null): { command: ClerkCommand; text: string } | { text: string; reason: string } => {
      const id = eid ?? '?'
      switch (raw.op) {
        case 'estimate': return typeof raw.minutes === 'number' ? { command: { op: 'estimate', entryId: id, minutes: raw.minutes }, text: `${name}: estimate ${raw.minutes}m` } : { text: `${name}: estimate`, reason: 'no minutes' }
        case 'rush': return { command: { op: 'rush', entryId: id, on: !!raw.on }, text: `${name}: ${raw.on ? 'up next' : 'not up next'}` }
        case 'off': return { command: { op: 'off', entryId: id, on: !!raw.on }, text: `${name}: ${raw.on ? 'off the calendar' : 'back on the calendar'}` }
        case 'unplace': return { command: { op: 'unplace', entryId: id }, text: `${name}: let the planner place it` }
        case 'split': return { command: { op: 'split', entryId: id, splittable: !!raw.splittable, minChunkMin: raw.minChunkMin, maxChunkMin: raw.maxChunkMin }, text: `${name}: ${raw.splittable ? 'may be split' : 'one piece'}${raw.minChunkMin ? `, chunks ${raw.minChunkMin}m` : ''}${raw.maxChunkMin ? ` to ${raw.maxChunkMin}m` : ''}` }
        case 'order': return { command: { op: 'order', entryId: id, place: (raw.place as 'first' | 'last' | 'before' | 'after') ?? 'first', than: tid ?? undefined }, text: `${name}: ${raw.place}${tid ? ` ${titleOf(tid)}` : ''}` }
        case 'due':
        case 'notBefore': {
          if (raw.at === null) return { command: { op: raw.op, entryId: id, at: null }, text: `${name}: no ${raw.op === 'due' ? 'due' : 'not-before'}` }
          const t = wallToEpoch(raw.at, tz)
          if (t === null) return { text: `${name}: ${raw.op}`, reason: 'no time' }
          if (raw.op === 'notBefore' && t < now - MIN) return { text: `${name}: not before ${raw.at}`, reason: 'in the past' }
          return { command: { op: raw.op, entryId: id, at: t }, text: `${name}: ${raw.op === 'due' ? 'due' : 'not before'} ${raw.at}` }
        }
        case 'place': {
          const t = wallToEpoch(raw.start, tz)
          if (t === null || typeof raw.minutes !== 'number') return { text: `${name}: place`, reason: 'no time' }
          if (t < now - MIN) return { text: `${name}: place at ${raw.start}`, reason: 'in the past' }
          return { command: { op: 'place', entryId: id, start: t, minutes: raw.minutes }, text: `${name}: at ${raw.start} for ${raw.minutes}m` }
        }
        case 'block': {
          const t = wallToEpoch(raw.start, tz)
          if (t === null || typeof raw.minutes !== 'number' || !raw.title) return { text: `block "${raw.title ?? ''}"`, reason: 'no time' }
          if (t < now - MIN) return { text: `block "${raw.title}" at ${raw.start}`, reason: 'in the past' }
          return { command: { op: 'block', title: String(raw.title), start: t, minutes: raw.minutes }, text: `"${raw.title}" at ${raw.start} for ${raw.minutes}m` }
        }
        default: return { text: raw.op, reason: 'unknown' }
      }
    }
    const b = build(entryId, thanId)
    if (!('command' in b)) {
      out.push(refuse(b.text, b.reason))
      continue
    }
    out.push({ raw, command: pending.length ? null : b.command, line: { text: b.text, ok: true }, pending })
  }
  return out
}

/** A draft with its picks filled in, built again so the text names the chosen entries. */
export function fillDraft(d: Draft, picks: Record<string, Id>, s: MayorlyState, now: number): ClerkCommand | null {
  if (d.command) return d.command
  const raw: RawCommand = { ...d.raw }
  for (const p of d.pending) {
    const id = picks[p.ref]
    if (!id) return null
    const title = s.entries.find((e) => e.id === id)?.title
    if (!title) return null
    if (raw.ref === p.ref) raw.ref = title
    if (raw.than === p.ref) raw.than = title
  }
  const again = draftCommands({ commands: [raw], ask: null, log: '' }, s, now)[0]
  return again?.command ?? null
}

/** The outcome of applying the commands, without committing: how many blocks move and how many turn late. */
export function previewApply(s: MayorlyState, commands: ClerkCommand[], log: string, ctx: Ctx): { moved: number; newLate: number } {
  const cal = s.settings.calendar
  const windows = windowsFor(cal, ctx.now, cal.horizonDays + 1)
  const horizonEnd = ctx.now + cal.horizonDays * DAY
  const applied = reduce(s, { type: 'schedule/apply', commands, log }, ctx).state
  const after = reduce(applied, { type: 'schedule/replan', windows, horizonEnd }, ctx).state
  const before = new Map(s.calendar.blocks.map((b) => [b.id, b]))
  let moved = 0
  for (const b of after.calendar.blocks) {
    const was = before.get(b.id)
    if (!was || was.start !== b.start || was.end !== b.end) moved++
  }
  const lateBefore = s.calendar.blocks.filter((b) => b.late).length
  const lateAfter = after.calendar.blocks.filter((b) => b.late).length
  return { moved, newLate: Math.max(0, lateAfter - lateBefore) }
}

export function toArrangement(id: string, say: string, ask: string | null, drafts: Draft[], s: MayorlyState, outcome: { moved: number; newLate: number }): Arrangement {
  const titleOf = (eid: Id) => s.entries.find((e) => e.id === eid)?.title ?? eid
  const asks = new Map<string, { id: Id; title: string }[]>()
  for (const d of drafts) for (const p of d.pending) if (!asks.has(p.ref)) asks.set(p.ref, p.options.map((o) => ({ id: o, title: titleOf(o) })))
  return { id, say, ask, lines: drafts.map((d) => d.line), moved: outcome.moved, newLate: outcome.newLate, asks: [...asks].map(([ref, options]) => ({ ref, options })) }
}
