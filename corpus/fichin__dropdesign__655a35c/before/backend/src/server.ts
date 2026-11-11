import { createApp } from './app.ts'
import { config } from './config.ts'
import { createPool } from './db/pool.ts'

const pool = createPool(config.DATABASE_URL)
const server = createApp({ pool, corsOrigin: config.CORS_ORIGIN }).listen(config.PORT, () => {
  console.log(`API listening on http://localhost:${config.PORT}`)
})

// Render (and Ctrl+C) send SIGTERM/SIGINT: finish in-flight requests, then close database connections
for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(signal, () => {
    server.close(() => {
      void pool.end().then(() => process.exit(0))
    })
  })
}
