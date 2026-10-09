// Synthesised cues, no audio files. Each one marks a state change you might not be
// looking at: an attachment-style clack for a swap, a two-note rise for a tomato.

let ctx: AudioContext | null = null
let enabled = true

export function setSoundEnabled(on: boolean) {
  enabled = on
}

function ac(): AudioContext | null {
  if (!enabled) return null
  try {
    ctx ??= new AudioContext()
    if (ctx.state === 'suspended') void ctx.resume()
    return ctx
  } catch {
    return null
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
}
