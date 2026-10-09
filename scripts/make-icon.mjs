// Builds the app and tray icons from the founder's hand-drawn 16x16 tomato
// (mayorly-assets/art/icon.tomato@1x.png). Integer nearest-neighbour scaling
// only, the same thing the game's camera zoom does; no pixel is invented.
// Needs ImageMagick 7 (`magick`) on PATH.
import { execFileSync } from 'node:child_process'

const src = 'build/tomato@1x.png'
const run = (...args) => execFileSync('magick', args, { stdio: 'inherit' })

run(src, '-filter', 'point', '-resize', '1600%', 'build/icon.png')
run(src, '-filter', 'point', '-resize', '200%', 'build/tray.png')
run(src, '-filter', 'point', '-define', 'icon:auto-resize=256,128,64,48,32,16', 'build/icon.ico')
console.log('wrote build/icon.png, build/tray.png, build/icon.ico')
