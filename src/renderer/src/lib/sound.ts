import type { AlarmChoice } from '@core/index'
import { bridge } from '../bridge'
import { ac, tone } from './sfx'

export { setSoundEnabled, sfx } from './sfx'

const customBuffers = new Map<string, Promise<AudioBuffer>>()
let playing: AudioBufferSourceNode | null = null

export async function decodeAlarm(dataUrl: string): Promise<AudioBuffer> {
  const a = ac(true)
  if (!a) throw new Error('Audio is unavailable on this device.')
  try {
    const bytes = Uint8Array.from(atob(dataUrl.split(',')[1] ?? ''), c => c.charCodeAt(0))
    const buffer = await a.decodeAudioData(bytes.buffer)
    if (!buffer.length) throw new Error('Empty audio')
    return buffer
  } catch { throw new Error('This file could not be played. Try an MP3 or WAV file.') }
}

/** Stop whatever alarm or preview is sounding. */
export function stopAlarm() {
  if (playing) { try { playing.stop() } catch { /* already ended */ } playing = null }
}

/** A sound not saved yet, heard the way an alarm plays it: from the start, for 15 seconds at most. */
export async function playDataUrl(dataUrl: string, onEnd?: () => void): Promise<void> {
  const a = ac(true)
  if (!a) throw new Error('Audio is unavailable on this device.')
  const buffer = await decodeAlarm(dataUrl)
  stopAlarm()
  const source = a.createBufferSource()
  source.buffer = buffer
  source.connect(a.destination)
  source.start(0, 0, Math.min(buffer.duration, 15))
  playing = source
  source.onended = () => {
    if (playing === source) playing = null
    onEnd?.()
  }
}

/** Preview is explicit and can be heard even when automatic sound cues are muted. */
export async function playAlarm(choice: AlarmChoice, preview = false): Promise<void> {
  const a = ac(preview)
  if (!a || choice.tone === 'silent') return
  if (playing) { try { playing.stop() } catch { /* already ended */ } playing = null }
  if (choice.tone === 'custom' && choice.customId) {
    try {
      let decoded = customBuffers.get(choice.customId)
      if (!decoded) {
        decoded = bridge.alarms.read(choice.customId).then(data => {
          if (!data) throw new Error('The custom sound is missing. Upload it again.')
          return decodeAlarm(data)
        })
        customBuffers.set(choice.customId, decoded)
      }
      const buffer = await decoded
      const source = a.createBufferSource()
      source.buffer = buffer
      source.connect(a.destination)
      source.start(0, 0, Math.min(buffer.duration, 15))
      playing = source
      source.onended = () => { if (playing === source) playing = null }
      return
    } catch (e) {
      customBuffers.delete(choice.customId)
      if (preview) throw e
      // A removed file must not make a timer transition silent.
    }
  }
  const t = a.currentTime
  switch (choice.tone) {
    case 'bell':
      tone(a, 880, t, 1.1, 0.08); tone(a, 1760, t, 0.6, 0.025)
      break
    case 'chime':
      [523, 659, 784].forEach((f, i) => tone(a, f, t + i * 0.15, 0.55, 0.065))
      break
    case 'pulse':
      [0, 0.22, 0.44].forEach(offset => tone(a, 660, t + offset, 0.13, 0.065, 'triangle'))
      break
    case 'gentle':
      tone(a, 330, t, 0.8, 0.045); tone(a, 440, t + 0.25, 0.9, 0.04)
      break
    default:
      tone(a, 392, t, 0.22, 0.06, 'triangle'); tone(a, 523, t + 0.09, 0.3, 0.05, 'triangle')
  }
}
