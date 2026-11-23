import { describe, expect, it } from 'vitest'
import { onDeskId, reduce, sampleState, type Action, type MayorlyState } from '../core/index'
import { promptStep } from './aiswitch'
import { goOnStep, isLeagueTask, LEAGUE_END_MS, LEAGUE_POLL_MS, LEAGUE_SAME_MS, leagueHolds, leagueRunning, leagueTasks, matchStep, NO_MATCH_YET, playAll, playStep, type MatchMemory } from './leagueplay'
import { openStep } from './streamdeath'

const now = Date.parse('2026-11-23T05:40:00Z')

/** On beta, having come from alpha; a couch with the founder's League item, a stream task, and coins unless `broke`. */
function desk(o: { broke?: boolean; league?: string | null } = {}) {
  let n = 0
  let t = now
  const ctx = { get now() { return t }, newId: () => `id${++n}`, random: () => 0.5, device: 'here' }
  let s: MayorlyState = sampleState(now, ctx.newId)
  if (!o.broke) s = { ...s, tokens: [...s.tokens, { id: 'seed', at: now, amount: 40, reason: 'tomato', sittingId: null } as never] }
  const act = (a: Action) => (s = reduce(s, a, ctx).state)
  act({ type: 'entry/capture', text: 'legal: alpha', start: true })
  act({ type: 'entry/capture', text: 'dance: beta', start: true })
  if (o.league !== null) act({ type: 'leisure/add', title: o.league ?? 'couch: league of legends 2026' })
  act({ type: 'leisure/add', title: 'Stream watch' })
  const stream = s.leisure.find((l) => l.title === 'Stream watch')!.id
  act({ type: 'entry/cue-add', id: stream, text: "Kai'sa dies" })
  const league = s.leisure.find((l) => l.title === (o.league ?? 'couch: league of legends 2026'))?.id ?? ''
  const id = (title: string) => s.entries.find((e) => e.title === title)?.id ?? s.leisure.find((l) => l.title === title)!.id
  const later = (ms: number) => {
    t += ms
  }
  return { get s() { return s }, act, id, league, stream, later }
}

/** One step of a match start, applied. */
function play(d: ReturnType<typeof desk>) {
  const step = playStep(d.s)
  if (step.act) d.act(step.act)
  return step
}

/** A match starting, every step applied as the shell does; the whys of the steps that acted. */
function playThrough(d: ReturnType<typeof desk>) {
  return playAll(d.s, (a) => {
    d.act(a)
    return d.s
  })
    .filter((x) => x.act)
    .map((x) => x.why)
}

