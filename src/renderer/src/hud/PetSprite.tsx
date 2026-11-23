import { art, specOf, type ArtId } from '../lib/art'
import { Pixel, PixelAnim } from '../lib/Pixel'

// The founder's drawings of the pet, one per state (mayorly-assets: pet.tomato.*). Each is a 24x24
// canvas with the 16x16 tomato in its middle at (4,4), shown at 3x and centred on the 48 px tomato,
// so the tomato never moves between states and anything drawn round it spreads evenly. A state not
// drawn yet is null here, and the pet shows the plain tomato as before.

export type PetState = 'work' | 'rest' | 'couch' | 'hold' | 'idle' | 'held' | 'hop' | 'gaming'

/** The desk as the pet's sign colours it (Pet.tsx). */
export type PetTone = 'idle' | 'live' | 'hold' | 'rest' | 'ready' | 'couch'

export const PET_ART: Record<PetState, ArtId> = {
  work: 'pet.tomato.work',
  rest: 'pet.tomato.rest',
  couch: 'pet.tomato.couch',
  hold: 'pet.tomato.hold',
  idle: 'pet.tomato.idle',
  held: 'pet.tomato.held',
  hop: 'pet.tomato.hop',
  gaming: 'pet.tomato.gaming',
}

/** The drawing for each tone. Ready waits for you, so it is the hold. */
const TONE_STATE: Record<PetTone, PetState> = { live: 'work', rest: 'rest', couch: 'couch', hold: 'hold', ready: 'hold', idle: 'idle' }

/** Whether the founder has drawn this state. */
export const petDrawn = (state: PetState): boolean => !!art(PET_ART[state])

/**
 * The states the pet is in, most particular first: gaming mode, then carried, then mid-hop, then
 * what the desk is doing. A moment with no drawing of its own (a hop, say) gives way to the next.
 */
export function petStates(p: { gaming: boolean; held: boolean; hop: boolean; tone: PetTone }): PetState[] {
  const out: PetState[] = []
  if (p.gaming) out.push('gaming')
  if (p.held) out.push('held')
  if (p.hop) out.push('hop')
  out.push(TONE_STATE[p.tone])
  return out
}

/** The first of these the founder has drawn, or null for the plain tomato. */
export const drawnPet = (states: PetState[]): PetState | null => states.find(petDrawn) ?? null

/** The working loop's speed: two frames, twice a second. */
export const PET_WORK_FPS = 2

/** The drawing for a state, centred on the tomato's 48 px box (`.pet-art`), or null while not drawn. */
export function PetSprite({ state, scale = 3, still = false }: { state: PetState; scale?: number; still?: boolean }) {
  const id = PET_ART[state]
  if (!art(id)) return null
  // Whole art pixels from the tomato's corner, so the canvas lands on the same grid as the tomato it
  // replaces: (16 - 24) / 2 = 4 art pixels up and left, 12 px at 3x.
  const s = specOf(id)
  const k = Math.max(1, Math.round(scale))
  const at = { left: Math.floor((16 - s.w) / 2) * k, top: Math.floor((16 - s.h) / 2) * k }
  return state === 'work'
    ? <PixelAnim id={id} scale={k} fps={still ? 0 : PET_WORK_FPS} className="pet-art" style={at} />
    : <Pixel id={id} scale={k} className="pet-art" style={at} />
}
