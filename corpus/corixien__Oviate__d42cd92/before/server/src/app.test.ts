import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { newDb } from 'pg-mem';
import { SCHEMA, type Db } from './db.ts';
import { createApp } from './app.ts';
import { CandleStore, parseYahoo, aggregate, emptyCols, type Provider, type Tf } from './candles.ts';
import { hashPassword, verifyPassword } from './auth.ts';

async function boot(opts: { signup?: boolean } = {}) {
  const mem = newDb();
  mem.public.none(SCHEMA);
  const { Pool } = mem.adapters.createPg();
  const pool = new Pool();
  const db: Db = { query: (sql, params) => pool.query(sql, params as any[]) };
  const calls: [string, Tf, number, number][] = [];
  const provider: Provider = async (s, tf, from, to) => {
    calls.push([s, tf, from, to]);
    const c = emptyCols();
    for (let t = from - (from % 86400) + 86400; t < to; t += 86400) { c.t.push(t); c.o.push(1); c.h.push(2); c.l.push(0.5); c.c.push(1.5); c.v.push(10); }
    return c;
  };
  const candles = new CandleStore(db, provider);
  const server = createServer(createApp({ db, candles, allowSignup: opts.signup ?? true, fetch: (async () => new Response(JSON.stringify({ quotes: [{ symbol: 'AAPL', longname: 'Apple', exchDisp: 'NASDAQ', quoteType: 'EQUITY' }] }))) as typeof fetch }));
  await new Promise<void>((r) => server.listen(0, r));
  const base = `http://127.0.0.1:${(server.address() as any).port}`;
  const call = async (method: string, path: string, body?: unknown, token?: string) => {
    const r = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: r.status, body: await r.json().catch(() => null) as any };
  };
  return { call, calls, close: () => server.close() };
}

test('accounts: register, login, wrong password, me, logout', async () => {
  const s = await boot();
  const r = await s.call('POST', '/api/auth/register', { email: 'A@B.de', password: 'password1', name: 'Ann' });
  assert.equal(r.status, 201); assert.equal(r.body.user.email, 'a@b.de');
  assert.equal((await s.call('POST', '/api/auth/register', { email: 'a@b.de', password: 'password1' })).status, 409);
  assert.equal((await s.call('POST', '/api/auth/register', { email: 'x@b.de', password: 'short' })).status, 400);
  assert.equal((await s.call('POST', '/api/auth/login', { email: 'a@b.de', password: 'nope-nope' })).status, 401);
  const l = await s.call('POST', '/api/auth/login', { email: 'a@b.de', password: 'password1' });
  assert.equal(l.status, 200);
  assert.equal((await s.call('GET', '/api/auth/me', undefined, l.body.token)).body.user.name, 'Ann');
  assert.equal((await s.call('GET', '/api/auth/me')).status, 401);
  await s.call('POST', '/api/auth/logout', {}, l.body.token);
  assert.equal((await s.call('GET', '/api/auth/me', undefined, l.body.token)).status, 401);
  s.close();
});

test('registration can be closed', async () => {
  const s = await boot({ signup: false });
  assert.equal((await s.call('POST', '/api/auth/register', { email: 'a@b.de', password: 'password1' })).status, 403);
  s.close();
});

test('password hashes verify and differ per salt', async () => {
  const a = await hashPassword('secret-pass'), b = await hashPassword('secret-pass');
  assert.notEqual(a, b);
  assert.ok(await verifyPassword('secret-pass', a)); assert.ok(!(await verifyPassword('other', a)));
});

test('candles are fetched once for all users and only the missing range afterwards', async () => {
  const s = await boot();
  const t1 = (await s.call('POST', '/api/auth/register', { email: 'a@b.de', password: 'password1' })).body.token;
  const t2 = (await s.call('POST', '/api/auth/register', { email: 'c@d.de', password: 'password1' })).body.token;
  const now = Math.floor(Date.now() / 1000), day = 86400;
  const q = (from: number, to: number) => `/api/candles?symbol=aapl&tf=1d&from=${from}&to=${to}`;
  const a = await s.call('GET', q(now - 30 * day, now), undefined, t1);
  assert.equal(a.status, 200); assert.ok(a.body.t.length >= 29);
  assert.equal(s.calls.length, 1);
  const b = await s.call('GET', q(now - 30 * day, now), undefined, t2);
  assert.deepEqual(b.body.t, a.body.t);
  assert.equal(s.calls.length, 1, 'the second user is served from the table (the tail refresh waits 30 s)');
  await s.call('GET', q(now - 60 * day, now), undefined, t2);
  assert.equal(s.calls.length, 2); assert.equal(s.calls[1][3] <= now - 30 * day + 1, true, 'only the older part is requested');
  assert.equal((await s.call('GET', '/api/candles?symbol=!!&tf=1d&from=1&to=2', undefined, t1)).status, 400);
  assert.equal((await s.call('GET', '/api/candles?symbol=AAPL&tf=2d&from=1&to=2', undefined, t1)).status, 400);
  assert.equal((await s.call('GET', q(1, 2))).status, 401);
  assert.equal((await s.call('GET', '/api/search?q=apple', undefined, t1)).body[0].symbol, 'AAPL');
  s.close();
});

