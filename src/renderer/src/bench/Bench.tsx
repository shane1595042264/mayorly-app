import { useEffect, useState, type CSSProperties, type ReactNode } from 'react'
import { LEDGER_CAP, type MayorlyState } from '@core/index'
import { ART, art, glyphArt, specOf, type ArtId, type ArtSpec } from '../lib/art'
import { Pixel, PixelAnim } from '../lib/Pixel'
import { PixelNumber } from '../lib/PixelNumber'
import { GLYPH_NAMES, Glyph } from '../lib/glyphs'
import { PET_ART, PetSprite, type PetState } from '../hud/PetSprite'
import { ShelfScene } from '../deck/ShelfScene'
import { SCENE } from '../deck/shelfLayout'
import { ui9Frame } from '../deck/ui9'
import { demoState } from '../bridge/demo'
import { INSET, PET, TOMATO } from '../../../shared/pet'
import { GLYPH_SLOTS, GROUPS, PET_COPY, READOUTS, type BenchItem, type Frame, type View } from './catalog'
import '../styles/bench.css'

// The art bench: http://localhost:5199/?art in `npm run web`, kept open beside Aseprite. Every sprite
// lib/art.ts knows, at 1x and at the scale the app shows it, and the pet and the shelf drawn in place
// by the app's own components. One not drawn yet is a dashed box with what the app shows meanwhile,
// never a stand-in drawing.
//
// A save reaches the page without a reload: `npm run art -- --watch` copies the PNG, Vite re-runs
// lib/art.ts (a fresh ?t= on every URL), and this module, which imports it and exports only a
// component, is a Fast Refresh boundary, so it runs again and redraws with the new URLs. That is why
// every image here reads art() as it renders and nothing keeps a URL in state.

/** Ledger glyph files present, by name alone; lazy, so nothing loads here. Adding one re-runs this module. */
const glyphFiles = import.meta.glob('../assets/art/glyph.*.png')

type Backdrop = 'dark' | 'light' | 'checker'
const BACKDROPS: Backdrop[] = ['dark', 'light', 'checker']
const PREFS = 'mayorly.bench'

/** The backdrop and the Mac window's outline, remembered in this browser only. */
function readPrefs(): { backdrop: Backdrop; guides: boolean } {
  try {
    const p = JSON.parse(localStorage.getItem(PREFS) ?? '{}') as { backdrop?: Backdrop; guides?: boolean }
    return { backdrop: BACKDROPS.includes(p.backdrop as Backdrop) ? (p.backdrop as Backdrop) : 'dark', guides: p.guides !== false }
  } catch {
    return { backdrop: 'dark', guides: true }
  }
}

/** Screen pixels per CSS pixel. At a fraction, art pixels cannot all come out the same size. */
function useRatio(): number {
  const [ratio, setRatio] = useState(() => (typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1))
  useEffect(() => {
    const on = () => setRatio(window.devicePixelRatio || 1)
    window.addEventListener('resize', on)
    return () => window.removeEventListener('resize', on)
  }, [])
  return ratio
}

const canvasLine = (s: ArtSpec) => (s.frames > 1 ? `${s.w}x${s.h}, ${s.frames} frames in a ${s.w}x${s.h * s.frames} strip` : `${s.w}x${s.h}`)

/** A glyph file's Phosphor name: glyph.briefcase_metal is briefcase-metal. */
const glyphName = (id: string) => id.slice('glyph.'.length).replace(/_/g, '-')

/** Every glyph on the bench: the three slots, then any other glyph file, by its Phosphor name. */
function glyphNames(): string[] {
  const names = GLYPH_SLOTS.map((g) => g.name)
  for (const path of Object.keys(glyphFiles)) {
    const name = glyphName(path.slice(path.lastIndexOf('/') + 1, -'.png'.length))
    if (!names.includes(name)) names.push(name)
  }
  return names
}

function glyphItem(name: string): BenchItem {
  const slot = GLYPH_SLOTS.find((g) => g.name === name)
  return {
    id: glyphArt(name),
    where: slot?.where ?? `Any ledger whose glyph is ${name}.`,
    today: `Phosphor ${name}, from the glyph catalogue.`,
    views: [{ scale: 1 }, { scale: 2 }],
  }
}

