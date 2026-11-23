import { balance, COUCH_COINS_PER_TOMATO, onDeskId, recentTasks, switchToAction, type Action, type FoundTask, type Id, type MayorlyState } from '../core/index'
import type { PromptStep } from './aiswitch'
import { isWatched, STREAM, type WatchTask } from './streamdeath'

// A League match of your own is the League task. When one starts on this computer (the game serves
// its Live Client Data API on 127.0.0.1:2999 while a match is loaded, and only then; the shell polls
// it, main/leaguewatch.ts), the task named League goes on the desk, as a pick of it would. While the
// match runs, the rules that move the desk on their own (an AI prompt, a stream brought to the front)
// leave it there; your own Alt+Q or pick still moves it. Pure: the shell feeds it what the port said
// and applies what it returns.

/** How often the shell asks the port, and how long it must stay shut before the match is over. */
export const LEAGUE_POLL_MS = 3000
export const LEAGUE_END_MS = 15_000

/** A name that says League: League of Legends, League, LoL, 英雄联盟. */
const LEAGUE_TITLE = /league of legends|\bleague\b|\blol\b|英雄联盟|英雄聯盟|리그 오브 레전드/i

/**
 * A task you play League on: its name says League, and it watches no stream. "watch LCK league",
 * or a task whose rules say the streamer dies, is a League stream watched, not a game of yours.
 */
export function isLeagueTask(t: WatchTask): boolean {
  return LEAGUE_TITLE.test(t.title) && !STREAM.test(t.title) && !isWatched(t)
}

const idOf = (f: FoundTask): Id => (f.kind === 'entry' ? f.entry.id : f.item.id)
const nameOf = (f: FoundTask): string => (f.kind === 'entry' ? f.entry.title : f.item.title)
const rank = (order: Id[], id: Id) => {
  const i = order.indexOf(id)
  return i < 0 ? Number.MAX_SAFE_INTEGER : i
}

/** The open tasks named League, the one worked on last first; ones never worked on after, the couch list before the flow. */
export function leagueTasks(s: MayorlyState): FoundTask[] {
  const tasks: FoundTask[] = [
    ...s.leisure.filter((l) => l.archivedAt === null && isLeagueTask(l)).map((item) => ({ kind: 'leisure' as const, item })),
    ...s.entries.filter((e) => e.doneAt === null && isLeagueTask(e)).map((entry) => ({ kind: 'entry' as const, entry })),
  ]
  if (tasks.length < 2) return tasks
  const recent = recentTasks(s, 50).map(idOf)
  return tasks
    .map((f, i) => ({ f, i }))
    .sort((a, b) => rank(recent, idOf(a.f)) - rank(recent, idOf(b.f)) || a.i - b.i)
    .map((x) => x.f)
}

/** The desk is on a task named League while a match of yours runs, with the rule on: the rules that switch on their own leave it there. */
export function leagueHolds(s: MayorlyState, playing: boolean): boolean {
  if (!playing || !s.settings.autoSwitch.leaguePlay) return false
  const id = onDeskId(s)
  const t = id ? (s.entries.find((e) => e.id === id) ?? s.leisure.find((l) => l.id === id)) : undefined
  return !!t && isLeagueTask(t)
}

/**
 * A League match of yours just started here: onto the task named League (the one played last), as
 * a pick of it would. One already on the desk but paused or waiting runs again, and one behind its
 * own rest comes back from it, running (desk/skipRest, as Option+R does). From another task's rest
 * or from a superset it is a sitting of its own, the work parked behind it for Alt+Q: a swap into
 * the rest, or into the superset's slot, would hand the desk back to the work when that ends, while
 * the match goes on. Not from an idle desk: with nothing running you are not keeping time, and the
 * couch would charge for it. The couch runs only with a coin in hand, so nothing is switched or
 * resumed that the desk would refuse or end at once. The shell acts it (a match is you, at this
 * computer), so it takes the desk from another device as a pick would.
 */
export function playStep(s: MayorlyState): PromptStep & { to?: string } {
  if (!s.settings.autoSwitch.leaguePlay) return { act: null, why: 'the rule is off' }
  const [pick] = leagueTasks(s)
  if (!pick) return { act: null, why: 'no task named League' }
  const to = nameOf(pick)
  const d = s.desk
  if (d.status === 'idle' || !d.block) return { act: null, why: 'the desk is idle', to }
  if (pick.kind === 'leisure' && balance(s) < COUCH_COINS_PER_TOMATO) return { act: null, why: 'no coin for the couch', to }
  const resting = d.block.kind === 'rest'
  if (onDeskId(s) === idOf(pick)) {
    if (resting) return { act: { type: 'desk/skipRest' }, why: 'back from its rest', to }
    if (d.status === 'running') return { act: null, why: 'already there', to }
    return { act: { type: 'desk/resume' }, why: 'resumed', to }
  }
  if (resting || d.plan?.mode === 'superset') {
    const act: Action = pick.kind === 'leisure' ? { type: 'desk/select', leisureId: pick.item.id, mode: 'couch' } : { type: 'desk/select', entryId: pick.entry.id, ledgerId: pick.entry.ledgerId, mode: 'pomodoro' }
    return { act, why: 'switched', to }
  }
  const act = switchToAction(s, pick)
  return act ? { act, why: 'switched', to } : { act: null, why: 'already there', to }
}

/** What the shell remembers of the port: whether a match is on (null before the first answer), and since when the port has been shut. */
export interface MatchMemory {
  playing: boolean | null
  closedSince: number | null
}

export const NO_MATCH_YET: MatchMemory = { playing: null, closedSince: null }

/** A match the last run of Mayorly saw this recently, open again at the first answer after a launch, is the same match. */
export const LEAGUE_SAME_MS = 180_000

/**
 * One answer of the port. A match starts the moment it is open and was not; it is over once the
 * port has been shut for LEAGUE_END_MS, so a connect that fails once under load never makes a
 * second start. The first answer after a launch starts one too (Mayorly opened mid-match), unless
 * the last run saw the port open within LEAGUE_SAME_MS (`seenAt`, kept beside the save): then
 * Mayorly only restarted (an update, mid-match) and the match goes on, so a desk you moved off
 * League yourself, or paused, is left as you left it.
 */
export function matchStep(m: MatchMemory, open: boolean, now: number, seenAt: number | null = null): { memory: MatchMemory; started: boolean; ended: boolean } {
  if (open && m.playing === null && seenAt !== null && now - seenAt >= 0 && now - seenAt < LEAGUE_SAME_MS) return { memory: { playing: true, closedSince: null }, started: false, ended: false }
  if (open) return { memory: { playing: true, closedSince: null }, started: m.playing !== true, ended: false }
  if (m.playing !== true) return { memory: { playing: false, closedSince: null }, started: false, ended: false }
  const since = m.closedSince ?? now
  if (now - since >= LEAGUE_END_MS) return { memory: { playing: false, closedSince: null }, started: false, ended: true }
  return { memory: { playing: true, closedSince: since }, started: false, ended: false }
}
