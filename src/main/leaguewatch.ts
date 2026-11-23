import { readFileSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { connect } from 'node:net'
import { onDeskId, type Id } from '@core/index'
import type { ClerkNotice } from '../shared/bridge'
import { goOnStep, LEAGUE_POLL_MS, LEAGUE_SAME_MS, leagueRunning, matchStep, NO_MATCH_YET, playAll, type MatchMemory } from '../shared/leagueplay'
import type { Engine } from './engine'
import { log } from './log'

// A League match of your own, seen the way League lets apps see one: while a match is loaded (a
// game, a spectated one, a replay) the game serves its Live Client Data API on 127.0.0.1:2999, and
// only then. A connect there answers in a few milliseconds, on Windows and macOS alike. Until 0.1.93
// the process list was the other half, but on the founder's PC (744 processes) tasklist takes over
// 25 s, so it hit its 3 s timeout every time and never saw a match. Asked every LEAGUE_POLL_MS: the
// stream rule's guard reads the answer, and a match starting puts the League task on the desk
// (shared/leagueplay.ts).

let cache: { at: number; value: boolean } | null = null
let going: Promise<boolean> | null = null
/** How long an answer holds for the stream rule's guard; the poll renews it every few seconds. */
const FRESH_MS = 10_000

/** The last answer, while it is fresh; null when there is none. */
export function ownLeagueMatchNow(): boolean | null {
  return cache && Date.now() - cache.at < FRESH_MS ? cache.value : null
}

/** Whether a League match of yours is running: the game's Live Client Data API answering on 2999. One ask at a time, kept 2 s. */
export function ownLeagueMatch(): Promise<boolean> {
  if (cache && Date.now() - cache.at < 2000) return Promise.resolve(cache.value)
  if (going) return going
  going = portOpen()
    .then((value) => {
      cache = { at: Date.now(), value }
      return value
    })
    .finally(() => {
      going = null
    })
  return going
}

function portOpen(): Promise<boolean> {
  return new Promise((resolve) => {
    const sock = connect(2999, '127.0.0.1')
    const done = (v: boolean) => {
      sock.destroy()
      resolve(v)
    }
    sock.once('connect', () => done(true))
    sock.once('error', () => done(false))
    // Generous: a launch keeps the main thread busy, and a timeout is read as no match.
    sock.setTimeout(1000, () => done(false))
  })
}

export interface LeagueRule {
  start(): void
  stop(): void
  /** A match of yours is on, as last heard (the last LEAGUE_END_MS after it included). */
  playing(): boolean
}

export function leagueRule(o: {
  engine: Engine
  say: (n: ClerkNotice) => void
  /** The name of a task, short, for a notice. */
  title: (id: Id | null) => string
  /** When an automatic rule last switched the desk, so the stream rule does not take this switch for yours. */
  auto: { at: number }
  /**
   * Where the last time the port was seen open is kept, and whether the League task was running
   * then (league.json beside the save, this computer only), so a restart mid-match is the same match
   * and not a new one, and a League task the launch paused runs on. Null keeps nothing.
   */
  file: string | null
}): LeagueRule {
  const { engine } = o
  let memory: MatchMemory = NO_MATCH_YET
  let timer: NodeJS.Timeout | null = null
  let asking = false
  let stopped = false
  // The last run's word: when it last saw the port open, and whether the League task was running then.
  let seenAt: number | null = null
  let wasRunning = false
  try {
    const j = o.file ? (JSON.parse(readFileSync(o.file, 'utf8')) as { openAt?: unknown; running?: unknown }) : null
    if (j && typeof j.openAt === 'number' && Number.isFinite(j.openAt)) seenAt = j.openAt
    wasRunning = j?.running === true
  } catch {
    // No file yet, or a torn one: no match seen.
  }
  // Written while the port is open: every 15 s, and at once when the League task starts or stops
  // running, so the word a restart reads is at most a poll old.
  let kept: { at: number; running: boolean } | null = null
  const keep = (now: number) => {
    if (!o.file) return
    const running = leagueRunning(engine.state)
    if (kept && kept.running === running && now - kept.at < LEAGUE_SAME_MS / 12) return
    kept = { at: now, running }
    void writeFile(o.file, JSON.stringify({ openAt: now, running })).catch((err) => log.warn('[league]', `not kept: ${err instanceof Error ? err.message : String(err)}`))
  }

  const why = { cause: 'game' as const, via: 'Your League match started' }

  const started = (now: number) => {
    const steps = playAll(engine.state, (a, step) => {
      o.auto.at = now
      engine.act(a, { ...why, detail: step.to ? `the task named League: ${step.to}` : undefined })
      return engine.state
    })
    const acted = steps.filter((x) => x.act)
    const last = steps[steps.length - 1]
    log.info('[league]', `your match started: ${(acted.length ? acted : steps).map((x) => x.why).join(', then ')}${last?.to ? ` (${last.to})` : ''}`)
    if (acted.length) o.say({ phase: 'done', text: `League match: on ${o.title(onDeskId(engine.state))}` })
    else if (last?.why === 'no coin for the couch') o.say({ phase: 'done', text: 'League match: no coin for the couch' })
  }

  // Mayorly restarted mid-match: the League task the launch paused runs on; anything else stays.
  const goOn = (now: number) => {
    const step = goOnStep(engine.state, wasRunning)
    log.info('[league]', `your match went on while Mayorly restarted: ${step.why}${step.to ? ` (${step.to})` : ''}`)
    if (!step.act) return
    o.auto.at = now
    engine.act(step.act, { cause: 'game', via: 'Your League match went on', detail: 'Mayorly restarted mid-match' })
    o.say({ phase: 'done', text: `League match: on ${o.title(onDeskId(engine.state))}` })
  }

  const poll = async () => {
    if (asking) return
    asking = true
    try {
      const open = await ownLeagueMatch()
      if (stopped) return
      const now = Date.now()
      const step = matchStep(memory, open, now, seenAt)
      memory = step.memory
      if (step.ended) log.info('[league]', 'your match is over')
      if (step.goesOn) goOn(now)
      if (step.started) started(now)
      if (open) keep(now)
    } catch (err) {
      log.warn('[league]', `not acted on: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      asking = false
    }
  }

  return {
    start() {
      if (timer || stopped) return
      void poll()
      timer = setInterval(() => void poll(), LEAGUE_POLL_MS)
    },
    stop() {
      stopped = true
      if (timer) clearInterval(timer)
      timer = null
    },
    playing: () => memory.playing === true,
  }
}
