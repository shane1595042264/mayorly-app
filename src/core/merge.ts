import type { Id, MayorlyState } from './model'
import { CLERK_LOG_CAP } from './rules'
import { reconcileTomatoes } from './accounting'

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
    const chosen = (l.endedAt !== null) !== (t.endedAt !== null) ? (l.endedAt !== null ? l : t) : (l.focusMs >= t.focusMs ? l : t)
    const keys = new Set([...Object.keys(l.ledgerTomatoes ?? {}), ...Object.keys(t.ledgerTomatoes ?? {})])
    return { ...chosen, ledgerTomatoes: Object.fromEntries([...keys].map(key => [key, Math.max(l.ledgerTomatoes?.[key] ?? 0, t.ledgerTomatoes?.[key] ?? 0)])) }
  }, (x) => x.startedAt)
  const segments = unionLogs(local.segments, incoming.segments, (l, t) => (l.end !== null ? l : t), (x) => x.start)
  const tokens = unionLogs(local.tokens, incoming.tokens, (l) => l, (x) => x.at)
  // A restore counts as a making: an entry put back since the last sync is kept, like a new one.
  const merged = mergeDeletable(local.entries, incoming.entries, since, (e) => Math.max(e.createdAt, e.restoredAt ?? 0), (l, t) => {
    const history = unionLogs(l.history ?? [], t.history ?? [], (l) => l, e => e.at)
    const latest = (e: typeof l) => Math.max(e.doneAt ?? 0, ...(e.history ?? []).map(h => h.at))
    const chosen = latest(l) !== latest(t) ? (latest(l) > latest(t) ? l : t)
      : (l.doneAt !== null) !== (t.doneAt !== null) ? (l.doneAt !== null ? l : t)
      : l.tomatoes !== t.tomatoes ? (l.tomatoes > t.tomatoes ? l : t) : t
    return { ...chosen, history }
  })
  // The trash is a log: the later deletion of an id wins. A live entry restored after that
  // deletion stays live and leaves the trash; otherwise the trash takes it off the list.
  const trashAll = unionLogs(local.trash, incoming.trash, (l, t) => (l.deletedAt >= t.deletedAt ? l : t), (x) => x.deletedAt)
  const deletedAt = new Map(trashAll.map((t) => [t.id, t.deletedAt]))
  const entries = merged.filter((e) => !deletedAt.has(e.id) || (e.restoredAt ?? 0) > deletedAt.get(e.id)!)
  const live = new Set(entries.map((e) => e.id))
  const trash = trashAll.filter((t) => !live.has(t.id))
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
  const calendar = { events, feeds, external, blocks: newerPlan.blocks, overflow: newerPlan.overflow, plannedAt: newerPlan.plannedAt, horizonEnd: newerPlan.horizonEnd, plannedMode: newerPlan.plannedMode }
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
  return reconcileTomatoes({ ...incoming, ledgers, entries, trash, supersets, leisure, houseRules, sittings, segments, tokens, clerkLog, desk, calendar })
}
