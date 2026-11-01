import type { AlarmChoice, AlarmKind, AlarmTone } from './model'

export const ALARM_TONES: { id: AlarmTone; label: string }[] = [
  { id: 'classic', label: 'Classic' }, { id: 'bell', label: 'Bell' },
  { id: 'chime', label: 'Chime' }, { id: 'pulse', label: 'Pulse' },
  { id: 'gentle', label: 'Gentle' }, { id: 'silent', label: 'Silent' },
]
export const DEFAULT_ALARMS: Record<AlarmKind, AlarmChoice> = { work: { tone: 'classic' }, rest: { tone: 'classic' } }

export function sanitiseAlarms(raw: Partial<Record<AlarmKind, AlarmChoice>> | undefined): Record<AlarmKind, AlarmChoice> {
  const choice = (kind: AlarmKind): AlarmChoice => {
    const c = raw?.[kind]
    const customId = typeof c?.customId === 'string' && /^[a-f0-9-]{36}$/i.test(c.customId) ? c.customId : undefined
    const tone = c?.tone === 'custom' && customId ? 'custom' : ALARM_TONES.some(t => t.id === c?.tone) ? c!.tone : 'classic'
    return { tone, ...(customId ? { customId, customName: typeof c?.customName === 'string' ? c.customName.slice(0, 120) : 'Custom sound' } : {}) }
  }
  return { work: choice('work'), rest: choice('rest') }
}