/** One view of a sprite: a stage to sit on, and what it is below. */
function Shot({ label, warn, children }: { label: string; warn?: string; children: ReactNode }) {
  return (
    <figure className="bench-view">
      <div className="bench-stage">{children}</div>
      <figcaption>{label}</figcaption>
      {warn && <p className="bench-warn">{warn}</p>}
    </figure>
  )
}

/** Where a sprite will go, while it is not drawn: a dashed box its size, with what the app shows. */
function Missing({ w, h, children, style }: { w?: number; h?: number; children?: ReactNode; style?: CSSProperties }) {
  return <span className="bench-missing" style={{ width: w, height: h, ...style }}>{children}</span>
}

/** The stock icon the app shows meanwhile, at a size; inside a dashed box, so 2 px under its edge. */
type Stand = ((size: number) => ReactNode) | undefined

/** The file as saved, at 1x and its own size, with a word when that is not the canvas the app expects. */
function Raw({ id, use, stand }: { id: ArtId; use?: string; stand?: Stand }) {
  const url = art(id)
  const s = specOf(id)
  const [got, setGot] = useState<{ url: string; w: number; h: number } | null>(null)
  const label = `1x${use ? `, ${use}` : ''}${s.frames > 1 ? ', the strip' : ''}`
  if (!url) return <Shot label={label}><Missing w={s.w} h={s.h * s.frames}>{stand?.(Math.min(s.w, s.h) - 2)}</Missing></Shot>
  const off = got && got.url === url && (got.w !== s.w || got.h !== s.h * s.frames)
  return (
    <Shot label={label} warn={off ? `The file is ${got.w}x${got.h}; the app expects ${s.w}x${s.h * s.frames}.` : undefined}>
      <img className="px" src={url} alt="" draggable={false} onLoad={(e) => setGot({ url, w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })} />
    </Shot>
  )
}

/** A sprite at a whole scale, played if it is a strip. */
function Scaled({ id, view, fps = 4, stand }: { id: ArtId; view: View; fps?: number; stand?: Stand }) {
  const s = specOf(id)
  const label = `${view.scale}x${view.use ? `, ${view.use}` : ''}${s.frames > 1 ? `, ${fps} frames a second` : ''}`
  if (!art(id)) return <Shot label={label}><Missing w={s.w * view.scale} h={s.h * view.scale}>{stand?.(Math.min(s.w, s.h) * view.scale - 2)}</Missing></Shot>
  return <Shot label={label}>{s.frames > 1 ? <PixelAnim id={id} scale={view.scale} fps={fps} /> : <Pixel id={id} scale={view.scale} />}</Shot>
}

/** Tiles side by side, to see the seams. */
function Swatch({ rows, scale = 2 }: { rows: ArtId[][]; scale?: number }) {
  const n = specOf(rows[0][0]).w * scale
  return (
    <Shot label={`${scale}x, repeated`}>
      <span className="bench-swatch" style={{ gridTemplateColumns: `repeat(${rows[0].length}, ${n}px)` }}>
        {rows.flatMap((ids, r) =>
          ids.map((id, c) => {
            const url = art(id)
            return url ? <img key={`${r}.${c}`} className="px" src={url} width={n} height={n} alt="" draggable={false} /> : <Missing key={`${r}.${c}`} w={n} h={n} />
          }),
        )}
      </span>
    </Shot>
  )
}

/** A frame as the app draws it (ui9Frame), on a box of a whole size. */
function NineSlice({ id, frame }: { id: ArtId; frame: Frame }) {
  const css = ui9Frame(id, frame.scale, { slice: frame.slice, fill: frame.fill })
  const label = `${frame.scale}x, ${frame.use}, ${frame.w}x${frame.h}`
  if (!css) return <Shot label={label}><Missing w={frame.w} h={frame.h} style={{ fontSize: 14 }}>glass plate</Missing></Shot>
  const ink = !frame.fill ? 'is-open' : frame.darkInk ? 'is-dark-ink' : ''
  return <Shot label={label}><span className={`bench-nine ${ink}`} style={{ ...css, width: frame.w, height: frame.h }}>{frame.use}</span></Shot>
}

