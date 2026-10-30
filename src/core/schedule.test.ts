import { describe, expect, it } from 'vitest'
import { clip, normalize, plan, subtract, type PlanInput, type PlanTask } from './schedule'

// The planner against a fixed week: Monday 2026-01-05 09:00 UTC is "now", work hours nine
// to five every day for ten days unless a test says otherwise. All in UTC so no zone math.

const MIN = 60_000
const H = 60 * MIN
const DAY = 24 * H
const NOW = Date.UTC(2026, 0, 5, 9, 0)
const at = (dayOffset: number, hour: number, minute = 0) => Date.UTC(2026, 0, 5 + dayOffset, hour, minute)
const windows = (days = 10, from = 9, to = 17) => Array.from({ length: days }, (_, d) => ({ start: at(d, from), end: at(d, to) }))

function task(id: string, needMin: number, extra: Partial<PlanTask> = {}): PlanTask {
  return { id, needMin, due: null, notBefore: null, rush: false, order: 0, splittable: true, minChunkMin: null, maxChunkMin: null, ...extra }
}
function input(tasks: PlanTask[], extra: Partial<PlanInput> = {}): PlanInput {
  return { now: NOW, horizonEnd: NOW + 10 * DAY, windows: windows(), busy: [], tasks, previous: [], minChunkMin: 25, gridMin: 5, breakMin: 0, spill: true, ...extra }
}
const span = (p: { start: number; end: number }) => [p.start, p.end]

describe('interval algebra', () => {
  it('normalizes, subtracts and clips half-open intervals', () => {
    expect(normalize([{ start: 5, end: 3 }, { start: 10, end: 20 }, { start: 0, end: 10 }, { start: 25, end: 30 }])).toEqual([{ start: 0, end: 20 }, { start: 25, end: 30 }])
    expect(subtract([{ start: 0, end: 100 }], [{ start: 20, end: 30 }, { start: 90, end: 200 }])).toEqual([{ start: 0, end: 20 }, { start: 30, end: 90 }])
    expect(clip([{ start: 0, end: 100 }], 50, 70)).toEqual([{ start: 50, end: 70 }])
  })
})

