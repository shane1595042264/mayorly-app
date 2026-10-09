import { resolve } from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// The renderer on its own, in a browser, with the in-memory bridge.
// Used for fast UI iteration and for screenshots; the overlay window is the real target.
export default defineConfig({
  root: 'src/renderer',
  resolve: { alias: { '@core': resolve('src/core') } },
  plugins: [react()],
  server: { port: 5199, strictPort: true },
})
