// Economy and shelf rules, straight from the product spec. Change them there first.

export const LEDGER_CAP = 9
export const TOKENS_PER_TOMATO = 12
/** A sitting that reaches this many tomatoes pays the bonus on all of them. */
export const BONUS_AT = 3
export const BONUS_RATE = 0.5
export const CLERK_LOG_CAP = 200
/** A heartbeat gap longer than this means the machine slept; the desk pauses at the last beat. */
export const SLEEP_GAP_MS = 2 * 60_000

/**
 * Tokens paid for the n-th tomato of a sitting (1-based).
 * Below the threshold each pays the base. The tomato that reaches the threshold
 * also back-pays the bonus on the earlier ones, so a sitting of n >= 3 tomatoes
 * totals exactly n * base * 1.5. Long grinds beat scattered ones.
 */
export function tokensForTomato(n: number): number {
  const bonus = TOKENS_PER_TOMATO * BONUS_RATE
  if (n < BONUS_AT) return TOKENS_PER_TOMATO
  if (n === BONUS_AT) return TOKENS_PER_TOMATO + bonus + (BONUS_AT - 1) * bonus
  return TOKENS_PER_TOMATO + bonus
}

export function tokensForSitting(tomatoes: number): number {
  let total = 0
  for (let n = 1; n <= tomatoes; n++) total += tokensForTomato(n)
  return total
}
