import { reduce, type MayorlyState } from '@core/index'

// What the desk will put on next, worked out by running the reducer forward on a copy: skip the
// block on now, and skip again past any rest, until a block with work comes up. The same rule
// the desk follows, so a superset's next slot, a pomodoro's same task and a rest's return all
// come out as they will. Pure; nothing here touches the real state.

export interface Upcoming {
  entryId: string | null
  leisureId: string | null
  ledgerId: string | null
}

export function upcoming(s: MayorlyState, now: number, count = 3): Upcoming[] {
  const out: Upcoming[] = []
  let st = s
  let n = 0
  const ctx = { now, newId: () => `peek-${n++}`, random: () => 0.5, device: 'peek' }
  for (let guard = 0; guard < count * 3 && out.length < count; guard++) {
    if (st.desk.status === 'idle' || !st.desk.block) break
    const next = reduce(st, { type: 'desk/skip' }, ctx).state
    if (next === st || next.desk.status === 'idle' || !next.desk.block) break
    st = next
    const b = st.desk.block!
    if (b.kind === 'rest') continue
    out.push({ entryId: b.entryId, leisureId: b.leisureId ?? null, ledgerId: b.ledgerId })
  }
  return out
}
