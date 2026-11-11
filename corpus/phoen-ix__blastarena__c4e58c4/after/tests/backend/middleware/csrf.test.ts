import { describe, it, expect, jest, beforeAll, afterAll } from '@jest/globals';
import http from 'http';
import type { AddressInfo } from 'net';

jest.mock('../../../backend/src/db/connection', () => ({
  query: jest.fn(async () => []),
  execute: jest.fn(async () => ({ affectedRows: 0, insertId: 0 })),
  withTransaction: jest.fn(async () => undefined),
  createPool: jest.fn(async () => undefined),
  getPool: jest.fn(() => ({ execute: jest.fn(async () => [[], []]) })),
}));
jest.mock('../../../backend/src/db/redis', () => ({
  getRedis: jest.fn(() => ({ ping: jest.fn(async () => 'PONG') })),
  createRedisClient: jest.fn(async () => undefined),
}));
jest.mock('../../../backend/src/utils/logger', () => ({
  logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() },
}));

import { createApp } from '../../../backend/src/app';
import { loadConfig } from '../../../backend/src/config';

/**
 * POST /auth/refresh and /auth/logout authenticate by the refresh cookie alone, so they take a
 * double-submit token: the value GET /auth/csrf returns, echoed in X-CSRF-Token, must match the
 * csrfToken cookie. Driven through the real app so cookie parsing and route order are covered.
 */

let server: http.Server;
let base: string;

beforeAll(async () => {
  process.env.DB_PASSWORD ??= 'test-db-password';
  process.env.JWT_SECRET ??= 'x'.repeat(32);
  process.env.EMAIL_PEPPER ??= 'y'.repeat(32);
  process.env.TOTP_ENCRYPTION_KEY ??= 'ab'.repeat(32);
  process.env.APP_URL ??= 'http://localhost';
  loadConfig();

  server = http.createServer(createApp());
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) =>
    server.close((err) => (err ? reject(err) : resolve())),
  );
});

async function issue(cookie?: string): Promise<{ token: string; cookie: string }> {
  const res = await fetch(`${base}/api/auth/csrf`, { headers: cookie ? { cookie } : {} });
  expect(res.status).toBe(200);
  const setCookie = res.headers.get('set-cookie') ?? '';
  expect(setCookie).toMatch(/HttpOnly/);
  expect(setCookie).toMatch(/SameSite=Strict/);
  expect(setCookie).toMatch(/Path=\/api\/auth/);
  const { csrfToken } = (await res.json()) as { csrfToken: string };
  return { token: csrfToken, cookie: setCookie.split(';')[0] };
}

describe('CSRF token on the cookie-authenticated auth routes', () => {
  it('issues a 64-hex token and the matching cookie', async () => {
    const { token, cookie } = await issue();
    expect(token).toMatch(/^[0-9a-f]{64}$/);
    expect(cookie).toBe(`csrfToken=${token}`);
  });

  it('keeps an existing token, so every tab gets the same one', async () => {
    const first = await issue();
    const second = await issue(first.cookie);
    expect(second.token).toBe(first.token);
  });

  it.each(['/api/auth/refresh', '/api/auth/logout'])(
    '%s refuses a request without the token',
    async (path) => {
      const { cookie } = await issue();
      const res = await fetch(`${base}${path}`, {
        method: 'POST',
        headers: { cookie: `${cookie}; refreshToken=rt` },
      });
      expect(res.status).toBe(403);
      expect(await res.json()).toEqual({ error: 'Invalid CSRF token', code: 'CSRF_INVALID' });
    },
  );

  it.each(['/api/auth/refresh', '/api/auth/logout'])(
    '%s refuses a token that does not match the cookie',
    async (path) => {
      const { cookie } = await issue();
      const res = await fetch(`${base}${path}`, {
        method: 'POST',
        headers: { cookie, 'X-CSRF-Token': 'f'.repeat(64) },
      });
      expect(res.status).toBe(403);
    },
  );

  it('refuses a header with no cookie to match', async () => {
    const res = await fetch(`${base}/api/auth/refresh`, {
      method: 'POST',
      headers: { 'X-CSRF-Token': 'f'.repeat(64) },
    });
    expect(res.status).toBe(403);
  });

  it('lets a matching token through to the handler', async () => {
    const { token, cookie } = await issue();
    // No refresh cookie: past the CSRF check, the handler itself answers.
    const res = await fetch(`${base}/api/auth/refresh`, {
      method: 'POST',
      headers: { cookie, 'X-CSRF-Token': token },
    });
    expect(res.status).toBe(401);
    expect(((await res.json()) as { code: string }).code).toBe('NO_REFRESH_TOKEN');

    const logout = await fetch(`${base}/api/auth/logout`, {
      method: 'POST',
      headers: { cookie, 'X-CSRF-Token': token },
    });
    expect(logout.status).toBe(200);
  });
});
