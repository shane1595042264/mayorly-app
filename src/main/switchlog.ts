import { existsSync, readFileSync } from 'node:fs'
import { appendFile, stat, writeFile } from 'node:fs/promises'
import { SWITCH_LOG_MAX, switchRecordOf, type SwitchRecord } from '../shared/switchlog'
import { log } from './log'

// The switch log's keeping: the last hundred switches of the desk, in memory and in
// switches.jsonl beside the save, one line each, so a restart keeps them. This computer's own,
// never synced. When the file grows past a few hundred lines it is written again from memory.

const REWRITE_BYTES = 256 * 1024

export class SwitchLog {
  private items: SwitchRecord[] = []

  constructor(private file: string, private onAdd: (r: SwitchRecord) => void) {
    try {
      if (existsSync(file)) {
        const lines = readFileSync(file, 'utf8').split('\n').filter(Boolean).slice(-SWITCH_LOG_MAX)
        for (const line of lines) {
          try {
            const r = switchRecordOf(JSON.parse(line))
            if (r) this.items.push(r)
          } catch {
            // A torn last line from a crash: skipped.
          }
        }
      }
    } catch (err) {
      log.warn('[switch]', `the log could not be read: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  /** Newest first. */
  list(): SwitchRecord[] {
    return this.items.slice().reverse()
  }

  add(r: SwitchRecord) {
    this.items.push(r)
    if (this.items.length > SWITCH_LOG_MAX) this.items.splice(0, this.items.length - SWITCH_LOG_MAX)
    this.onAdd(r)
    void this.write(r)
  }

  private async write(r: SwitchRecord) {
    try {
      const size = await stat(this.file).then((x) => x.size, () => 0)
      if (size > REWRITE_BYTES) await writeFile(this.file, this.items.map((x) => JSON.stringify(x)).join('\n') + '\n')
      else await appendFile(this.file, JSON.stringify(r) + '\n')
    } catch (err) {
      log.warn('[switch]', `the log could not be written: ${err instanceof Error ? err.message : String(err)}`)
    }
  }
}
