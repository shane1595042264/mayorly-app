import type { Ledger } from '@core/index'

// How sure the clerk must be before it starts a ledger (or folds one away), found by trial and
// error for the model it actually runs on: models state their confidence on different scales, so
// no single number is right for all. The clerk files the lines below against four sample ledgers;
// half belong in one of them, half are a lasting area none of them covers. Every level from 50% to
// 95% is tried against what the model said, and the one that gets the most right is kept, with a
// wrong new ledger counted as worse than a missed one.

/** Until a model has been tried: a cautious level, since a wrong ledger is worse than none. */
export const DEFAULT_THRESHOLD = 0.85

const sample = (id: string, name: string, code: string, criterion: string, glyph: string): Ledger =>
  ({ id, name, code, criterion, glyph, handWritten: true, pays: true, createdAt: 0 }) as Ledger

export const TRIAL_LEDGERS: Ledger[] = [
  sample('trial-legal', 'Legal', 'LGL', 'Contracts, filings, immigration, anything with a lawyer or a form.', 'scales'),
  sample('trial-dance', 'Dance', 'DNC', 'Practice, drills, choreography, battle prep.', 'music'),
  sample('trial-career', 'Career', 'CAR', 'Job applications, resume, interview prep, networking.', 'briefcase'),
  sample('trial-fitness', 'Fitness', 'FIT', 'Workouts, runs, stretching, sports practice.', 'barbell'),
]

export const TRIALS: { line: string; wantsNew: boolean }[] = [
  // These fit one of the sample ledgers: starting a ledger for them would be wrong.
  { line: 'sign the new lease and send it back', wantsNew: false },
  { line: 'reply to the immigration lawyer', wantsNew: false },
  { line: 'renew my passport', wantsNew: false },
  { line: 'practice the footwork combo ~20', wantsNew: false },
  { line: 'choreograph the opening eight counts', wantsNew: false },
  { line: 'battle practice with the crew', wantsNew: false },
  { line: 'apply to the Stripe backend role', wantsNew: false },
  { line: 'prep for the Google onsite', wantsNew: false },
  { line: 'update my resume with the new project', wantsNew: false },
  { line: 'leg day at the gym', wantsNew: false },
  { line: 'run 5k before work', wantsNew: false },
  { line: 'stretch and foam roll', wantsNew: false },
  // A lasting part of a life none of the sample ledgers covers: these deserve a ledger.
  { line: 'repot the monstera and water the ferns', wantsNew: true },
  { line: 'call grandma for her birthday', wantsNew: true },
  { line: 'plan the trip to Kyoto', wantsNew: true },
  { line: 'pay the electricity bill', wantsNew: true },
  { line: 'learn 20 Japanese words', wantsNew: true },
  { line: "fix the bike's back brake", wantsNew: true },
  { line: 'cook meals for the week', wantsNew: true },
  { line: 'write the wedding toast for Sam', wantsNew: true },
  { line: 'clean out the garage', wantsNew: true },
  { line: 'set up the November budget', wantsNew: true },
  { line: 'record a new guitar cover', wantsNew: true },
  { line: 'research which daycare to choose', wantsNew: true },
]

export interface Trial {
  line: string
  wantsNew: boolean
  /** The model proposed a new ledger. */
  proposed: boolean
  /** How sure it said it was of that proposal, 0 when it made none. */
  confidence: number
}

export interface Tuned {
  threshold: number
  correct: number
  total: number
}

const LEVELS = Array.from({ length: 10 }, (_, i) => Math.round((0.5 + i * 0.05) * 100) / 100)

/**
 * The level that does best on these trials. Scored by F0.5, which weighs precision twice as much
 * as recall: a ledger started for nothing clutters the shelf, a missed one only leaves a line in
 * its closest ledger. Ties go to more right answers, then to the higher, more careful level. A
 * model that never proposed a ledger teaches nothing, so the cautious default stands.
 */
export function chooseThreshold(trials: Trial[]): Tuned {
  const total = trials.length
  if (!trials.some((t) => t.proposed)) return { threshold: DEFAULT_THRESHOLD, correct: trials.filter((t) => !t.wantsNew).length, total }
  let best: { t: number; f: number; correct: number } | null = null
  for (const t of LEVELS) {
    const made = (x: Trial) => x.proposed && x.confidence >= t
    const tp = trials.filter((x) => x.wantsNew && made(x)).length
    const fp = trials.filter((x) => !x.wantsNew && made(x)).length
    const fn = trials.filter((x) => x.wantsNew && !made(x)).length
    const correct = trials.filter((x) => x.wantsNew === made(x)).length
    const p = tp + fp ? tp / (tp + fp) : 0
    const r = tp + fn ? tp / (tp + fn) : 0
    const f = p + r ? (1.25 * p * r) / (0.25 * p + r) : 0
    if (!best || f > best.f || (f === best.f && correct > best.correct) || (f === best.f && correct === best.correct && t > best.t)) best = { t, f, correct }
  }
  // Nothing it proposed was right at any level: keep it from starting ledgers at all.
  if (!best || best.f === 0) return { threshold: 0.99, correct: trials.filter((t) => !t.wantsNew).length, total }
  return { threshold: best.t, correct: best.correct, total }
}

/** One line per trial, for the log: what the model said and whether the chosen level gets it right. */
export function describeTrials(trials: Trial[], threshold: number): string[] {
  return trials.map((t) => {
    const made = t.proposed && t.confidence >= threshold
    const said = t.proposed ? `new at ${Math.round(t.confidence * 100)}%` : 'existing'
    return `${made === t.wantsNew ? 'right' : 'WRONG'}  ${t.wantsNew ? 'wants new' : 'fits one '}  ${said.padEnd(11)}  ${t.line}`
  })
}
