import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DIGITS, PixelNumber, digitCells } from './PixelNumber'
import { specOf } from './art'

// Whether font.digits is drawn, for each test: art() answers from this.
const strip = vi.hoisted(() => ({ drawn: false }))
vi.mock('./art', async (load) => {
  const real = await load<typeof import('./art')>()
  return { ...real, art: (id: string) => (id === 'font.digits' ? (strip.drawn ? 'digits.png' : undefined) : real.art(id as never)) }
})

const html = (props: Parameters<typeof PixelNumber>[0]) => renderToStaticMarkup(createElement(PixelNumber, props))

describe('digitCells', () => {
  it('finds each character its cell in the strip', () => {
    expect(digitCells('25:00')).toEqual([2, 5, 10, 0, 0])
    expect(digitCells('2.5')).toEqual([2, 11, 5])
    expect(digitCells('1234567890')).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 0])
  })

  it('spells nothing the strip has no cell for', () => {
    expect(digitCells('+5:00')).toBeNull()
    expect(digitCells('1,234')).toBeNull()
    expect(digitCells(' 7')).toBeNull()
    expect(digitCells('')).toBeNull()
  })

  it('has a whole cell per character', () => {
    const s = specOf('font.digits')
    expect(s.w % DIGITS.length).toBe(0)
    expect(s.w / DIGITS.length).toBe(6)
    expect(s.h).toBe(8)
  })
})

describe('PixelNumber', () => {
  beforeEach(() => {
    strip.drawn = false
  })

  it('is the plain text while the digits are not drawn', () => {
    expect(html({ text: '25:00' })).toBe('25:00')
    expect(html({ text: '7', fallback: createElement('b', null, 'seven') })).toBe('<b>seven</b>')
  })

  it('draws each glyph as its cell of the strip at a whole scale, labelled with the text', () => {
    strip.drawn = true
    const out = html({ text: '25:00', scale: 2 })
    expect(out).toContain('role="img"')
    expect(out).toContain('aria-label="25:00"')
    expect(out.match(/background-position/g)).toHaveLength(5)
    // ':' is cell 10: 10 cells of 12 px at 2x.
    expect(out).toContain('background-position:-120px 0')
    expect(out).toContain('width:12px;height:16px')
    expect(out).toContain('background-size:144px 16px')
  })

  it('falls back on a character the strip lacks, or a row too wide for its box', () => {
    strip.drawn = true
    expect(html({ text: '+5:00', scale: 2 })).toBe('+5:00')
    // Seven cells at 2x is 84 px.
    expect(html({ text: '1:02:33', scale: 2, maxWidth: 66 })).toBe('1:02:33')
    expect(html({ text: '59:59', scale: 2, maxWidth: 66 })).toContain('role="img"')
  })
})