/** A number in the founder's digits as the app shows it (PixelNumber); the app's text while not drawn. */
function Readout({ text, scale, use, maxWidth, font }: (typeof READOUTS)[number]) {
  return (
    <Shot label={`${scale}x, ${use}`}>
      <PixelNumber text={text} scale={scale} maxWidth={maxWidth} className="bench-num" fallback={<Missing style={{ height: font + 4, padding: '0 4px', fontSize: font }}>{text}</Missing>} />
    </Shot>
  )
}

/** A sprite's card: its id, its canvas, whether it is drawn, where it shows, then its views. */
function Tile({ id, where, today, note, children }: { id: ArtId; where: string; today: string; note?: ReactNode; children: ReactNode }) {
  const drawn = !!art(id)
  return (
    <article className={`bench-tile ${drawn ? 'is-drawn' : 'is-missing'}`}>
      <header className="bench-tile-head">
        <code className="bench-id">{id}</code>
        <span className="bench-badge">{drawn ? 'Drawn' : 'Not drawn'}</span>
      </header>
      <p className="bench-meta">{canvasLine(specOf(id))}</p>
      <p className="bench-where">{where}</p>
      {!drawn && <p className="bench-today">Until it is drawn: {today}</p>}
      {note}
      <div className="bench-views">{children}</div>
    </article>
  )
}

function ItemTile({ item, note }: { item: BenchItem; note?: ReactNode }) {
  const s = specOf(item.id)
  const Stock = item.stand
  const stand: Stand = Stock ? (size) => <Stock size={size} /> : item.id.startsWith('glyph.') ? (size) => <Glyph name={glyphName(item.id)} size={size} /> : undefined
  const one = item.views.find((v) => v.scale === 1)
  return (
    <Tile id={item.id} where={item.where} today={item.today} note={note}>
      <Raw id={item.id} use={one?.use} stand={stand} />
      {item.views
        .filter((v) => v.scale > 1 || s.frames > 1)
        .map((v) => <Scaled key={v.scale} id={item.id} view={v} fps={item.fps} stand={stand} />)}
      {item.swatch && <Swatch rows={item.swatch} />}
      {item.frame && <NineSlice id={item.id} frame={item.frame} />}
      {item.digits && READOUTS.map((r) => <Readout key={r.use} {...r} />)}
    </Tile>
  )
}

/** The Mac's pet window at scale 1 (petBox in shared/pet.ts): the pet, and its inset all round. */
const WINDOW = { w: PET.width + INSET.x * 2, h: PET.height + INSET.y * 2 }
/** The sign's column ends this far from the tomato (`.pet` in hud.css). */
const GAP = 10
/** The sign's colour by state, as Pet.tsx gives `.pet-sign` its tone; a carried or hopping pet is at work. */
const TONE: Partial<Record<PetState, string>> = { rest: 'rest', couch: 'couch', hold: 'hold', idle: 'idle' }
const [SIGN, COUNT] = READOUTS

/**
 * A state in the pet's corner, built from the app's own pieces: the sign and count in hud.css's
 * classes reading 20:57 and 2.2 (in the founder's digits once drawn), and PetSprite on the 48 px
 * tomato, or the plain tomato with a dashed box where the drawing will go.
 */
