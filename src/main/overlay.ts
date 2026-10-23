import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { BrowserWindow, screen, type Display, type Rectangle } from 'electron'
import { IPC, type Layout, type UiMode } from '../shared/bridge'

// One transparent, always-on-top, frameless window.
//
// Windows: it covers the work area. In field mode it ignores the mouse (with move
// events forwarded so the HUD can react to hover) and can never take focus, so it
// never steals a keystroke from the app you are working in. The other modes take
// focus until closed.
//
// macOS: in field mode the window is only as big as the pet, sits where the tomato was dragged, and takes clicks like any
// small floating window. Nothing is click-through. The tomato is a native drag
// region, so the window server moves the window itself; when the move settles the
// window is hung off the tomato again on the side it now favours. Plus, deck and
// capture grow it to the work area. It is a panel, so it can take typing without
// activating Mayorly, and closing them leaves the app you were in active.

const mac = process.platform === 'darwin'
const debug = process.env.MAYORLY_DEBUG ? (...a: unknown[]) => console.error('[overlay]', ...a) : () => {}

/** The pet at HUD scale 1: the fixed-width sign, the gap, the tomato, and the hop's headroom.
 * The window is exactly this at the HUD scale, so nothing invisible catches a click, and it is
 * never resized on hover: a resize paints one frame of old content at the new position and the
 * tomato jumps. The caption is a separate click-through window. Matches `body.compact` in hud.css. */
const PET = { width: 80 + 10 + 48, height: 48 + 8 }
/** The pet's own corner inside the window; matches `body.compact .pet-wrap` in hud.css. */
const INSET = { x: 4, y: 4 }
/** The caption window: generous, because it is click-through; the text hugs the tomato's side. */
const CAPTION = { width: 360, height: 40 }
/** The tomato sprite at scale 1, so the window can be placed around its centre. */
const TOMATO = 48
/** How often the cursor is sampled for hover on macOS. */
const HOVER_POLL_MS = 40
/** A window move with no further movement for this long has settled. */
const MOVE_SETTLE_MS = 180

/** The tomato's bottom centre, in screen points. The side it favours decides how the window hangs off it. */
interface Anchor {
  x: number
  y: number
}

export class Overlay {
  win: BrowserWindow
  mode: UiMode = 'field'
  private hit = false
  private displayId: number
  private hoverTimer: NodeJS.Timeout | null = null
  private cursor = { x: NaN, y: NaN, inside: false }
  private anchor: Anchor | null = null
  private scale = 1
  private dragging = false
  private caption: BrowserWindow | null = null
  private captionText: string | null = null
  private fitting = false
  private settle: NodeJS.Timeout | null = null
  private readonly anchorFile: string

  constructor(dataDir: string) {
    this.anchorFile = join(dataDir, 'hud.json')
    if (mac) this.anchor = this.loadAnchor()
    const display = this.anchor ? screen.getDisplayNearestPoint(this.anchor) : screen.getPrimaryDisplay()
    this.displayId = display.id
    this.win = new BrowserWindow({
      ...(mac ? this.fieldBounds(display) : display.workArea),
      show: false,
      frame: false,
      transparent: true,
      backgroundColor: '#00000000',
      hasShadow: false,
      resizable: false,
      // macOS: the tomato is a drag region (hud.css), so the window must be movable.
      movable: mac,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      hiddenInMissionControl: true,
      focusable: false,
      alwaysOnTop: true,
      // The type cannot change after construction.
      ...(mac ? { type: 'panel' as const } : {}),
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
    if (mac) {
      // The process is already a UI element (accessory policy), so skip the transform
      // that would otherwise blink the window.
      this.win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true })
    } else {
      this.win.setIgnoreMouseEvents(true, { forward: true })
    }
    // showInactive, never show: show() would activate the app or make the panel key.
    this.win.once('ready-to-show', () => this.win.showInactive())
    this.win.webContents.on('did-finish-load', () => this.sendLayout())
    if (mac) {
      this.win.on('will-move', () => this.onMoving())
      this.win.on('move', () => this.onMoving())
    }
    this.startHoverPoll()

    screen.on('display-metrics-changed', () => this.fit())
    screen.on('display-removed', () => this.fit())
  }

  load() {
    if (process.env.ELECTRON_RENDERER_URL) void this.win.loadURL(process.env.ELECTRON_RENDERER_URL)
    else void this.win.loadFile(join(__dirname, '../renderer/index.html'))
  }

