import type { AlarmChoice } from '@core/index'
import { bridge } from '../bridge'

// Synthesised cues. Each one marks a state change you might not be
// looking at: an attachment-style clack for a swap, a two-note rise for a tomato.

let ctx: AudioContext | null = null
let enabled = true

export function setSoundEnabled(on: boolean) {
  enabled = on
}

function ac(preview = false): AudioContext | null {
  if (!enabled && !preview) return null
  try {
    ctx ??= new AudioContext()
    if (ctx.state === 'suspended') void ctx.resume()
    return ctx
  } catch {
    return null
  }
}

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

function tone(a: AudioContext, freq: number, at: number, dur: number, gain: number, type: OscillatorType = 'sine') {
  const o = a.createOscillator()
  const g = a.createGain()
  o.type = type
  o.frequency.setValueAtTime(freq, at)
  g.gain.setValueAtTime(0, at)
  g.gain.linearRampToValueAtTime(gain, at + 0.006)
  g.gain.exponentialRampToValueAtTime(0.0001, at + dur)
  o.connect(g).connect(a.destination)
  o.start(at)
  o.stop(at + dur + 0.02)
}

function click(a: AudioContext, at: number, gain: number, hz: number) {
  const len = Math.floor(a.sampleRate * 0.03)
  const buf = a.createBuffer(1, len, a.sampleRate)
  const d = buf.getChannelData(0)
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 6)
  const src = a.createBufferSource()
  src.buffer = buf
  const bp = a.createBiquadFilter()
  bp.type = 'bandpass'
  bp.frequency.value = hz
  bp.Q.value = 1.4
  const g = a.createGain()
  g.gain.value = gain
  src.connect(bp).connect(g).connect(a.destination)
  src.start(at)
}

export const sfx = {
  /** Mechanical clack: two transients and a low knock. */
  swap() {
    const a = ac()
    if (!a) return
    const t = a.currentTime
    click(a, t, 0.5, 2400)
    click(a, t + 0.055, 0.35, 1600)
    tone(a, 110, t + 0.05, 0.09, 0.12, 'triangle')
  },
  open() {
    const a = ac()
    if (!a) return
    const t = a.currentTime
    click(a, t, 0.25, 3200)
    tone(a, 660, t, 0.06, 0.04)
  },
  close() {
    const a = ac()
    if (!a) return
    click(a, a.currentTime, 0.18, 1800)
  },
  tomato() {
    const a = ac()
    if (!a) return
    const t = a.currentTime
    tone(a, 587, t, 0.16, 0.08)
    tone(a, 880, t + 0.11, 0.28, 0.07)
  },
  block() {
    const a = ac()
    if (!a) return
    const t = a.currentTime
    tone(a, 392, t, 0.22, 0.06, 'triangle')
    tone(a, 523, t + 0.09, 0.3, 0.05, 'triangle')
  },
  tick() {
    const a = ac()
    if (!a) return
    click(a, a.currentTime, 0.12, 4200)
  },
  /** An entry cleared: one clean high ding with a soft tail. */
  clear() {
    const a = ac()
    if (!a) return
    const t = a.currentTime
    click(a, t, 0.2, 5200)
    tone(a, 1318, t, 0.12, 0.05)
    tone(a, 1976, t + 0.04, 0.34, 0.045)
  },
  /** One coin landing on the counter; each one a little higher than the last. */
  coin(i: number) {
    const a = ac()
    if (!a) return
    const t = a.currentTime
    const f = 1568 * Math.pow(2, Math.min(i, 7) / 12)
    tone(a, f, t, 0.07, 0.05, 'triangle')
    tone(a, f * 1.5, t + 0.03, 0.14, 0.035)
  },
  /** The harvest banked: a quick bright run up and a ring, the pocket-full-of-coins sound. */
  cashIn() {
    const a = ac()
    if (!a) return
    const t = a.currentTime
    const run = [1046, 1318, 1568, 2093]
    run.forEach((f, i) => tone(a, f, t + i * 0.055, 0.12, 0.045, 'triangle'))
    tone(a, 2093, t + 0.24, 0.5, 0.05)
    tone(a, 3136, t + 0.26, 0.4, 0.02)
  },
}
