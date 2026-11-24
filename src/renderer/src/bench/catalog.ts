import { CaretRight, Check, Couch, LockSimple, Sparkle, SquaresFour, Storefront, Tray, type Icon } from '@phosphor-icons/react'
import type { ArtId } from '../lib/art'
import type { PetState } from '../hud/PetSprite'

// What the art bench says about each sprite: where the app shows it, at which scales, and what shows
// until it is drawn. Words and numbers only. This file never imports lib/art.ts, so a saved PNG
// updates the bench through Bench.tsx alone; every image there is read from art() as it renders.
// The scales and sizes copy the app's own (named beside each), which keeps them private to its files.

/** One size the app shows a sprite at, and where. */
export interface View {
  scale: number
  use?: string
}

/** A nine-slice frame as the app draws it (deck/ui9.ts), on a sample box of a whole size. */
export interface Frame {
  scale: number
  /** Art pixels cut from each side; the standard's corner is 8. */
  slice: number
  fill: boolean
  use: string
  w: number
  h: number
  /** Dark words on a light frame. */
  darkInk?: boolean
}

export interface BenchItem {
  id: ArtId
  /** Where the app shows it. */
  where: string
  /** What the app shows until it is drawn. */
  today: string
  /** The stock icon the app shows meanwhile, drawn in the dashed box. */
  stand?: Icon
  /** The scales the app shows it at, smallest first. */
  views: View[]
  /** A strip's speed, frames a second. */
  fps?: number
  /** Tiles: rows of ids repeated side by side, to see the seams. */
  swatch?: ArtId[][]
  frame?: Frame
  /** The numerals: readouts as the app shows them (lib/PixelNumber.tsx). */
  digits?: boolean
}

export interface BenchGroup {
  key: string
  title: string
  note: string
  items: BenchItem[]
}

/** The coin's turn, as CashIn.tsx plays it in flight (SPIN_FPS). */
const SPIN_FPS = 10

/** Readouts in the founder's digits, at the scales and widths the app gives them, and its text size meanwhile. */
export const READOUTS: { text: string; scale: number; use: string; maxWidth?: number; font: number }[] = [
  // Pet.tsx: SIGN_SCALE and SIGN_TEXT_PX, then COUNT_SCALE and COUNT_TEXT_PX; hud.css .pet-sign, .pet-count.
  { text: '20:57', scale: 2, use: 'the sign', maxWidth: 66, font: 22 },
  { text: '2.2', scale: 1, use: "the task's count", maxWidth: 44, font: 13 },
  // CashIn.tsx: COUNT_SCALE; hud.css .cashin-num.
  { text: '128', scale: 3, use: 'the coin counter', font: 30 },
]

const row = (id: ArtId, n = 4): ArtId[] => Array.from({ length: n }, () => id)

/** The pet's states. Their ids come from PET_ART, so a state added there shows up by itself. */
export const PET_COPY: Partial<Record<PetState, { where: string; today: string }>> = {
  work: { where: 'The pet while a focus block runs.', today: 'the plain tomato, breathing.' },
  rest: { where: 'The pet during a rest.', today: 'the plain tomato.' },
  couch: { where: 'The pet while a couch item runs.', today: 'the plain tomato.' },
  hold: { where: 'The pet while the desk is on hold, or waiting to start.', today: 'the plain tomato.' },
  idle: { where: 'The pet while the desk is idle.', today: 'the plain tomato.' },
  held: { where: 'The pet while you drag it.', today: 'the plain tomato.' },
  hop: { where: 'The pet during its hover hop.', today: 'the plain tomato, hopping.' },
  gaming: { where: 'The pet in gaming mode, Alt+Shift+G.', today: 'the plain tomato.' },
}

/** The ledger glyphs the founder means to draw first, by their Phosphor names. Any other glyph file shows too. */
export const GLYPH_SLOTS: { name: string; where: string }[] = [
  { name: 'barbell', where: 'EXE, everywhere the ledger shows its glyph.' },
  { name: 'briefcase', where: 'CAR, everywhere the ledger shows its glyph.' },
  { name: 'briefcase-metal', where: 'PRO, everywhere the ledger shows its glyph.' },
]

