import { serve } from '@hono/node-server'
import { app } from './app.js'
import { migrateWithRetry, pool } from './db.js'

const port = Number(process.env.PORT ?? 8080)
await migrateWithRetry()
const server = serve({ fetch: app.fetch, port, hostname: '0.0.0.0' }, (info) => {
  console.log(`[api] mayorly-api listening on ${info.port}`)
})

// A deploy sends SIGTERM: stop taking requests, let the ones in flight finish, close the pool.
let stopping = false
const stop = (signal: string) => {
  if (stopping) return
  stopping = true
  console.log(`[api] ${signal}: shutting down`)
  server.close(() => {
    void pool.end().finally(() => process.exit(0))
  })
  setTimeout(() => process.exit(0), 10_000).unref()
}
process.on('SIGTERM', () => stop('SIGTERM'))
process.on('SIGINT', () => stop('SIGINT'))
