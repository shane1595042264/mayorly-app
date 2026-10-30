import type { Epoch, Id, Interval, Ms } from './model'

// The planner: entries with estimates become blocks on the calendar, placed into work hours
// around everything fixed (the user's events, the clerk's pins, outside calendars). Pure and
// deterministic: the same input gives byte-identical output, and nothing here reads a clock.
//
// The rule is earliest deadline first with the flow's own order as the tiebreak, which is the
// list the user already keeps; the only extra tier is `rush` (up next). Placements stick from
// one run to the next unless something fixed landed on them, so the calendar does not churn;
// stickiness yields once to a deadline it would make late. What cannot fit is reported as
// overflow, never thrown and never silently dropped. No weights, no scoring: a plan the user
// can predict beats one that is slightly cleverer.

const MIN = 60_000

export interface PlanTask {
  id: Id
  /** Minutes still to place, after desk time and pins were credited by the caller. */
  needMin: number
  due: Epoch | null
  notBefore: Epoch | null
  /** Up next: ahead of every deadline. */
  rush: boolean
  /** The flow's order; lower first. */
  order: number
  splittable: boolean
  minChunkMin: number | null
  maxChunkMin: number | null
}

export interface Placement extends Interval {
  taskId: Id
  /** Ends after the task's due. */
  late: boolean
}

export interface PlanOverflow {
  taskId: Id
  /** past-due: placed, but finishing `minutes` after the due. no-room: `minutes` found no window inside the horizon. */
  kind: 'past-due' | 'no-room'
  minutes: number
}

export interface PlanInput {
  now: Epoch
  horizonEnd: Epoch
  /** Work hours, absolute. Any order; overlaps are merged. */
  windows: Interval[]
  /** The user's events, the clerk's pins, outside busy time: untouchable. */
  busy: Interval[]
  tasks: PlanTask[]
  /** The last run's placements, for stickiness. */
  previous: Placement[]
  /** Smallest chunk when a task does not say, minutes. */
  minChunkMin: number
  /** Starts and lengths snap to this, minutes. */
  gridMin: number
  /** Padding after every placed chunk, minutes. */
  breakMin: number
  /** Keep placing past a due (flagged late) instead of reporting no-room. */
  spill: boolean
}

export interface PlanResult {
  /** Sorted by start, then task id. */
  placements: Placement[]
  overflow: PlanOverflow[]
}

// ---------------------------------------------------------------- interval algebra
// Half-open [start, end) in epoch ms.

/** Valid, sorted by start, overlapping and touching ones merged. */
export function normalize(xs: Interval[]): Interval[] {
  const sorted = xs.filter((x) => Number.isFinite(x.start) && Number.isFinite(x.end) && x.end > x.start).sort((a, b) => a.start - b.start || a.end - b.end)
  const out: Interval[] = []
  for (const x of sorted) {
    const last = out[out.length - 1]
    if (last && x.start <= last.end) last.end = Math.max(last.end, x.end)
    else out.push({ start: x.start, end: x.end })
  }
  return out
}

/** What is left of `free` once `busy` is taken out. Both normalized. */
export function subtract(free: Interval[], busy: Interval[]): Interval[] {
  const out: Interval[] = []
  let j = 0
  for (const f of free) {
    let cursor = f.start
    while (j < busy.length && busy[j].end <= cursor) j++
    let k = j
    while (k < busy.length && busy[k].start < f.end) {
      const b = busy[k]
      if (b.start > cursor) out.push({ start: cursor, end: Math.min(b.start, f.end) })
      cursor = Math.max(cursor, b.end)
      if (cursor >= f.end) break
      k++
    }
    if (cursor < f.end) out.push({ start: cursor, end: f.end })
  }
  return out.filter((x) => x.end > x.start)
}

/** The parts of `xs` inside [start, end). */
export function clip(xs: Interval[], start: Epoch, end: Epoch): Interval[] {
  const out: Interval[] = []
  for (const x of xs) {
    const s = Math.max(x.start, start)
    const e = Math.min(x.end, end)
    if (e > s) out.push({ start: s, end: e })
  }
  return out
}

/** True when one of `free` holds all of `x`. `free` normalized. */
export function containedIn(free: Interval[], x: Interval): boolean {
  let lo = 0
  let hi = free.length - 1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    const f = free[mid]
    if (f.end <= x.start) lo = mid + 1
    else if (f.start > x.start) hi = mid - 1
    else return x.end <= f.end
  }
  return false
}

const roundUp = (t: number, stepMs: number) => Math.ceil(t / stepMs) * stepMs

// ---------------------------------------------------------------- the plan

export function plan(input: PlanInput): PlanResult {
  const first = run(input, input.previous)
  // Stickiness yields once to a deadline: when a task finishes late, kept placements of
  // tasks ranked below it that sit before its due are released and the plan runs again.
  const late = first.overflow.filter((o) => o.kind === 'past-due')
  if (late.length === 0 || input.previous.length === 0) return first
  const ranked = order(input.tasks)
  const rankOf = new Map(ranked.map((t, i) => [t.id, i]))
  const byId = new Map(input.tasks.map((t) => [t.id, t]))
  const released = new Set<string>()
  for (const o of late) {
    const t = byId.get(o.taskId)
    const r = rankOf.get(o.taskId)
    if (!t || t.due === null || r === undefined) continue
    for (const p of input.previous) {
      const pr = rankOf.get(p.taskId)
      if (pr === undefined || pr <= r) continue
      if (p.start < t.due && !(p.start < input.now && input.now < p.end)) released.add(key(p))
    }
  }
  if (released.size === 0) return first
  return run(input, input.previous.filter((p) => !released.has(key(p))))
}

