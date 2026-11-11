import { afterEach, describe, expect, it, vi } from 'vitest'
import { AiClerk } from './service'
import { KeySync } from './keysync'
import { checks, fromBase64, mergeRows, type VaultInfo, type VaultItem } from './vault'

// Two devices of one account against a stand-in for mayorly-api's /vault routes. Neither types
// a passphrase: the first makes the vault and hands its key to the server, the second takes it.

const MIN = 60_000

function server() {
  let vault: VaultInfo | null = null
  let items: VaultItem[] = []
  let escrow: { enc: string; id: string } | null = null
  const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status })
  const fetch = async (url: string, init?: RequestInit) => {
    const path = new URL(url).pathname
    const method = init?.method ?? 'GET'
    const body = init?.body ? JSON.parse(String(init.body)) : null
    if (path === '/vault' && method === 'GET') return json(200, { vault, items: vault ? items : [] })
    if (path === '/vault' && method === 'POST') {
      if (vault) return json(409, { error: 'exists', vault })
      vault = body as VaultInfo
      return json(200, { vault })
    }
    if (path === '/vault/escrow' && method === 'GET') return json(200, { keys: escrow })
    if (path === '/vault/escrow' && method === 'PUT') {
      // As the server does: only keys that open this vault's check are kept.
      if (!vault || !(await checks({ enc: fromBase64(body.enc), id: fromBase64(body.id) }, vault.check))) return json(409, { error: 'keys do not open this vault' })
      escrow = { enc: body.enc, id: body.id }
      return json(200, { ok: true })
    }
    if (path === '/vault/items' && method === 'POST') {
      if (!vault || body.check !== vault.check) return json(409, { error: 'vault-changed', vault })
      items = mergeRows(items, body.items)
      return json(200, { items })
    }
    return json(404, {})
  }
  return { fetch, escrowed: () => escrow !== null }
}

function device() {
  let text: string | null = null
  const clerk = new AiClerk({ load: () => (text ? { text } : null), available: () => true, save: (t) => void (text = t) }, () => {})
  return { clerk, sync: new KeySync('http://api.test', clerk) }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('key sync without a passphrase', () => {
  it('the first device makes the vault and hands its key over; the next opens it on sign-in', async () => {
    const api = server()
    vi.stubGlobal('fetch', api.fetch)
    const mac = device()
    mac.sync.setSession('mac')
    await mac.sync.sync()
    expect(mac.clerk.keySync().phase).toBe('on')
    expect(api.escrowed()).toBe(true)
    expect(mac.clerk.vaultSecret()?.escrowed).toBe(true)

    // A key the Mac has goes up sealed; the phone, signing in, gets the vault key and the key.
    mac.clerk.applySync([{ provider: 'gemini', key: 'AIza-from-the-mac-0123456789abcdefghijk', addedAt: 1 }], [], [])
    await mac.sync.sync()
    const phone = device()
    phone.sync.setSession('phone')
    await phone.sync.sync()
    expect(phone.clerk.keySync().phase).toBe('on')
    expect(phone.clerk.localKeys().map((k) => k.key)).toEqual(['AIza-from-the-mac-0123456789abcdefghijk'])
    mac.sync.setSession(null)
    phone.sync.setSession(null)
  }, MIN)

  it('a device with an old passphrase vault hands its keys over the first time it syncs', async () => {
    const api = server()
    vi.stubGlobal('fetch', api.fetch)
    const mac = device()
    mac.sync.setSession('mac')
    await mac.sync.sync()
    // As a Mac on the previous build left it: unlocked, never handed over.
    mac.clerk.setVaultSecret({ ...mac.clerk.vaultSecret()!, escrowed: false })
    await mac.sync.sync()
    expect(mac.clerk.vaultSecret()?.escrowed).toBe(true)
    mac.sync.setSession(null)
  }, MIN)
})
