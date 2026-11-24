// Synthesised cues, with nothing to load: the desktop's HUD and the phone both play these.
// Each one marks a state change you might not be looking at: a weapon-swap thud when the task on the
// desk changes, a clack for a pick being browsed, a two-note rise for a tomato. One AudioContext,
// made on first use; cues are off while sound is off.

let ctx: AudioContext | null = null
let enabled = true

export function setSoundEnabled(on: boolean) {
  enabled = on
}

export function ac(preview = false): AudioContext | null {
  if (!enabled && !preview) return null
  try {
    ctx ??= new AudioContext()
    if (ctx.state === 'suspended') void ctx.resume()
    return ctx
  } catch {
    return null
  }
}

export function tone(a: BaseAudioContext, freq: number, at: number, dur: number, gain: number, type: OscillatorType = 'sine', to: AudioNode = a.destination) {
  const o = a.createOscillator()
  const g = a.createGain()
  o.type = type
  o.frequency.setValueAtTime(freq, at)
  g.gain.setValueAtTime(0, at)
  g.gain.linearRampToValueAtTime(gain, at + 0.006)
  g.gain.exponentialRampToValueAtTime(0.0001, at + dur)
  o.connect(g).connect(to)
  o.start(at)
  o.stop(at + dur + 0.02)
}

export function click(a: BaseAudioContext, at: number, gain: number, hz: number, to: AudioNode = a.destination) {
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
  src.connect(bp).connect(g).connect(to)
  src.start(at)
}

/** A pitch that falls as it fades: the body of a hit. */
function drop(a: BaseAudioContext, from: number, to: number, at: number, fall: number, dur: number, gain: number, type: OscillatorType, out: AudioNode) {
  const o = a.createOscillator()
  const g = a.createGain()
  o.type = type
  o.frequency.setValueAtTime(from, at)
  o.frequency.exponentialRampToValueAtTime(to, at + fall)
  g.gain.setValueAtTime(0, at)
  g.gain.linearRampToValueAtTime(gain, at + 0.003)
  g.gain.exponentialRampToValueAtTime(0.0001, at + dur)
  o.connect(g).connect(out)
  o.start(at)
  o.stop(at + dur + 0.02)
}

/** Air pulled past the ear: noise through a band that rises, swelling into the moment it ends. */
function whoosh(a: BaseAudioContext, at: number, dur: number, gain: number, out: AudioNode) {
  const len = Math.floor(a.sampleRate * dur)
  const buf = a.createBuffer(1, len, a.sampleRate)
  const d = buf.getChannelData(0)
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1
  const src = a.createBufferSource()
  src.buffer = buf
  const bp = a.createBiquadFilter()
  bp.type = 'bandpass'
  bp.Q.value = 0.9
  bp.frequency.setValueAtTime(500, at)
  bp.frequency.exponentialRampToValueAtTime(4200, at + dur)
  const g = a.createGain()
  g.gain.setValueAtTime(0.0001, at)
  g.gain.exponentialRampToValueAtTime(gain, at + dur * 0.85)
  g.gain.linearRampToValueAtTime(0, at + dur)
  src.connect(bp).connect(g).connect(out)
  src.start(at)
}

/** A bus that squeezes the hit so it lands hard without clipping, then lifts it back. */
function punch(a: BaseAudioContext): AudioNode {
  const comp = a.createDynamicsCompressor()
  comp.threshold.value = -20
  comp.knee.value = 6
  comp.ratio.value = 8
  comp.attack.value = 0.002
  comp.release.value = 0.12
  const lift = a.createGain()
  // About 3 dB under full scale at its peak: it plays dozens of times a day, so a hit, not a jump.
  lift.gain.value = 1.15
  comp.connect(lift).connect(a.destination)
  return comp
}

/**
 * The task on the desk changed: a weapon swap. A short rising whoosh, then the hit: a deep thump
 * whose pitch falls away, a knock of body, a bright transient and the metal lock a beat later, all
 * through one compressed bus. About a third of a second. Built against any context, so it can be
 * rendered offline to listen to (`renderSwitch`).
 */
export function switchCue(a: BaseAudioContext, t: number) {
  const out = punch(a)
  whoosh(a, t, 0.09, 0.28, out)
  const hit = t + 0.085
  drop(a, 150, 42, hit, 0.17, 0.34, 0.95, 'sine', out)
  drop(a, 240, 110, hit, 0.06, 0.12, 0.3, 'triangle', out)
  click(a, hit, 1.0, 3400, out)
  click(a, hit + 0.055, 0.75, 1900, out)
  tone(a, 2637, hit + 0.055, 0.12, 0.05, 'triangle', out)
}

/** The switch cue as samples, for listening to it outside the app. */
export async function renderSwitch(sampleRate = 44100): Promise<AudioBuffer> {
  const off = new OfflineAudioContext(1, Math.ceil(sampleRate * 0.5), sampleRate)
  switchCue(off, 0.01)
  return off.startRendering()
}

export const sfx = {
  /** The task on the desk changed (Alt+Q, a pick, an AI prompt, a stream, your League match): the swap thud. */
  switch(preview = false) {
    const a = ac(preview)
    if (!a) return
    switchCue(a, a.currentTime)
  },
  /** Mechanical clack: two transients and a low knock. A pick being browsed, a skip, a stop. */
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
  /** Something set down: a soft two-step up, for an item put up for sale. */
  place() {
    const a = ac()
    if (!a) return
    const t = a.currentTime
    click(a, t, 0.2, 2600)
    tone(a, 784, t, 0.07, 0.035, 'triangle')
    tone(a, 1046, t + 0.06, 0.12, 0.03, 'triangle')
  },
  /** Something taken away: one low soft drop. */
  drop() {
    const a = ac()
    if (!a) return
    const t = a.currentTime
    click(a, t, 0.18, 1400)
    tone(a, 294, t, 0.12, 0.04, 'triangle')
    tone(a, 220, t + 0.05, 0.16, 0.03, 'triangle')
  },
  /** Not enough coins: a short low double knock, a no that does not scold. */
  nope() {
    const a = ac()
    if (!a) return
    const t = a.currentTime
    tone(a, 196, t, 0.07, 0.06, 'triangle')
    tone(a, 165, t + 0.09, 0.1, 0.05, 'triangle')
  },
  /** A coin leaving the counter for the couch; each one a little lower than the last. */
  coinOut(i: number) {
    const a = ac()
    if (!a) return
    const t = a.currentTime
    const f = 1568 * Math.pow(2, -Math.min(i, 7) / 12)
    tone(a, f * 1.5, t, 0.07, 0.04, 'triangle')
    tone(a, f, t + 0.04, 0.16, 0.035)
  },
  /** A couch block paid for: the cash-in's run turned downward and softer, spent rather than banked. */
  spend() {
    const a = ac()
    if (!a) return
    const t = a.currentTime
    const run = [1568, 1318, 1046, 784]
    run.forEach((f, i) => tone(a, f, t + i * 0.07, 0.14, 0.035, 'triangle'))
    tone(a, 523, t + 0.3, 0.45, 0.03)
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
