import type { Id, MayorlyState } from './model'
import { CLERK_LOG_CAP } from './rules'

// Two copies of one account's state, this machine's and the server's, become one without
// losing work. Sittings, segments and coins are append-only, so their union is the truth.
// Things that can be deleted (entries, ledgers, supersets, leisure, house rules) take the
// server's version when both have them; this machine's own are kept when it made them since
// its last sync, and dropped when they are older than that, because then they were deleted
// elsewhere. The desk belongs to the machine that is running it.

type WithId = { id: Id }

function unionLogs<T extends WithId>(mine: T[], theirs: T[], prefer: (m: T, t: T) => T, at: (x: T) => number): T[] {
  const m = new Map(mine.map((x) => [x.id, x]))
  for (const t of theirs) {
    const l = m.get(t.id)
    m.set(t.id, l ? prefer(l, t) : t)
  }
  return [...m.values()].sort((a, b) => at(a) - at(b))
}

function mergeDeletable<T extends WithId>(mine: T[], theirs: T[], since: number, createdAt: (x: T) => number, prefer: (m: T, t: T) => T): T[] {
  const m = new Map(mine.map((x) => [x.id, x]))
  const theirIds = new Set(theirs.map((x) => x.id))
  const out = theirs.map((t) => {
    const l = m.get(t.id)
    return l ? prefer(l, t) : t
  })
  for (const l of mine) if (!theirIds.has(l.id) && createdAt(l) >= since) out.push(l)
  return out
}

/** The server's document and this machine's state as one. `syncedAt` is when this machine last matched the server, or null if never. */
export function mergeStates(local: MayorlyState, incoming: MayorlyState, syncedAt: number | null): MayorlyState {
  const since = syncedAt ?? 0
  const theirs = <T>(_l: T, t: T) => t
  const sittings = unionLogs(local.sittings, incoming.sittings, (l, t) => {
    if ((l.endedAt !== null) !== (t.endedAt !== null)) return l.endedAt !== null ? l : t
    return l.focusMs >= t.focusMs ? l : t
  }, (x) => x.startedAt)
  const segments = unionLogs(local.segments, incoming.segments, (l, t) => (l.end !== null ? l : t), (x) => x.start)
  const tokens = unionLogs(local.tokens, incoming.tokens, (l) => l, (x) => x.at)
  const entries = mergeDeletable(local.entries, incoming.entries, since, (e) => e.createdAt, (l, t) => {
    if ((l.doneAt !== null) !== (t.doneAt !== null)) return l.doneAt !== null ? l : t
    if (l.tomatoes !== t.tomatoes) return l.tomatoes > t.tomatoes ? l : t
    return t
  })
  const ledgers = mergeDeletable(local.ledgers, incoming.ledgers, since, (l) => l.createdAt, theirs)
  const leisure = mergeDeletable(local.leisure, incoming.leisure, since, (l) => l.createdAt, theirs)
  const houseRules = mergeDeletable(local.houseRules, incoming.houseRules, since, (r) => r.createdAt, theirs)
  // Supersets carry no date: one only this machine has is kept.
  const supersets = mergeDeletable(local.supersets, incoming.supersets, since, () => Infinity, theirs)
  // The calendar: events and feeds like entries; outside events per feed, the fresher fetch wins;
  // blocks and overflow are derived and the next replan here rewrites them anyway.
  const lc = local.calendar
  const ic = incoming.calendar
  const events = mergeDeletable(lc.events, ic.events, since, (e) => e.createdAt, (l, t) => (l.seq >= t.seq ? l : t))
  const feeds = mergeDeletable(lc.feeds, ic.feeds, since, (f) => f.createdAt, (l, t) => ((l.lastFetchedAt ?? 0) >= (t.lastFetchedAt ?? 0) ? l : t))
  const feedIds = new Set(feeds.map((f) => f.id))
  const fresherHere = new Set(feeds.filter((f) => lc.feeds.some((x) => x.id === f.id && (x.lastFetchedAt ?? 0) >= (ic.feeds.find((y) => y.id === f.id)?.lastFetchedAt ?? 0))).map((f) => f.id))
  const external = [...lc.external.filter((x) => feedIds.has(x.feedId) && fresherHere.has(x.feedId)), ...ic.external.filter((x) => feedIds.has(x.feedId) && !fresherHere.has(x.feedId))]
  const newerPlan = (lc.plannedAt ?? 0) >= (ic.plannedAt ?? 0) ? lc : ic
  const calendar = { events, feeds, external, blocks: newerPlan.blocks, overflow: newerPlan.overflow, plannedAt: newerPlan.plannedAt, horizonEnd: newerPlan.horizonEnd }
  const seen = new Set<string>()
  const clerkLog = [...incoming.clerkLog, ...local.clerkLog]
    .filter((x) => {
      const k = `${x.at}|${x.text}`
      if (seen.has(k)) return false
      seen.add(k)
      return true
    })
    .sort((a, b) => a.at - b.at)
    .slice(-CLERK_LOG_CAP)
  const desk = local.desk.status === 'running' ? local.desk : incoming.desk
  return { ...incoming, ledgers, entries, supersets, leisure, houseRules, sittings, segments, tokens, clerkLog, desk, calendar }
}