test('per-user key / value is last write wins and private', async () => {
  const s = await boot();
  const a = (await s.call('POST', '/api/auth/register', { email: 'a@b.de', password: 'password1' })).body.token;
  const b = (await s.call('POST', '/api/auth/register', { email: 'c@d.de', password: 'password1' })).body.token;
  assert.equal((await s.call('PUT', '/api/kv/state', { value: 'v2', updatedAt: 200 }, a)).body.stored, true);
  const old = await s.call('PUT', '/api/kv/state', { value: 'v1', updatedAt: 100 }, a);
  assert.equal(old.body.stored, false); assert.equal(old.body.updatedAt, 200);
  assert.deepEqual((await s.call('GET', '/api/kv', undefined, a)).body, { state: { value: 'v2', updatedAt: 200 } });
  assert.deepEqual((await s.call('GET', '/api/kv', undefined, b)).body, {});
  assert.equal((await s.call('PUT', '/api/kv/Bad Key', { value: 'x' }, a)).status, 400);
  s.close();
});

test('scripts: private by default, public ones show up for other users only', async () => {
  const s = await boot();
  const a = (await s.call('POST', '/api/auth/register', { email: 'a@b.de', password: 'password1', name: 'Ann' })).body.token;
  const b = (await s.call('POST', '/api/auth/register', { email: 'c@d.de', password: 'password1' })).body.token;
  await s.call('PUT', '/api/scripts/strategies/Mine', { code: 'strategy("a")', public: false, updatedAt: 1 }, a);
  await s.call('PUT', '/api/scripts/strategies/Shared', { code: 'strategy("b")', public: true, updatedAt: 2 }, a);
  assert.deepEqual((await s.call('GET', '/api/community?kind=strategies', undefined, b)).body.map((x: any) => [x.name, x.author]), [['Shared', 'Ann']]);
  assert.equal((await s.call('GET', '/api/community?kind=strategies', undefined, a)).body.length, 0, 'own scripts are not listed as community');
  assert.equal((await s.call('GET', '/api/scripts', undefined, b)).body.length, 0);
  assert.equal((await s.call('GET', '/api/scripts', undefined, a)).body.length, 2);
  await s.call('PUT', '/api/scripts/strategies/Shared', { code: 'strategy("b")', public: false, updatedAt: 3 }, a);
  assert.equal((await s.call('GET', '/api/community?kind=strategies', undefined, b)).body.length, 0, 'unpublished again');
  await s.call('DELETE', '/api/scripts/strategies/Mine', undefined, a);
  assert.equal((await s.call('GET', '/api/scripts', undefined, a)).body.length, 1);
  assert.equal((await s.call('PUT', '/api/scripts/strategies/..%2Fx', { code: 'x' }, a)).status, 400);
  s.close();
});

test('shared cache: summaries keep the first value, news windows are replaced', async () => {
  const s = await boot();
  const a = (await s.call('POST', '/api/auth/register', { email: 'a@b.de', password: 'password1' })).body.token;
  assert.equal((await s.call('GET', '/api/shared/aisum:abc', undefined, a)).status, 404);
  await s.call('PUT', '/api/shared/aisum:abc', { value: 'first' }, a);
  await s.call('PUT', '/api/shared/aisum:abc', { value: 'second' }, a);
  assert.equal((await s.call('GET', '/api/shared/aisum:abc', undefined, a)).body.value, 'first');
  await s.call('PUT', '/api/shared/news:AAPL:1', { value: 'a' }, a);
  await s.call('PUT', '/api/shared/news:AAPL:1', { value: 'b' }, a);
  assert.equal((await s.call('GET', '/api/shared/news:AAPL:1', undefined, a)).body.value, 'b');
  assert.equal((await s.call('PUT', '/api/shared/secret:x', { value: 'b' }, a)).status, 400);
  s.close();
});

test('yahoo parsing and 4h aggregation', () => {
  const c = parseYahoo({ chart: { result: [{ timestamp: [0, 3600, 7200], indicators: { quote: [{ open: [1, 2, null], high: [2, 3, 4], low: [0.5, 1, 1], close: [1.5, 2.5, 3], volume: [10, 20, 30] }] } }] } });
  assert.deepEqual(c.t, [0, 3600], 'a bar with a null value is skipped');
  assert.throws(() => parseYahoo({ chart: { result: null, error: { description: 'Not found' } } }), /Not found/);
  const h = emptyCols();
  for (let i = 0; i < 8; i++) { h.t.push(i * 3600); h.o.push(1 + i); h.h.push(2 + i); h.l.push(0.5); h.c.push(1.5 + i); h.v.push(10); }
  const a = aggregate(h, 14400);
  assert.equal(a.t.length, 2); assert.equal(a.v[0], 40); assert.equal(a.o[1], 5); assert.equal(a.c[0], 4.5);
});
