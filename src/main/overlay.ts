import { join } from 'node:path'
import { BrowserWindow, screen, type Display } from 'electron'
import type { UiMode } from '../shared/bridge'

// One transparent, always-on-top window covering the work area of a display.
// In field mode it ignores the mouse (with move events forwarded so the HUD can
// still react to hover) and can never take focus, so it never steals a keystroke
// from the app you are working in. The other modes take focus until closed.

export class Overlay {
  win: BrowserWindow
  mode: UiMode = 'field'
  private hit = false
  private displayId: number

  constructor() {
    const display = screen.getPrimaryDisplay()
    this.displayId = display.id
    this.win = new BrowserWindow({
      ...display.workArea,
      show: false,
      frame: false,
      transparent: true,
      backgroundColor: '#00000000',
      hasShadow: false,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      focusable: false,
      alwaysOnTop: true,
      title: 'Mayorly',
      webPreferences: {
        preload: join(__dirname, '../preload/index.cjs'),
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        backgroundThrottling: false,
        spellcheck: false,
      },
    })
    this.pin()
    this.win.setIgnoreMouseEvents(true, { forward: true })
    this.win.once('ready-to-show', () => this.win.showInactive())

    screen.on('display-metrics-changed', () => this.fit())
    screen.on('display-removed', () => this.fit())
  }

  load() {
    if (process.env.ELECTRON_RENDERER_URL) void this.win.loadURL(process.env.ELECTRON_RENDERER_URL)
    else void this.win.loadFile(join(__dirname, '../renderer/index.html'))
  }

  /** Re-assert topmost. Some focus changes on Windows quietly drop the level. */
  private pin() {
    this.win.setAlwaysOnTop(true, 'screen-saver')
  }

  setMode(mode: UiMode) {
    if (this.win.isDestroyed()) return
    this.mode = mode
    if (mode === 'field') {
      this.win.blur()
      this.win.setFocusable(false)
      this.win.setIgnoreMouseEvents(!this.hit, { forward: true })
    } else {
      if (!this.win.isVisible()) this.win.showInactive()
      this.win.setIgnoreMouseEvents(false)
      this.win.setFocusable(true)
      this.win.focus()
      this.win.webContents.focus()
    }
    this.pin()
  }

  setHit(hit: boolean) {
    this.hit = hit
    if (this.mode === 'field' && !this.win.isDestroyed()) this.win.setIgnoreMouseEvents(!hit, { forward: true })
  }

  toggleVisible() {
    if (this.win.isVisible()) {
      this.win.hide()
    } else {
      this.win.showInactive()
      this.pin()
    }
  }

  displays() {
    const primary = screen.getPrimaryDisplay().id
    return screen.getAllDisplays().map((d, i) => ({
      id: d.id,
      label: `Display ${i + 1}  ${d.size.width}x${d.size.height}${d.id === primary ? '  (primary)' : ''}`,
      primary: d.id === primary,
      current: d.id === this.displayId,
    }))
  }

  moveTo(displayId: number) {
    this.displayId = displayId
    this.fit()
  }

  private fit() {
    const all = screen.getAllDisplays()
    const target: Display = all.find((d) => d.id === this.displayId) ?? screen.getPrimaryDisplay()
    this.displayId = target.id
    this.win.setBounds(target.workArea)
    this.pin()
  }
}
