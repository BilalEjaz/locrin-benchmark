import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { rateLimit } from 'express-rate-limit';
import { registerRoutes } from './routes';
import { errorHandler } from './middleware/errorHandler';
import { localeMiddleware } from './middleware/locale';
import { getConfig } from './config';

export function createApp(): express.Express {
  const app = express();
  // No `X-Powered-By: Express` on every API response. (audit E12)
  app.disable('x-powered-by');

  const allowedOrigin = new URL(getConfig().APP_URL).origin;
  app.use(
    cors({
      origin: allowedOrigin,
      credentials: true,
    }),
  );
  app.use(express.json({ limit: '1mb' }));
  app.use(cookieParser());
  app.use(localeMiddleware);

  // Trust proxy (behind nginx)
  app.set('trust proxy', 1);

  // App-wide per-IP safety net in front of every API route, independent of nginx's limit_req and
  // of Redis (memory store). The strict per-route limiters (middleware/rateLimiter.ts) still apply
  // on top. 1000 requests per minute is far above any real client: a player averages well under
  // one request per second (a view switch fires about ten, the open-world view polls every 10 s,
  // gameplay runs over Socket.io, which never reaches Express), so the budget still covers dozens
  // of players sharing one NAT address. Keyed by req.ip under the trust-proxy setting above.
  app.use(
    '/api',
    rateLimit({
      windowMs: 60_000,
      limit: getConfig().API_RATE_LIMIT_PER_MIN,
      standardHeaders: 'draft-8',
      legacyHeaders: false,
      message: { error: 'Too many requests', code: 'RATE_LIMITED' },
    }),
  );

  // Security headers are set by nginx, not here.
  //
  // This used to set X-Content-Type-Options, X-Frame-Options, Referrer-Policy and
  // Permissions-Policy, all four of which nginx also sets — so every /api/* response carried them
  // twice, and the two X-Frame-Options *disagreed*: DENY from here, SAMEORIGIN from nginx.
  // Browsers resolve that to the stricter DENY, so nothing was broken, but the intent was
  // genuinely ambiguous and neither layer was clearly the owner.
  //
  // nginx wins the ownership because it is the only layer that sees every response: static assets,
  // the 502 page, and 429s from the rate limiter never reach Express at all. Its SAMEORIGIN also
  // agrees with the CSP's `frame-ancestors 'self'`, which modern browsers prefer over
  // X-Frame-Options anyway. The backend publishes no host port, so nothing reaches it except
  // through nginx; the dev stack gets the same four via security-headers-dev.conf.
  // (audit HEADER-OWNERSHIP-1)

  registerRoutes(app);

  // JSON 404 for anything the routers did not match.
  //
  // Without it, Express's finalhandler answered with an HTML error page — `<pre>Cannot GET
  // /api/nope</pre>` — on an API that is otherwise JSON end to end, so a client branching on
  // `code` got nothing to branch on. It also stamped its own `Content-Security-Policy:
  // default-src 'none'` on the way out, which arrived alongside nginx's policy and left those
  // responses carrying two conflicting CSP headers. (audit HEADER-OWNERSHIP-1)
  app.use((_req, res) => {
    res.status(404).json({ error: 'Not found', code: 'NOT_FOUND' });
  });

  app.use(errorHandler);

  return app;
}
