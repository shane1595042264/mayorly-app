import { resolve } from 'node:path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import type { Plugin } from 'vite'

/** Development only: the Vite dev server talks to the page over a websocket the shipped CSP does not allow. */
const devCsp = (): Plugin => ({
  name: 'mayorly-dev-csp',
  apply: 'serve',
  transformIndexHtml: (html) => html.replace("connect-src 'self'", "connect-src 'self' ws://localhost:* http://localhost:*"),
})

const alias = { '@core': resolve('src/core') }

export default defineConfig({
  main: {
    resolve: { alias },
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
    plugins: [react(), devCsp()],
    build: { minify: true, rollupOptions: { input: { index: resolve('src/renderer/index.html') } } },
  },
})