function Corner({ state }: { state: PetState }) {
  const id = PET_ART[state]
  const s = specOf(id)
  const tone = TONE[state] ?? 'live'
  // Where PetSprite puts a drawing: whole art pixels out from the tomato's corner.
  const canvas: CSSProperties = { position: 'absolute', left: Math.floor((16 - s.w) / 2) * 3, top: Math.floor((16 - s.h) / 2) * 3 }
  const plain = art('icon.tomato')
  return (
    <Shot label="3x, in the pet's corner">
      <span className="bench-plate">
        <span className="bench-window" style={{ width: WINDOW.w, height: WINDOW.h }}>
          <span className="pet-col bench-at" style={{ right: INSET.x + TOMATO + GAP, bottom: INSET.y }}>
            <span className="pet-sign-row">
              {tone !== 'idle' && (
                <span className="pet-count num">
                  <PixelNumber text={COUNT.text} scale={COUNT.scale} maxWidth={COUNT.maxWidth} />
                </span>
              )}
              <span className={`pet-sign num tone-${tone}`}>
                <PixelNumber text={SIGN.text} scale={SIGN.scale} maxWidth={SIGN.maxWidth} />
              </span>
            </span>
          </span>
          <span className="bench-at" style={{ right: INSET.x, bottom: INSET.y, width: TOMATO, height: TOMATO }}>
            {art(id) ? (
              <PetSprite state={state} />
            ) : (
              <>
                {plain && <img className="pet-sprite" src={plain} alt="" draggable={false} />}
                <Missing w={s.w * 3} h={s.h * 3} style={canvas} />
              </>
            )}
          </span>
        </span>
      </span>
    </Shot>
  )
}

function PetTile({ state }: { state: PetState }) {
  const id = PET_ART[state]
  const copy = PET_COPY[state] ?? { where: `The pet: ${state}.`, today: 'the plain tomato.' }
  return (
    <Tile id={id} where={copy.where} today={copy.today}>
      <Corner state={state} />
      <Raw id={id} />
    </Tile>
  )
}

/** Two shelves from the browser preview's sample: nine ledgers, two of them yours, a block running and a letter in the tray, then the desk idle and the tray empty. */
function sampleShelves(): { working: MayorlyState; idle: MayorlyState } {
  const demo = demoState(Date.now(), () => crypto.randomUUID())
  const ledgers = demo.ledgers.length
    ? Array.from({ length: LEDGER_CAP }, (_, i) => ({ ...demo.ledgers[i % demo.ledgers.length], id: `bench-${i}`, handWritten: i === 2 || i === 6 }))
    : []
  return {
    working: { ...demo, ledgers },
    idle: { ...demo, ledgers, desk: { ...demo.desk, status: 'idle' }, entries: demo.entries.filter((e) => e.ledgerId !== null) },
  }
}

/** The top of the Shelf tab, drawn by the app itself (ShelfScene), so every piece shows where it stands. */
function SceneTile() {
  const [shelves] = useState(sampleShelves)
  const drawn = !!art('prop2x4.bookshelf')
  // ShelfScene draws at 2x.
  const box = { w: SCENE.w * 2, h: SCENE.h * 2 }
  return (
    <article className={`bench-tile bench-tile-wide ${drawn ? 'is-drawn' : 'is-missing'}`}>
      <p className="bench-name">The Shelf tab, in place</p>
      <p className="bench-where">Your wall, floor, bookshelf and desk as the app lays them out, with nine sample ledgers (two hand-written, so locked), the mail tray while a letter waits, and the clerk once drawn.</p>
      {!drawn && <p className="bench-today">Until the bookshelf is drawn: the Shelf tab shows its cards alone.</p>}
      <div className="bench-views">
        <Shot label="2x, a block running">{drawn ? <ShelfScene s={shelves.working} /> : <Missing w={box.w} h={box.h} />}</Shot>
        <Shot label="2x, the desk idle">{drawn ? <ShelfScene s={shelves.idle} /> : <Missing w={box.w} h={box.h} />}</Shot>
      </div>
    </article>
  )
}

interface Section {
  key: string
  title: string
  note: string
  ids: ArtId[]
  tiles: ReactNode[]
}

