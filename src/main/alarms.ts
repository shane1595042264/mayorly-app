import { randomUUID } from 'node:crypto'
import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { basename, extname, join } from 'node:path'
import type { AlarmChoice } from '@core/index'

export const AUDIO_MAX_BYTES = 5 * 1024 * 1024
const MIME: Record<string, string> = { '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg', '.m4a': 'audio/mp4', '.aac': 'audio/aac', '.flac': 'audio/flac' }
export const AUDIO_EXTENSIONS = Object.keys(MIME).map(x => x.slice(1))

/** Audio stays on this machine. State only carries the selected tone and its local asset id. */
export class AlarmFiles {
  private dir: string
  constructor(dataDir: string) { this.dir = join(dataDir, 'alarms') }

  pickFile(path: string): { name: string; dataUrl: string } {
    const mime = MIME[extname(path).toLowerCase()]
    if (!mime) throw new Error('Choose an MP3, WAV, OGG, M4A, AAC or FLAC file.')
    const size = statSync(path).size
    if (size <= 0 || size > AUDIO_MAX_BYTES) throw new Error('Choose an audio file up to 5 MB.')
    return { name: basename(path), dataUrl: `data:${mime};base64,${readFileSync(path).toString('base64')}` }
  }

  save(name: string, dataUrl: string): AlarmChoice {
    if (typeof dataUrl !== 'string' || dataUrl.length > AUDIO_MAX_BYTES * 4 / 3 + 100) throw new Error('Choose an audio file up to 5 MB.')
    const match = /^data:(audio\/(?:mpeg|wav|ogg|mp4|aac|flac));base64,([A-Za-z0-9+/]+={0,2})$/.exec(dataUrl)
    if (!match || Buffer.from(match[2], 'base64').length > AUDIO_MAX_BYTES) throw new Error('This audio file could not be read.')
    const customId = randomUUID()
    const customName = basename(String(name)).slice(0, 120) || 'Custom sound'
    mkdirSync(this.dir, { recursive: true })
    writeFileSync(join(this.dir, `${customId}.json`), JSON.stringify({ dataUrl }), { mode: 0o600 })
    return { tone: 'custom', customId, customName }
  }

  read(id: string): string | null {
    if (typeof id !== 'string' || !/^[a-f0-9-]{36}$/i.test(id)) return null
    try {
      const path = join(this.dir, `${id}.json`)
      if (statSync(path).size > AUDIO_MAX_BYTES * 4 / 3 + 200) return null
      const data = JSON.parse(readFileSync(path, 'utf8')) as { dataUrl?: unknown }
      return typeof data.dataUrl === 'string' && data.dataUrl.startsWith('data:audio/') ? data.dataUrl : null
    } catch { return null }
  }
}
