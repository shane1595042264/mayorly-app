import { serve } from '@hono/node-server'
import { app } from './app.js'
import { migrate } from './db.js'

const port = Number(process.env.PORT ?? 8080)
await migrate()
serve({ fetch: app.fetch, port, hostname: '0.0.0.0' }, (info) => {
  console.log(`[api] mayorly-api listening on ${info.port}`)
})
