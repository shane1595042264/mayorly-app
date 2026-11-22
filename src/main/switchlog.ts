import { appendFileSync, existsSync, readFileSync } from 'node:fs'
import { appendFile, rename, stat, writeFile } from 'node:fs/promises'
import { SWITCH_LOG_MAX, switchRecordOf, type SwitchRecord } from '../shared/switchlog'
import { log } from './log'

// The switch log's keeping: the last hundred switches of the desk, in memory and in
// switches.jsonl beside the save, one line each, so a restart keeps them. This computer's own,
// never synced. When the file grows past a few hundred lines it is written again from memory.

const REWRITE_BYTES = 256 * 1024

export class SwitchLog {
  private items: SwitchRecord[] = []
  /** Writes one after another, so an append never lands inside a rewrite. */
  private writing: Promise<void> = Promise.resolve()

  constructor(private file: string, private onAdd: (r: SwitchRecord) => void) {
    try {
      if (existsSync(file)) {
        const text = readFileSync(file, 'utf8')
        // A line torn by a crash: end it, so the next record starts on a line of its own.
        if (text && !text.endsWith('\n')) appendFileSync(file, '\n')
        const lines = text.split('\n').filter(Boolean).slice(-SWITCH_LOG_MAX)
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
    this.writing = this.writing.then(() => this.write(r))
  }

  private async write(r: SwitchRecord) {
    try {
      const size = await stat(this.file).then((x) => x.size, () => 0)
      if (size > REWRITE_BYTES) {
        // Written beside it and moved into place, so a stop halfway never leaves an empty log.
        const tmp = `${this.file}.tmp`
        await writeFile(tmp, this.items.map((x) => JSON.stringify(x)).join('\n') + '\n')
        await rename(tmp, this.file)
      } else await appendFile(this.file, JSON.stringify(r) + '\n')
    } catch (err) {
      log.warn('[switch]', `the log could not be written: ${err instanceof Error ? err.message : String(err)}`)
    }
  }
}
