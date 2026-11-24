import type { CSSProperties } from 'react'
import { LEDGER_CAP, tray, type MayorlyState } from '@core/index'
import { art } from '../lib/art'
import { Pixel } from '../lib/Pixel'
import { ledgerVars } from '../lib/themes'
import { BASE, CLERK, DESK, placeFurniture, SCENE, SHELF, SPINE, spineAt, TILE, TRAY_ON_DESK, wallRows, type RoomLayout } from './shelfLayout'

// The top of the Shelf tab: the founder's hall in one picture. His wall and floor, his bookshelf
// with a spine for every ledger (a locked one for each he wrote himself), his desk beside it, the
// lamp lit while a block runs once desk.working is drawn, the mail tray on it while the tray holds
// entries, and the clerk by the shelf once drawn. It reads at a glance and needs no click; a
// spine opens its ledger like the cards below. Nothing shows until the bookshelf is drawn.

/** Screen pixels per art pixel, for every piece of the scene. */
const K = 2

const at = (x: number, y: number): CSSProperties => ({ left: x * K, top: y * K })

export function ShelfScene({ s, open }: { s: MayorlyState; open?: (ledgerId: string) => void }) {
  if (!art('prop2x4.bookshelf')) return null
  const wall = art('tile.wall.plaster')
  const floor = art('tile.floor.wood')
  const clerk = !!art('char.clerk.stand')
  const pos = placeFurniture(clerk)

  const ledgers = s.ledgers.slice(0, LEDGER_CAP)
  const mine = ledgers.filter((l) => l.handWritten).length
  const inTray = tray(s).length
  const working = s.desk.status === 'running' && s.desk.block?.kind === 'focus'
  const desk = working && art('prop2x2.desk.working') ? 'prop2x2.desk.working' : 'prop2x2.desk.idle'
  const deskTop = BASE - DESK.h

  const tile = `${TILE * K}px ${TILE * K}px`
  const rows = wallRows()
  const summary = [
    `${ledgers.length} of ${LEDGER_CAP} ledgers on the shelf, ${mine} hand-written.`,
    inTray ? `${inTray} in the tray.` : 'The tray is empty.',
    working ? 'A block runs at the desk.' : 'The desk is idle.',
  ].join(' ')

  return (
    <div className="shelf-scene" role="group" aria-label={summary} style={{ width: SCENE.w * K, height: SCENE.h * K, '--k': `${K}px` } as CSSProperties}>
      {wall && (
        <div
          className="shelf-scene-wall"
          style={{
            height: SCENE.wall * K,
            backgroundImage: rows.map(() => `url("${wall}")`).join(', '),
            backgroundPosition: rows.map((y) => `0 ${y * K}px`).join(', '),
            backgroundSize: tile,
            backgroundRepeat: 'repeat-x',
          }}
        />
      )}
      {floor && (
        <div
          className="shelf-scene-floor"
          style={{ top: SCENE.wall * K, height: (SCENE.h - SCENE.wall) * K, backgroundImage: `url("${floor}")`, backgroundSize: tile }}
        />
      )}
      {pos.clerk !== null && <Pixel id="char.clerk.stand" scale={K} className="shelf-scene-thing" style={at(pos.clerk, BASE - CLERK.h)} title="The clerk" />}
      <Pixel id="prop2x4.bookshelf" scale={K} className="shelf-scene-thing" style={at(pos.shelf, BASE - SHELF.h)} />
      {ledgers.map((l, i) => {
        const p = spineAt(i)
        return (
          <button
            key={l.id}
            type="button"
            className="shelf-spine"
            style={{ ...at(pos.shelf + p.x, BASE - SHELF.h + p.y), width: SPINE.w * K, height: SPINE.h * K, ...ledgerVars(l) }}
            title={`${l.code} ${l.name}`}
            aria-label={`Open ${l.code} ${l.name}`}
            onClick={() => open?.(l.id)}
            // Enter or Space on a focused spine is this spine's, not the Shelf grid's keys (which open the selected card).
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') e.stopPropagation()
            }}
          >
            {/* The whole icon, placed so its spine fills the button; it never takes the pointer, so a neighbour's margin never steals a click. */}
            <Pixel
              id={l.handWritten ? 'icon.ledger.locked' : 'icon.ledger.closed'}
              scale={K}
              className="shelf-spine-px"
              style={at(-SPINE.x, -SPINE.y)}
              fallback={<span className="shelf-spine-empty" />}
            />
          </button>
        )
      })}
      <Pixel id={desk} scale={K} className="shelf-scene-thing" style={at(pos.desk, deskTop)} title={working ? 'A block runs at the desk' : 'The desk'} />
      {inTray > 0 && (
        <Pixel
          id="prop1x1.mailtray"
          scale={K}
          className="shelf-scene-thing"
          style={at(pos.desk + TRAY_ON_DESK.x, deskTop + TRAY_ON_DESK.y)}
          title={`${inTray} in the tray`}
        />
      )}
    </div>
  )
}

