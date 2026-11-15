import { describe, expect, it } from 'vitest'
import { GLYPH_NAMES as SHARED } from './glyph-names'
import { GLYPH_NAMES } from '../renderer/src/lib/glyphs'

describe('the glyph names the clerk picks from', () => {
  it('are exactly the catalogue the shelf draws', () => {
    expect([...SHARED].sort()).toEqual([...GLYPH_NAMES].sort())
  })
})
