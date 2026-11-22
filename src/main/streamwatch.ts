import { execFile } from 'node:child_process'
import { appendFile, rename, stat } from 'node:fs/promises'
import { connect } from 'node:net'
import { onDeskId, type Action, type Id } from '@core/index'
import type { ClerkNotice } from '../shared/bridge'
import {
  deathStep,
  graceStep,
  HELLO_MS,
  leagueFeatures,
  leagueOf,
  leagueStep,
  learningWhy,
  pickTab,
  streamArm,
  streamPostOf,
  TAB_STALE_MS,
  LEAGUE,
  type DeathMemory,
  type DeathTick,
  type StreamArm,
  type StreamGrid,
  type StreamReply,
  type StreamStatus,
  type StreamWord,
  type TabSeen,
} from '../shared/streamdeath'
import type { Engine } from './engine'
import { log } from './log'

// The shell of the stream rule (shared/streamdeath.ts): it hears the stream eye's posts through the
// agents listener, answers each with whether to read the video, keeps one detector per tab, and
// on a death does the quick switch, after checking that no League match of your own is running.
// The switch is dispatched, not acted: a death proves nobody is at this computer, so it never
// claims the desk from a phone or laptop that took it over a moment ago. Logs what it sees at each
// death, near miss and switch by hand, so the numbers can be tuned.

export interface StreamRule {
  onStream(post: unknown): StreamReply
  start(): void
  stop(): void
  /** Your own switch right after a death switched you is let go (graceStep). */
  grace(a: Action): { drop: boolean; why: string }
  status(): StreamStatus
}

interface Tab {
  seen: TabSeen
  memory: DeathMemory | null
  grid: StreamGrid | null
  tick: DeathTick | null
  /** A death switched away from it with muting on: the next answer asks the eye to mute. */
  mute: boolean
  /** The eye was asked to mute it, for this task: the answer says unmute once the desk is back on that task, or the rule or muting is off. */
  mutedFor: Id | null
  /** The last minute of what was read, for the trace. */
  trail: { at: number; seen: string; grid: StreamGrid | null; ad: boolean }[]
}

const OFF: StreamReply = { armed: false, every: HELLO_MS }
/** How much of the trail a trace keeps, and how big the trace file may grow before it starts over. */
const TRAIL_MS = 60_000
const TRACE_MAX = 20 * 1024 * 1024

