// Economy and shelf rules, straight from the product spec. Change them there first.

export const LEDGER_CAP = 9
/** One tomato, one token. No bonus for long sittings: nothing here rewards one kind of day over another. */
export const TOKENS_PER_TOMATO = 1
/** One token buys one block of leisure, the same length as a focus block. Rests are free. */
export const LEISURE_TOKENS_PER_BLOCK = 1
export const CLERK_LOG_CAP = 200
/** A heartbeat gap longer than this means the machine slept; the desk pauses at the last beat. */
export const SLEEP_GAP_MS = 2 * 60_000

/** Tokens paid for the n-th tomato of a sitting (1-based). Every tomato pays the same. */
export function tokensForTomato(_n: number): number {
  return TOKENS_PER_TOMATO
}

export function tokensForSitting(tomatoes: number): number {
  return Math.max(0, Math.floor(tomatoes)) * TOKENS_PER_TOMATO
}
