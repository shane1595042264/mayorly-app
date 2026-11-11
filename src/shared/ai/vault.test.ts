import { describe, expect, it } from 'vitest'
import { checks, deriveKeys, fromBase64, incoming, kdfOk, KDF, keyId, live, makeCheck, mergeRows, newSalt, open, openKey, outgoing, seal, sealKey, toBase64, type LocalKey, type LocalRemoval, type VaultItem, type VaultKeys } from './vault'
import fixture from './vault.fixture.json'

// Cheap settings so the tests run fast; the app uses KDF.
const FAST = { name: 'scrypt' as const, N: 2 ** 12, r: 8, p: 1 }

interface Computer {
  local: LocalKey[]
  removed: LocalRemoval[]
}

/** One sync of one computer against the server, the way KeySync does it. */
async function syncOnce(keys: VaultKeys, server: VaultItem[], pc: Computer): Promise<VaultItem[]> {
  const merged = mergeRows(server, await outgoing(keys, pc.local, pc.removed))
  const { add, drop } = await incoming(keys, pc.local, merged)
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
    const check = await makeCheck(mac)
    expect(await checks(win, check)).toBe(true)
    expect(await checks(await deriveKeys('wrong horse battery', salt, FAST), check)).toBe(false)
    expect(await keyId(mac, 'gemini', 'AIza-one')).toBe(await keyId(win, 'gemini', 'AIza-one'))
    expect(await keyId(mac, 'gemini', 'AIza-one')).not.toBe(await keyId(mac, 'gemini', 'AIza-two'))
    // Another vault names the same key differently, so ids say nothing across accounts.
    expect(await keyId(await deriveKeys('correct horse battery', newSalt(), FAST), 'gemini', 'AIza-one')).not.toBe(await keyId(mac, 'gemini', 'AIza-one'))
  })

  it('seals so that only the passphrase opens it, and a changed blob does not open', async () => {
    const keys = await deriveKeys('correct horse battery', newSalt(), FAST)
    const blob = await sealKey(keys, 'openai', 'sk-secret')
    expect(blob).not.toContain('sk-secret')
    expect(await openKey(keys, blob)).toEqual({ provider: 'openai', key: 'sk-secret' })
    const other = await deriveKeys('another passphrase', newSalt(), FAST)
    expect(await openKey(other, blob)).toBeNull()
    const raw = Buffer.from(blob, 'base64url')
    raw[20] ^= 1
    expect(await open(keys, raw.toString('base64url'))).toBeNull()
    expect(await seal(keys, 'x')).not.toBe(await seal(keys, 'x'))
  })

  it('two distinct keys on a Mac and another on Windows make three on both', async () => {
    const keys = await deriveKeys('correct horse battery', newSalt(), FAST)
    const mac: Computer = { local: [{ provider: 'gemini', key: 'AIza-mac', addedAt: 1 }, { provider: 'openai', key: 'sk-mac', addedAt: 2 }], removed: [] }
    const win: Computer = { local: [{ provider: 'gemini', key: 'AIza-win', addedAt: 3 }], removed: [] }
    let server: VaultItem[] = []
    server = await syncOnce(keys, server, mac)
    server = await syncOnce(keys, server, win)
    server = await syncOnce(keys, server, mac)
    expect(server.filter(live)).toHaveLength(3)
    expect(names(mac)).toEqual(['AIza-mac', 'AIza-win', 'sk-mac'])
    expect(names(win)).toEqual(names(mac))
  })

  it('the same key on two computers is one key', async () => {
    const keys = await deriveKeys('correct horse battery', newSalt(), FAST)
    const mac: Computer = { local: [{ provider: 'anthropic', key: 'sk-ant-same', addedAt: 10 }], removed: [] }
    const win: Computer = { local: [{ provider: 'anthropic', key: 'sk-ant-same', addedAt: 20 }], removed: [] }
    let server: VaultItem[] = []
    server = await syncOnce(keys, server, mac)
    server = await syncOnce(keys, server, win)
    server = await syncOnce(keys, server, mac)
    expect(server).toHaveLength(1)
    expect(mac.local).toHaveLength(1)
    expect(win.local).toHaveLength(1)
  })

  it('a key removed on one computer goes from the other, and stays gone', async () => {
    const keys = await deriveKeys('correct horse battery', newSalt(), FAST)
    const mac: Computer = { local: [{ provider: 'xai', key: 'xai-1', addedAt: 1 }], removed: [] }
    const win: Computer = { local: [], removed: [] }
    let server = await syncOnce(keys, [], mac)
    server = await syncOnce(keys, server, win)
    expect(names(win)).toEqual(['xai-1'])
    // Removed on the Mac at 50.
    mac.removed.push({ ...mac.local[0], at: 50 })
    mac.local = []
    server = await syncOnce(keys, server, mac)
    // Windows still sends its copy, added at 1: the later removal wins.
    server = await syncOnce(keys, server, win)
    expect(win.local).toEqual([])
    server = await syncOnce(keys, server, mac)
    expect(mac.local).toEqual([])
    expect(server.filter(live)).toHaveLength(0)
  })

  it('pasting a removed key again brings it back everywhere', async () => {
    const keys = await deriveKeys('correct horse battery', newSalt(), FAST)
    const mac: Computer = { local: [], removed: [{ provider: 'gemini', key: 'AIza-back', at: 50 }] }
    const win: Computer = { local: [], removed: [] }
    let server = await syncOnce(keys, [], mac)
    expect(server.filter(live)).toHaveLength(0)
    win.local.push({ provider: 'gemini', key: 'AIza-back', addedAt: 90 })
    server = await syncOnce(keys, server, win)
    server = await syncOnce(keys, server, mac)
    expect(names(mac)).toEqual(['AIza-back'])
  })

  it('skips rows this vault cannot open', async () => {
    const keys = await deriveKeys('correct horse battery', newSalt(), FAST)
    const other = await deriveKeys('someone else', newSalt(), FAST)
    const foreign: VaultItem = { id: await keyId(keys, 'gemini', 'AIza-x'), blob: await sealKey(other, 'gemini', 'AIza-x'), addedAt: 5, deletedAt: null }
    expect((await incoming(keys, [], [foreign])).add).toEqual([])
  })

  // vault.fixture.json was written by the first, Node-only version of this file. Every vault set
  // up before the phone existed was made by it, so this one must make exactly the same bytes.
  it('makes exactly what the first version made, so existing vaults open everywhere', async () => {
    for (const run of [fixture.fast, fixture.app]) {
      const keys = await deriveKeys(fixture.passphrase, fixture.salt, run.kdf as typeof KDF)
      expect(toBase64(keys.enc)).toBe(run.enc)
      expect(toBase64(keys.id)).toBe(run.id)
      expect(await checks(keys, run.check)).toBe(true)
      expect(await keyId(keys, 'openai', 'sk-test-0123456789abcdefghij')).toBe(run.keyId)
      expect(await openKey(keys, run.blob)).toEqual({ provider: 'openai', key: 'sk-test-0123456789abcdefghij' })
      // And what it seals now, the first version could open: same layout, same key.
      expect(await openKey({ enc: fromBase64(run.enc), id: fromBase64(run.id) }, await sealKey(keys, 'gemini', 'AIza-round-trip'))).toEqual({ provider: 'gemini', key: 'AIza-round-trip' })
    }
  }, 30_000)

  it('refuses scrypt settings that are too weak or too heavy', () => {
    expect(kdfOk(KDF)).toBe(true)
    expect(kdfOk({ ...KDF, N: 2 ** 10 })).toBe(false)
    expect(kdfOk({ ...KDF, N: 2 ** 22 })).toBe(false)
    expect(kdfOk({ ...KDF, N: 3 * 2 ** 15 })).toBe(false)
    expect(kdfOk({ ...KDF, name: 'pbkdf2' })).toBe(false)
    expect(kdfOk(null)).toBe(false)
  })
})
