import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS, reduce, sampleState, sanitiseSettings, type Action, type HudEvent, type MayorlyState, type Settings } from '../core/index'
import { deskSeen, impactFor, lastImpact, momentOf, previewImpact, reachOf, sweepOf, wallsOf, withEffect, type Impact } from './impact'

const now = Date.parse('2026-11-24T18:00:00Z')

/** A desk driven one step at a time, as the engine drives it, keeping the moment each step made. */
function desk(device = 'here') {
  let n = 0
  let t = now
  const ctx = () => ({ now: t, newId: () => `id${++n}`, random: () => 0.5, device })
  let s: MayorlyState = sampleState(now, () => `id${++n}`)
  s = { ...s, tokens: [...s.tokens, { id: 'seed', at: now, amount: 40, reason: 'tomato', sittingId: null } as never] }
  const act = (a: Action, on = device): Impact | null => {
    const before = deskSeen(s)
    const r = reduce(s, a, ctx())
    s = r.state
    return impactFor(r.events as HudEvent[], before, s, on)
  }
  const wait = (ms: number) => {
    t += ms
    return act({ type: 'desk/tick' })
  }
  return { get s() { return s }, act, wait }
}

describe('what hits the screen', () => {
  it('a start, a switch, a task done: each its own moment, style and words', () => {
    const d = desk()
    const start = d.act({ type: 'entry/capture', text: 'legal: alpha', start: true })
    expect(start).toMatchObject({ moment: 'start', style: 'edges', kicker: 'Starting', title: 'alpha' })
    d.act({ type: 'entry/capture', text: 'legal: beta' })
    const beta = d.s.entries.find((e) => e.title === 'beta')!
    const sw = d.act({ type: 'desk/select', entryId: beta.id, ledgerId: beta.ledgerId } as Action)
    expect(sw).toMatchObject({ moment: 'switch', style: 'ripple', kicker: 'Switched to', title: 'beta' })
    const done = d.act({ type: 'entry/complete', id: beta.id })
    expect(done).toMatchObject({ moment: 'done', style: 'shockwave', kicker: 'Done', title: 'beta' })
  })

  it('focus ending is a rest, and the rest ending is back to work, in cool and warm colours', () => {
    const d = desk()
    d.act({ type: 'entry/capture', text: 'legal: alpha', start: true })
    const rest = d.wait(d.s.settings.focusMin * 60_000 + 1000)
    expect(rest).toMatchObject({ moment: 'rest', style: 'tide', kicker: 'Focus done' })
    expect(rest?.title).toMatch(/^Rest/)
    if (d.s.desk.status === 'ready') d.act({ type: 'desk/resume' })
    const work = d.wait(d.s.settings.shortRestMin * 60_000 + 1000)
    expect(work?.moment).toBe('work')
    expect(work?.title).toBe('alpha')
    expect(work?.color).not.toBe(rest?.color)
  })

  it('a pause and a resume show as a change of the desk', () => {
    const d = desk()
    d.act({ type: 'entry/capture', text: 'legal: alpha', start: true })
    expect(d.act({ type: 'desk/pause' })).toMatchObject({ moment: 'pause', kicker: 'Paused', title: 'alpha' })
    expect(d.act({ type: 'desk/resume' })).toMatchObject({ moment: 'resume', kicker: 'Resumed', title: 'alpha' })
  })

  it('a resume after time paused is Resumed too', () => {
    const d = desk()
    d.act({ type: 'entry/capture', text: 'legal: alpha', start: true })
    d.wait(60_000)
    d.act({ type: 'desk/pause' })
    expect(d.wait(30_000)).toBeNull()
    expect(d.act({ type: 'desk/resume' })).toMatchObject({ moment: 'resume', kicker: 'Resumed' })
  })

  it('an edge glow turned off before there were styles keeps the switch quiet', () => {
    const old = { ...DEFAULT_SETTINGS, switchPulse: false } as Partial<Settings> & { switchPulse: boolean }
    delete old.impact
    expect(sanitiseSettings(old as Settings).impact.styles.switch).toBe('off')
    expect(sanitiseSettings(old as Settings).impact.styles.done).toBe('shockwave')
    expect(sanitiseSettings({ ...DEFAULT_SETTINGS }).impact.styles.switch).toBe('ripple')
    expect('switchPulse' in sanitiseSettings(old as Settings)).toBe(false)
  })

  it('standing down ends the sitting', () => {
    const d = desk()
    d.act({ type: 'entry/capture', text: 'legal: alpha', start: true })
    expect(d.act({ type: 'desk/standDown' })).toMatchObject({ moment: 'stop', title: 'Stood down' })
  })

  it('a moment whose style is off plays nothing, and the others still do', () => {
    const d = desk()
    d.act({ type: 'settings/update', patch: { impact: { ...d.s.settings.impact, styles: { ...d.s.settings.impact.styles, start: 'off' } } } })
    expect(d.act({ type: 'entry/capture', text: 'legal: alpha', start: true })).toBeNull()
    expect(d.act({ type: 'desk/pause' })?.moment).toBe('pause')
  })

  it('a computer holding a desk that runs elsewhere shows nothing', () => {
    const d = desk()
    d.act({ type: 'desk/claim', name: 'Here' })
    d.act({ type: 'entry/capture', text: 'legal: alpha', start: true })
    const before = deskSeen(d.s)
    const r = reduce(d.s, { type: 'desk/pause' }, { now, newId: () => 'x', random: () => 0.5, device: 'here' })
    expect(momentOf(r.events, before, r.state, 'somewhere else')).toBeNull()
    expect(momentOf(r.events, before, r.state, 'here')?.moment).toBe('pause')
  })

  it('a step that changes nothing makes no moment', () => {
    const d = desk()
    d.act({ type: 'entry/capture', text: 'legal: alpha', start: true })
    expect(d.wait(1000)).toBeNull()
  })

  it('Try shows the moment as it would look now, in the style asked for', () => {
    const d = desk()
    d.act({ type: 'entry/capture', text: 'legal: alpha', start: true })
    expect(previewImpact('switch', 'sweep', d.s)).toMatchObject({ moment: 'switch', style: 'sweep', kicker: 'Switched to', title: 'alpha' })
    expect(previewImpact('rest', 'tide', d.s).title).toBe(`Rest, ${d.s.settings.shortRestMin} min`)
  })
})

