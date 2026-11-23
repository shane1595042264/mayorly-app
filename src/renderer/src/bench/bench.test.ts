import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { ART } from '../lib/art'
import { Bench } from './Bench'

// The bench draws whatever lib/art.ts has: here every sprite is drawn, or none is.
const drawn = vi.hoisted(() => ({ all: false }))
vi.mock('../lib/art', async (real) => {
  const mod = await real<typeof import('../lib/art')>()
  return { ...mod, art: (id: string) => (drawn.all ? `/art/${id}.png?t=1` : undefined) }
})

const page = (all: boolean) => {
  drawn.all = all
  return renderToStaticMarkup(createElement(Bench))
}

describe('the art bench', () => {
  it('lists every sprite the app knows and the three ledger glyphs', () => {
    const html = page(false)
    for (const id of Object.keys(ART)) expect(html).toContain(`>${id}<`)
    for (const id of ['glyph.barbell', 'glyph.briefcase', 'glyph.briefcase_metal']) expect(html).toContain(`>${id}<`)
  })

  it('shows a dashed box and no image for a sprite not drawn', () => {
    const html = page(false)
    expect(html).not.toContain('/art/')
    expect(html).toContain('bench-missing')
    expect(html).toMatch(/>0 of \d+ drawn/)
  })

  it('shows every drawing once it exists, and no dashed box', () => {
    const html = page(true)
    for (const id of Object.keys(ART)) expect(html).toContain(`/art/${id}.png?t=1`)
    expect(html).not.toContain('bench-missing')
    expect(html).toMatch(/>(\d+) of \1 drawn/)
  })
})
