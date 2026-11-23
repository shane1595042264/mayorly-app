import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PetSprite, drawnPet, petStates } from './PetSprite'

// Which pet drawings exist, for each test: art() answers from this.
const drawn = vi.hoisted(() => ({ ids: new Set<string>() }))
vi.mock('../lib/art', async (load) => {
  const real = await load<typeof import('../lib/art')>()
  return { ...real, art: (id: string) => (id.startsWith('pet.') ? (drawn.ids.has(id) ? `${id}.png` : undefined) : real.art(id as never)) }
})

describe('the pet state', () => {
  beforeEach(() => {
    drawn.ids = new Set()
  })

  it('reads gaming first, then carried, then the hop, then the desk', () => {
    expect(petStates({ gaming: true, held: true, hop: true, tone: 'live' })).toEqual(['gaming', 'held', 'hop', 'work'])
    expect(petStates({ gaming: false, held: false, hop: false, tone: 'ready' })).toEqual(['hold'])
    expect(petStates({ gaming: false, held: false, hop: false, tone: 'couch' })).toEqual(['couch'])
    expect(petStates({ gaming: false, held: false, hop: false, tone: 'idle' })).toEqual(['idle'])
  })

  it('is the plain tomato with nothing drawn, and a moment not drawn gives way to the desk', () => {
    expect(drawnPet(petStates({ gaming: false, held: true, hop: false, tone: 'live' }))).toBeNull()
    drawn.ids.add('pet.tomato.work')
    expect(drawnPet(petStates({ gaming: false, held: true, hop: false, tone: 'live' }))).toBe('work')
    drawn.ids.add('pet.tomato.held')
    expect(drawnPet(petStates({ gaming: false, held: true, hop: false, tone: 'live' }))).toBe('held')
    drawn.ids.add('pet.tomato.gaming')
    expect(drawnPet(petStates({ gaming: true, held: true, hop: false, tone: 'live' }))).toBe('gaming')
  })

  it('centres a 24x24 drawing on the 48 px tomato on whole pixels', () => {
    drawn.ids.add('pet.tomato.gaming')
    const out = renderToStaticMarkup(createElement(PetSprite, { state: 'gaming' }))
    expect(out).toContain('width="72"')
    expect(out).toContain('left:-12px;top:-12px')
    expect(renderToStaticMarkup(createElement(PetSprite, { state: 'rest' }))).toBe('')
  })

  it('plays the work strip, and holds its first frame when still', () => {
    drawn.ids.add('pet.tomato.work')
    expect(renderToStaticMarkup(createElement(PetSprite, { state: 'work' }))).toContain('px-strip 1s steps(2) infinite')
    expect(renderToStaticMarkup(createElement(PetSprite, { state: 'work', still: true }))).not.toContain('animation:')
  })
})
