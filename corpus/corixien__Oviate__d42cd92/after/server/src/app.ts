// HTTP API of the sync server: plain node:http, JSON, bearer tokens. `createApp` gets its dependencies so it can be tested against an in-memory database.
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Db } from './db.ts';
import { AuthError, login, logout, register, userOf, type User } from './auth.ts';
import { CandleStore, isTf, searchSymbols, type Fetch } from './candles.ts';
import { SECRET_NAMES, type Vault } from './vault.ts';

export interface Deps { db: Db; candles: CandleStore; allowSignup: boolean; fetch?: Fetch; /** null: SECRETS_KEY is not set, key sync is off */ vault?: Vault | null }

class HttpError extends Error { status: number; constructor(status: number, msg: string) { super(msg); this.status = status; } }
const bad = (msg: string) => new HttpError(400, msg);

const MAX_BODY = 3_000_000;
const SYMBOL = /^[A-Za-z0-9.^=\-/ ]{1,24}$/;
const KV_KEY = /^[a-z0-9:_.-]{1,64}$/;
const SHARED_KEY = /^(news|aisum|cal)[:a-zA-Z0-9_.|-]{1,160}$/;
const KINDS = ['indicators', 'strategies'];

async function readJson(req: IncomingMessage): Promise<any> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const c of req) { size += c.length; if (size > MAX_BODY) throw new HttpError(413, 'Request too large'); chunks.push(c as Buffer); }
  if (!size) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw bad('Invalid JSON'); }
}

// login attempts per address: slows down password guessing
const attempts = new Map<string, number[]>();
function throttle(ip: string) {
  const now = Date.now(), list = (attempts.get(ip) ?? []).filter((t) => now - t < 600_000);
  if (list.length >= 30) throw new HttpError(429, 'Too many attempts, try again in a few minutes');
  list.push(now); attempts.set(ip, list);
  if (attempts.size > 5000) for (const [k, v] of attempts) if (!v.some((t) => now - t < 600_000)) attempts.delete(k);
}

