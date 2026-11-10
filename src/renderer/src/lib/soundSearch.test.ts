import { describe, expect, it } from 'vitest'
import { licenseLabel, soundName, toFound } from './soundSearch'

const hit = (over: Record<string, unknown> = {}) => ({
  id: 'a1',
  title: 'Reception bell.wav',
  creator: 'someone',
  license: 'by',
  duration: 6798,
  url: 'https://cdn.freesound.org/previews/1/1_2-hq.mp3',
  filetype: 'mp3',
  filesize: 153888,
  foreign_landing_url: 'https://freesound.org/s/1',
  ...over,
})

describe('the sound library', () => {
  it('keeps alarm-sized files from Freesound we can play, and tidies the title', () => {
    expect(toFound([hit()])).toEqual([
      { id: 'a1', title: 'Reception bell', creator: 'someone', license: 'CC BY', durationMs: 6798, url: 'https://cdn.freesound.org/previews/1/1_2-hq.mp3', page: 'https://freesound.org/s/1' },
    ])
  })

  it('drops other hosts, plain http, formats we cannot play, files over 5 MB and junk', () => {
    expect(toFound([
      hit({ url: 'https://prod-1.storage.jamendo.com/?trackid=1&format=mp32' }),
      hit({ url: 'http://cdn.freesound.org/previews/1/1.mp3' }),
      hit({ filetype: 'mp32' }),
      hit({ filesize: 6 * 1024 * 1024 }),
      hit({ url: 'not a url' }),
      hit({ id: '' }),
      'nonsense',
    ])).toEqual([])
    expect(toFound(null)).toEqual([])
  })

  it('names licences the way they are written, and keeps the credit in the alarm name', () => {
    expect(['cc0', 'by', 'by-nc', 'by-nc-sa', ''].map(licenseLabel)).toEqual(['CC0', 'CC BY', 'CC BY-NC', 'CC BY-NC-SA', 'CC'])
    expect(soundName(toFound([hit()])[0])).toBe('Reception bell by someone (CC BY)')
  })
})
