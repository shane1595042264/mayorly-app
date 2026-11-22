// Economy and shelf rules, straight from the product spec. Change them there first.

export const LEDGER_CAP = 9
/**
 * One tomato, one coin. No bonus for long sittings: nothing here rewards one kind of day
 * over another. A tomato grown on an entry is paid when that entry is cleared, like a crop
 * harvested; ledger time with no entry pays as it goes, since there is nothing to harvest.
 */
export const TOKENS_PER_TOMATO = 1
/**
 * The couch costs what the desk pays: one coin for each whole tomato of time on a couch item, counted
 * like a task's tomatoes, from its intervals at each sitting's tomato length, so switching in and out
 * neither saves nor costs anything (nine hours of a game at 30 minutes a tomato is 18 coins). Each
 * coin goes as its tomato completes; the couch needs one in hand to run. Rests are free.
 */
export const COUCH_COINS_PER_TOMATO = 1
export const CLERK_LOG_CAP = 200
/** A heartbeat gap longer than this means the machine slept; the desk pauses at the last beat. */
export const SLEEP_GAP_MS = 2 * 60_000

/** Coins paid for the n-th tomato of a sitting (1-based). Every tomato pays the same. */
export function tokensForTomato(_n: number): number {
  return TOKENS_PER_TOMATO
}

export function tokensForSitting(tomatoes: number): number {
  return Math.max(0, Math.floor(tomatoes)) * TOKENS_PER_TOMATO
}
