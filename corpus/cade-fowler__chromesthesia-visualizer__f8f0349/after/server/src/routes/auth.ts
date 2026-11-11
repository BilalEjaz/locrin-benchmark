import { Router, type CookieOptions } from 'express';
import type { ApiError, AuthStatus } from '@chromesthesia/shared';
import {
    authConfig,
    clientIp,
    isOwner,
    LoginLimiter,
    SESSION_COOKIE,
    SESSION_MAX_AGE_MS,
    signSession,
    verifyPassword,
} from '../auth.js';
import { loginSchema } from '../validation.js';

type NoParams = Record<string, never>;

/** The owner login routes. Each app gets its own failed-login counter. */
export const authRouter = () => {
    const router = Router();
    const limiter = new LoginLimiter();

    const cookieOptions = (secure: boolean): CookieOptions => ({
        httpOnly: true,
        sameSite: 'strict',
        secure,
        path: '/',
    });

    // Log in with the owner password; sets the session cookie
    router.post<NoParams, ApiError>('/login', async (req, res) => {
        const client = clientIp(req);
        const waitMs = limiter.retryAfterMs(client);
        if (waitMs) {
            res.set('Retry-After', String(Math.ceil(waitMs / 1000)));
            return res.status(429).json({ error: 'Too many attempts' });
        }

        const parsed = loginSchema.safeParse(req.body);
        if (!parsed.success) return res.status(400).json({ error: 'Expected a password' });

        const config = authConfig(req);
        if (!(await verifyPassword(parsed.data.password, config.passwordHash))) {
            limiter.fail(client);
            return res.status(401).json({ error: 'Wrong password' });
        }

        limiter.succeed(client);
        const token = signSession(config.sessionSecret, Date.now() + SESSION_MAX_AGE_MS);
        res.cookie(SESSION_COOKIE, token, {
            ...cookieOptions(config.secureCookies),
            maxAge: SESSION_MAX_AGE_MS,
        });
        res.status(204).end();
    });

    router.post('/logout', (req, res) => {
        res.clearCookie(SESSION_COOKIE, cookieOptions(authConfig(req).secureCookies));
        res.status(204).end();
    });

    // Whether this browser is logged in as the owner
    router.get<NoParams, AuthStatus>('/me', (req, res) => {
        res.json({ owner: isOwner(req) });
    });

    return router;
};
