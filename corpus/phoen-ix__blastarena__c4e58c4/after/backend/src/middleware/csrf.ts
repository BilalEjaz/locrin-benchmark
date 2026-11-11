import { randomBytes } from 'crypto';
import { Request, Response, NextFunction } from 'express';
import { getConfig } from '../config';

/**
 * Double-submit CSRF token for the routes that authenticate by cookie alone.
 *
 * Everything else in the API authenticates with the `Authorization: Bearer` header, which a
 * browser never attaches on its own. The exceptions are POST /auth/refresh and /auth/logout:
 * they act on the httpOnly refresh cookie, and a body-less POST is a "simple" request that
 * another page can send without a CORS preflight. The cookie is SameSite=Strict, which stops
 * cross-site senders; this also stops same-site ones (a sibling subdomain) and browsers that
 * ignore SameSite. The SPA reads the token from GET /auth/csrf (CORS keeps the body from other
 * origins) and echoes it in X-CSRF-Token, a custom header no cross-origin page can set without
 * a preflight the CORS policy refuses.
 */

const TOKEN_RE = /^[0-9a-f]{64}$/;

/** GET /auth/csrf. Reuses a valid cookie so tabs and concurrent requests agree on one token. */
export function issueCsrfToken(req: Request, res: Response): void {
  const existing: unknown = req.cookies.csrfToken;
  const csrfToken =
    typeof existing === 'string' && TOKEN_RE.test(existing)
      ? existing
      : randomBytes(32).toString('hex');
  res.cookie('csrfToken', csrfToken, {
    httpOnly: true,
    secure: getConfig().APP_URL.startsWith('https'),
    sameSite: 'strict',
    path: '/api/auth',
  });
  res.json({ csrfToken });
}

export function verifyCsrfToken(req: Request, res: Response, next: NextFunction): void {
  const csrfToken: unknown = req.cookies.csrfToken;
  if (typeof csrfToken !== 'string' || csrfToken !== req.get('X-CSRF-Token')) {
    res.status(403).json({ error: 'Invalid CSRF token', code: 'CSRF_INVALID' });
    return;
  }
  next();
}
