import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { ObjectId } from 'mongodb';
import { useTestDb } from '../test/db.js';
import { ownerCookie, TEST_PASSWORD, testApp } from '../test/auth.js';
import { SESSION_COOKIE, signSession } from '../auth.js';

useTestDb();

const login = (app: ReturnType<typeof testApp>, password: string) =>
    request(app).post('/api/auth/login').send({ password });

describe('POST /api/auth/login', () => {
    it('sets an HttpOnly, SameSite=Strict session cookie that /me accepts', async () => {
        const app = testApp();
        const res = await login(app, TEST_PASSWORD);

        expect(res.status).toBe(204);
        const cookie = res.headers['set-cookie']![0]!;
        expect(cookie).toMatch(new RegExp(`^${SESSION_COOKIE}=`));
        expect(cookie).toContain('HttpOnly');
        expect(cookie).toContain('SameSite=Strict');
        expect(cookie).not.toContain('Secure');

        const me = await request(app).get('/api/auth/me').set('Cookie', cookie.split(';')[0]!);
        expect(me.body).toEqual({ owner: true });
    });

    it('marks the cookie Secure when configured', async () => {
        const app = testApp({ secureCookies: true });
        const res = await login(app, TEST_PASSWORD);
        expect(res.headers['set-cookie']![0]).toContain('Secure');
    });

    it('rejects a wrong password with 401 and no cookie', async () => {
        const res = await login(testApp(), 'wrong');

        expect(res.status).toBe(401);
        expect(res.body).toEqual({ error: 'Wrong password' });
        expect(res.headers['set-cookie']).toBeUndefined();
    });

    it('rejects a missing password with 400', async () => {
        const res = await request(testApp()).post('/api/auth/login').send({});
        expect(res.status).toBe(400);
    });

    it('blocks after 5 failures, even with the right password', async () => {
        const app = testApp();
        for (let i = 0; i < 5; i++) expect((await login(app, 'wrong')).status).toBe(401);

        const res = await login(app, TEST_PASSWORD);
        expect(res.status).toBe(429);
        expect(Number(res.headers['retry-after'])).toBeGreaterThan(0);
    });
});

describe('failed login counting', () => {
    const failFive = async (app: ReturnType<typeof testApp>, ip?: string) => {
        for (let i = 0; i < 5; i++) {
            const req = login(app, 'wrong');
            await (ip ? req.set('CF-Connecting-IP', ip) : req);
        }
    };
    const loginFrom = (app: ReturnType<typeof testApp>, ip: string) =>
        login(app, TEST_PASSWORD).set('CF-Connecting-IP', ip);

    it('counts each Cloudflare visitor separately when trusting Cloudflare', async () => {
        const app = testApp({ trustCloudflare: true });
        await failFive(app, '203.0.113.7');

        expect((await loginFrom(app, '203.0.113.7')).status).toBe(429);
        expect((await loginFrom(app, '198.51.100.2')).status).toBe(204);
    });

    it('ignores the header otherwise, so it cannot be used to dodge the limit', async () => {
        const app = testApp();
        await failFive(app, '203.0.113.7');

        expect((await loginFrom(app, '198.51.100.2')).status).toBe(429);
    });
});

describe('POST /api/auth/logout', () => {
    it('clears the session cookie', async () => {
        const res = await request(testApp()).post('/api/auth/logout').set('Cookie', ownerCookie());

        expect(res.status).toBe(204);
        expect(res.headers['set-cookie']![0]).toMatch(
            new RegExp(`^${SESSION_COOKIE}=;.*Expires=Thu, 01 Jan 1970`),
        );
    });
});

describe('GET /api/auth/me', () => {
    const me = (cookie?: string) => {
        const req = request(testApp()).get('/api/auth/me');
        return cookie ? req.set('Cookie', cookie) : req;
    };

    it('is false without a valid session', async () => {
        const forged = signSession('some-other-secret-of-enough-length', Date.now() + 60_000);
        for (const cookie of [
            undefined,
            ownerCookie(Date.now() - 1),
            `${SESSION_COOKIE}=${forged}`,
            `${SESSION_COOKIE}=nonsense`,
        ]) {
            expect((await me(cookie)).body).toEqual({ owner: false });
        }
    });

    it('is true with a valid session among other cookies', async () => {
        expect((await me(`theme=dark; ${ownerCookie()}`)).body).toEqual({ owner: true });
    });
});

describe('write routes', () => {
    const songId = '1XZPtZVqcOzzxbYIR7MjQw';
    const colorId = new ObjectId().toHexString();
    const writes = [
        ['put', `/api/songs/${songId}`],
        ['post', `/api/songs/${songId}/colors`],
        ['patch', `/api/colors/${colorId}`],
        ['delete', `/api/colors/${colorId}`],
    ] as const;

    it.each(writes)('%s %s needs an owner session', async (method, path) => {
        const app = testApp();
        for (const cookie of [undefined, ownerCookie(Date.now() - 1)]) {
            const req = request(app)[method](path).send({});
            const res = await (cookie ? req.set('Cookie', cookie) : req);
            expect(res.status).toBe(401);
            expect(res.body).toEqual({ error: 'Not logged in' });
        }
    });

    it('leaves reads public', async () => {
        const app = testApp();
        expect((await request(app).get('/api/songs')).status).toBe(200);
        expect((await request(app).get(`/api/songs/${songId}`)).status).toBe(404);
    });
});
