import { createHash, randomUUID } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { SyncStatus } from '../shared/bridge'
import { SyncClient } from '../shared/sync-client'
import type { Engine } from './engine'

// The desktop's side of the sync loop in src/shared/sync-client.ts, which the phone shares:
// a sha1 of what the state has to say, and the mark kept in sync.json beside the save.

export class Sync extends SyncClient {
  constructor(engine: Engine, apiUrl: string, dataDir: string, onStatus: (s: SyncStatus) => void) {
    const file = join(dataDir, 'sync.json')
    super(engine, apiUrl, {
      hash: (text) => createHash('sha1').update(text).digest('hex'),
      loadMark: () => (existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : null),
      saveMark: (mark) => writeFileSync(file, JSON.stringify(mark)),
      newDevice: () => `${process.platform}-${randomUUID().slice(0, 8)}`,
    }, onStatus)
  }
}
