import { describe, expect, it } from 'vitest'
import { parseFeed, pickZip, shouldOffer } from './macfeed'

const FEED = `version: 0.1.18
files:
  - url: Mayorly-0.1.18-arm64.zip
    sha512: aaa==
    size: 127908742
  - url: Mayorly-0.1.18-arm64.dmg
    sha512: bbb==
    size: 127823549
  - url: Mayorly-0.1.18-x64.zip
    sha512: ccc==
    size: 134775095
path: Mayorly-0.1.18-arm64.zip
sha512: aaa==
releaseDate: '2026-11-10T21:53:48.000Z'
commit: 5732b13
`

const at = Date.parse('2026-11-10T21:53:48.000Z')

describe('the Mac update feed', () => {
  it('reads the version, the commit, the date and every file', () => {
    const f = parseFeed(FEED)!
    expect(f.version).toBe('0.1.18')
    expect(f.commit).toBe('5732b13')
    expect(f.releaseDate).toBe('2026-11-10T21:53:48.000Z')
    expect(f.files).toHaveLength(3)
    expect(f.files[0]).toEqual({ url: 'Mayorly-0.1.18-arm64.zip', sha512: 'aaa==', size: 127908742 })
  })

  it('picks the zip for this Mac, never the disk image', () => {
    const f = parseFeed(FEED)!
    expect(pickZip(f, 'arm64')?.sha512).toBe('aaa==')
    expect(pickZip(f, 'x64')?.sha512).toBe('ccc==')
    expect(pickZip(f, 'ia32')).toBeNull()
  })

  it('is not a feed without a version or files', () => {
    expect(parseFeed('Not Found')).toBeNull()
    expect(parseFeed('version: 0.1.2\nfiles:\n')).toBeNull()
  })

  it('offers a release made from another commit after this build', () => {
    const f = parseFeed(FEED)!
    expect(shouldOffer(f, { version: '0.1.0', commit: '017487f+', builtAt: at - 60_000 })).toBe(true)
    expect(shouldOffer(f, { version: '0.1.17', commit: 'fe56a24', builtAt: at - 3_600_000 })).toBe(true)
  })

  it('never offers the commit this build stands on, dirty or not', () => {
    const f = parseFeed(FEED)!
    expect(shouldOffer(f, { version: '0.1.0', commit: '5732b13+', builtAt: at - 60_000 })).toBe(false)
    expect(shouldOffer(f, { version: '0.1.18', commit: '5732b13', builtAt: at - 60_000 })).toBe(false)
  })

  it('never offers a release older than a build shipped from a newer commit', () => {
    const f = parseFeed(FEED)!
    expect(shouldOffer(f, { version: '0.1.0', commit: '9999999', builtAt: at + 60_000 })).toBe(false)
  })
})
