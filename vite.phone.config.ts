import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'
import { buildInfo } from './build-info'

// The phone app's web layer: src/phone, built into mobile/www, which Capacitor wraps for iOS
// (and later Android). `npm run phone` serves it at localhost:5200 for a browser (?demo for
// sample data); `npm run ship:ios` builds it into the app on the phone.
/** The app's own native code: plugins that live in the iOS project rather than in a package. */
const NATIVE_FILES = ['mobile/ios/App/App/AuthSession.swift', 'mobile/ios/App/App/Dictation.swift', 'mobile/ios/App/App/SceneDelegate.swift', 'mobile/ios/App/App/Info.plist']

/**
 * Which native shell this web layer needs: the Capacitor packages and their versions, and the
 * app's own native code. A bundle sent over the air only goes to a phone whose installed app has
 * the same; anything else waits for an install (npm run ship:ios).
 */
function shell(): string {
  const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as { devDependencies: Record<string, string> }
  const native = Object.entries(pkg.devDependencies).filter(([name]) => name.startsWith('@capacitor/') && name !== '@capacitor/cli').sort().map(([n, v]) => `${n}@${v}`).join(',')
  const h = createHash('sha256').update(native)
  for (const f of NATIVE_FILES) h.update(readFileSync(f))
  return h.digest('hex').slice(0, 12)
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const build = buildInfo()
  const id = shell()
  return {
    root: resolve('src/phone'),
    base: './',
    // phone.json beside index.html says what this bundle is; the release workflow makes the
    // over-the-air manifest from it.
    plugins: [react(), {
      name: 'phone-meta',
      generateBundle() {
        this.emitFile({ type: 'asset', fileName: 'phone.json', source: JSON.stringify({ version: build.version, commit: build.commit, builtAt: build.builtAt, shell: id }) })
      },
    }],
    resolve: { alias: { '@core': resolve('src/core') } },
    define: {
      __MAYORLY_BUILD__: JSON.stringify(build),
      __API_URL__: JSON.stringify(env.MAIN_VITE_API_URL ?? ''),
      __PHONE_SHELL__: JSON.stringify(id),
    },
    build: { outDir: resolve('mobile/www'), emptyOutDir: true, target: 'safari16', assetsInlineLimit: 0 },
    server: { port: 5200, host: true },
  }
})
