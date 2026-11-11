import { blockEndsAt, reduce, type Block, type MayorlyState } from '@core/index'

// Every block end from now on, as the desk will really run it: the reducer is run forward,
// tick by tick at each block's end, so auto-start, rests, rounds and a sitting that ends all
// come out as they will. Pure, so it can be tested; notify.ts turns these into notifications.

const MAX = 12
const HORIZON_MS = 12 * 3_600_000

export interface Ending {
  at: number
  title: string
  body: string
}

const minutes = (b: Block | null) => (b?.durationMs ? Math.round(b.durationMs / 60_000) : 0)

function nameOf(s: MayorlyState, b: Block | null): string {
  if (!b) return ''
  if (b.kind === 'leisure') return s.leisure.find((x) => x.id === b.leisureId)?.title ?? 'the couch'
  return s.entries.find((e) => e.id === b.entryId)?.title ?? s.ledgers.find((l) => l.id === b.ledgerId)?.name ?? 'the desk'
}

/** Every block end from now on, as the desk will run it, up to twelve hours or twelve endings. */
export function endings(s: MayorlyState, now: number, device: string): Ending[] {
  const out: Ending[] = []
  let st = s
  let n = 0
  const ctx = (at: number) => ({ now: at, newId: () => `sim-${n++}`, random: () => 0.5, device })
  for (let i = 0; i < MAX; i++) {
    const d = st.desk
    const end = blockEndsAt(st)
    if (d.status !== 'running' || end === null || end - now > HORIZON_MS) break
    const ended = d.block
    st = reduce(st, { type: 'desk/tick' }, ctx(end)).state
    const next = st.desk.block
    const going = st.desk.status === 'running'
    const title = ended?.kind === 'focus' ? 'Focus done' : ended?.kind === 'rest' ? 'Rest over' : 'Couch time is up'
    let body: string
    if (!next || st.desk.status === 'idle') body = 'The sitting is complete.'
    else if (next.kind === 'rest') body = going ? `Rest ${minutes(next)} min.` : 'Start the rest when you are ready.'
    else if (next.kind === 'leisure') body = going ? `${nameOf(st, next)}, ${minutes(next)} min.` : `Next: ${nameOf(st, next)}.`
    else body = going ? `Back to ${nameOf(st, next)}.` : `Next: ${nameOf(st, next)}. Start when you are ready.`
    if (end > now) out.push({ at: end, title, body })
  }
  return out
}

