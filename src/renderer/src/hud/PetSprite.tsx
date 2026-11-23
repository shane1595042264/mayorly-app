import { art, type ArtId } from '../lib/art'
import { Pixel, PixelAnim } from '../lib/Pixel'

// The founder's drawings of the pet, one per state (mayorly-assets: pet.tomato.*). Each is a 24x24
// canvas with the 16x16 tomato in its middle at (4,4), shown at 3x and centred on the 48 px tomato,
// so the tomato never moves between states and anything drawn round it spreads evenly. A state not
// drawn yet is null here, and the pet shows the plain tomato as before.

export type PetState = 'work' | 'rest' | 'couch' | 'hold' | 'idle' | 'held' | 'hop' | 'gaming'

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

/** Whether the founder has drawn this state. */
export const petDrawn = (state: PetState): boolean => !!art(PET_ART[state])

/** The working loop's speed: two frames, twice a second. */
export const PET_WORK_FPS = 2

/** The drawing for a state, centred on the tomato's 48 px box (`.pet-art`), or null while not drawn. */
export function PetSprite({ state, scale = 3, still = false }: { state: PetState; scale?: number; still?: boolean }) {
  const id = PET_ART[state]
  if (!art(id)) return null
  return state === 'work'
    ? <PixelAnim id={id} scale={scale} fps={still ? 0 : PET_WORK_FPS} className="pet-art" />
    : <Pixel id={id} scale={scale} className="pet-art" />
}