describe('one wave across every screen', () => {
  const left = { x: -1920, y: 0, width: 1920, height: 1080 }
  const main = { x: 0, y: 0, width: 2560, height: 1440 }

  it('reaches the farthest corner of every screen from the tomato', () => {
    const tomato = { x: 2500, y: 1400 }
    expect(reachOf(tomato, [main])).toBe(Math.ceil(Math.hypot(2500, 1400)))
    expect(reachOf(tomato, [main, left])).toBe(Math.ceil(Math.hypot(2500 + 1920, 1400)))
  })

  it('crashes into every edge but the ones another screen touches', () => {
    const portrait = { x: 2560, y: -300, width: 1080, height: 1920 }
    expect(wallsOf(main, [main])).toEqual({ left: true, right: true, top: true, bottom: true })
    expect(wallsOf(main, [main, left])).toEqual({ left: false, right: true, top: true, bottom: true })
    expect(wallsOf(left, [main, left])).toEqual({ left: true, right: false, top: true, bottom: true })
    expect(wallsOf(main, [main, left, portrait])).toEqual({ left: false, right: false, top: true, bottom: true })
    expect(wallsOf(portrait, [main, left, portrait])).toEqual({ left: false, right: true, top: true, bottom: true })
  })

  it('sweeps away from the tomato, across them all', () => {
    expect(sweepOf({ x: 2500, y: 1400 }, [main, left])).toEqual({ dir: -1, reachX: 2500 + 1920 })
    expect(sweepOf({ x: -1800, y: 500 }, [main, left])).toEqual({ dir: 1, reachX: 2560 + 1800 })
  })
})

describe('impacts on a page', () => {
  it('keeps the last one finishing under a new one, and only the newest speaks', () => {
    let list: { kind: string; seq: number }[] = []
    list = withEffect(list, { kind: 'impact', seq: 1 })
    list = withEffect(list, { kind: 'cashin', seq: 2 })
    list = withEffect(list, { kind: 'impact', seq: 3 })
    list = withEffect(list, { kind: 'impact', seq: 4 })
    expect(list.map((x) => x.seq)).toEqual([2, 3, 4])
    expect(lastImpact(list)).toBe(4)
  })
})
