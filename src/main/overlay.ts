import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { BrowserWindow, screen, type Display, type Rectangle } from 'electron'
import { IPC, type Effect, type Layout, type UiMode } from '../shared/bridge'
import { CAPTION, DRAWER, TASKBAR, TOMATO, anchorInBox, captionBox, clampAnchor, cornerAnchor, drawerBox, homeAnchor, petBox, sideOf, type Side } from '../shared/pet'

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

// The pet's sizes, and the rules for where it, its caption and the drawer sit, are in
// src/shared/pet.ts, shared with the page, which draws the same boxes in the Windows overlay.
/** How often the cursor is sampled for hover on macOS. */
const HOVER_POLL_MS = 40
/** How often a held tomato checks which display the pointer is on. */
const HELD_POLL_MS = 16
/** The poll rate while the pointer is far from the pet: enough to notice it coming. */
const HOVER_IDLE_MS = 250
const HOVER_NEAR_PX = 160
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
  private text = 1
  private drawer: BrowserWindow | null = null
  private drawerShownAt = 0
  private dragging = false
  private caption: BrowserWindow | null = null
  private captionText: string | null = null
  private effects: BrowserWindow | null = null
  private effectsReady = false
  private effectQueue: Effect[] = []
  private effectsHide: NodeJS.Timeout | null = null
  private effectsClose: NodeJS.Timeout | null = null
  private fitting = false
  private settle: NodeJS.Timeout | null = null
  private heldTimer: NodeJS.Timeout | null = null
  private readonly anchorFile: string
  /** The user has put the pet somewhere (a saved place); a first run takes its side from the settings instead. */
  private placed = false
  /** Every layout change, so the shell can keep `hudSide` true to where the pet is. */
  onLayout: ((layout: Layout) => void) | null = null

  constructor(dataDir: string) {
    this.anchorFile = join(dataDir, 'hud.json')
    // Both desktops remember where the tomato was left: the Mac moves its window there,
    // Windows draws the pet there inside the overlay.
    this.anchor = this.loadAnchor()
    this.placed = this.anchor !== null
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
        preload: join(import.meta.dirname, '../preload/index.cjs'),
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
    // The pet's display went away: it moves to the primary one, at its default spot there.
    screen.on('display-removed', (_e, d) => {
      if (d.id === this.displayId) {
        this.displayId = screen.getPrimaryDisplay().id
        this.anchor = null
        this.saveAnchor()
      }
      this.fit()
    })
  }

  load() {
    if (process.env.ELECTRON_RENDERER_URL) void this.win.loadURL(process.env.ELECTRON_RENDERER_URL)
    else void this.win.loadFile(join(import.meta.dirname, '../renderer/index.html'))
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
          preload: join(import.meta.dirname, '../preload/index.cjs'),
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
      else void this.caption.loadFile(join(import.meta.dirname, '../renderer/index.html'), { query: { caption: '1' } })
      this.caption.webContents.on('did-finish-load', () => this.pushCaption())
      this.caption.on('closed', () => { this.caption = null })
    }
    this.placeCaption()
    this.pushCaption()
    if (!this.caption.isVisible()) this.caption.showInactive()
  }

  /**
   * macOS: coins paid out fly from the tomato to a counter in the top right of the screen.
   * The pet window is too small for that, so a display-only window the size of the work
   * area appears for the animation and ignores the mouse throughout.
   */
  cashIn(amount: number, balance: number) {
    if (!mac || this.win.isDestroyed()) return
    const wa = this.display().workArea
    const a = this.anchor ?? this.defaultAnchor(wa)
    const effect: Effect = { kind: 'cashin', amount, balance, from: { x: a.x - wa.x, y: a.y - (TOMATO / 2) * this.scale - wa.y } }
    if (!this.effects) {
      this.effects = new BrowserWindow({
        ...wa,
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
        title: 'Mayorly effects',
        webPreferences: {
          preload: join(import.meta.dirname, '../preload/index.cjs'),
          sandbox: true,
          contextIsolation: true,
          nodeIntegration: false,
          backgroundThrottling: false,
          spellcheck: false,
        },
      })
      this.effects.setAlwaysOnTop(true, 'screen-saver')
      this.effects.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true })
      this.effects.setIgnoreMouseEvents(true)
      const page = process.env.ELECTRON_RENDERER_URL ? `${process.env.ELECTRON_RENDERER_URL}?effects` : null
      if (page) void this.effects.loadURL(page)
      else void this.effects.loadFile(join(import.meta.dirname, '../renderer/index.html'), { query: { effects: '1' } })
      this.effects.webContents.on('did-finish-load', () => {
        this.effectsReady = true
        for (const e of this.effectQueue.splice(0)) this.playEffect(e)
      })
      this.effects.on('closed', () => {
        this.effects = null
        this.effectsReady = false
      })
    }
    if (this.effectsReady) this.playEffect(effect)
    else this.effectQueue.push(effect)
  }

  /** The effects page says it has finished. The window goes a minute later: a renderer should not idle all day for one harvest. */
  effectDone() {
    debug('effect done')
    if (this.effectsHide) clearTimeout(this.effectsHide)
    this.effectsHide = null
    this.effects?.hide()
    if (this.effectsClose) clearTimeout(this.effectsClose)
    this.effectsClose = setTimeout(() => {
      this.effectsClose = null
      if (this.effects && !this.effects.isDestroyed() && !this.effects.isVisible()) this.effects.close()
    }, 60_000)
  }

  private playEffect(e: Effect) {
    if (!this.effects || this.effects.isDestroyed()) return
    if (this.effectsClose) clearTimeout(this.effectsClose)
    this.effectsClose = null
    this.effects.setBounds(this.display().workArea)
    debug('effect', e.kind, e.amount, 'from', e.from)
    this.effects.webContents.send(IPC.effect, e)
    if (!this.effects.isVisible()) this.effects.showInactive()
    // Whatever happens in the page, the window does not stay.
    if (this.effectsHide) clearTimeout(this.effectsHide)
    this.effectsHide = setTimeout(() => this.effectDone(), 6000)
  }

  private pushCaption() {
    if (!this.caption || this.caption.isDestroyed()) return
    this.caption.webContents.send(IPC.caption, { text: this.captionText ?? '', side: this.layout().side })
  }

  /** Just above the tomato, starting at its outer edge and running over the sign's column; below it when the screen's top is in the way. */
  private placeCaption() {
    if (!this.caption) return
    const wa = this.display().workArea
    const a = this.anchor ?? this.defaultAnchor(wa)
    const { below, ...box } = captionBox(a, wa, this.layout().side, this.scale)
    debug('caption', { ...box, below, anchor: a })
    this.caption.setBounds(box)
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
      // Windows, the quick drawer: like the Mac's small drawer window, only the drawer and the pet take
      // the pointer; a click anywhere else reaches the app beneath, and the blur that follows closes it.
      if (!mac && mode === 'drawer') this.win.setIgnoreMouseEvents(!this.hit, { forward: true })
      else this.win.setIgnoreMouseEvents(false)
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
    if ((this.mode === 'field' || this.mode === 'drawer') && !this.win.isDestroyed()) this.win.setIgnoreMouseEvents(!hit, { forward: true })
  }

  /** The HUD scale setting: the pet window grows with it so nothing is clipped. */
  setScale(scale: number) {
    const next = Math.min(1.6, Math.max(0.7, Number(scale) || 1))
    if (next === this.scale) return
    this.scale = next
    if (mac && this.mode === 'field') this.fit()
  }

  /** The pet's text size (settings.text.pet): the window gets the extra height two bigger task lines need. */
  setTextSize(factor: number) {
    const next = Math.min(1.6, Math.max(0.8, Number(factor) || 1))
    if (next === this.text) return
    this.text = next
    if (mac && this.mode === 'field') this.fit()
  }

  /** Keyboard move: the pet window takes the keyboard while the user nudges it, and gives it back after. */
  setMoving(on: boolean) {
    if (this.win.isDestroyed() || this.mode !== 'field') return
    if (on) {
      this.win.setFocusable(true)
      this.win.focus()
      this.win.webContents.focus()
    } else {
      this.win.blur()
      this.win.setFocusable(false)
    }
  }

  /** Move the tomato by this much. */
  nudge(dx: number, dy: number) {
    const wa = this.display().workArea
    const a = this.anchor ?? this.defaultAnchor(wa)
    this.place({ x: a.x + dx, y: a.y + dy })
  }

  /** Put the tomato in a corner of the work area it is on. */
  snap(corner: 1 | 2 | 3 | 4) {
    const wa = this.display().workArea
    this.place(cornerAnchor(wa, corner, this.scale, this.taskbarReserve(wa)))
  }

  /**
   * Windows: the tomato is being carried. The overlay covers one display, so it goes to whichever
   * one the pointer is on: the tomato crosses as a window would, and the pointer is always over
   * this window, so its release arrives even if the mouse capture slipped at the border.
   */
  setHeld(held: boolean) {
    if (mac) return
    if (this.heldTimer) clearInterval(this.heldTimer)
    this.heldTimer = held ? setInterval(() => this.followPointer(), HELD_POLL_MS) : null
  }

  private pointerDisplay(): Display {
    return screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
  }

  private followPointer() {
    if (this.win.isDestroyed()) return
    const under = this.pointerDisplay()
    if (under.id === this.displayId) return
    this.displayId = under.id
    this.fit()
  }

  /**
   * Windows: the tomato was let go. The desktop point says where, and the pointer says on which
   * display: the tomato can hang a few pixels over a border the pointer has already crossed.
   */
  placeAt(x: number, y: number, screenX: number, screenY: number) {
    if (mac) return
    this.setHeld(false)
    if (Number.isFinite(screenX) && Number.isFinite(screenY)) {
      this.place({ x: screenX, y: screenY }, this.pointerDisplay())
      return
    }
    if (!Number.isFinite(x) || !Number.isFinite(y)) return
    const wa = this.display().workArea
    this.place({ x: wa.x + x, y: wa.y + y })
  }

  /** Windows, first run: no saved place yet, so the pet starts in the bottom corner of the side the settings name. */
  adoptSide(side: Side) {
    if (mac || this.placed) return
    this.anchor = this.defaultAnchor(this.display().workArea, side)
    this.sendLayout()
  }

  /** The tomato's new place, by keyboard or a drag: hang the window around it, remember it, tell the page. */
  private place(a: Anchor, on?: Display) {
    if (this.settle) {
      clearTimeout(this.settle)
      this.settle = null
    }
    const nearest = on ?? screen.getDisplayNearestPoint(a)
    this.displayId = nearest.id
    this.anchor = this.clampAnchor(a, nearest.workArea)
    this.placed = true
    debug('place', this.anchor)
    this.fit()
    this.saveAnchor()
    this.sendLayout()
    this.pushCaption()
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
    const a: Anchor = anchorInBox(b, this.side(wa, this.anchor ?? this.defaultAnchor(wa)), this.scale)
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
    this.anchor = this.defaultAnchor(this.display().workArea)
    this.saveAnchor()
    this.sendLayout()
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
    // The page places the pet by the window it is in; tell it in the same step the window changes.
    this.sendLayout()
  }

  private side(wa: Rectangle, a: Anchor): Layout['side'] {
    return sideOf(wa, a)
  }

  private defaultAnchor(wa: Rectangle, side: Side = 'right'): Anchor {
    return homeAnchor(wa, this.scale, side, this.taskbarReserve(wa))
  }

  /** Windows: a work area that is the whole display means the taskbar hides itself and slides over the bottom when it shows. */
  private taskbarReserve(wa: Rectangle): number {
    if (mac) return 0
    const d = screen.getAllDisplays().find((x) => x.workArea.x === wa.x && x.workArea.y === wa.y && x.workArea.width === wa.width && x.workArea.height === wa.height)
    return d && d.workArea.height === d.bounds.height && d.workArea.width === d.bounds.width ? TASKBAR : 0
  }

  private clampAnchor(a: Anchor, wa: Rectangle): Anchor {
    return clampAnchor(a, wa, this.scale)
  }

  /** The field window, hung off the tomato on the side it favours, kept on screen. */
  private fieldBounds(display: Display): Rectangle {
    const wa = display.workArea
    const a = this.anchor ?? (this.anchor = this.defaultAnchor(wa))
    return petBox(a, wa, this.scale, this.text)
  }

  layout(): Layout {
    const wa = this.display().workArea
    const a = this.anchor ?? this.defaultAnchor(wa)
    // Windows: the overlay is the work area, so the page gets the tomato in its own pixels.
    return { compact: mac, side: this.side(wa, a), dragging: this.dragging, pet: mac ? null : { x: a.x - wa.x, y: a.y - wa.y } }
  }

  /**
   * The quick drawer: its own window hung under the pet (over it when the pet sits low), so
   * the pet's window never changes and the tomato never moves. Focusable, since you type in
   * it; it closes when it loses focus, on Esc from its page, or on the hotkey again.
   */
  toggleDrawer() {
    if (!mac || this.win.isDestroyed()) return
    if (this.drawer && !this.drawer.isDestroyed() && this.drawer.isVisible()) {
      this.closeDrawer()
      return
    }
    this.setCaption(null)
    if (!this.drawer || this.drawer.isDestroyed()) {
      this.drawer = new BrowserWindow({
        width: DRAWER.width,
        height: DRAWER.height,
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
        focusable: true,
        alwaysOnTop: true,
        type: 'panel',
        title: 'Mayorly drawer',
        webPreferences: {
          preload: join(import.meta.dirname, '../preload/index.cjs'),
          sandbox: true,
          contextIsolation: true,
          nodeIntegration: false,
          backgroundThrottling: false,
          spellcheck: false,
        },
      })
      this.drawer.setAlwaysOnTop(true, 'screen-saver')
      this.drawer.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true })
      const page = process.env.ELECTRON_RENDERER_URL ? `${process.env.ELECTRON_RENDERER_URL}?drawer` : null
      if (page) void this.drawer.loadURL(page)
      else void this.drawer.loadFile(join(import.meta.dirname, '../renderer/index.html'), { query: { drawer: '1' } })
      // Losing focus closes it, like every other interface; the first moments after showing are ignored, since taking focus can bounce once.
      this.drawer.on('blur', () => {
        if (Date.now() - this.drawerShownAt > 400) this.closeDrawer()
      })
      this.drawer.on('closed', () => {
        this.drawer = null
      })
    }
    this.drawer.setBounds(this.drawerPlace(this.display()))
    this.drawerShownAt = Date.now()
    this.drawer.show()
    this.drawer.focus()
    this.drawer.webContents.focus()
  }

  closeDrawer() {
    if (this.drawer && !this.drawer.isDestroyed() && this.drawer.isVisible()) this.drawer.hide()
  }

  /** Every page of ours that renders state: the pet's window, and the drawer while it exists (hidden or not, since it is reused). */
  pages(): Electron.WebContents[] {
    const out: Electron.WebContents[] = []
    if (!this.win.isDestroyed()) out.push(this.win.webContents)
    if (this.drawer && !this.drawer.isDestroyed()) out.push(this.drawer.webContents)
    return out
  }

  /** Under the pet when there is room, over it otherwise, flush with the pet's outer side. */
  private drawerPlace(display: Display): Rectangle {
    const wa = display.workArea
    return drawerBox(this.fieldBounds(display), wa, this.side(wa, this.anchor ?? this.defaultAnchor(wa)))
  }

  private sendLayout() {
    if (this.win.isDestroyed()) return
    const layout = this.layout()
    this.win.webContents.send(IPC.layout, layout)
    this.onLayout?.(layout)
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
    this.scheduleHoverPoll(HOVER_POLL_MS)
  }
  /** Fast while the pointer is near the pet, slow while it is across the screen: an all-day app should cost nothing idle. */
  private scheduleHoverPoll(ms: number) {
    this.hoverTimer = setTimeout(() => {
      this.hoverTimer = null
      const near = this.pollCursor()
      this.scheduleHoverPoll(near ? HOVER_POLL_MS : HOVER_IDLE_MS)
    }, ms)
  }

  private stopHoverPoll() {
    if (!this.hoverTimer) return
    clearTimeout(this.hoverTimer)
    this.hoverTimer = null
    this.cursor = { x: NaN, y: NaN, inside: false }
  }

  /** Feeds the page the pointer; true when the pointer is near enough to keep polling fast. */
  private pollCursor(): boolean {
    if (this.win.isDestroyed() || this.mode !== 'field' || !this.win.isVisible()) return false
    const p = screen.getCursorScreenPoint()
    const b = this.win.getBounds()
    const near = p.x >= b.x - HOVER_NEAR_PX && p.x < b.x + b.width + HOVER_NEAR_PX && p.y >= b.y - HOVER_NEAR_PX && p.y < b.y + b.height + HOVER_NEAR_PX
    if (p.x === this.cursor.x && p.y === this.cursor.y) return near
    const x = p.x - b.x
    const y = p.y - b.y
    const inside = x >= 0 && y >= 0 && x < b.width && y < b.height
    const wasInside = this.cursor.inside
    this.cursor = { x: p.x, y: p.y, inside }
    const wc = this.win.webContents
    if (inside) wc.sendInputEvent({ type: 'mouseMove', x, y })
    else if (wasInside) wc.sendInputEvent({ type: 'mouseLeave', x: 0, y: 0 })
    return near
  }
}
