import { Menu, Tray, nativeImage, shell, app } from 'electron'
import { blockView, clock, type MayorlyState } from '@core/index'
import trayIcon from '../../build/tray.png?asset'
import type { Engine } from './engine'
import type { Overlay } from './overlay'

export interface TrayActions {
  command: (cmd: 'plus' | 'capture' | 'deck') => void
  togglePause: () => void
  dataDir: string
}

export function createTray(engine: Engine, overlay: Overlay, act: TrayActions): Tray {
  const tray = new Tray(nativeImage.createFromPath(trayIcon))
  tray.setToolTip('Mayorly')
  tray.on('click', () => act.command('deck'))

  const rebuild = (s: MayorlyState) => {
    const v = blockView(s, Date.now())
    const status =
      !v ? 'Desk idle'
        : v.status === 'paused' ? `Holding  ${v.block.label}`
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
    const key = JSON.stringify([s.desk.status, s.desk.block?.label, s.desk.block?.entryId, s.settings.hotkeys, s.settings.openAtLogin])
    if (key !== last) {
      last = key
      rebuild(s)
    }
  })
  return tray
}
