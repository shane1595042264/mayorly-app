import { describe, expect, it } from 'vitest'
import { chooseThreshold, DEFAULT_THRESHOLD, TRIALS, type Trial } from './tuning'

const trial = (wantsNew: boolean, proposed: boolean, confidence: number): Trial => ({ line: 'x', wantsNew, proposed, confidence })

describe('tuning the level for starting a ledger', () => {
  it('has as many lines that fit as lines that need a ledger', () => {
    expect(TRIALS.filter((t) => t.wantsNew)).toHaveLength(TRIALS.length / 2)
  })

  it('picks the level that separates right proposals from wrong ones', () => {
    // Right proposals at 0.9 and up, wrong ones at 0.7 and below.
    const trials = [trial(true, true, 0.95), trial(true, true, 0.9), trial(true, true, 0.92), trial(false, true, 0.7), trial(false, true, 0.6), trial(false, false, 0)]
    const r = chooseThreshold(trials)
    expect(r.threshold).toBeGreaterThan(0.7)
    expect(r.threshold).toBeLessThanOrEqual(0.9)
    expect(r).toMatchObject({ correct: 6, total: 6 })
  })

  it('leans careful: a level that lets a wrong ledger in loses to one that misses a right one', () => {
    const trials = [trial(true, true, 0.9), trial(true, true, 0.9), trial(true, true, 0.75), trial(false, true, 0.75)]
    // At 0.75 every right one is made but so is the wrong one; at 0.8 one right one is missed.
    expect(chooseThreshold(trials).threshold).toBeGreaterThan(0.75)
  })

  it('keeps the cautious default when the model never proposes, and shuts it off when every proposal is wrong', () => {
    expect(chooseThreshold([trial(true, false, 0), trial(false, false, 0)]).threshold).toBe(DEFAULT_THRESHOLD)
    expect(chooseThreshold([trial(false, true, 0.9), trial(true, false, 0)]).threshold).toBe(0.99)
  })
})
