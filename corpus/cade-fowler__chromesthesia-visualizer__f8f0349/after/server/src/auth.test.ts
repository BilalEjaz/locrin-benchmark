import { describe, expect, it } from 'vitest';
import { hashPassword, isValidSession, LoginLimiter, signSession, verifyPassword } from './auth.js';

describe('hashPassword / verifyPassword', () => {
    it('accepts the password it hashed and rejects others', async () => {
        const hash = await hashPassword('a long enough password');

        expect(hash).toMatch(/^scrypt:[\w-]+:[\w-]+$/);
        expect(await verifyPassword('a long enough password', hash)).toBe(true);
        expect(await verifyPassword('a long enough passworD', hash)).toBe(false);
    });

    it('salts each hash', async () => {
        expect(await hashPassword('same')).not.toBe(await hashPassword('same'));
    });

    it('never matches a malformed hash', async () => {
        for (const stored of ['', 'scrypt:', 'bcrypt:a:b', 'scrypt:abc:short']) {
            expect(await verifyPassword('x', stored)).toBe(false);
        }
    });
});

describe('isValidSession', () => {
    const secret = 'a-secret-that-is-at-least-32-characters';
    const now = 1_000_000;

    it('accepts a signed, unexpired token', () => {
        expect(isValidSession(secret, signSession(secret, now + 1), now)).toBe(true);
    });

    it('rejects expired, tampered, foreign and missing tokens', () => {
        const token = signSession(secret, now + 1000);
        const [, signature] = token.split('.');

        expect(isValidSession(secret, signSession(secret, now), now)).toBe(false);
        expect(isValidSession(secret, `${now + 9999}.${signature}`, now)).toBe(false);
        expect(isValidSession('another-secret-of-the-same-sort-xx', token, now)).toBe(false);
        expect(isValidSession(secret, undefined, now)).toBe(false);
        expect(isValidSession(secret, 'garbage', now)).toBe(false);
    });
});

describe('LoginLimiter', () => {
    it('blocks after too many failures until the window ends, and a success resets it', () => {
        const limiter = new LoginLimiter(2, 1000);
        limiter.fail('a', 0);
        expect(limiter.retryAfterMs('a', 10)).toBe(0);
        limiter.fail('a', 10);
        expect(limiter.retryAfterMs('a', 100)).toBe(900);
        expect(limiter.retryAfterMs('b', 100)).toBe(0);
        expect(limiter.retryAfterMs('a', 1000)).toBe(0);

        limiter.fail('a', 2000);
        limiter.succeed('a');
        limiter.fail('a', 2001);
        expect(limiter.retryAfterMs('a', 2002)).toBe(0);
    });
});
