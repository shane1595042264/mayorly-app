// The founder's sprites as the app ships them: every PNG in assets/art, copied from mayorly-assets by
// `npm run art` (scripts/art.mjs), found here by its slot id. One not drawn yet is undefined, and every
// caller then shows what it showed before: the plain tomato, a Phosphor icon. Hand-drawn only, and
// shown only at whole-number scales (lib/Pixel.tsx), so a pixel is always a square of pixels.

// In dev a PNG saved in Aseprite re-runs this module (Vite's HMR, through `npm run art -- --watch`),
// and Vite gives the changed file a fresh `?t=`, so every image fetches the new drawing without a
// reload. A build inlines or hashes them instead.
const files = import.meta.glob<string>('../assets/art/*.png', { eager: true, import: 'default' })
const urls = new Map<string, string>()
for (const [path, url] of Object.entries(files)) urls.set(path.slice(path.lastIndexOf('/') + 1, -'.png'.length), url)

/** A sprite's canvas: one frame's width and height, and how many frames are stacked top to bottom. */
export interface ArtSpec {
  w: number
  h: number
  frames: number
}

const PET: ArtSpec = { w: 24, h: 24, frames: 1 }
const ICON: ArtSpec = { w: 16, h: 16, frames: 1 }

/** Every sprite the app knows, by its slot id in mayorly-assets, with its canvas (classes.json there). */
export const ART = {
  'icon.tomato': ICON,
  'icon.coin': ICON,
  'icon.coin.spin': { w: 16, h: 16, frames: 4 },
  'icon.clerk': ICON,
  'icon.couch': ICON,
  'icon.market': ICON,
  'icon.stamp': ICON,
  'icon.letter': ICON,
  'icon.ledger.open': ICON,
  'icon.ledger.closed': ICON,
  'icon.ledger.locked': ICON,
  'pet.tomato.work': { w: 24, h: 24, frames: 2 },
  'pet.tomato.rest': PET,
  'pet.tomato.couch': PET,
  'pet.tomato.hold': PET,
  'pet.tomato.idle': PET,
  'pet.tomato.held': PET,
  'pet.tomato.hop': PET,
  'pet.tomato.gaming': PET,
  'prop1x1.mailtray': ICON,
  'prop2x2.desk.idle': { w: 32, h: 32, frames: 1 },
  'prop2x2.desk.working': { w: 32, h: 32, frames: 1 },
  'prop2x4.bookshelf': { w: 32, h: 64, frames: 1 },
  'prop4x3.ledger.open': { w: 64, h: 48, frames: 1 },
  'char.clerk.stand': { w: 16, h: 32, frames: 1 },
  'tile.floor.wood': ICON,
  'tile.wall.plaster': ICON,
  'tile.terrain.grass_a': ICON,
  'tile.terrain.dirt_path': ICON,
  'ui9.panel.parchment': PET,
  'ui9.panel.wood': PET,
  'font.digits': { w: 72, h: 8, frames: 1 },
} satisfies Record<string, ArtSpec>

/** A sprite the app knows, or a ledger glyph drawn by the founder (`glyph.<Phosphor name, - as _>`). */
export type ArtId = keyof typeof ART | `glyph.${string}`

/** The URL of a drawn sprite, or undefined while it is not drawn. */
export function art(id: ArtId): string | undefined {
  return urls.get(id)
}

/** The canvas of a sprite: from the table, and 16x16 for a ledger glyph. */
export function specOf(id: ArtId): ArtSpec {
  return (ART as Record<string, ArtSpec>)[id] ?? ICON
}

/** The drawn sprite for a ledger's Phosphor glyph name, if the founder drew one. */
export const glyphArt = (name: string): ArtId => `glyph.${name.replace(/-/g, '_')}`