/**
 * The Shelf tab as the founder's room (`roomLayout`): his wall tiled across the whole tab and his
 * floor along its foot, his bookshelf at one side with a spine for every ledger and his desk at the
 * other, all at one whole scale. The cards hang on the wall between them (ShelfTab draws them over
 * this); a spine and its card light together (`hot`), and the bay the keys are on shows on its spine.
 */
export function ShelfRoomArt({ s, room, hot, picked, onHot, open }: { s: MayorlyState; room: RoomLayout; hot: string | null; picked: string | null; onHot: (id: string | null) => void; open: (ledgerId: string) => void }) {
  const K = room.k
  const wall = art('tile.wall.plaster')
  const floor = art('tile.floor.wood')
  const ledgers = s.ledgers.slice(0, LEDGER_CAP)
  const inTray = tray(s).length
  const working = s.desk.status === 'running' && s.desk.block?.kind === 'focus'
  const desk = working && art('prop2x2.desk.working') ? 'prop2x2.desk.working' : 'prop2x2.desk.idle'
  const tile = `${TILE * K}px ${TILE * K}px`
  const rows = wallRows(room.wall)
  const px = (x: number, y: number): CSSProperties => ({ left: x, top: y })
  return (
    <div className="shelf-room-art" aria-hidden={false}>
      {wall && (
        <div
          className="shelf-scene-wall"
          style={{
            height: room.wall * K,
            backgroundImage: rows.map(() => `url("${wall}")`).join(', '),
            backgroundPosition: rows.map((y) => `0 ${y * K}px`).join(', '),
            backgroundSize: tile,
            backgroundRepeat: 'repeat-x',
          }}
        />
      )}
      {floor && <div className="shelf-scene-floor" style={{ top: room.wall * K, height: TILE * K, backgroundImage: `url("${floor}")`, backgroundSize: tile }} />}
      {room.clerk !== null && art('char.clerk.stand') && <Pixel id="char.clerk.stand" scale={K} className="shelf-scene-thing" style={px(room.clerk, (room.wall + 4 - CLERK.h) * K)} title="The clerk" />}
      <Pixel id="prop2x4.bookshelf" scale={K} className="shelf-scene-thing" style={px(room.shelf, room.shelfTop)} />
      {ledgers.map((l, i) => {
        const p = spineAt(i)
        return (
          <button
            key={l.id}
            type="button"
            className={`shelf-spine ${hot === l.id ? 'is-hot' : ''} ${picked === l.id ? 'is-picked' : ''}`}
            style={{ ...px(room.shelf + p.x * K, room.shelfTop + p.y * K), width: SPINE.w * K, height: SPINE.h * K, ...ledgerVars(l) }}
            title={`${l.code} ${l.name}`}
            aria-label={`Open ${l.code} ${l.name}`}
            onClick={() => open(l.id)}
            onMouseEnter={() => onHot(l.id)}
            onMouseLeave={() => onHot(null)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') e.stopPropagation()
            }}
          >
            <Pixel
              id={l.handWritten ? 'icon.ledger.locked' : 'icon.ledger.closed'}
              scale={K}
              className="shelf-spine-px"
              style={{ left: -SPINE.x * K, top: -SPINE.y * K }}
              fallback={<span className="shelf-spine-empty" />}
            />
          </button>
        )
      })}
      <Pixel id={desk} scale={K} className="shelf-scene-thing" style={px(room.desk, room.deskTop)} title={working ? 'A block runs at the desk' : 'The desk'} />
      {inTray > 0 && (
        <Pixel
          id="prop1x1.mailtray"
          scale={K}
          className="shelf-scene-thing"
          style={px(room.desk + TRAY_ON_DESK.x * K, room.deskTop + TRAY_ON_DESK.y * K)}
          title={`${inTray} in the tray`}
        />
      )}
    </div>
  )
}
