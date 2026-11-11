import bcrypt from 'bcryptjs'
import { Router } from 'express'
import type pg from 'pg'
import { z } from 'zod'
import { conflict, HttpError } from '../errors.ts'
import type { Sessions } from './session.ts'

/** What the API returns for a user; never includes the password hash */
export interface PublicUser {
  id: string
  email: string
}

const email = z.string().trim().toLowerCase()

const registerBody = z.object({
  email: email.pipe(z.email('Enter a valid email address').max(254)),
  password: z
    .string()
    .min(8, 'Password must be at least 8 characters')
    // bcrypt ignores everything after 72 bytes, so longer passwords would be silently truncated
    .refine((value) => Buffer.byteLength(value, 'utf8') <= 72, 'Password must be at most 72 bytes'),
})

// Login only checks the fields are present: anything wrong beyond that is the same generic 401
const loginBody = z.object({ email, password: z.string() })

const invalidCredentials = () => new HttpError(401, 'Invalid email or password')

export function authRoutes(pool: pg.Pool, sessions: Sessions, { bcryptRounds }: { bcryptRounds: number }) {
  const router = Router()

  // Compared against when the email doesn't exist, so a login for an unknown email takes
  // as long as one with a wrong password (no timing hint about which accounts exist)
  let dummyHash: Promise<string> | undefined
  const getDummyHash = () => (dummyHash ??= bcrypt.hash('not-a-real-password', bcryptRounds))

  router.post('/register', async (req, res) => {
    const { email, password } = registerBody.parse(req.body)
    const passwordHash = await bcrypt.hash(password, bcryptRounds)
    const { rows: [user] } = await pool.query<PublicUser>(
      `INSERT INTO users (email, password_hash) VALUES ($1, $2)
       ON CONFLICT (email) DO NOTHING
       RETURNING id, email`,
      [email, passwordHash],
    )
    if (!user) throw conflict('An account with this email already exists')

    await sessions.start(res, user.id)
    res.status(201).json(user)
  })

  router.post('/login', async (req, res) => {
    const { email, password } = loginBody.parse(req.body)
    const { rows: [user] } = await pool.query<PublicUser & { password_hash: string }>(
      'SELECT id, email, password_hash FROM users WHERE email = $1',
      [email],
    )
    const matches = await bcrypt.compare(password, user?.password_hash ?? (await getDummyHash()))
    if (!user || !matches) throw invalidCredentials()

    await sessions.start(res, user.id)
    res.json({ id: user.id, email: user.email } satisfies PublicUser)
  })

  router.post('/logout', (_req, res) => {
    sessions.end(res)
    res.status(204).end()
  })

  router.get('/me', sessions.requireAuth, async (_req, res) => {
    const { rows: [user] } = await pool.query<PublicUser>('SELECT id, email FROM users WHERE id = $1', [
      res.locals.userId,
    ])
    if (!user) {
      // Valid token for an account that no longer exists
      sessions.end(res)
      throw new HttpError(401, 'Not signed in')
    }
    res.json(user)
  })

  return router
}
