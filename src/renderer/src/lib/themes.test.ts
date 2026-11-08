import { describe, expect, it } from 'vitest'
import { LEDGER_THEMES } from '@core/index'
import { distinctTheme } from './themes'

describe('the colour Auto picks', () => {
  it('is one no other ledger wears', () => {
    const worn = ['amber', 'blue', 'green', undefined] as const
    const pick = distinctTheme([...worn])
    expect(['amber', 'blue', 'green']).not.toContain(pick)
  })

  it('stands farthest from the colours already worn', () => {
    // Next to amber, orange is the worst choice; a cool colour sets it apart.
    expect(['indigo', 'blue', 'sky', 'teal', 'magenta']).toContain(distinctTheme(['amber']))
    expect(distinctTheme(['amber'])).not.toBe('orange')
  })

  it('takes the least worn colour once every colour is on a ledger', () => {
    const all = [...LEDGER_THEMES, ...LEDGER_THEMES.filter((t) => t !== 'teal')]
    expect(distinctTheme(all)).toBe('teal')
  })

  it('starts the palette when there is nothing to differ from', () => {
    expect(distinctTheme([])).toBe('amber')
  })
})
