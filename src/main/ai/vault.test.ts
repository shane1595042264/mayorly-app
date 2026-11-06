import { describe, expect, it } from 'vitest'
import { checks, deriveKeys, incoming, kdfOk, KDF, keyId, live, makeCheck, mergeRows, newSalt, open, openKey, outgoing, seal, sealKey, type LocalKey, type LocalRemoval, type VaultItem, type VaultKeys } from './vault'

// Cheap settings so the tests run fast; the app uses KDF.
const FAST = { name: 'scrypt' as const, N: 2 ** 12, r: 8, p: 1 }

interface Computer {
  local: LocalKey[]
  removed: LocalRemoval[]
}

/** One sync of one computer against the server, the way KeySync does it. */
function syncOnce(keys: VaultKeys, server: VaultItem[], pc: Computer): VaultItem[] {
  const merged = mergeRows(server, outgoing(keys, pc.local, pc.removed))
  const { add, drop } = incoming(keys, pc.local, merged)
  pc.local = [...pc.local.filter((k) => !drop.includes(k)), ...add]
  pc.removed = []
  return merged
}
const names = (pc: Computer) => pc.local.map((k) => k.key).sort()

describe('key vault', () => {
  it('makes the same keys from the same passphrase on any computer, and catches a wrong one', async () => {
    const salt = newSalt()
    const mac = await deriveKeys('correct horse battery', salt, FAST)
    const win = await deriveKeys('correct horse battery', salt, FAST)
    const check = makeCheck(mac)
    expect(checks(win, check)).toBe(true)
    expect(checks(await deriveKeys('wrong horse battery', salt, FAST), check)).toBe(false)
    expect(keyId(mac, 'gemini', 'AIza-one')).toBe(keyId(win, 'gemini', 'AIza-one'))
    expect(keyId(mac, 'gemini', 'AIza-one')).not.toBe(keyId(mac, 'gemini', 'AIza-two'))
    // Another vault names the same key differently, so ids say nothing across accounts.
    expect(keyId(await deriveKeys('correct horse battery', newSalt(), FAST), 'gemini', 'AIza-one')).not.toBe(keyId(mac, 'gemini', 'AIza-one'))
  })

  it('seals so that only the passphrase opens it, and a changed blob does not open', async () => {
    const keys = await deriveKeys('correct horse battery', newSalt(), FAST)
    const blob = sealKey(keys, 'openai', 'sk-secret')
    expect(blob).not.toContain('sk-secret')
    expect(openKey(keys, blob)).toEqual({ provider: 'openai', key: 'sk-secret' })
    const other = await deriveKeys('another passphrase', newSalt(), FAST)
    expect(openKey(other, blob)).toBeNull()
    const raw = Buffer.from(blob, 'base64url')
    raw[20] ^= 1
    expect(open(keys, raw.toString('base64url'))).toBeNull()
    expect(seal(keys, 'x')).not.toBe(seal(keys, 'x'))
  })

  it('two distinct keys on a Mac and another on Windows make three on both', async () => {
    const keys = await deriveKeys('correct horse battery', newSalt(), FAST)
    const mac: Computer = { local: [{ provider: 'gemini', key: 'AIza-mac', addedAt: 1 }, { provider: 'openai', key: 'sk-mac', addedAt: 2 }], removed: [] }
    const win: Computer = { local: [{ provider: 'gemini', key: 'AIza-win', addedAt: 3 }], removed: [] }
    let server: VaultItem[] = []
    server = syncOnce(keys, server, mac)
    server = syncOnce(keys, server, win)
    server = syncOnce(keys, server, mac)
    expect(server.filter(live)).toHaveLength(3)
    expect(names(mac)).toEqual(['AIza-mac', 'AIza-win', 'sk-mac'])
    expect(names(win)).toEqual(names(mac))
  })

  it('the same key on two computers is one key', async () => {
    const keys = await deriveKeys('correct horse battery', newSalt(), FAST)
    const mac: Computer = { local: [{ provider: 'anthropic', key: 'sk-ant-same', addedAt: 10 }], removed: [] }
    const win: Computer = { local: [{ provider: 'anthropic', key: 'sk-ant-same', addedAt: 20 }], removed: [] }
    let server: VaultItem[] = []
    server = syncOnce(keys, server, mac)
    server = syncOnce(keys, server, win)
    server = syncOnce(keys, server, mac)
    expect(server).toHaveLength(1)
    expect(mac.local).toHaveLength(1)
    expect(win.local).toHaveLength(1)
  })

  it('a key removed on one computer goes from the other, and stays gone', async () => {
    const keys = await deriveKeys('correct horse battery', newSalt(), FAST)
    const mac: Computer = { local: [{ provider: 'xai', key: 'xai-1', addedAt: 1 }], removed: [] }
    const win: Computer = { local: [], removed: [] }
    let server = syncOnce(keys, [], mac)
    server = syncOnce(keys, server, win)
    expect(names(win)).toEqual(['xai-1'])
    // Removed on the Mac at 50.
    mac.removed.push({ ...mac.local[0], at: 50 })
    mac.local = []
    server = syncOnce(keys, server, mac)
    // Windows still sends its copy, added at 1: the later removal wins.
    server = syncOnce(keys, server, win)
    expect(win.local).toEqual([])
    server = syncOnce(keys, server, mac)
    expect(mac.local).toEqual([])
    expect(server.filter(live)).toHaveLength(0)
  })

  it('pasting a removed key again brings it back everywhere', async () => {
    const keys = await deriveKeys('correct horse battery', newSalt(), FAST)
    const mac: Computer = { local: [], removed: [{ provider: 'gemini', key: 'AIza-back', at: 50 }] }
    const win: Computer = { local: [], removed: [] }
    let server = syncOnce(keys, [], mac)
    expect(server.filter(live)).toHaveLength(0)
    win.local.push({ provider: 'gemini', key: 'AIza-back', addedAt: 90 })
    server = syncOnce(keys, server, win)
    server = syncOnce(keys, server, mac)
    expect(names(mac)).toEqual(['AIza-back'])
  })

  it('skips rows this vault cannot open', async () => {
    const keys = await deriveKeys('correct horse battery', newSalt(), FAST)
    const other = await deriveKeys('someone else', newSalt(), FAST)
    const foreign: VaultItem = { id: keyId(keys, 'gemini', 'AIza-x'), blob: sealKey(other, 'gemini', 'AIza-x'), addedAt: 5, deletedAt: null }
    expect(incoming(keys, [], [foreign]).add).toEqual([])
  })

  it('refuses scrypt settings that are too weak or too heavy', () => {
    expect(kdfOk(KDF)).toBe(true)
    expect(kdfOk({ ...KDF, N: 2 ** 10 })).toBe(false)
    expect(kdfOk({ ...KDF, N: 2 ** 22 })).toBe(false)
    expect(kdfOk({ ...KDF, N: 3 * 2 ** 15 })).toBe(false)
    expect(kdfOk({ ...KDF, name: 'pbkdf2' })).toBe(false)
    expect(kdfOk(null)).toBe(false)
  })
})
