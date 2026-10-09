// Full-resolution screenshots of the browser preview (npm run web), for review and the README.
//   SHOT_URL=http://localhost:5199/?demo SHOT_OUT=docs/hud.png electron scripts/shot.cjs
// Optional: SHOT_W, SHOT_H (default 1920x1080), SHOT_JS (runs in the page first), SHOT_WAIT (ms).
// Parameters travel in the environment because Electron on Windows refuses some
// positional file-path arguments before the script even starts.
const fs = require('node:fs')
const { app, BrowserWindow } = require('electron')

const env = process.env
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

app.whenReady().then(async () => {
  try {
    const win = new BrowserWindow({ width: +(env.SHOT_W || 1920), height: +(env.SHOT_H || 1080), show: false, useContentSize: true, frame: false, webPreferences: { offscreen: true, backgroundThrottling: false } })
    win.webContents.setFrameRate(60)
    await win.loadURL('about:blank')
    await win.loadURL(env.SHOT_URL)
    await sleep(1500)
    if (env.SHOT_JS) await win.webContents.executeJavaScript(env.SHOT_JS)
    await sleep(+(env.SHOT_WAIT || 1600))
    const img = await win.webContents.capturePage()
    fs.writeFileSync(env.SHOT_OUT, img.toPNG())
    console.log('wrote', env.SHOT_OUT)
  } catch (e) {
    console.error(e)
    process.exitCode = 1
  }
  app.quit()
})
