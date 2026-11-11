// Owner login: one password, checked against a scrypt hash from the env, and a stateless signed
// session cookie. Only node:crypto is used.
//
// CSRF: the session cookie is SameSite=Strict and the API is same-origin only (no CORS), so other
// sites can't make a browser send a write with it.
import { createHmac, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import type { Request, RequestHandler } from 'express';

const scryptAsync = promisify(scrypt) as (pw: string, salt: Buffer, len: number) => Promise<Buffer>;

export interface AuthConfig {
    /** From `npm run hash-password -w server`: scrypt:<salt>:<hash> */
    passwordHash: string;
    /** Signs session cookies. Changing it logs out every device. */
    sessionSecret: string;
    /** Adds Secure to the cookie; on in production, where the site is served over https */
    secureCookies: boolean;
    /**
     * Take the visitor's IP from Cloudflare's CF-Connecting-IP header. Turn on only when every
     * request comes through Cloudflare (the tunnel), or anyone could send the header to pose
     * as a fresh visitor. Off: the IP of the connection itself.
     */
    trustCloudflare?: boolean;
}

export const SESSION_COOKIE = 'session';
export const SESSION_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

const KEY_LENGTH = 64;

/** Hashes a password as scrypt:<salt b64url>:<hash b64url>. */
export const hashPassword = async (password: string): Promise<string> => {
    const salt = randomBytes(16);
    const hash = await scryptAsync(password, salt, KEY_LENGTH);
    return `scrypt:${salt.toString('base64url')}:${hash.toString('base64url')}`;
};

/** Whether the password matches a hash from hashPassword(). A malformed hash never matches. */
export const verifyPassword = async (password: string, stored: string): Promise<boolean> => {
    const [scheme, salt, hash] = stored.split(':');
    if (scheme !== 'scrypt' || !salt || !hash) return false;
    const expected = Buffer.from(hash, 'base64url');
    if (expected.length !== KEY_LENGTH) return false;
    const actual = await scryptAsync(password, Buffer.from(salt, 'base64url'), KEY_LENGTH);
    return timingSafeEqual(actual, expected);
};

const sign = (secret: string, payload: string) =>
    createHmac('sha256', secret).update(payload).digest('base64url');

/** A session token, <expiresAtMs>.<signature>. */
export const signSession = (secret: string, expiresAt: number): string =>
    `${expiresAt}.${sign(secret, String(expiresAt))}`;

/** Whether a session token is genuine and not expired. */
export const isValidSession = (secret: string, token: string | undefined, now = Date.now()) => {
    if (!token) return false;
    const [expiresAt, signature] = token.split('.');
    if (!expiresAt || !signature || !/^\d+$/.test(expiresAt)) return false;
    const expected = Buffer.from(sign(secret, expiresAt));
    const given = Buffer.from(signature);
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) return false;
    return Number(expiresAt) > now;
};

/** Reads one cookie from the request's Cookie header. */
export const readCookie = (req: Request, name: string): string | undefined => {
    for (const part of (req.headers.cookie ?? '').split(';')) {
        const eq = part.indexOf('=');
        if (eq !== -1 && part.slice(0, eq).trim() === name) {
            return decodeURIComponent(part.slice(eq + 1).trim());
        }
    }
    return undefined;
};

/** The auth config createApp() was given. */
export const authConfig = (req: Request): AuthConfig => req.app.locals.auth as AuthConfig;

/**
 * Who's making the request, for counting failed logins. Through Cloudflare Tunnel every
 * connection comes from cloudflared on the same machine, so the visitor's IP has to come from
 * Cloudflare's header; otherwise a stranger's wrong guesses would lock the owner out too.
 */
export const clientIp = (req: Request): string => {
    const forwarded = req.get('CF-Connecting-IP')?.trim();
    if (authConfig(req).trustCloudflare && forwarded) return forwarded;
    return req.ip ?? req.socket.remoteAddress ?? 'unknown';
};

export const isOwner = (req: Request) =>
    isValidSession(authConfig(req).sessionSecret, readCookie(req, SESSION_COOKIE));

/** Lets a request through only with a valid owner session. Every write route uses it. */
export const requireOwner: RequestHandler = (req, res, next) => {
    if (!isOwner(req)) {
        res.status(401).json({ error: 'Not logged in' });
        return;
    }
    next();
};

/**
 * Counts failed logins per client and blocks a client after too many. In memory, so a restart
 * resets it; that's fine for one owner.
 */
export class LoginLimiter {
    private failures = new Map<string, { count: number; firstAt: number }>();

    constructor(
        private maxFailures = 5,
        private windowMs = 15 * 60 * 1000,
    ) {}

    /** Milliseconds until this client may try again, or 0 if it may try now. */
    retryAfterMs(key: string, now = Date.now()): number {
        const entry = this.failures.get(key);
        if (!entry) return 0;
        const endsAt = entry.firstAt + this.windowMs;
        if (now >= endsAt) {
            this.failures.delete(key);
            return 0;
        }
        return entry.count >= this.maxFailures ? endsAt - now : 0;
    }

    fail(key: string, now = Date.now()): void {
        const entry = this.failures.get(key);
        if (!entry || now >= entry.firstAt + this.windowMs) {
            this.failures.set(key, { count: 1, firstAt: now });
        } else {
            entry.count++;
        }
    }

    succeed(key: string): void {
        this.failures.delete(key);
    }
}
