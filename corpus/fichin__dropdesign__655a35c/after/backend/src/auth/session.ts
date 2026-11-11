import type { CookieOptions, RequestHandler, Response } from 'express'
import { jwtVerify, SignJWT } from 'jose'
import { HttpError } from '../errors.ts'

export const SESSION_COOKIE = 'kanban_session'
const SESSION_DAYS = 7

export interface SessionOptions {
  /** Signs and verifies session tokens (JWT_SECRET) */
  jwtSecret: string
  /** Send the cookie over HTTPS only; on in production */
  secureCookies: boolean
}

/**
 * Sessions are stateless: the cookie holds a signed JWT whose subject is the user id.
 * - httpOnly: page scripts can't read it, so an XSS bug can't steal the session
 * - sameSite=lax: not sent on cross-site POST/PATCH, which blocks CSRF on our JSON API
 * - secure in production: HTTPS only
 */
export function createSessions({ jwtSecret, secureCookies }: SessionOptions) {
  const key = new TextEncoder().encode(jwtSecret)
  const cookieOptions: CookieOptions = {
    httpOnly: true,
    secure: secureCookies,
    sameSite: 'lax',
    path: '/',
  }

  async function start(res: Response, userId: string) {
    const token = await new SignJWT()
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(userId)
      .setIssuedAt()
      .setExpirationTime(`${SESSION_DAYS}d`)
      .sign(key)
    res.cookie(SESSION_COOKIE, token, { ...cookieOptions, maxAge: SESSION_DAYS * 24 * 60 * 60 * 1000 })
  }

  function end(res: Response) {
    res.clearCookie(SESSION_COOKIE, cookieOptions)
  }

  /** The user id in a valid, unexpired token, or null */
  async function userIdFrom(token: unknown): Promise<string | null> {
    if (typeof token !== 'string' || !token) return null
    try {
      const { payload } = await jwtVerify(token, key, { algorithms: ['HS256'] })
      return typeof payload.sub === 'string' ? payload.sub : null
    } catch {
      return null // bad signature, expired, or malformed
    }
  }

  /**
   * Rejects requests without a valid session with 401, before any database work;
   * otherwise puts the user id in res.locals.userId.
   */
  const requireAuth: RequestHandler = async (req, res, next) => {
    const userId = await userIdFrom(req.cookies?.[SESSION_COOKIE])
    if (!userId) throw new HttpError(401, 'Not signed in')
    res.locals.userId = userId
    next()
  }

  return { start, end, userIdFrom, requireAuth }
}

export type Sessions = ReturnType<typeof createSessions>
