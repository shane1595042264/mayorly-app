// A scripted walk through the phone app, for the end-to-end roasting review
// (.claude/skills/end-to-end-roasting). Opens the app offscreen at phone size, plays each step
// of a tour (tap, type, wait), and after each step saves frames at the given offsets, so motion
// can be seen frame by frame, plus a log of what the app did: the tab on screen, the desk, every
// sound it played (oscillators and buffers started) and every haptic (navigator.vibrate, which
// Capacitor's web Haptics calls), and console errors.
//
//   ROAST_URL=http://localhost:5200/?demo ROAST_OUT=.roast/round-1 npx electron scripts/roast-tour.cjs
//   ROAST_TOUR=path/to/tour.json  to play your own steps instead of the default tour below.
//
// A step: { name, do: "<js run in the page>", frames: [ms, ...] }. In the page, __roast.tap(sel, i)
// presses the i-th match of a selector the way a finger does (pointer down, up, click),
// __roast.type(sel, text) types into a field, __roast.key(sel, key) presses a key on it, and
// __roast.text(sel) reads text. Parameters travel in the environment, as in shot.cjs.
const fs = require('node:fs')
const path = require('node:path')
const { app, BrowserWindow } = require('electron')

const env = process.env
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const OUT = env.ROAST_OUT || '.roast/latest'

const HOOKS = `(() => {
  const log = (window.__roastLog = { sounds: 0, haptics: 0, errors: [] })
  const Ctx = window.AudioContext
  if (Ctx) {
    const osc = Ctx.prototype.createOscillator
    Ctx.prototype.createOscillator = function () { const o = osc.call(this); const s = o.start.bind(o); o.start = (...a) => { log.sounds++; return s(...a) }; return o }
    const buf = Ctx.prototype.createBufferSource
    Ctx.prototype.createBufferSource = function () { const o = buf.call(this); const s = o.start.bind(o); o.start = (...a) => { log.sounds++; return s(...a) }; return o }
  }
  navigator.vibrate = () => { log.haptics++; return true }
  window.addEventListener('error', (e) => log.errors.push(String(e.message)))
  const at = (sel, i = 0) => { const el = document.querySelectorAll(sel)[i]; if (!el) throw new Error('nothing matches ' + sel + ' #' + i); return el }
  window.__roast = {
    tap(sel, i = 0) {
      const el = at(sel, i)
      const r = el.getBoundingClientRect()
      const o = { bubbles: true, cancelable: true, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, pointerId: 1, pointerType: 'touch', isPrimary: true }
      el.dispatchEvent(new PointerEvent('pointerdown', o))
      el.dispatchEvent(new PointerEvent('pointerup', o))
      el.click()
    },
    type(sel, text, i = 0) {
      const el = at(sel, i)
      el.focus()
      const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
      Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, text)
      el.dispatchEvent(new Event('input', { bubbles: true }))
    },
    key(sel, key, i = 0) { at(sel, i).dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true })) },
    text(sel, i = 0) { const el = document.querySelectorAll(sel)[i]; return el ? el.textContent.trim() : null },
    count(sel) { return document.querySelectorAll(sel).length },
  }
})()`

const SNAPSHOT = `(() => {
  const m = window.__mayorly && window.__mayorly.state()
  const d = m && m.desk
  const onDesk = d && d.block && (m.entries.find((e) => e.id === d.block.entryId)?.title || m.leisure.find((x) => x.id === d.block.leisureId)?.title || d.block.label)
  const log = window.__roastLog
  const out = {
    tab: document.querySelector('.tab[aria-current=page]')?.textContent.trim() ?? null,
    sheets: document.querySelectorAll('.sheet').length,
    sheet: document.querySelector('.sheet h2')?.textContent.trim() ?? null,
    desk: d ? d.status : null,
    onDesk: onDesk ?? null,
    clock: document.querySelector('.clock')?.getAttribute('aria-label') ?? null,
    sounds: log.sounds, haptics: log.haptics, errors: log.errors.slice(),
  }
  log.sounds = 0; log.haptics = 0; log.errors.length = 0
  return out
})()`