export function streamRule(o: {
  engine: Engine
  say: (n: ClerkNotice) => void
  send: (channel: string, payload: unknown) => void
  statusChannel: string
  /** The name of a task, short, for a notice. */
  title: (id: Id | null) => string
  /** When an automatic rule (this one or the AI prompt rule) last switched the desk, so a switch then is not taken for yours. */
  auto: { at: number }
  /**
   * The file a trace goes to: the last minute of numbers read from the stream (never a picture),
   * written when a death switches and when you leave a watched stream yourself, so the rule can be
   * tuned on real deaths. Null keeps none.
   */
  traceFile: string | null
}): StreamRule {
  const { engine } = o
  const tabs = new Map<string, Tab>()
  let started = false
  let fired: { at: number; taskId: Id; tab: string } | null = null
  let firing = false
  let lastArm = ''
  let armedSince: number | null = null
  let heard = false
  let nudged = false
  let lastNear = 0
  let lastCost = 0
  let lastDesk: Id | null = null
  let lastStatus = ''
  const tainted = new Set<string>()
  let seen: { at: number; text: string; phase: string; tab: string } | null = null
  let timer: NodeJS.Timeout | null = null
  let offAction: (() => void) | null = null
  let offState: (() => void) | null = null

  const arm = (): StreamArm => streamArm(engine.state, engine.deviceId)

  // A line when the rule starts watching, and when it stops (or cannot start) for a task that has a watched rule.
  const noteArm = (a: StreamArm, now: number) => {
    const key = a.on ? `on:${a.taskId}` : `off:${a.why}`
    if (a.on) armedSince ??= now
    else armedSince = null
    if (key === lastArm) return
    const was = lastArm
    lastArm = key
    if (a.on) log.info('[stream]', `on: ${o.title(a.taskId ?? null)}, rule "${a.cue}"`)
    else if (was.startsWith('on:') || a.cue) log.info('[stream]', `off: ${a.why}`)
  }

  const tabList = () => [...tabs.values()].map((t) => t.seen)

  const status = (): StreamStatus => {
    const a = arm()
    if (!a.taskId || !a.cue) return { taskId: null, word: null }
    if (!a.on) return a.why === 'the rule is off' ? { taskId: a.taskId, word: 'Off in Settings' } : { taskId: null, word: null }
    const now = Date.now()
    const recent = tabList().filter((t) => now - t.at <= TAB_STALE_MS)
    const word = (w: StreamWord): StreamStatus => ({ taskId: a.taskId as Id, word: w })
    if (!recent.length) return word('No stream seen')
    const pick = pickTab(recent, a.title ?? '', now)
    if (!pick) {
      const shown = recent.filter((t) => t.visible)
      return word(!shown.length ? 'Stream hidden' : shown.some((t) => t.tainted && t.league !== false) ? 'Stream cannot be read' : 'Not League')
    }
    const m = tabs.get(pick.tab)?.memory
    if (!m || m.phase === 'learning') return word(m && learningWhy(m) === 'no minimap' ? 'No minimap in view' : 'Learning the stream')
    return word(m.phase === 'dead' ? 'Streamer is down' : 'Watching the stream')
  }

  const pushStatus = () => {
    if (!started) return
    const s = status()
    const key = `${s.taskId}:${s.word}`
    if (key === lastStatus) return
    lastStatus = key
    o.send(o.statusChannel, s)
  }

  // The last minute read from a tab, to the trace file, with why: a death that switched, or you leaving the stream yourself.
  const trace = (tab: Tab | undefined, why: string) => {
    if (!o.traceFile || !tab || !tab.trail.length) return
    const b64 = (x: Uint8Array) => Buffer.from(x).toString('base64')
    const line = JSON.stringify({
      at: new Date().toISOString(),
      why,
      site: tab.seen.site,
      category: tab.seen.category,
      samples: tab.trail.map((t) => ({ at: t.at, ad: t.ad, seen: t.seen, grid: t.grid && { c: b64(t.grid.chroma), l: b64(t.grid.luma), t: b64(t.grid.lit) } })),
    })
    const file = o.traceFile
    void (async () => {
      try {
        const size = await stat(file).then((x) => x.size, () => 0)
        if (size > TRACE_MAX) await rename(file, `${file}.old`)
        await appendFile(file, line + '\n')
      } catch (err) {
        log.warn('[stream]', `no trace: ${err instanceof Error ? err.message : String(err)}`)
      }
    })()
  }

  const fire = async (tick: DeathTick, a: StreamArm, site: string, tabId: string) => {
    if (firing) return
    firing = true
    try {
      const own = await ownLeagueMatch()
      const step = deathStep(engine.state, engine.deviceId, { ownMatch: own, sinceFireMs: fired ? Date.now() - fired.at : Infinity })
      log.info('[stream]', `death on ${site}: ${tick.seen}; ${step.why}`)
      if (!step.act) return
      o.auto.at = Date.now()
      fired = { at: o.auto.at, taskId: a.taskId as Id, tab: tabId }
      engine.dispatch(step.act, { cause: 'stream', via: `Streamer died on ${site} (rule: ${a.cue})`, detail: tick.seen })
      // Muted only when the switch took you off this stream (not onto another task that watches it).
      const tab = tabs.get(tabId)
      const now = arm()
      const still = now.on && pickTab(tabList(), now.title ?? '', Date.now())?.tab === tabId
      if (tab && engine.state.settings.autoSwitch.streamMute && !still) {
        tab.mute = true
        tab.mutedFor = a.taskId as Id
      }
      o.say({ phase: 'done', text: `Streamer died: on ${o.title(onDeskId(engine.state))}` })
      trace(tab, `death: ${tick.seen}`)
    } catch (err) {
      log.warn('[stream]', `death not acted on: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      firing = false
      pushStatus()
    }
  }

  const onStream = (raw: unknown): StreamReply => {
    if (!started) return OFF
    const p = streamPostOf(raw)
    if (!p) return OFF
    const now = Date.now()
    heard = true
    const prev = tabs.get(p.tab)
    const league = leagueOf(p.category, p.title)
    const tab: Tab = prev ?? { seen: null as unknown as TabSeen, memory: null, grid: null, tick: null, mute: false, mutedFor: null, trail: [] }
    tab.seen = { tab: p.tab, site: p.site, title: p.title, category: p.category, league, visible: p.visible, active: p.active, area: p.area, tainted: p.kind === 'tainted', at: now }
    tabs.set(p.tab, tab)
    for (const [k, t] of tabs) if (now - t.seen.at > LEAGUE.forgetMs) tabs.delete(k)

    // A death just switched away from this tab: mute it now, if muting is on. Once the desk is back
    // on that task, or the rule or muting is off, say unmute; a tab armed again needs no mute.
    const answer = (r: StreamReply): StreamReply => {
      const st = engine.state.settings.autoSwitch
      if (tab.mute && !r.armed) {
        tab.mute = false
        log.info('[stream]', `muting ${p.site}`)
        return { ...r, mute: true }
      }
      tab.mute = false
      const holds = tab.mutedFor !== null || p.held
      if (holds && (r.armed || (tab.mutedFor !== null && onDeskId(engine.state) === tab.mutedFor) || !st.streamDeath || !st.streamMute)) {
        tab.mutedFor = null
        log.info('[stream]', `unmuting ${p.site}`)
        return { ...r, mute: false }
      }
      return r
    }
    const a = arm()
    noteArm(a, now)
    if (!a.on) {
      pushStatus()
      return answer(OFF)
    }
    if (p.kind === 'tainted') {
      if (!tainted.has(p.site)) log.info('[stream]', `${p.site}: the page will not let its video be read`)
      tainted.add(p.site)
      pushStatus()
      return answer(OFF)
    }
    const pick = pickTab(tabList(), a.title ?? '', now)
    if (!pick || pick.tab !== p.tab) {
      pushStatus()
      return answer(OFF)
    }
    if (p.cost !== null && (lastCost === 0 || now - lastCost > 10 * 60_000)) {
      lastCost = now
      log.info('[stream]', `cost: ${p.cost} ms a frame in Chrome on ${p.site}`)
    }
    // Twice a second; once a second if reading a frame costs the page more than 25 ms.
    const every = p.cost !== null && p.cost > 25 ? 1000 : 500
    if (p.kind === 'hello' && !p.ad) {
      pushStatus()
      return answer({ armed: true, every })
    }
    const f = p.grid ? leagueFeatures(p.grid, tab.grid, now) : null
    if (p.grid) tab.grid = p.grid
    const was = tab.memory?.phase ?? null
    const tick = leagueStep(tab.memory, f, { ad: p.ad }, now)
    tab.memory = tick.memory
    tab.tick = tick
    tab.trail.push({ at: now, seen: tick.seen, grid: p.grid, ad: p.ad })
    while (tab.trail.length && now - tab.trail[0].at > TRAIL_MS) tab.trail.shift()
    seen = { at: now, text: tick.seen, phase: tick.memory.phase, tab: p.tab }
    if (tick.event === 'learned') log.info('[stream]', `learned ${p.site}${p.category ? ` (${p.category})` : ''}: ${tick.seen}`)
    else if (tick.event === 'reset') log.info('[stream]', `another scene on ${p.site}: learning again`)
    else if (tick.event === 'respawn') log.info('[stream]', `back up: ${tick.seen}`)
    else if (tick.near && now - lastNear > 60_000) {
      lastNear = now
      log.info('[stream]', `near: ${tick.seen}`)
    }
    if (tick.event === 'death') void fire(tick, a, p.site, p.tab)
    if (was !== tick.memory.phase) pushStatus()
    return answer({ armed: true, every })
  }

  // Ground truth for tuning: you left a watched stream yourself (with what the detector saw just
  // then), or went back to it soon after a death switched you away (a death that was not one).
  const onAction = (action: Action, changed: boolean) => {
    if (!changed) return
    const now = Date.now()
    const desk = onDeskId(engine.state)
    if (desk !== lastDesk) {
      const left = lastDesk
      lastDesk = desk
      const byHand = !firing && now - o.auto.at > 1500 && (action.type === 'desk/switch' || action.type === 'desk/select' || action.type === 'desk/deploy')
      if (byHand && left && lastArm === `on:${left}` && seen && now - seen.at < 3000) {
        log.info('[stream]', `by hand: ${seen.text}`)
        trace(tabs.get(seen.tab), `by hand: ${seen.text}`)
      }
      if (byHand && fired && desk === fired.taskId && now - fired.at < 8000) log.info('[stream]', `undone: back on the stream ${((now - fired.at) / 1000).toFixed(1)} s after a death switched`)
    }
    pushStatus()
  }

  return {
    onStream,
    start() {
      if (started) return
      started = true
      lastDesk = onDeskId(engine.state)
      offAction = engine.onAction(onAction)
      offState = engine.on(() => pushStatus())
      // Tabs go quiet without saying so; and a rule armed for a minute with nothing heard at all
      // most likely means the extension in Chrome is the one from before this update.
      timer = setInterval(() => {
        const a = arm()
        noteArm(a, Date.now())
        if (a.on && !heard && !nudged && armedSince !== null && Date.now() - armedSince > 60_000) {
          nudged = true
          log.info('[stream]', 'armed a minute and no stream heard from')
          o.say({ phase: 'done', text: 'No stream seen. If one plays in Chrome, reload the Mayorly extension in chrome://extensions, then the stream page' })
        }
        pushStatus()
      }, 5000)
      pushStatus()
    },
    stop() {
      started = false
      if (timer) clearInterval(timer)
      offAction?.()
      offState?.()
    },
    grace(a: Action) {
      return graceStep(a, engine.state, fired, Date.now())
    },
    status,
  }
}

let ownCache: { at: number; value: boolean } | null = null
let ownTimed = false

/**
 * A League match of your own is running: the game's process is up (Windows), or its Live Client
 * Data API answers on 127.0.0.1:2999, which it serves only during a match. Cached for 10 s.
 */
export async function ownLeagueMatch(): Promise<boolean> {
  if (ownCache && Date.now() - ownCache.at < 10_000) return ownCache.value
  const t0 = Date.now()
  const port = new Promise<boolean>((resolve) => {
    const sock = connect(2999, '127.0.0.1')
    const done = (v: boolean) => {
      sock.destroy()
      resolve(v)
    }
    sock.once('connect', () => done(true))
    sock.once('error', () => done(false))
    sock.setTimeout(400, () => done(false))
  })
  const proc =
    process.platform === 'win32'
      ? new Promise<boolean>((resolve) =>
          execFile('tasklist', ['/FI', 'IMAGENAME eq League of Legends.exe', '/FO', 'CSV', '/NH'], { windowsHide: true, timeout: 3000 }, (err, out) => resolve(!err && /league of legends\.exe/i.test(String(out)))),
        )
      : Promise.resolve(false)
  const [a, b] = await Promise.all([port, proc])
  if (!ownTimed) {
    ownTimed = true
    log.info('[stream]', `own match check: ${Date.now() - t0} ms`)
  }
  ownCache = { at: Date.now(), value: a || b }
  return a || b
}