describe('the planner', () => {
  it('places one task at the first free moment', () => {
    const r = plan(input([task('a', 90)]))
    expect(r.placements.map(span)).toEqual([[at(0, 9), at(0, 10, 30)]])
    expect(r.overflow).toEqual([])
  })

  it('splits around a meeting, unless the task may not be split', () => {
    const busy = [{ start: at(0, 10), end: at(0, 11) }]
    const r = plan(input([task('a', 120)], { busy }))
    expect(r.placements.map(span)).toEqual([[at(0, 9), at(0, 10)], [at(0, 11), at(0, 12)]])
    const whole = plan(input([task('a', 120, { splittable: false })], { busy }))
    expect(whole.placements.map(span)).toEqual([[at(0, 11), at(0, 13)]])
  })

  it('places a need shorter than the smallest chunk whole', () => {
    const r = plan(input([task('a', 15), task('b', 5, { order: 1 })]))
    expect(r.placements.map(span)).toEqual([[at(0, 9), at(0, 9, 15)], [at(0, 9, 15), at(0, 9, 20)]])
    expect(r.overflow).toEqual([])
  })

  it('never leaves a tail shorter than one chunk', () => {
    const busy = [{ start: at(0, 9, 45), end: at(0, 10) }]
    const r = plan(input([task('a', 60)], { busy }))
    expect(r.placements.map(span)).toEqual([[at(0, 9), at(0, 9, 35)], [at(0, 10), at(0, 10, 25)]])
  })

  it('an earlier due beats the flow order; rush beats a due; then order, then id', () => {
    const r = plan(input([task('a', 60, { order: 0 }), task('b', 60, { order: 1, due: at(0, 12) }), task('c', 60, { order: 2, rush: true })]))
    expect(r.placements.map((p) => p.taskId)).toEqual(['c', 'b', 'a'])
    const tie = plan(input([task('y', 30, { order: 1 }), task('x', 30, { order: 1 })]))
    expect(tie.placements.map((p) => p.taskId)).toEqual(['x', 'y'])
  })

  it('respects not-before', () => {
    const r = plan(input([task('a', 60, { notBefore: at(0, 14) })]))
    expect(r.placements.map(span)).toEqual([[at(0, 14), at(0, 15)]])
  })

  it('skips days with no hours and caps chunks', () => {
    const r = plan(input([task('a', 180, { maxChunkMin: 60 })], { windows: [{ start: at(0, 9), end: at(0, 10) }, { start: at(2, 9), end: at(2, 17) }] }))
    expect(r.placements.map(span)).toEqual([[at(0, 9), at(0, 10)], [at(2, 9), at(2, 10)], [at(2, 10), at(2, 11)]])
  })

  it('pads a break after every placed chunk', () => {
    const r = plan(input([task('a', 60, { order: 0 }), task('b', 60, { order: 1 })], { breakMin: 10 }))
    expect(r.placements.map(span)).toEqual([[at(0, 9), at(0, 10)], [at(0, 10, 10), at(0, 11, 10)]])
  })

  it('spills past a due and says by how much, or stops and says there was no room', () => {
    const late = plan(input([task('a', 120, { due: at(0, 10) })]))
    expect(late.placements.map(span)).toEqual([[at(0, 9), at(0, 11)]])
    expect(late.placements[0].late).toBe(true)
    expect(late.overflow).toEqual([{ taskId: 'a', kind: 'past-due', minutes: 60 }])
    const strict = plan(input([task('a', 120, { due: at(0, 10) })], { spill: false }))
    expect(strict.placements.map(span)).toEqual([[at(0, 9), at(0, 10)]])
    expect(strict.overflow).toEqual([{ taskId: 'a', kind: 'no-room', minutes: 60 }])
  })

  it('does not throw on a task that cannot fit the horizon, and reports the shortfall', () => {
    const r = plan(input([task('a', 30_000)]))
    expect(r.overflow[0]).toMatchObject({ taskId: 'a', kind: 'no-room' })
    expect(r.overflow[0].minutes).toBe(30_000 - 10 * 8 * 60)
  })

  it('is stable: the same input again changes nothing, a shuffled input changes nothing', () => {
    const tasks = [task('a', 90, { order: 0 }), task('b', 45, { order: 1, due: at(1, 12) }), task('c', 200, { order: 2 })]
    const first = plan(input(tasks))
    const again = plan(input(tasks, { previous: first.placements }))
    expect(again).toEqual(first)
    const shuffled = plan(input([tasks[2], tasks[0], tasks[1]]))
    expect(shuffled).toEqual(first)
  })

  it('a new busy interval moves only the chunk it lands on', () => {
    const tasks = [task('a', 60, { order: 0 }), task('b', 60, { order: 1 }), task('c', 60, { order: 2 })]
    const first = plan(input(tasks))
    const meeting = { start: at(0, 10, 15), end: at(0, 10, 45) }
    const next = plan(input(tasks, { previous: first.placements, busy: [meeting] }))
    const a = next.placements.filter((p) => p.taskId === 'a').map(span)
    const c = next.placements.filter((p) => p.taskId === 'c').map(span)
    expect(a).toEqual([[at(0, 9), at(0, 10)]])
    expect(c).toEqual([[at(0, 11), at(0, 12)]])
    expect(next.placements.filter((p) => p.taskId === 'b').map(span)).toEqual([[at(0, 12), at(0, 13)]])
  })

  it('a chunk in progress stays, from now to its end', () => {
    const previous = [{ taskId: 'a', start: at(0, 8, 30), end: at(0, 9, 30), late: false }]
    const r = plan(input([task('a', 60)], { previous }))
    expect(r.placements.map(span)).toEqual([[at(0, 9), at(0, 9, 30)], [at(0, 9, 30), at(0, 10)]])
  })

  it('stickiness yields to a deadline it would make late', () => {
    const previous = [{ taskId: 'y', start: at(0, 9), end: at(0, 12), late: false }]
    const tasks = [task('x', 180, { order: 0, due: at(0, 12) }), task('y', 180, { order: 1 })]
    const r = plan(input(tasks, { previous }))
    expect(r.placements.filter((p) => p.taskId === 'x').map(span)).toEqual([[at(0, 9), at(0, 12)]])
    expect(r.overflow).toEqual([])
    // The control: with room for both, the kept chunk stays.
    const roomy = plan(input([task('x', 60, { order: 0, due: at(0, 14) }), task('y', 180, { order: 1 })], { previous }))
    expect(roomy.placements.filter((p) => p.taskId === 'y').map(span)).toEqual([[at(0, 9), at(0, 12)]])
  })

  it('never places over busy time or outside the windows (seeded sweep)', () => {
    let seed = 7
    const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648)
    for (let round = 0; round < 40; round++) {
      const busy = Array.from({ length: 6 }, () => {
        const s = at(Math.floor(rnd() * 5), 9 + Math.floor(rnd() * 7), Math.floor(rnd() * 12) * 5)
        return { start: s, end: s + (1 + Math.floor(rnd() * 6)) * 15 * MIN }
      })
      const tasks = Array.from({ length: 5 }, (_, i) => task(`t${i}`, 25 + Math.floor(rnd() * 20) * 10, { order: i, due: rnd() < 0.4 ? at(1 + Math.floor(rnd() * 4), 17) : null, splittable: rnd() < 0.8 }))
      const r = plan(input(tasks, { busy, breakMin: 5 }))
      const free = subtract(normalize(windows()), normalize(busy))
      for (const p of r.placements) {
        expect(free.some((f) => f.start <= p.start && p.end <= f.end)).toBe(true)
        for (const q of r.placements) if (q !== p) expect(p.end <= q.start || q.end <= p.start).toBe(true)
      }
    }
  })
})
