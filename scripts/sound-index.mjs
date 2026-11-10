// Builds the alarm sound catalogue the app searches as you type: short Creative Commons clips from
// Freesound, found through Openverse, a page of results per word below. Openverse takes seconds per
// search and allows anonymous callers about 20 a minute and 200 a day, so the app ships this list
// and only asks the network for words it does not cover.
//   node scripts/sound-index.mjs
import { writeFileSync } from 'node:fs'

const WORDS = [
  'bell', 'chime', 'gong', 'ding', 'beep', 'alarm', 'alert', 'notification', 'buzzer', 'ring',
  'doorbell', 'clock', 'tick', 'cuckoo', 'singing bowl', 'tibetan bowl', 'meditation', 'zen', 'calm', 'gentle',
  'soft', 'morning', 'wake up', 'birds', 'bird', 'rooster', 'owl', 'cricket', 'frog', 'cat',
  'dog', 'water', 'drop', 'rain', 'wave', 'ocean', 'stream', 'wind', 'thunder', 'fire',
  'piano', 'guitar', 'harp', 'xylophone', 'marimba', 'glockenspiel', 'kalimba', 'music box', 'flute', 'violin',
  'synth', 'pluck', 'pad', 'drum', 'timpani', 'cymbal', 'triangle', 'tambourine', 'fanfare', 'trumpet',
  'horn', 'whistle', 'success', 'win', 'level up', 'coin', 'magic', 'sparkle', 'whoosh', 'swoosh',
  'click', 'pop', 'bubble', 'knock', 'wood', 'typewriter', 'keyboard', 'phone', 'message', 'game',
  'retro', '8bit', 'arcade', 'victory', 'countdown', 'metronome', 'start', 'finish', 'laser', 'robot',
  'spaceship', 'applause', 'cheer', 'laugh', 'train', 'ship', 'siren', 'church', 'temple', 'om',
]
const API = 'https://api.openverse.org/v1/audio/'
const OUT = 'src/renderer/src/lib/sound-index.json'
const PREFIX = 'https://cdn.freesound.org/previews/'
const PLAYABLE = new Set(['mp3', 'wav', 'ogg', 'flac'])
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const sounds = new Map()
for (const [n, word] of WORDS.entries()) {
  const params = new URLSearchParams({ q: word, source: 'freesound', length: 'shortest', mature: 'false', page_size: '20' })
  let body = null
  for (let attempt = 0; attempt < 4 && !body; attempt++) {
    try {
      const res = await fetch(`${API}?${params}`, { headers: { 'User-Agent': 'Mayorly sound catalogue builder' }, signal: AbortSignal.timeout(60_000) })
      if (res.status === 429) {
        console.log(`  ${word}: rate limited, waiting a minute`)
        await sleep(65_000)
        continue
      }
      if (!res.ok) throw new Error(String(res.status))
      body = await res.json()
    } catch (err) {
      console.log(`  ${word}: ${err.message}, retrying`)
      await sleep(5_000)
    }
  }
  let added = 0
  for (const r of body?.results ?? []) {
    const url = typeof r.url === 'string' ? r.url : ''
    if (!url.startsWith(PREFIX) || !PLAYABLE.has(String(r.filetype).toLowerCase())) continue
    if (typeof r.filesize === 'number' && r.filesize > 5 * 1024 * 1024) continue
    if (!r.id || sounds.has(r.id)) continue
    sounds.set(r.id, {
      i: r.id,
      t: String(r.title ?? '').replace(/\.(wav|aiff?|flac|mp3|ogg)$/i, '').trim() || 'Untitled sound',
      c: String(r.creator ?? '').trim() || 'unknown',
      l: String(r.license ?? ''),
      d: typeof r.duration === 'number' ? r.duration : null,
      u: url.slice(PREFIX.length),
      p: typeof r.foreign_landing_url === 'string' ? r.foreign_landing_url : null,
      g: [word, ...(Array.isArray(r.tags) ? r.tags.map((x) => String(x?.name ?? '').toLowerCase()).filter(Boolean) : [])].filter((x, k, all) => all.indexOf(x) === k).slice(0, 10),
    })
    added++
  }
  console.log(`${n + 1}/${WORDS.length} ${word}: +${added} (${sounds.size})`)
  // About one call every 3.5 seconds at most: under the anonymous burst limit.
  await sleep(3_500)
}
writeFileSync(OUT, JSON.stringify({ built: new Date().toISOString().slice(0, 10), sounds: [...sounds.values()] }))
console.log(`wrote ${sounds.size} sounds to ${OUT}`)
