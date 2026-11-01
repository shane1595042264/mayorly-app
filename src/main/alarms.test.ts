import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { AlarmFiles, AUDIO_MAX_BYTES } from './alarms'

const dirs: string[] = []
const dir = () => { const path = mkdtempSync(join(tmpdir(), 'mayorly-alarm-test-')); dirs.push(path); return path }
afterEach(() => { for (const path of dirs.splice(0)) rmSync(path, { recursive: true, force: true }) })

describe('local alarm files', () => {
  it('copies an upload into app data and reads it after the source file is gone and the store restarts', () => {
    const root = dir(), source = join(root, 'tone.wav')
    writeFileSync(source, Buffer.from('RIFF test audio fixture'))
    const files = new AlarmFiles(root)
    const picked = files.pickFile(source)
    const choice = files.save(picked.name, picked.dataUrl)
    rmSync(source)
    expect(choice.customName).toBe('tone.wav')
    expect(new AlarmFiles(root).read(choice.customId!)).toBe(picked.dataUrl)
  })

  it('refuses unsupported and oversized uploads and cannot read a supplied path', () => {
    const root = dir(), files = new AlarmFiles(root)
    expect(() => files.save('page.html', 'data:text/html;base64,SGVsbG8=')).toThrow()
    expect(() => files.save('big.wav', 'x'.repeat(AUDIO_MAX_BYTES * 2))).toThrow()
    expect(files.read('../../mayorly.json')).toBeNull()
    expect(files.read('00000000-0000-0000-0000-000000000000')).toBeNull()
    const empty = join(root, 'empty.wav')
    writeFileSync(empty, '')
    expect(() => files.pickFile(empty)).toThrow('up to 5 MB')
  })
})
