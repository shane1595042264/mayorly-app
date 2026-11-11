import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ClerkStore } from '../../shared/ai/service'
import type { Seal } from '../seal'

/** The clerk's keys on a computer: ai.bin beside the save, sealed (seal.ts). */
export function sealedClerkStore(dir: string, seal: Seal): ClerkStore {
  const file = join(dir, 'ai.bin')
  return {
    load: () => (existsSync(file) ? seal.open(readFileSync(file)) : null),
    available: () => seal.available(),
    save: (text) => writeFileSync(file, seal.seal(text)),
  }
}
