import { resolve } from 'node:path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import type { Plugin } from 'vite'
import { buildInfo } from './build-info'

/** Development only: the Vite dev server talks to the page over a websocket the shipped CSP does not allow. */
const devCsp = (): Plugin => ({
  name: 'mayorly-dev-csp',
  apply: 'serve',
  transformIndexHtml: (html) => html.replace("connect-src 'self'", "connect-src 'self' ws://localhost:* http://localhost:*"),
})

const alias = { '@core': resolve('src/core') }
/** The build stamp every bundle carries: version, commit, time, the top of NOTES.md. */
const define = { __MAYORLY_BUILD__: JSON.stringify(buildInfo()) }

export default defineConfig({
  main: {
    resolve: { alias },
    define,
    build: { rollupOptions: { input: { index: resolve('src/main/index.ts') } } },
  },
  preload: {
    resolve: { alias },
    build: {
      rollupOptions: {
        input: { index: resolve('src/preload/index.ts') },
        // Sandboxed preloads are plain scripts, so keep this one CommonJS.
        output: { format: 'cjs', entryFileNames: '[name].cjs' },
      },
    },
  },
  renderer: {
    root: 'src/renderer',
    resolve: { alias },
    define,
    plugins: [react(), devCsp()],
    build: { minify: true, rollupOptions: { input: { index: resolve('src/renderer/index.html') } } },
  },
})
