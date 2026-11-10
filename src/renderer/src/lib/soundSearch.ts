// Sounds from the open web, for the alarms. Openverse indexes Creative Commons audio and needs
// no key; Freesound is the source, because it holds sound effects rather than songs, and its
// "shortest" clips run a few seconds, the length of an alarm. Openverse takes seconds to answer
// and allows anonymous callers about 20 searches a minute and 200 a day, so the app ships a
// catalogue of such clips (sound-index.json, from scripts/sound-index.mjs) and searches that as
// you type; the network is asked only for words the catalogue barely covers.
// Both hosts are named in the page's Content-Security-Policy, and nothing else is fetched.

import catalogue from './sound-index.json'

const API = 'https://api.openverse.org/v1/audio/'
const FILE_HOST = 'cdn.freesound.org'
const MAX_BYTES = 5 * 1024 * 1024
const MIME: Record<string, string> = { mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', flac: 'audio/flac' }

export interface FoundSound {
  id: string
  title: string
  creator: string
  /** "CC0", "CC BY", "CC BY-NC" and so on. */
  license: string
  durationMs: number | null
  url: string
  /** The sound's own page, for the credit. */
  page: string | null
}

interface RawResult {
  id?: unknown
  title?: unknown
  creator?: unknown
  license?: unknown
  duration?: unknown
  url?: unknown
  filetype?: unknown
  filesize?: unknown
  foreign_landing_url?: unknown
}

const str = (v: unknown) => (typeof v === 'string' ? v : '')

export function licenseLabel(code: string): string {
  const c = code.trim().toLowerCase()
  if (!c) return 'CC'
  if (c === 'cc0' || c === 'pdm') return c.toUpperCase()
  return `CC ${c.toUpperCase()}`
}

/** What a result has to be to land on the list: an alarm-sized file we can play, from Freesound. */
export function toFound(results: unknown): FoundSound[] {
  if (!Array.isArray(results)) return []
  const out: FoundSound[] = []
  for (const r of results as RawResult[]) {
    const url = str(r.url)
    let host = ''
    try {
      const u = new URL(url)
      host = u.protocol === 'https:' ? u.hostname : ''
    } catch {
      continue
    }
    if (host !== FILE_HOST) continue
    if (!MIME[str(r.filetype).toLowerCase()]) continue
    const size = typeof r.filesize === 'number' ? r.filesize : null
    if (size !== null && size > MAX_BYTES) continue
    const id = str(r.id)
    if (!id) continue
    out.push({
      id,
      title: str(r.title).replace(/\.(wav|aiff?|flac|mp3|ogg)$/i, '').trim() || 'Untitled sound',
      creator: str(r.creator).trim() || 'unknown',
      license: licenseLabel(str(r.license)),
      durationMs: typeof r.duration === 'number' ? r.duration : null,
      url,
      page: str(r.foreign_landing_url) || null,
    })
  }
  return out
}

export async function searchSounds(query: string): Promise<FoundSound[]> {
  const q = query.trim()
  if (!q) return []
  const params = new URLSearchParams({ q, source: 'freesound', length: 'shortest', mature: 'false', page_size: '20' })
  let res: Response
  try {
    res = await fetch(`${API}?${params}`, { signal: AbortSignal.timeout(15_000) })
  } catch {
    throw new Error('Could not reach the sound library. Check the connection and try again.')
  }
  if (res.status === 429) throw new Error('The sound library is busy for now. Try again in a minute.')
  if (!res.ok) throw new Error(`The sound library answered ${res.status}.`)
  const body = (await res.json()) as { results?: unknown }
  return toFound(body.results)
}

/** The sound's file as a data URL, the shape a saved alarm takes. Only Freesound's file host. */
export async function downloadSound(sound: FoundSound): Promise<string> {
  const u = new URL(sound.url)
  if (u.protocol !== 'https:' || u.hostname !== FILE_HOST) throw new Error('That sound is not from the library.')
  let res: Response
  try {
    res = await fetch(u, { signal: AbortSignal.timeout(30_000) })
  } catch {
    throw new Error('Could not download the sound. Try again.')
  }
  if (!res.ok) throw new Error(`The download answered ${res.status}.`)
  const declared = Number(res.headers.get('content-length') ?? 0)
  if (declared > MAX_BYTES) throw new Error('That sound is over 5 MB.')
  const blob = await res.blob()
  if (blob.size === 0 || blob.size > MAX_BYTES) throw new Error('That sound is over 5 MB.')
  const ext = u.pathname.split('.').pop()?.toLowerCase() ?? ''
  const mime = MIME[ext] ?? (Object.values(MIME).includes(blob.type) ? blob.type : '')
  if (!mime) throw new Error('That sound is not in a format the alarms can play.')
  const bytes = new Uint8Array(await blob.arrayBuffer())
  let bin = ''
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return `data:${mime};base64,${btoa(bin)}`
}

const PREVIEWS = 'https://cdn.freesound.org/previews/'

interface Packed {
  i: string
  t: string
  c: string
  l: string
  d: number | null
  u: string
  p: string | null
  g: string[]
}

export interface IndexedSound extends FoundSound {
  /** Words to match on, the tags included. */
  tags: string[]
}

export const unpack = (x: Packed): IndexedSound => ({
  id: x.i,
  title: x.t,
  creator: x.c,
  license: licenseLabel(x.l),
  durationMs: x.d,
  url: PREVIEWS + x.u,
  page: x.p,
  tags: x.g,
})

const INDEX: IndexedSound[] = (catalogue as { sounds: Packed[] }).sounds.map(unpack)

const tokens = (text: string) => text.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)

/**
 * The catalogue's best matches, at once. Every word has to start a word of the title or a tag, so
 * a half-typed word already finds things. A title that starts with the search comes first, then
 * titles that hold every word, then tag matches; shorter clips first within each.
 */
export function rankSounds(list: IndexedSound[], query: string, limit = 30): FoundSound[] {
  const words = tokens(query)
  if (!words.length) return []
  const q = query.trim().toLowerCase()
  const scored: { s: IndexedSound; rank: number }[] = []
  for (const s of list) {
    const title = tokens(s.title)
    const tags = s.tags.flatMap(tokens)
    if (!words.every((w) => title.some((t) => t.startsWith(w)) || tags.some((t) => t.startsWith(w)))) continue
    const rank = s.title.toLowerCase().startsWith(q) ? 0 : words.every((w) => title.some((t) => t.startsWith(w))) ? 1 : 2
    scored.push({ s, rank })
  }
  return scored
    .sort((a, b) => a.rank - b.rank || (a.s.durationMs ?? 1e9) - (b.s.durationMs ?? 1e9))
    .slice(0, limit)
    .map(({ s: { tags: _tags, ...found } }) => found)
}

export const findLocal = (query: string, limit = 30) => rankSounds(INDEX, query, limit)

/** How many sounds ship with the app. */
export const catalogueSize = INDEX.length

/** The name the alarm keeps, with the credit Creative Commons asks for. */
export const soundName = (s: FoundSound) => `${s.title} by ${s.creator} (${s.license})`.slice(0, 120)
