// The founder's sprites into the app. Every art/<id>@1x.png in mayorly-assets (the folder beside this
// repo, or MAYORLY_ASSETS) that passes the art standard's validator is copied to
// src/renderer/src/assets/art/<id>.png, where src/renderer/src/lib/art.ts finds it by its id. A blank
// scaffold or a file that fails the standard is never copied, so the app keeps showing what it showed
// before (the plain tomato, the stock icon) until the drawing is real. The tomato also goes to
// build/tomato@1x.png, and the app's icons are made again from it (make-icon.mjs).
//
//   npm run art              copy once
//   npm run art -- --watch   copy on every save in Aseprite; `npm run web` at /?art shows it at once
//
// Copies bytes, nothing else: it never draws, scales or alters a pixel.
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, watch } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const assets = resolve(process.env.MAYORLY_ASSETS ?? join(root, '..', 'mayorly-assets'))
const src = join(assets, 'art')
const out = join(root, 'src', 'renderer', 'src', 'assets', 'art')
const watching = process.argv.includes('--watch')

if (!existsSync(src)) {
  console.log(`No art at ${src}: clone mayorly-assets beside this repo, or set MAYORLY_ASSETS. The app keeps the art it has.`)
  process.exit(0)
}
const { validate } = await import(pathToFileURL(join(assets, 'lib', 'validate.mjs')).href)
mkdirSync(out, { recursive: true })

const same = (a, b) => existsSync(b) && readFileSync(a).equals(readFileSync(b))
const time = () => new Date().toTimeString().slice(0, 8)

async function sync() {
  const { classes } = JSON.parse(readFileSync(join(assets, 'classes.json'), 'utf8'))
  const wanted = new Set()
  let changed = 0
  for (const f of readdirSync(src)) {
    const m = /^(.+)@1x\.png$/.exec(f)
    if (!m) continue
    const id = m[1]
    const slotFile = join(assets, 'slots', `${id}.json`)
    if (!existsSync(slotFile)) continue
    const slot = JSON.parse(readFileSync(slotFile, 'utf8'))
    const cls = classes[slot.class]
    if (!cls) continue
    const from = join(src, f)
    const r = await validate(new Uint8Array(readFileSync(from)), { ...cls, id, bays: slot.bays })
    // Not ready yet (a blank canvas, or a rule broken): the app keeps its last good copy, if any.
    if (!r.ok) {
      if (existsSync(join(out, `${id}.png`))) wanted.add(id)
      continue
    }
    wanted.add(id)
    const to = join(out, `${id}.png`)
    if (same(from, to)) continue
    copyFileSync(from, to)
    changed++
    console.log(`${time()}  ${id}`)
    if (id === 'icon.tomato') {
      copyFileSync(from, join(root, 'build', 'tomato@1x.png'))
      execFileSync(process.execPath, [join(root, 'scripts', 'make-icon.mjs')], { cwd: root, stdio: 'inherit' })
    }
  }
  // A drawing removed from mayorly-assets leaves the app too.
  for (const f of readdirSync(out)) {
    const id = f.replace(/\.png$/, '')
    if (f.endsWith('.png') && !wanted.has(id)) {
      rmSync(join(out, f))
      changed++
      console.log(`${time()}  ${id} removed`)
    }
  }
  return changed
}

const n = await sync()
if (!watching) {
  console.log(n ? `${n} sprite${n === 1 ? '' : 's'} copied into the app` : 'The app has every sprite already')
  process.exit(0)
}
console.log(`Watching ${src}. Save in Aseprite; npm run web shows it at http://localhost:5199/?art`)
let timer = null
watch(src, () => {
  clearTimeout(timer)
  // Aseprite writes a file in more than one step: wait for it to settle.
  timer = setTimeout(() => void sync().catch((err) => console.error(err.message)), 200)
})