  /**
   * macOS: the hover caption lives in its own small window beside the pet, always
   * click-through, so the pet window can be exactly the pet. It shows the same
   * renderer in caption mode and gets its text over IPC.
   */
  setCaption(text: string | null) {
    if (!mac || this.win.isDestroyed()) return
    this.captionText = text
    if (!text) {
      this.caption?.hide()
      return
    }
    if (!this.caption) {
      this.caption = new BrowserWindow({
        ...CAPTION,
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
        hiddenInMissionControl: true,
        focusable: false,
        alwaysOnTop: true,
        type: 'panel',
        title: 'Mayorly caption',
        webPreferences: {
          preload: join(__dirname, '../preload/index.cjs'),
          sandbox: true,
          contextIsolation: true,
          nodeIntegration: false,
          backgroundThrottling: false,
          spellcheck: false,
        },
      })
      this.caption.setAlwaysOnTop(true, 'screen-saver')
      this.caption.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true })
      // Display only: every click falls through to whatever is beneath.
      this.caption.setIgnoreMouseEvents(true)
      const page = process.env.ELECTRON_RENDERER_URL ? `${process.env.ELECTRON_RENDERER_URL}?caption` : null
      if (page) void this.caption.loadURL(page)
      else void this.caption.loadFile(join(__dirname, '../renderer/index.html'), { query: { caption: '1' } })
      this.caption.webContents.on('did-finish-load', () => this.pushCaption())
      this.caption.on('closed', () => { this.caption = null })
    }
    this.placeCaption()
    this.pushCaption()
    if (!this.caption.isVisible()) this.caption.showInactive()
  }

  private pushCaption() {
    if (!this.caption || this.caption.isDestroyed()) return
    this.caption.webContents.send(IPC.caption, { text: this.captionText ?? '', side: this.layout().side })
  }

  /** Beside the pet, toward the centre of the screen, level with the sign. */
  private placeCaption() {
    if (!this.caption) return
    const b = this.win.getBounds()
    const wa = this.display().workArea
    const side = this.layout().side
    const x = side === 'right' ? b.x - CAPTION.width + INSET.x : b.x + b.width - INSET.x
    const y = b.y + b.height - INSET.y - Math.round((30 + 8) * this.scale) - Math.round((CAPTION.height - 30 * this.scale) / 2)
    this.caption.setBounds({
      x: Math.round(Math.min(Math.max(x, wa.x), wa.x + wa.width - CAPTION.width)),
      y: Math.round(Math.min(Math.max(y, wa.y), wa.y + wa.height - CAPTION.height)),
      ...CAPTION,
    })
  }

  /** Re-assert topmost. Some focus changes on Windows quietly drop the level. 'screen-saver' is also the right macOS level: above the Dock and menu bar. */
  private pin() {
    this.win.setAlwaysOnTop(true, 'screen-saver')
  }

  setMode(mode: UiMode) {
    if (this.win.isDestroyed()) return
    debug('mode', mode)
    this.mode = mode
    if (mode !== 'field') this.setCaption(null)
    if (mode === 'field') {
      this.win.blur()
      this.win.setFocusable(false)
      if (mac) {
        this.fit()
        this.win.setIgnoreMouseEvents(false)
      } else {
        this.win.setIgnoreMouseEvents(!this.hit, { forward: true })
      }
      this.startHoverPoll()
    } else {
      this.stopHoverPoll()
      if (mac) this.fit()
      if (!this.win.isVisible()) this.win.showInactive()
      this.win.setIgnoreMouseEvents(false)
      this.win.setFocusable(true)
      this.win.focus()
      this.win.webContents.focus()
    }
    this.pin()
  }

  /** Windows field mode: the pointer is over a HUD control, so stop ignoring the mouse. */
  setHit(hit: boolean) {
    this.hit = hit
    if (mac) return
    if (this.mode === 'field' && !this.win.isDestroyed()) this.win.setIgnoreMouseEvents(!hit, { forward: true })
  }

  /** The HUD scale setting: the pet window grows with it so nothing is clipped. */
  setScale(scale: number) {
    const next = Math.min(1.6, Math.max(0.7, Number(scale) || 1))
    if (next === this.scale) return
    this.scale = next
    if (mac && this.mode === 'field') this.fit()
  }

  /** The tomato's half width at the current scale. */
  private get half() {
    return (TOMATO / 2) * this.scale
  }

  /** The user is dragging the window by the tomato. Drop the caption, pause hover, wait for it to settle. */
  private onMoving() {
    if (this.fitting || this.mode !== 'field') return
    if (!this.dragging) {
      this.dragging = true
      this.stopHoverPoll()
      this.setCaption(null)
      this.sendLayout()
    }
    if (this.settle) clearTimeout(this.settle)
    this.settle = setTimeout(() => this.onMoved(), MOVE_SETTLE_MS)
  }

  /** The move settled: read the tomato's new place off the window, re-hang the window around it, remember it. */
  private onMoved() {
    this.settle = null
    this.dragging = false
    const b = this.win.getBounds()
    const wa = this.display().workArea
    const side = this.side(wa, this.anchor ?? this.defaultAnchor(wa))
    const a: Anchor = {
      x: side === 'right' ? b.x + b.width - INSET.x - this.half : b.x + INSET.x + this.half,
      y: b.y + b.height - INSET.y,
    }
    const nearest = screen.getDisplayNearestPoint(a)
    this.displayId = nearest.id
    this.anchor = this.clampAnchor(a, nearest.workArea)
    this.fit()
    this.saveAnchor()
    this.sendLayout()
    this.startHoverPoll()
  }

  toggleVisible() {
    if (this.win.isVisible()) {
      this.win.hide()
      this.setCaption(null)
      this.stopHoverPoll()
    } else {
      this.win.showInactive()
      this.pin()
      this.startHoverPoll()
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
    if (mac) {
      this.anchor = this.defaultAnchor(this.display().workArea)
      this.saveAnchor()
      this.sendLayout()
    }
    this.fit()
  }

  // ---- geometry ----------------------------------------------------------------

  private display(): Display {
    return screen.getAllDisplays().find((d) => d.id === this.displayId) ?? screen.getPrimaryDisplay()
  }

  private fit() {
    const target = this.display()
    this.displayId = target.id
    this.fitting = true
    this.win.setBounds(mac && this.mode === 'field' ? this.fieldBounds(target) : target.workArea)
    this.fitting = false
    this.pin()
  }

  private side(wa: Rectangle, a: Anchor): Layout['side'] {
    return a.x < wa.x + wa.width / 2 ? 'left' : 'right'
  }

  private defaultAnchor(wa: Rectangle): Anchor {
    return { x: wa.x + wa.width - 64 - this.half, y: wa.y + wa.height - 28 }
  }

  private clampAnchor(a: Anchor, wa: Rectangle): Anchor {
    const mx = INSET.x + this.half
    return {
      x: Math.min(Math.max(a.x, wa.x + mx), wa.x + wa.width - mx),
      y: Math.min(Math.max(a.y, wa.y + INSET.y + TOMATO * this.scale), wa.y + wa.height - INSET.y),
    }
  }

  /** The field window, hung off the tomato on the side it favours, kept on screen. */
  private fieldBounds(display: Display): Rectangle {
    const wa = display.workArea
    const a = this.anchor ?? (this.anchor = this.defaultAnchor(wa))
    const size = { width: Math.ceil(PET.width * this.scale) + INSET.x * 2, height: Math.ceil(PET.height * this.scale) + INSET.y * 2 }
    const x = this.side(wa, a) === 'right' ? a.x + this.half + INSET.x - size.width : a.x - this.half - INSET.x
    const y = a.y + INSET.y - size.height
    return {
      x: Math.round(Math.min(Math.max(x, wa.x), wa.x + wa.width - size.width)),
      y: Math.round(Math.min(Math.max(y, wa.y), wa.y + wa.height - size.height)),
      width: size.width,
      height: size.height,
    }
  }

  layout(): Layout {
    const wa = this.display().workArea
    return { compact: mac, side: this.side(wa, this.anchor ?? this.defaultAnchor(wa)), dragging: this.dragging }
  }

  private sendLayout() {
    if (this.win.isDestroyed()) return
    this.win.webContents.send(IPC.layout, this.layout())
  }

  private loadAnchor(): Anchor | null {
    try {
      if (!existsSync(this.anchorFile)) return null
      const raw = JSON.parse(readFileSync(this.anchorFile, 'utf8')) as { anchor?: Anchor }
      const a = raw.anchor
      if (!a || typeof a.x !== 'number' || typeof a.y !== 'number') return null
      return this.clampAnchor(a, screen.getDisplayNearestPoint(a).workArea)
    } catch {
      return null
    }
  }

  private saveAnchor() {
    if (!this.anchor) return
    try {
      writeFileSync(this.anchorFile, JSON.stringify({ anchor: this.anchor }))
    } catch (err) {
      console.error('[overlay] could not save the HUD position:', err)
    }
  }

  // ---- hover on macOS ------------------------------------------------------------
  // AppKit only delivers mouse-moved events to the key window, and in field mode the
  // panel never is one, so the cursor is sampled and the page gets the same mousemove.

  private startHoverPoll() {
    if (!mac || this.hoverTimer) return
    this.hoverTimer = setInterval(() => this.pollCursor(), HOVER_POLL_MS)
  }

  private stopHoverPoll() {
    if (!this.hoverTimer) return
    clearInterval(this.hoverTimer)
    this.hoverTimer = null
    this.cursor = { x: NaN, y: NaN, inside: false }
  }

  private pollCursor() {
    if (this.win.isDestroyed() || this.mode !== 'field' || !this.win.isVisible()) return
    const p = screen.getCursorScreenPoint()
    if (p.x === this.cursor.x && p.y === this.cursor.y) return
    const b = this.win.getBounds()
    const x = p.x - b.x
    const y = p.y - b.y
    const inside = x >= 0 && y >= 0 && x < b.width && y < b.height
    const wasInside = this.cursor.inside
    this.cursor = { x: p.x, y: p.y, inside }
    const wc = this.win.webContents
    if (inside) wc.sendInputEvent({ type: 'mouseMove', x, y })
    else if (wasInside) wc.sendInputEvent({ type: 'mouseLeave', x: 0, y: 0 })
  }
}