export function createApp(d: Deps) {
  const send = (res: ServerResponse, status: number, body: unknown) => {
    const s = JSON.stringify(body);
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(s), 'Cache-Control': 'no-store' });
    res.end(s);
  };

  async function route(req: IncomingMessage, res: ServerResponse, url: URL) {
    const m = req.method ?? 'GET', p = url.pathname;
    const ip = String(req.headers['x-forwarded-for'] ?? req.socket.remoteAddress ?? '').split(',')[0].trim();
    if (p === '/health') { await d.db.query('SELECT 1'); return send(res, 200, { ok: true }); }

    if (m === 'POST' && (p === '/api/auth/register' || p === '/api/auth/login')) {
      throttle(ip);
      const b = await readJson(req);
      if (p.endsWith('register')) { if (!d.allowSignup) throw new HttpError(403, 'Registration is closed'); return send(res, 201, await register(d.db, b.email, b.password, b.name)); }
      return send(res, 200, await login(d.db, b.email, b.password));
    }

    // everything below needs an account
    const token = /^Bearer (\S+)$/.exec(String(req.headers.authorization ?? ''))?.[1] ?? '';
    const user: User | null = await userOf(d.db, token);
    if (!user) throw new HttpError(401, 'Not signed in');

    if (p === '/api/auth/me' && m === 'GET') return send(res, 200, { user });
    if (p === '/api/auth/logout' && m === 'POST') { await logout(d.db, token); return send(res, 200, { ok: true }); }

    if (p === '/api/candles' && m === 'GET') {
      const symbol = url.searchParams.get('symbol') ?? '', tf = url.searchParams.get('tf');
      const now = Math.floor(Date.now() / 1000);
      const from = Math.max(0, Math.floor(Number(url.searchParams.get('from') ?? 0))), to = Math.min(now + 86400, Math.floor(Number(url.searchParams.get('to') ?? now)));
      if (!SYMBOL.test(symbol) || !isTf(tf) || !Number.isFinite(from) || !Number.isFinite(to) || from >= to) throw bad('symbol, tf, from and to are needed');
      return send(res, 200, await d.candles.get(symbol.toUpperCase(), tf, from, to));
    }
    if (p === '/api/search' && m === 'GET') {
      const q = (url.searchParams.get('q') ?? '').trim().slice(0, 60);
      return send(res, 200, q ? await searchSymbols(q, d.fetch) : []);
    }

    // ---- per-user key / value (settings, chart drawings, watchlists, paper accounts ...): last write wins per key
    if (p === '/api/kv' && m === 'GET') {
      const r = await d.db.query<{ key: string; value: string; updated_at: number }>('SELECT key, value, updated_at FROM user_kv WHERE user_id = $1', [user.id]);
      return send(res, 200, Object.fromEntries(r.rows.map((x) => [x.key, { value: x.value, updatedAt: x.updated_at }])));
    }
    const kv = /^\/api\/kv\/([^/]+)$/.exec(p);
    if (kv && m === 'PUT') {
      const key = decodeURIComponent(kv[1]), b = await readJson(req);
      if (!KV_KEY.test(key) || typeof b.value !== 'string' || b.value.length > 2_000_000) throw bad('invalid key or value');
      const at = Number.isFinite(b.updatedAt) ? Math.floor(b.updatedAt) : Date.now();
      const cur = (await d.db.query<{ updated_at: number }>('SELECT updated_at FROM user_kv WHERE user_id = $1 AND key = $2', [user.id, key])).rows[0];
      if (cur && cur.updated_at > at) return send(res, 200, { stored: false, updatedAt: cur.updated_at });
      if (!cur && (await d.db.query<{ n: number }>('SELECT COUNT(*) AS n FROM user_kv WHERE user_id = $1', [user.id])).rows[0].n >= 200) throw bad('too many keys');
      await d.db.query('INSERT INTO user_kv (user_id, key, value, updated_at) VALUES ($1,$2,$3,$4) ON CONFLICT (user_id, key) DO UPDATE SET value = $3, updated_at = $4', [user.id, key, b.value, at]);
      return send(res, 200, { stored: true, updatedAt: at });
    }

    // ---- scripts: private per user, optionally public (visible to everybody in the community list)
    if (p === '/api/scripts' && m === 'GET') {
      const r = await d.db.query<any>('SELECT kind, name, code, public, updated_at FROM scripts WHERE user_id = $1', [user.id]);
      return send(res, 200, r.rows.map((x) => ({ kind: x.kind, name: x.name, code: x.code, public: !!x.public, updatedAt: x.updated_at })));
    }
    const sc = /^\/api\/scripts\/(indicators|strategies)\/([^/]+)$/.exec(p);
    if (sc && (m === 'PUT' || m === 'DELETE')) {
      const kind = sc[1], name = decodeURIComponent(sc[2]);
      if (!name || name.length > 80 || /[\\\0/]/.test(name)) throw bad('invalid name');
      if (m === 'DELETE') { await d.db.query('DELETE FROM scripts WHERE user_id = $1 AND kind = $2 AND name = $3', [user.id, kind, name]); return send(res, 200, { ok: true }); }
      const b = await readJson(req);
      if (typeof b.code !== 'string' || b.code.length > 100_000) throw bad('invalid code');
      const at = Number.isFinite(b.updatedAt) ? Math.floor(b.updatedAt) : Date.now();
      const cur = (await d.db.query<{ updated_at: number }>('SELECT updated_at FROM scripts WHERE user_id = $1 AND kind = $2 AND name = $3', [user.id, kind, name])).rows[0];
      if (cur && cur.updated_at > at) return send(res, 200, { stored: false, updatedAt: cur.updated_at });
      if (!cur && (await d.db.query<{ n: number }>('SELECT COUNT(*) AS n FROM scripts WHERE user_id = $1', [user.id])).rows[0].n >= 500) throw bad('too many scripts');
      await d.db.query('INSERT INTO scripts (user_id, kind, name, code, public, updated_at) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (user_id, kind, name) DO UPDATE SET code = $4, public = $5, updated_at = $6',
        [user.id, kind, name, b.code, b.public === true, at]);
      return send(res, 200, { stored: true, updatedAt: at });
    }
    if (p === '/api/community' && m === 'GET') {
      const kind = url.searchParams.get('kind') ?? '';
      if (!KINDS.includes(kind)) throw bad('kind must be indicators or strategies');
      const r = await d.db.query<any>('SELECT s.kind, s.name, s.code, s.updated_at, u.name AS author FROM scripts s JOIN users u ON u.id = s.user_id WHERE s.public = TRUE AND s.kind = $1 AND s.user_id <> $2 ORDER BY s.updated_at DESC LIMIT 200', [kind, user.id]);
      return send(res, 200, r.rows.map((x) => ({ kind: x.kind, name: x.name, code: x.code, author: x.author, updatedAt: x.updated_at })));
    }

    // ---- API keys of the user (Alpaca, news providers, AI), sealed with the server's SECRETS_KEY
    if (p === '/api/secrets' && m === 'GET') {
      if (!d.vault) throw new HttpError(503, 'Key sync is off: the server has no SECRETS_KEY');
      const r = await d.db.query<{ name: string; sealed: string; updated_at: number }>('SELECT name, sealed, updated_at FROM secrets WHERE user_id = $1', [user.id]);
      const out: Record<string, { value: string; updatedAt: number }> = {};
      for (const x of r.rows) { const v = d.vault.open(user.id, x.name, x.sealed); if (v !== null) out[x.name] = { value: v, updatedAt: x.updated_at }; }
      return send(res, 200, out);
    }
    const se = /^\/api\/secrets\/([a-z_]+)$/.exec(p);
    if (se && (m === 'PUT' || m === 'DELETE')) {
      if (!d.vault) throw new HttpError(503, 'Key sync is off: the server has no SECRETS_KEY');
      if (!SECRET_NAMES.includes(se[1])) throw bad('unknown key name');
      if (m === 'DELETE') { await d.db.query('DELETE FROM secrets WHERE user_id = $1 AND name = $2', [user.id, se[1]]); return send(res, 200, { ok: true }); }
      const b = await readJson(req);
      if (typeof b.value !== 'string' || !b.value.trim() || b.value.length > 4000) throw bad('invalid value');
      await d.db.query('INSERT INTO secrets (user_id, name, sealed, updated_at) VALUES ($1,$2,$3,$4) ON CONFLICT (user_id, name) DO UPDATE SET sealed = $3, updated_at = $4', [user.id, se[1], d.vault.seal(user.id, se[1], b.value.trim()), Date.now()]);
      return send(res, 200, { ok: true });
    }

    // ---- cache shared by everybody: news windows, AI summaries, calendar (the same for every user)
    const sh = /^\/api\/shared\/(.+)$/.exec(p);
    if (sh) {
      const key = decodeURIComponent(sh[1]);
      if (!SHARED_KEY.test(key)) throw bad('invalid key');
      if (m === 'GET') {
        const r = (await d.db.query<{ value: string; updated_at: number }>('SELECT value, updated_at FROM shared_cache WHERE key = $1', [key])).rows[0];
        return r ? send(res, 200, { value: r.value, updatedAt: r.updated_at }) : send(res, 404, { error: 'not found' });
      }
      if (m === 'PUT') {
        const b = await readJson(req);
        if (typeof b.value !== 'string' || b.value.length > 1_000_000) throw bad('invalid value');
        const at = Date.now();
        // summaries never change once written; news / calendar windows are replaced by newer data
        const sql = key.startsWith('aisum')
          ? 'INSERT INTO shared_cache (key, value, updated_at) VALUES ($1,$2,$3) ON CONFLICT (key) DO NOTHING'
          : 'INSERT INTO shared_cache (key, value, updated_at) VALUES ($1,$2,$3) ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = $3';
        await d.db.query(sql, [key, b.value, at]);
        return send(res, 200, { ok: true });
      }
    }
    throw new HttpError(404, 'Not found');
  }

  return async (req: IncomingMessage, res: ServerResponse) => {
    // tokens travel in a header, not in cookies: any origin may call the API (desktop webview, Android, browser)
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
    try { await route(req, res, new URL(req.url ?? '/', 'http://x')); }
    catch (e) {
      if (e instanceof HttpError || e instanceof AuthError) return send(res, e.status, { error: e.message });
      console.error(req.method, req.url, e);
      return send(res, 500, { error: 'Server error' });
    }
  };
}
