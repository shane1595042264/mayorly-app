import { Capacitor } from '@capacitor/core'
import { Directory, Encoding, Filesystem } from '@capacitor/filesystem'

// What the phone keeps on disk: JSON files in the app's Library folder (backed up with the
// phone, never shown to the person). The same calls work in a browser for development, where
// Capacitor keeps them in IndexedDB. A write goes to a temporary file first and is then renamed
// over the old one, so a crash mid-write never leaves half a save.

const DIR = Directory.Library
const ROOT = 'mayorly'

export const native = Capacitor.isNativePlatform()
export const platformName = Capacitor.getPlatform() // 'ios', 'android' or 'web'
export const API_URL: string = __API_URL__

export async function readJson<T>(name: string): Promise<T | null> {
  try {
    const r = await Filesystem.readFile({ path: `${ROOT}/${name}`, directory: DIR, encoding: Encoding.UTF8 })
    return JSON.parse(typeof r.data === 'string' ? r.data : await r.data.text()) as T
  } catch {
    return null
  }
}

export async function writeJson(name: string, value: unknown): Promise<void> {
  const data = JSON.stringify(value)
  const tmp = `${ROOT}/.${name}.tmp`
  await Filesystem.writeFile({ path: tmp, data, directory: DIR, encoding: Encoding.UTF8, recursive: true })
  await Filesystem.rename({ from: tmp, to: `${ROOT}/${name}`, directory: DIR, toDirectory: DIR })
}

export async function removeFile(name: string): Promise<void> {
  await Filesystem.deleteFile({ path: `${ROOT}/${name}`, directory: DIR }).catch(() => {})
}

/**
 * A 106-bit hash of a string: two cyrb53 runs with different seeds. Only ever compared on this
 * phone (has the state changed since it last matched the server), so it need not match the
 * desktop's sha1, and it is synchronous, which crypto.subtle is not.
 */
export function hash(text: string): string {
  const run = (seed: number) => {
    let h1 = 0xdeadbeef ^ seed
    let h2 = 0x41c6ce57 ^ seed
    for (let i = 0; i < text.length; i++) {
      const c = text.charCodeAt(i)
      h1 = Math.imul(h1 ^ c, 2654435761)
      h2 = Math.imul(h2 ^ c, 1597334677)
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)
    return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16).padStart(14, '0')
  }
  return run(1) + run(2)
}

/** What the desk calls this device when it runs here: shown on the computers as where it is running. */
export const deviceName = /iPad/.test(navigator.userAgent) ? 'iPad' : /iPhone/.test(navigator.userAgent) ? 'iPhone' : 'Phone'