/** The default tour: every place, every kind of control, the moments the app advertises. */
const TOUR = [
  { name: 'open', do: '', frames: [0, 700] },
  { name: 'pause', do: "__roast.tap('.primary')", frames: [0, 90, 220, 600] },
  { name: 'resume', do: "__roast.tap('.primary')", frames: [0, 90, 220, 600] },
  { name: 'open-picker', do: "__roast.tap('.task')", frames: [0, 100, 260, 600] },
  { name: 'picker-pomodoro', do: "__roast.tap('.sheet .seg button', 0)", frames: [0, 150, 400] },
  { name: 'pick-another-task', do: "__roast.tap('.sheet .row', 2)", frames: [0, 120, 300, 700] },
  { name: 'tab-ledgers', do: "__roast.tap('.tab:not(.capture-tab)', 1)", frames: [0, 80, 200, 600] },
  { name: 'open-ledger', do: "__roast.tap('.screen .row', 0)", frames: [0, 120, 500, 1000] },
  { name: 'entry-menu', do: "__roast.tap('.screen .list .row', 0)", frames: [0, 100, 260, 600] },
  { name: 'start-from-entry-menu', do: "__roast.tap('.sheet .menu button', 0)", frames: [0, 120, 300, 700] },
  { name: 'clear-task', do: "__roast.tap('.clear-btn')", frames: [0, 80, 200, 450, 900] },
  { name: 'open-capture', do: "__roast.tap('.capture-tab')", frames: [0, 100, 260, 600] },
  { name: 'type-capture', do: "__roast.type('.capture-field', 'legal call the notary about the lease')", frames: [200] },
  { name: 'add-capture', do: "__roast.tap('.capture-actions .btn.white')", frames: [0, 150, 500, 1200] },
  { name: 'add-and-start', do: "__roast.type('.capture-field', 'dance stretch twenty minutes'); setTimeout(() => __roast.tap('.capture-actions .btn:not(.white)'), 60)", frames: [200, 400, 800] },
  { name: 'tab-couch', do: "__roast.tap('.tab:not(.capture-tab)', 2)", frames: [0, 120, 600] },
  { name: 'tab-settings', do: "__roast.tap('.tab:not(.capture-tab)', 3)", frames: [0, 120, 600] },
  { name: 'stepper-up', do: "__roast.tap('.stepper button', 1)", frames: [0, 120, 400] },
  { name: 'toggle', do: "__roast.tap('.toggle', 0)", frames: [0, 80, 200, 500] },
  { name: 'search-settings', do: "__roast.type('.settings-search input', 'rest')", frames: [150] },
  { name: 'jump-to-setting', do: "__roast.key('.settings-search input', 'Enter')", frames: [100, 300, 700, 1500] },
  { name: 'back-to-desk', do: "__roast.tap('.tab:not(.capture-tab)', 0)", frames: [0, 150, 600] },
  { name: 'stand-down', do: "__roast.tap('.round', 2)", frames: [0, 120, 400, 900] },
]

app.whenReady().then(async () => {
  try {
    fs.mkdirSync(OUT, { recursive: true })
    const tour = env.ROAST_TOUR ? JSON.parse(fs.readFileSync(env.ROAST_TOUR, 'utf8')) : TOUR
    const win = new BrowserWindow({ width: +(env.ROAST_W || 390), height: +(env.ROAST_H || 844), show: false, useContentSize: true, frame: false, webPreferences: { offscreen: true, backgroundThrottling: false } })
    win.webContents.setFrameRate(60)
    await win.loadURL('about:blank')
    await win.loadURL(env.ROAST_URL || 'http://localhost:5200/?demo')
    await sleep(1200)
    await win.webContents.executeJavaScript(HOOKS)
    const log = []
    for (let i = 0; i < tour.length; i++) {
      const step = tour[i]
      const tag = `${String(i + 1).padStart(2, '0')}-${step.name}`
      let error = null
      const t0 = Date.now()
      try {
        if (step.do) await win.webContents.executeJavaScript(`(() => { ${step.do} })()`)
      } catch (e) {
        error = String(e.message || e)
      }
      const frames = []
      for (const ms of step.frames ?? [400]) {
        const wait = t0 + ms - Date.now()
        if (wait > 0) await sleep(wait)
        const file = `${tag}-t${ms}.png`
        fs.writeFileSync(path.join(OUT, file), (await win.webContents.capturePage()).toPNG())
        frames.push(file)
      }
      const state = await win.webContents.executeJavaScript(SNAPSHOT)
      log.push({ step: tag, did: step.do, error, frames, ...state })
      console.log(tag, error ? `ERROR ${error}` : '', JSON.stringify(state))
    }
    fs.writeFileSync(path.join(OUT, 'log.json'), JSON.stringify(log, null, 2))
    console.log('wrote', OUT)
  } catch (e) {
    console.error(e)
    process.exitCode = 1
  }
  app.quit()
})
