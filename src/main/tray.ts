import { Menu, Tray, nativeImage, shell, app, type NativeImage } from 'electron'
import { blockView, clock, type MayorlyState } from '@core/index'
import tray1x from '../../build/tomato@1x.png?asset'
import tray2x from '../../build/tray.png?asset'
import type { Engine } from './engine'
import type { Overlay } from './overlay'

export interface TrayActions {
  command: (cmd: 'plus' | 'capture' | 'deck') => void
  togglePause: () => void
  dataDir: string
}

/**
 * Windows takes the 2x tomato and scales it to the tray. The macOS menu bar is 16 points,
 * so it gets the hand-drawn 16 px tomato as 1x and the same pixels doubled as 2x; file
 * name conventions (@2x) do not survive bundling, so the pair is built here.
 */
function trayImage(): NativeImage {
  if (process.platform !== 'darwin') return nativeImage.createFromPath(tray2x)
  const img = nativeImage.createFromPath(tray1x)
  const twice = nativeImage.createFromPath(tray2x)
  img.addRepresentation({ scaleFactor: 2, width: 32, height: 32, buffer: twice.toBitmap() })
  return img
}

export function createTray(engine: Engine, overlay: Overlay, act: TrayActions): Tray {
  const tray = new Tray(trayImage())
  tray.setToolTip('Mayorly')
  // On macOS a click opens the menu itself (and would fire this as well); Deck is in the menu.
  if (process.platform !== 'darwin') tray.on('click', () => act.command('deck'))

  const rebuild = (s: MayorlyState) => {
    const v = blockView(s, Date.now())
    const status =
      !v ? 'Desk idle'
        : v.status === 'paused' ? `Holding  ${v.block.label}`
          : v.block.kind === 'leisure' ? `Couch  ${v.block.label}  ${v.remainingMs !== null ? clock(v.remainingMs) : ''}`
          : v.block.kind === 'rest' ? `${v.block.label}  ${v.remainingMs !== null ? clock(v.remainingMs) : ''}`
            : `${v.ledger?.code ?? 'FREE'}  ${v.entry?.title ?? v.block.label}`
    tray.setToolTip(`Mayorly  ${status}`)
    const hk = s.settings.hotkeys
    const menu = Menu.buildFromTemplate([
      { label: status, enabled: false },
      { type: 'separator' },
      { label: 'Swap', accelerator: hk.plus, click: () => act.command('plus') },
      { label: 'Capture', accelerator: hk.capture, click: () => act.command('capture') },
      { label: 'Deck', accelerator: hk.deck, click: () => act.command('deck') },
      {
        label: s.desk.status === 'running' ? 'Hold' : 'Resume',
        accelerator: hk.pause,
        enabled: s.desk.status !== 'idle',
        click: act.togglePause,
      },
      { label: overlay.win.isVisible() ? 'Hide HUD' : 'Show HUD', accelerator: hk.hide, click: () => { overlay.toggleVisible(); rebuild(engine.state) } },
      { label: s.desk.holster ? `Switch to ${s.desk.holster.block.label}` : 'Switch session', accelerator: hk.switch, enabled: !!s.desk.holster, click: () => engine.dispatch({ type: 'desk/switch' }) },
      { type: 'separator' },
      {
        label: 'Display',
        submenu: overlay.displays().map((d) => ({
          label: d.label,
          type: 'radio' as const,
          checked: d.current,
          click: () => overlay.moveTo(d.id),
        })),
      },
      {
        label: 'Open at login',
        type: 'checkbox',
        checked: s.settings.openAtLogin,
        click: (item) => engine.dispatch({ type: 'settings/update', patch: { openAtLogin: item.checked } }),
      },
      { label: 'Open data folder', click: () => void shell.openPath(act.dataDir) },
      { type: 'separator' },
      { label: 'Quit Mayorly', click: () => app.quit() },
    ])
    tray.setContextMenu(menu)
  }

  rebuild(engine.state)
  let last = ''
  engine.on((s) => {
    // Only rebuild when something the menu shows has changed, not on every tick.
    const key = JSON.stringify([s.desk.status, s.desk.block?.label, s.desk.block?.entryId, s.desk.holster?.block.label ?? null, s.settings.hotkeys, s.settings.openAtLogin])
    if (key !== last) {
      last = key
      rebuild(s)
    }
  })
  return tray
}
