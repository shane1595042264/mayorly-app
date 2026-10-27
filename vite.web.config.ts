import { resolve } from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import type { Plugin } from 'vite'

/** The browser preview has a photo behind it and a dev websocket; the shipped page has neither. */
const webCsp = (): Plugin => ({
  name: 'mayorly-web-csp',
  transformIndexHtml: (html) =>
    html
      .replace("img-src 'self' data:", "img-src 'self' data: https://picsum.photos https://fastly.picsum.photos")
      .replace("connect-src 'self'", "connect-src 'self' ws://localhost:* http://localhost:*"),
})

// The renderer on its own, in a browser, with the in-memory bridge.
// Used for fast UI iteration and for screenshots; the overlay window is the real target.
export default defineConfig({
  root: 'src/renderer',
  resolve: { alias: { '@core': resolve('src/core') } },
  plugins: [react(), webCsp()],
  server: { port: 5199, strictPort: true },
})