/** The page: the groups in catalog.ts, the pet from PET_ART, the glyphs present, and anything else lib/art.ts knows. */
function sections(): Section[] {
  const states = Object.keys(PET_ART) as PetState[]
  const out: Section[] = GROUPS.map((g) => {
    if (g.key === 'pet') return { ...g, ids: states.map((st) => PET_ART[st]), tiles: states.map((st) => <PetTile key={st} state={st} />) }
    const items = g.key === 'glyphs' ? glyphNames().map(glyphItem) : g.items
    const tiles = items.map((it) => {
      const unknown = g.key === 'glyphs' && !GLYPH_NAMES.includes(glyphName(it.id))
      const note = unknown ? <p className="bench-warn">No ledger glyph is named {glyphName(it.id)}, so the app never shows this file. The names are in lib/glyphs.tsx.</p> : undefined
      return <ItemTile key={it.id} item={it} note={note} />
    })
    if (g.key === 'scene') tiles.unshift(<SceneTile key="scene" />)
    return { ...g, ids: items.map((it) => it.id), tiles }
  })
  const placed = new Set<string>(out.flatMap((sec) => sec.ids))
  const rest = (Object.keys(ART) as ArtId[]).filter((id) => !placed.has(id))
  if (rest.length) {
    const items: BenchItem[] = rest.map((id) => ({ id, where: 'In lib/art.ts, not placed on this page yet.', today: 'nothing yet.', views: [{ scale: 1 }, { scale: 2 }] }))
    out.push({ key: 'other', title: 'Not placed yet', note: 'Sprites lib/art.ts knows that this page has no words for.', ids: rest, tiles: items.map((it) => <ItemTile key={it.id} item={it} />) })
  }
  return out
}

export function Bench() {
  const [prefs, setPrefs] = useState(readPrefs)
  const ratio = useRatio()
  useEffect(() => {
    try {
      localStorage.setItem(PREFS, JSON.stringify(prefs))
    } catch {
      /* storage unavailable: the choice lasts this visit */
    }
  }, [prefs])
  useEffect(() => {
    document.title = 'Mayorly art bench'
  }, [])

  const all = sections()
  const count = (ids: ArtId[]) => ids.filter((id) => art(id)).length
  const ids = all.flatMap((sec) => sec.ids)

  return (
    <main className="bench" data-backdrop={prefs.backdrop} data-guides={prefs.guides ? 'on' : 'off'}>
      <header className="bench-head">
        <h1 className="bench-title">Art bench</h1>
        <p className="bench-lede">
          Draw in Aseprite and save. With <code>npm run art -- --watch</code> running, each save shows up here within a second, at 1x and at the size the app shows it.
        </p>
        <p className="bench-lede">
          {count(ids)} of {ids.length} drawn. A magenta dashed box is a sprite not drawn yet, with what the app shows meanwhile.
        </p>
        {ratio % 1 !== 0 && (
          <p className="bench-warn">
            This screen shows {Math.round(ratio * 100)}% (browser zoom or the display's scale), so art pixels cannot all be the same size. Ctrl+0 resets the browser's zoom.
          </p>
        )}
        <div className="bench-controls">
          <span className="bench-control">
            Backdrop
            {BACKDROPS.map((b) => (
              <button key={b} type="button" className={prefs.backdrop === b ? 'is-on' : ''} onClick={() => setPrefs({ ...prefs, backdrop: b })}>
                {b === 'dark' ? 'Dark' : b === 'light' ? 'Light' : 'Checker'}
              </button>
            ))}
          </span>
          <span className="bench-control">
            Mac window
            <button type="button" className={prefs.guides ? 'is-on' : ''} onClick={() => setPrefs({ ...prefs, guides: !prefs.guides })}>
              {prefs.guides ? 'Shown' : 'Hidden'}
            </button>
          </span>
        </div>
        <nav className="bench-nav">
          {all.map((sec) => (
            <a key={sec.key} href={`#bench-${sec.key}`}>
              {sec.title}
              <span className="bench-count">
                {count(sec.ids)}/{sec.ids.length}
              </span>
            </a>
          ))}
        </nav>
      </header>
      {all.map((sec) => (
        <section key={sec.key} id={`bench-${sec.key}`} className="bench-group">
          <h2 className="bench-group-title">
            {sec.title}
            <span className="bench-count">
              {count(sec.ids)} of {sec.ids.length} drawn
            </span>
          </h2>
          <p className="bench-note">{sec.note}</p>
          <div className="bench-grid">{sec.tiles}</div>
        </section>
      ))}
    </main>
  )
}
