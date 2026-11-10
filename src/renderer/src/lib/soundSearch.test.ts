import { describe, expect, it } from 'vitest'
import { licenseLabel, rankSounds, soundName, toFound, unpack } from './soundSearch'

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

describe('the catalogue that ships with the app', () => {
  const sounds = [
    { i: '1', t: 'Reception bell', c: 'a', l: 'by', d: 6000, u: '1.mp3', p: null, g: ['bell', 'desk'] },
    { i: '2', t: 'Bell, Candle Damper', c: 'b', l: 'cc0', d: 3000, u: '2.mp3', p: null, g: ['bell'] },
    { i: '3', t: 'Morning birds', c: 'c', l: 'by-nc', d: 9000, u: '3.mp3', p: null, g: ['birds', 'dawn', 'chirp'] },
    { i: '4', t: 'Gong hit', c: 'd', l: 'by', d: 4000, u: '4.mp3', p: null, g: ['gong', 'temple'] },
  ].map(unpack)
  const ids = (q: string) => rankSounds(sounds, q).map((s) => s.id)

  it('finds a half-typed word, title starts first, then shorter clips', () => {
    expect(ids('be')).toEqual(['2', '1'])
    expect(ids('bell')).toEqual(['2', '1'])
  })

  it('matches tags too, and needs every word', () => {
    expect(ids('dawn')).toEqual(['3'])
    expect(ids('temple gong')).toEqual(['4'])
    expect(ids('bell gong')).toEqual([])
    expect(ids('  ')).toEqual([])
  })

  it('gives back sounds the alarms can download', () => {
    expect(rankSounds(sounds, 'gong')[0]).toEqual({ id: '4', title: 'Gong hit', creator: 'd', license: 'CC BY', durationMs: 4000, url: 'https://cdn.freesound.org/previews/4.mp3', page: null })
  })
})