describe('a League match of yours', () => {
  it('knows the task you play League on by its name, never one that watches a stream', () => {
    for (const title of ['couch: league of legends 2026', 'League of Legends', 'play League', 'LoL ranked', '英雄联盟', '英雄聯盟']) expect(isLeagueTask({ title })).toBe(true)
    for (const title of ['Stream watch', 'watch LCK league', 'League stream', 'lollipop', "Play Baldur's Gate 3", 'leaguer', 'daily geoguesser 2026']) expect(isLeagueTask({ title })).toBe(false)
    // A League task whose rules watch a stream (the eye on, or the streamer dies on a stream) is watched, not played.
    expect(isLeagueTask({ title: 'League of Legends', watch: true, cues: ['Faker dies'] })).toBe(false)
    expect(isLeagueTask({ title: 'League of Legends', cues: ['Finish one game'] })).toBe(true)
    expect(isLeagueTask({ title: 'League of Legends', watch: false })).toBe(true)
  })

  it('puts the League task on the desk, running, from the task you were on, and Alt+Q takes you back', () => {
    const d = desk()
    expect(onDeskId(d.s)).toBe(d.id('beta'))
    expect(play(d)).toMatchObject({ why: 'switched', to: 'couch: league of legends 2026', act: { type: 'desk/select', leisureId: d.league } })
    expect(onDeskId(d.s)).toBe(d.league)
    expect(d.s.desk.status).toBe('running')
    expect(d.s.desk.block?.kind).toBe('leisure')
    d.act({ type: 'desk/switch' })
    expect(onDeskId(d.s)).toBe(d.id('beta'))
  })

  it('goes back to the League task with its clock when it is the swap-back', () => {
    const d = desk()
    play(d)
    d.act({ type: 'desk/switch' })
    const step = play(d)
    expect(step).toMatchObject({ why: 'switched', act: { type: 'desk/switch' } })
    expect(onDeskId(d.s)).toBe(d.league)
  })

  it('takes over from a rest, which the match outlasts', () => {
    const d = desk()
    d.act({ type: 'desk/skip' })
    expect(d.s.desk.block?.kind).toBe('rest')
    expect(play(d)).toMatchObject({ why: 'switched' })
    expect(onDeskId(d.s)).toBe(d.league)
    expect(d.s.desk.block?.kind).toBe('leisure')
    expect(d.s.desk.status).toBe('running')
  })

  it('runs a paused desk again, the League task or another', () => {
    const d = desk()
    play(d)
    d.act({ type: 'desk/pause' })
    expect(play(d)).toMatchObject({ why: 'resumed', act: { type: 'desk/resume' } })
    expect(d.s.desk.status).toBe('running')
    expect(onDeskId(d.s)).toBe(d.league)
    // Already there and running: nothing to do.
    expect(play(d)).toMatchObject({ act: null, why: 'already there' })
    const p = desk()
    p.act({ type: 'desk/pause' })
    expect(play(p)).toMatchObject({ why: 'switched' })
    expect(onDeskId(p.s)).toBe(p.league)
    expect(p.s.desk.status).toBe('running')
  })

  it('brings its own sitting back from its rest, running or paused, so the match is not timed as a free rest', () => {
    for (const paused of [false, true]) {
      const d = desk()
      d.act({ type: 'settings/update', patch: { autoStartFocus: false } })
      play(d)
      d.later(26 * 60_000)
      d.act({ type: 'desk/tick' })
      expect(d.s.desk.block?.kind).toBe('rest')
      expect(onDeskId(d.s)).toBe(d.league)
      if (paused) d.act({ type: 'desk/pause' })
      expect(play(d)).toMatchObject({ why: 'back from its rest', act: { type: 'desk/skipRest' } })
      expect(d.s.desk.block?.kind).toBe('leisure')
      expect(d.s.desk.status).toBe('running')
      expect(onDeskId(d.s)).toBe(d.league)
    }
  })

  it('from a superset is a sitting of its own, so the next slot never takes the desk back mid-match', () => {
    const d = desk()
    d.act({ type: 'desk/deploy', mode: 'superset', supersetId: d.s.supersets[0].id })
    d.later(20 * 60_000)
    d.act({ type: 'desk/tick' })
    expect(d.s.desk.plan?.mode).toBe('superset')
    expect(play(d)).toMatchObject({ why: 'switched', act: { type: 'desk/select', leisureId: d.league, mode: 'couch' } })
    expect(onDeskId(d.s)).toBe(d.league)
    expect(d.s.desk.plan?.mode).toBe('couch')
    d.later(11 * 60_000)
    d.act({ type: 'desk/tick' })
    expect(onDeskId(d.s)).toBe(d.league)
    expect(d.s.desk.block?.kind).toBe('leisure')
    // The superset waits behind it for Alt+Q.
    d.act({ type: 'desk/switch' })
    expect(d.s.desk.plan?.mode).toBe('superset')
  })

  it('takes League out of a superset slot a pick swapped it into, so the superset waits behind the match for Alt+Q', () => {
    for (const resting of [false, true]) {
      const d = desk()
      d.act({ type: 'desk/deploy', mode: 'superset', supersetId: d.s.supersets[0].id })
      d.act({ type: 'desk/select', leisureId: d.league })
      expect(d.s.desk.plan?.mode).toBe('superset')
      expect(onDeskId(d.s)).toBe(d.league)
      if (resting) {
        d.later(26 * 60_000)
        d.act({ type: 'desk/tick' })
        expect(d.s.desk.block?.kind).toBe('rest')
      }
      const whys = playThrough(d)
      expect(whys).toEqual(resting ? ['back from its rest', 'its slot back to the superset', 'switched'] : ['its slot back to the superset', 'switched'])
      expect(d.s.desk.plan?.mode).toBe('couch')
      expect(onDeskId(d.s)).toBe(d.league)
      expect(d.s.desk.status).toBe('running')
      d.later(40 * 60_000)
      d.act({ type: 'desk/tick' })
      expect(onDeskId(d.s)).toBe(d.league)
      // After the match, Alt+Q is the superset again, on its own slot.
      d.act({ type: 'desk/switch' })
      expect(d.s.desk.plan?.mode).toBe('superset')
      expect(onDeskId(d.s)).not.toBe(d.league)
    }
  })

  it('keeps whether the League task runs, for a restart mid-match, and puts back only the launch pause', () => {
    const d = desk()
    expect(leagueRunning(d.s)).toBe(false)
    play(d)
    expect(leagueRunning(d.s)).toBe(true)
    // The launch paused it: it was running when the last run wrote, so it runs again.
    d.act({ type: 'desk/pause' })
    expect(leagueRunning(d.s)).toBe(false)
    expect(goOnStep(d.s, true)).toMatchObject({ why: 'running again', act: { type: 'desk/resume' } })
    // You had paused it, or moved off League, before the restart: left as it was.
    expect(goOnStep(d.s, false)).toEqual({ act: null, why: 'left as it was' })
    d.act({ type: 'desk/resume' })
    d.act({ type: 'desk/switch' })
    d.act({ type: 'desk/pause' })
    expect(goOnStep(d.s, true)).toEqual({ act: null, why: 'left as it was' })
    const off = desk()
    play(off)
    off.act({ type: 'desk/pause' })
    off.act({ type: 'settings/update', patch: { autoSwitch: { ...off.s.settings.autoSwitch, leaguePlay: false } } })
    expect(goOnStep(off.s, true)).toEqual({ act: null, why: 'the rule is off' })
  })

  it('deploys a League task in the flow apart from another task\'s rest', () => {
    const d = desk({ league: null })
    d.act({ type: 'entry/capture', text: 'dance: LoL ranked climb' })
    d.act({ type: 'desk/skip' })
    expect(d.s.desk.block?.kind).toBe('rest')
    expect(play(d)).toMatchObject({ why: 'switched', act: { type: 'desk/select', entryId: d.id('LoL ranked climb'), mode: 'pomodoro' } })
    expect(onDeskId(d.s)).toBe(d.id('LoL ranked climb'))
    expect(d.s.desk.block?.kind).toBe('focus')
    expect(d.s.desk.status).toBe('running')
  })

  it('does nothing from an idle desk, without a coin for the couch, with no League task, or with the rule off', () => {
    const idle = desk()
    idle.act({ type: 'desk/standDown' })
    expect(play(idle)).toMatchObject({ act: null, why: 'the desk is idle' })
    expect(idle.s.desk.status).toBe('idle')
    const broke = desk({ broke: true })
    expect(play(broke)).toMatchObject({ act: null, why: 'no coin for the couch' })
    expect(onDeskId(broke.s)).toBe(broke.id('beta'))
    // Paused on the League item with the last coin gone: not resumed only to end a tick later.
    const spent = desk()
    play(spent)
    spent.act({ type: 'desk/pause' })
    spent.act({ type: 'market/add', title: 'everything', price: 40 } as never)
    spent.act({ type: 'market/buy', id: spent.s.market[0].id } as never)
    expect(play(spent)).toMatchObject({ act: null, why: 'no coin for the couch' })
    expect(spent.s.desk.status).toBe('paused')
    const none = desk({ league: null })
    expect(play(none)).toEqual({ act: null, why: 'no task named League' })
    const off = desk()
    off.act({ type: 'settings/update', patch: { autoSwitch: { ...off.s.settings.autoSwitch, leaguePlay: false } } })
    expect(play(off)).toEqual({ act: null, why: 'the rule is off' })
    expect(onDeskId(off.s)).toBe(off.id('beta'))
  })

  it('needs no coin for a League task in the flow', () => {
    const d = desk({ broke: true, league: null })
    d.act({ type: 'entry/capture', text: 'dance: LoL ranked climb' })
    expect(play(d)).toMatchObject({ why: 'switched', to: 'LoL ranked climb' })
    expect(onDeskId(d.s)).toBe(d.id('LoL ranked climb'))
  })

  it('picks the League task you played last, then the couch list before the flow', () => {
    const d = desk()
    d.act({ type: 'entry/capture', text: 'dance: LoL ranked climb' })
    expect(leagueTasks(d.s).map((f) => (f.kind === 'entry' ? f.entry.title : f.item.title))).toEqual(['couch: league of legends 2026', 'LoL ranked climb'])
    d.act({ type: 'desk/select', entryId: d.id('LoL ranked climb'), ledgerId: d.s.entries.find((e) => e.title === 'LoL ranked climb')!.ledgerId })
    d.later(60_000)
    d.act({ type: 'desk/select', entryId: d.id('beta'), ledgerId: d.s.entries.find((e) => e.title === 'beta')!.ledgerId })
    expect(play(d)).toMatchObject({ why: 'switched', to: 'LoL ranked climb' })
  })

  it('holds the desk on the League task while it runs: an AI prompt or a stream brought to the front leaves it there', () => {
    const d = desk()
    play(d)
    expect(leagueHolds(d.s, true)).toBe(true)
    expect(leagueHolds(d.s, false)).toBe(false)
    const typed = { at: now, app: 'claude' as const, manual: true }
    expect(promptStep(d.s, typed, Infinity, leagueHolds(d.s, true))).toEqual({ act: null, why: 'your League match is running' })
    expect(promptStep(d.s, typed, Infinity, leagueHolds(d.s, false)).act).toEqual({ type: 'desk/switch' })
    const page = { title: 'xQc - Twitch', live: true }
    expect(openStep(d.s, 'here', page, { sinceFireMs: Infinity, leagueHeld: true })).toEqual({ act: null, why: 'your League match is running' })
    expect(openStep(d.s, 'here', page, { sinceFireMs: Infinity, leagueHeld: false }).act).toEqual({ type: 'desk/select', leisureId: d.stream })
    // Moved off it by hand (Alt+Q), the desk is yours: the rules run as ever.
    d.act({ type: 'desk/switch' })
    expect(leagueHolds(d.s, true)).toBe(false)
    expect(promptStep(d.s, typed, Infinity, leagueHolds(d.s, true)).act).toEqual({ type: 'desk/switch' })
    // With the rule off there is no hold.
    play(d)
    d.act({ type: 'settings/update', patch: { autoSwitch: { ...d.s.settings.autoSwitch, leaguePlay: false } } })
    expect(leagueHolds(d.s, true)).toBe(false)
  })
})