const key = (p: Placement) => `${p.taskId}|${p.start}|${p.end}`

/** rush, then earliest due, then the flow's order, then id: a total order. */
function order(tasks: PlanTask[]): PlanTask[] {
  return [...tasks].sort((a, b) =>
    Number(b.rush) - Number(a.rush) ||
    (a.due ?? Infinity) - (b.due ?? Infinity) ||
    a.order - b.order ||
    (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
}

function run(input: PlanInput, previous: Placement[]): PlanResult {
  const { now, horizonEnd } = input
  const grid = Math.max(1, Math.round(input.gridMin)) * MIN
  const breakMs = Math.max(0, input.breakMin) * MIN
  const windows = clip(normalize(input.windows), now, horizonEnd)
  let free = subtract(windows, normalize(input.busy))
  const tasks = order(input.tasks)
  const byId = new Map(tasks.map((t) => [t.id, t]))
  const remaining = new Map(tasks.map((t) => [t.id, Math.max(0, roundUp(t.needMin, input.gridMin)) ]))
  const placements: Placement[] = []
  const take = (p: Placement) => {
    placements.push(p)
    free = subtract(free, [{ start: p.start, end: p.end + breakMs }])
  }

  // Stickiness: keep last time's chunks where nothing fixed landed on them.
  const kept = [...previous].sort((a, b) => a.start - b.start || (a.taskId < b.taskId ? -1 : 1))
  for (const p of kept) {
    const t = byId.get(p.taskId)
    if (!t) continue
    const rem = remaining.get(t.id) ?? 0
    if (rem <= 0) continue
    const inProgress = p.start < now && now < p.end
    let start: number
    let end: number
    if (inProgress) {
      start = now
      end = p.end
    } else {
      if (p.start < now || p.end > horizonEnd) continue
      if (!containedIn(free, p)) continue
      if (t.notBefore !== null && p.start < t.notBefore) continue
      if (t.due !== null && p.end > t.due && !p.late) continue
      start = p.start
      end = p.end
    }
    const minutes = Math.ceil((end - start) / MIN)
    if (minutes <= 0) continue
    const used = Math.min(minutes, rem)
    end = start + used * MIN
    take({ taskId: t.id, start, end, late: t.due !== null && end > t.due })
    remaining.set(t.id, rem - used)
  }

  const overflow: PlanOverflow[] = []
  for (const t of tasks) {
    let rem = remaining.get(t.id) ?? 0
    if (rem <= 0) continue
    const from = Math.max(now, t.notBefore ?? 0)
    const minChunk = Math.max(t.minChunkMin ?? input.minChunkMin, input.gridMin)
    const maxChunk = t.maxChunkMin ?? Infinity
    let stoppedAtDue = false
    for (let i = 0; i < free.length && rem > 0; i++) {
      const gap = free[i]
      if (gap.end <= from) continue
      const s = roundUp(Math.max(gap.start, from), grid)
      let len = Math.floor((gap.end - s) / grid) * input.gridMin
      if (len < minChunk) continue
      if (t.due !== null && !input.spill) {
        // No spilling: nothing is placed past the due, and what would cross it is cut at it.
        if (s >= t.due) {
          stoppedAtDue = true
          break
        }
        len = Math.min(len, Math.floor((t.due - s) / grid) * input.gridMin)
        if (len < minChunk) {
          stoppedAtDue = true
          break
        }
      }
      let chunk = t.splittable ? Math.min(rem, len, maxChunk) : rem
      if (!t.splittable && chunk > len) continue
      // Never leave a tail shorter than one chunk.
      if (rem - chunk > 0 && rem - chunk < minChunk) {
        chunk = rem - minChunk
        if (chunk < minChunk) continue
      }
      chunk = Math.floor(chunk / input.gridMin) * input.gridMin
      if (chunk < minChunk) continue
      const end = s + chunk * MIN
      take({ taskId: t.id, start: s, end, late: t.due !== null && end > t.due })
      rem -= chunk
      i = -1
    }
    remaining.set(t.id, rem)
    if (rem > 0) overflow.push({ taskId: t.id, kind: 'no-room', minutes: rem })
    else if (!stoppedAtDue && t.due !== null) {
      const lastEnd = Math.max(...placements.filter((p) => p.taskId === t.id).map((p) => p.end))
      if (lastEnd > t.due) overflow.push({ taskId: t.id, kind: 'past-due', minutes: Math.ceil((lastEnd - t.due) / MIN) })
    }
  }

  placements.sort((a, b) => a.start - b.start || (a.taskId < b.taskId ? -1 : a.taskId > b.taskId ? 1 : 0))
  return { placements, overflow }
}

/** Minutes between two epochs, for callers that credit time. */
export const minutesBetween = (a: Epoch, b: Epoch): number => Math.max(0, Math.round((b - a) / MIN))
export type { Ms }
