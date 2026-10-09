import { firstRunState, reduce, type MayorlyState } from '@core/index'

// Sample data for the browser preview (?demo). Never used by the desktop app.

const MIN = 60_000

export function demoState(now: number, newId: () => string): MayorlyState {
  let s = firstRunState(now - 7 * 86_400_000, newId)
  let t = now - 7 * 86_400_000
  const run = (a: Parameters<typeof reduce>[1], at = t) => {
    s = reduce(s, a, { now: at, newId, random: () => 0.42 }).state
  }

  // A week of history so the record has something to show.
  const [lgl, dnc, car] = s.ledgers
  run({ type: 'settings/update', patch: { shortRestMin: 0, longRestMin: 0 } })
  const mins = [[50, 25, 75], [25, 50, 50], [0, 75, 25], [75, 25, 100], [50, 50, 25], [25, 0, 50]]
  for (let d = 0; d < mins.length; d++) {
    const day = new Date(now)
    day.setDate(day.getDate() - (6 - d))
    day.setHours(10, 0, 0, 0)
    t = day.getTime()
    run({ type: 'desk/deploy', mode: 'pomodoro' })
    let at = t
    for (const [i, ledger] of [lgl, dnc, car].entries()) {
      if (!mins[d][i]) continue
      run({ type: 'desk/swap', ledgerId: ledger.id }, at)
      at += mins[d][i] * MIN
      run({ type: 'desk/tick' }, at)
    }
    run({ type: 'desk/standDown' }, at)
  }
  run({ type: 'settings/update', patch: { shortRestMin: 5, longRestMin: 15 } })

  t = now - 40 * MIN
  // Entries arrive after the history so past time is ledger-only.
  for (const text of [
    'legal: Review lease renewal clause 7 ~30',
    'legal: Scan and file the signed NDA ~15',
    'dance: Footwork drills, three sets ~25',
    'dance: Freestyle to the battle playlist ~40',
    'career: Tailor resume for the next posting ~45',
    'career: Send two follow-up emails ~20',
    'Book a haircut',
  ]) run({ type: 'entry/capture', text })

  // Mid-way through the second slot of today's rotation.
  t = now - 34 * MIN
  run({ type: 'desk/deploy', mode: 'superset', supersetId: s.supersets[0].id })
  for (let at = t; at <= now; at += 1000) run({ type: 'desk/tick' }, at)
  return s
}
