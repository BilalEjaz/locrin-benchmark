import cookieParser from 'cookie-parser'
import cors from 'cors'
import express, { type ErrorRequestHandler } from 'express'
import type pg from 'pg'
import { z } from 'zod'
import { authRoutes } from './auth/routes.ts'
import { createSessions, type SessionOptions } from './auth/session.ts'
import { boardRoutes } from './boards/routes.ts'
import { HttpError } from './errors.ts'

interface AppOptions {
  pool: pg.Pool
  /** Origin of the frontend allowed to call the API from a browser */
  corsOrigin: string
  auth: SessionOptions & {
    /** bcrypt cost factor; each +1 doubles the time to hash (tests use a low value) */
    bcryptRounds?: number
  }
}

export function createApp({ pool, corsOrigin, auth }: AppOptions) {
  const app = express()
  const sessions = createSessions(auth)

  // credentials: lets a browser on corsOrigin send the session cookie (needed if the
  // frontend and API are on different origins; in development Vite proxies to one origin)
  app.use(cors({ origin: corsOrigin, credentials: true }))
  app.use(express.json({ limit: '100kb' }))
  app.use(cookieParser())

  // For uptime checks (e.g. Render's health check): is the server up and can it reach the database?
  app.get('/api/health', async (_req, res) => {
    try {
      await pool.query('SELECT 1')
      res.json({ status: 'ok', database: 'ok' })
    } catch {
      res.status(503).json({ status: 'error', database: 'unreachable' })
    }
  })

  app.use('/api/auth', authRoutes(pool, sessions, { bcryptRounds: auth.bcryptRounds ?? 12 }))

  // Signed-in users only: requests without a valid session get 401 before any database work
  app.use(['/api/boards', '/api/tasks'], sessions.requireAuth)
  app.use('/api', boardRoutes(pool))

  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'Not found' })
  })

  app.use(errorHandler)
  return app
}

// Express 5 passes errors thrown in async route handlers here
const errorHandler: ErrorRequestHandler = (error, _req, res, _next) => {
  if (error instanceof HttpError) {
    res.status(error.status).json({ error: error.message })
    return
  }
  if (error instanceof z.ZodError) {
    res.status(400).json({ error: 'Invalid request', issues: error.issues })
    return
  }
  // Malformed JSON body
  if (error instanceof SyntaxError && 'body' in error) {
    res.status(400).json({ error: 'Request body is not valid JSON' })
    return
  }
  console.error(error)
  res.status(500).json({ error: 'Something went wrong' })
}