describe('the port, as the shell hears it', () => {
  /** Answers every LEAGUE_POLL_MS, open or shut, from a memory; the starts and ends by answer number. */
  function run(answers: boolean[], m: MatchMemory = NO_MATCH_YET) {
    const out: string[] = []
    answers.forEach((open, i) => {
      const step = matchStep(m, open, i * LEAGUE_POLL_MS)
      m = step.memory
      if (step.started) out.push(`start@${i}`)
      if (step.ended) out.push(`end@${i}`)
    })
    return { out, memory: m }
  }
  const shut = (ms: number) => Array.from({ length: Math.ceil(ms / LEAGUE_POLL_MS) }, () => false)

  it('starts a match when the port opens, the first answer included, and once', () => {
    expect(run([true, true, true]).out).toEqual(['start@0'])
    expect(run([false, false, true, true]).out).toEqual(['start@2'])
    expect(run([false, false]).memory.playing).toBe(false)
  })

  it('takes a match the last run saw a moment ago for the same one: a restart mid-match moves nothing', () => {
    const at = 10 * 60_000
    const first = (seenAt: number | null) => matchStep(NO_MATCH_YET, true, at, seenAt)
    expect(first(at - 40_000)).toMatchObject({ started: false, memory: { playing: true } })
    expect(first(at - LEAGUE_SAME_MS + 1)).toMatchObject({ started: false })
    // Seen long ago, never, or (a clock set back) in the future: a new match.
    expect(first(at - LEAGUE_SAME_MS)).toMatchObject({ started: true })
    expect(first(null)).toMatchObject({ started: true })
    expect(first(at + 60_000)).toMatchObject({ started: true })
    expect(first(at - 40_000).goesOn).toBe(true)
    expect(first(null).goesOn).toBe(false)
    // A connect that timed out while Mayorly was starting decides nothing: the next open answer goes on, no start.
    const shutFirst = matchStep(NO_MATCH_YET, false, at, at - 40_000)
    expect(shutFirst).toMatchObject({ started: false, ended: false, memory: { playing: null } })
    expect(matchStep(shutFirst.memory, true, at + LEAGUE_POLL_MS, at - 40_000)).toMatchObject({ started: false, goesOn: true })
    // Shut until the time is up: no match, and a later one is a start.
    const gone = matchStep(NO_MATCH_YET, false, at + LEAGUE_SAME_MS, at)
    expect(gone.memory.playing).toBe(false)
    expect(matchStep(gone.memory, true, at + LEAGUE_SAME_MS + LEAGUE_POLL_MS, at).started).toBe(true)
    // Only the first answer after a launch is asked: later starts are starts.
    const over = run([true, ...shut(LEAGUE_END_MS + LEAGUE_POLL_MS)], NO_MATCH_YET).memory
    expect(matchStep(over, true, at, at - 1000).started).toBe(true)
  })

  it('ends it only once the port has stayed shut, so a failed connect mid-match is no second start', () => {
    expect(run([true, false, false, true, true]).out).toEqual(['start@0'])
    const r = run([true, ...shut(LEAGUE_END_MS), false])
    expect(r.out).toEqual(['start@0', `end@${Math.ceil(LEAGUE_END_MS / LEAGUE_POLL_MS) + 1}`])
    expect(r.memory.playing).toBe(false)
    // The next match is a new start.
    expect(run([true, ...shut(LEAGUE_END_MS + LEAGUE_POLL_MS), true]).out).toEqual(['start@0', `end@${Math.ceil(LEAGUE_END_MS / LEAGUE_POLL_MS) + 1}`, `start@${Math.ceil(LEAGUE_END_MS / LEAGUE_POLL_MS) + 2}`])
  })
})