/** The page, top to bottom. The pet's and the glyphs' tiles are filled in by the bench. */
export const GROUPS: BenchGroup[] = [
  {
    key: 'pet',
    title: 'The pet',
    note: 'Each state is a 24x24 canvas with the tomato at (4,4), shown at 3x and centred on the tomato, beside its sign. The grey dashed line is the pet\'s window on a Mac: anything drawn past it is cut off there. Windows shows the whole canvas.',
    items: [],
  },
  {
    key: 'coin',
    title: 'The coin',
    note: 'Your coin at every size it shows. A strip plays a whole frame at a time.',
    items: [
      { id: 'icon.coin', where: 'Every coin: the counter, the flights, the prices, the wallet.', today: 'nothing: the app needs it.', views: [{ scale: 1, use: 'prices' }, { scale: 2, use: 'flights' }, { scale: 3, use: 'wallet' }] },
      { id: 'icon.coin.spin', where: 'Every coin in flight, in and out.', today: 'your coin, turned by CSS.', views: [{ scale: 1 }, { scale: 2, use: 'flights' }], fps: SPIN_FPS },
    ],
  },
  {
    key: 'icons',
    title: 'Icons',
    note: '16x16, shown at 1x in lists and at 2x where the stock icon was bigger. Until one is drawn, its dashed box holds the stock icon the app shows.',
    items: [
      { id: 'icon.tomato', where: 'A tomato beside every count, pomodoro in the Plus menu, the app and tray icons.', today: 'nothing: the app needs it.', views: [{ scale: 1, use: 'rows' }, { scale: 2, use: 'Plus menu' }] },
      { id: 'icon.couch', where: 'The Couch tile in the Plus menu, the Leisure tab, the phone\'s Couch tab.', today: 'Phosphor Couch.', stand: Couch, views: [{ scale: 1 }, { scale: 2 }] },
      { id: 'icon.market', where: 'The Market tab.', today: 'Phosphor Storefront.', stand: Storefront, views: [{ scale: 1 }, { scale: 2 }] },
      { id: 'icon.stamp', where: 'Clear in the Plus menu: the stamp on a finished entry.', today: 'Phosphor Check.', stand: Check, views: [{ scale: 1 }, { scale: 2 }] },
      { id: 'icon.letter', where: 'Capture\'s prompt, and an unfiled entry.', today: 'Phosphor CaretRight.', stand: CaretRight, views: [{ scale: 1 }, { scale: 2 }] },
      { id: 'prop1x1.mailtray', where: 'Capture in the Plus menu, and on the desk in the shelf scene while the tray holds entries.', today: 'Phosphor Tray.', stand: Tray, views: [{ scale: 1 }, { scale: 2 }] },
      { id: 'icon.ledger.open', where: 'The phone\'s Ledgers tab while it is open.', today: 'Phosphor SquaresFour.', stand: SquaresFour, views: [{ scale: 1 }, { scale: 2 }] },
    ],
  },
  {
    key: 'glyphs',
    title: 'Ledger glyphs',
    note: 'A drawn glyph wins over the Phosphor glyph of the same name, everywhere a ledger shows it. Save it as glyph.<name> with - written as _, for example glyph.briefcase_metal.',
    items: [],
  },
  {
    key: 'scene',
    title: 'The shelf and its room',
    note: 'The Shelf tab\'s picture as the app draws it, then each piece at 2x. Tiles also repeat side by side, so a seam shows.',
    items: [
      { id: 'prop2x4.bookshelf', where: 'The Shelf tab: your ledgers stand on it as spines, up to nine.', today: 'the Shelf tab\'s cards alone.', views: [{ scale: 2 }] },
      { id: 'prop4x3.ledger.open', where: 'The Shelf tab: the ledger you point at or pick, out of the shelf and lying open on the wall beside it, its name and numbers written on the two pages.', today: 'a plain book in CSS of the same size.', views: [{ scale: 1 }, { scale: 2 }] },
      { id: 'icon.ledger.closed', where: 'A ledger on the shelf: its spine.', today: 'a dashed outline where the spine goes.', views: [{ scale: 1 }, { scale: 2 }] },
      { id: 'icon.ledger.locked', where: 'A hand-written ledger\'s spine, and its lock on the open ledger.', today: 'Phosphor LockSimple.', stand: LockSimple, views: [{ scale: 1 }, { scale: 2 }] },
      { id: 'prop2x2.desk.idle', where: 'The desk in the shelf scene, and the empty Flow.', today: 'text only.', views: [{ scale: 2 }] },
      { id: 'prop2x2.desk.working', where: 'The desk in the shelf scene while a block runs: the lamp lit.', today: 'the idle desk.', views: [{ scale: 2 }] },
      { id: 'tile.wall.plaster', where: 'The wall of the shelf scene. It repeats left to right; its bottom two rows meet the floor.', today: 'no wall.', views: [{ scale: 2 }], swatch: [row('tile.wall.plaster'), row('tile.floor.wood'), row('tile.floor.wood')] },
      { id: 'tile.floor.wood', where: 'The floor of the shelf scene.', today: 'no floor.', views: [{ scale: 2 }], swatch: [row('tile.floor.wood'), row('tile.floor.wood'), row('tile.floor.wood')] },
      { id: 'tile.terrain.grass_a', where: 'The band along the top of the Leisure tab.', today: 'no band.', views: [{ scale: 2 }], swatch: [row('tile.terrain.grass_a'), row('tile.terrain.grass_a'), row('tile.terrain.grass_a')] },
      { id: 'tile.terrain.dirt_path', where: 'The path through the Leisure tab\'s band.', today: 'grass only.', views: [{ scale: 2 }], swatch: [row('tile.terrain.grass_a'), row('tile.terrain.dirt_path'), row('tile.terrain.grass_a')] },
    ],
  },
  {
    key: 'frames',
    title: 'Frames',
    note: 'A 24x24 cut into corners, edges and a middle: the corners never stretch, the edges stretch one way and the middle both, so keep each edge one colour along its length. Each shows as a box at the scale the app draws it.',
    items: [
      // ClerkAsk.tsx: PARCHMENT_SLICE, at 3x, the middle filled.
      { id: 'ui9.panel.parchment', where: 'The frame of the clerk\'s question card.', today: 'the dark glass plate, drawn by CSS.', views: [{ scale: 1 }], frame: { scale: 3, slice: 9, fill: true, use: 'question card', w: 240, h: 96, darkInk: true } },
      // Keymap.tsx and WhatsNew.tsx: at 2x, the middle left to the panel behind.
      { id: 'ui9.panel.wood', where: 'The frames of the Keymap and What\'s New screens.', today: 'bevels drawn by CSS.', views: [{ scale: 1 }], frame: { scale: 2, slice: 8, fill: false, use: 'Keymap', w: 192, h: 64 } },
    ],
  },
  {
    key: 'numerals',
    title: 'Numerals',
    note: 'Readouts as the app shows them, one 6x8 cell a character. The sign has room for five characters at 2x, so a clock of an hour or more shows the plain text.',
    items: [
      { id: 'font.digits', where: 'The pet\'s sign and count, and the coin counter. Twelve 6x8 cells: 0123456789:.', today: 'Barlow Condensed, the app\'s type.', views: [{ scale: 1 }, { scale: 3, use: 'close up' }], digits: true },
    ],
  },
  {
    key: 'clerk',
    title: 'The clerk',
    note: 'The mute records-keeper: its face as an icon, and the clerk standing beside the shelf.',
    items: [
      { id: 'icon.clerk', where: 'In place of the stock AI sparkle (Capture, Ask, Calendar, Flow, What\'s New), and at 3x on the clerk\'s question card.', today: 'Phosphor Sparkle, and the tomato on the question card.', stand: Sparkle, views: [{ scale: 1 }, { scale: 2 }, { scale: 3, use: 'question card' }] },
      { id: 'char.clerk.stand', where: 'Beside the bookshelf in the Shelf tab\'s picture.', today: 'nothing stands there.', views: [{ scale: 1 }, { scale: 2, use: 'Shelf tab' }] },
    ],
  },
]
