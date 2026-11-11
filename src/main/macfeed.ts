// The Mac's own update feed, read without Electron so it can be tested. The dist workflow
// renames the ad-hoc build's latest-mac.yml to mayorly-mac.yml, out of electron-updater's way
// (Squirrel refuses a build without a Developer ID), and stamps it with the commit. The shape is
// electron-builder's:
//
//   version: 0.1.18
//   files:
//     - url: Mayorly-0.1.18-arm64.zip
//       sha512: <base64>
//       size: 127908742
//   releaseDate: '2026-11-10T21:53:48.000Z'
//   commit: 5732b13

export interface FeedFile {
  url: string
  sha512: string
  size: number
}

export interface MacFeed {
  version: string
  commit: string | null
  releaseDate: string | null
  files: FeedFile[]
}

const unquote = (v: string) => v.trim().replace(/^(['"])(.*)\1$/, '$2')

/** The feed, or null when it is not one. Only the keys above are read; the rest is ignored. */
export function parseFeed(text: string): MacFeed | null {
  let version: string | null = null
  let commit: string | null = null
  let releaseDate: string | null = null
  const files: FeedFile[] = []
  let cur: Partial<FeedFile> | null = null
  let inFiles = false
  const close = () => {
    if (cur?.url && cur.sha512) files.push({ url: cur.url, sha512: cur.sha512, size: cur.size ?? 0 })
    cur = null
  }
  for (const raw of text.split(/\r?\n/)) {
    if (!raw.trim() || raw.trim().startsWith('#')) continue
    const top = !/^\s/.test(raw)
    const m = /^\s*(-\s+)?([A-Za-z0-9_]+):\s*(.*)$/.exec(raw)
    if (!m) continue
    const [, dash, key, value] = m
    if (top) {
      close()
      inFiles = key === 'files'
      if (key === 'version') version = unquote(value)
      else if (key === 'commit') commit = unquote(value) || null
      else if (key === 'releaseDate') releaseDate = unquote(value) || null
      continue
    }
    if (!inFiles) continue
    if (dash) {
      close()
      cur = {}
    }
    if (!cur) continue
    if (key === 'url') cur.url = unquote(value)
    else if (key === 'sha512') cur.sha512 = unquote(value)
    else if (key === 'size') cur.size = Number(unquote(value)) || 0
  }
  close()
  if (!version || !files.length) return null
  return { version, commit, releaseDate, files }
}

/** The zip for this Mac's architecture: `-arm64.zip` or `-x64.zip`. */
export function pickZip(feed: MacFeed, arch: string): FeedFile | null {
  return feed.files.find((f) => f.url.endsWith(`-${arch}.zip`)) ?? null
}

/**
 * Whether the release is worth installing over this build: not the commit this build was made
 * from, and made after it. A build that ship:mac made from the newest commit is ahead of a
 * release still being built, so the older release is never offered as an update. The `+` on a
 * build made from a dirty tree is ignored: the commit is still the one it stands on.
 */
export function shouldOffer(feed: MacFeed, build: { version: string; commit: string; builtAt: number }): boolean {
  const mine = build.commit.replace(/\+$/, '')
  if (feed.commit && mine !== 'local' && (feed.commit.startsWith(mine) || mine.startsWith(feed.commit))) return false
  if (feed.version === build.version && !feed.commit) return false
  const at = feed.releaseDate ? Date.parse(feed.releaseDate) : NaN
  if (!Number.isFinite(at)) return false
  return at > build.builtAt
}
