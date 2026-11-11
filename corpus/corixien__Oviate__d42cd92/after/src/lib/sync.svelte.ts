import { app } from './app.svelte';
import { library, type ScriptKind } from './library.svelte';
import { kvGet, kvSet, remote, secretsApply, secretsExport, type Raw, type Tf } from './api';
import { freeName, hashCode, planScripts, planSecrets, stateDirection, type Seen } from './sync.ts';

export interface SyncUser { id: string; email: string; name: string }
export interface Community { kind: ScriptKind; name: string; code: string; author: string; updatedAt: number }
interface Auth { server: string; token: string; user: SyncUser; candles: boolean }
/** Local bookkeeping of the sync (never sent): when the settings last changed here, and what every script looked like at its last sync. */
interface Meta { localAt: number; seen: Record<string, Seen>; public: Record<string, boolean>; secrets: Record<string, string> }

class HttpError extends Error { status: number; constructor(status: number, msg: string) { super(msg); this.status = status; } }
const KINDS: ScriptKind[] = ['indicators', 'strategies'];
const key = (kind: ScriptKind, name: string) => `${kind}/${name}`;

/** Account, settings / script sync and the shared server (candles, summaries, community scripts). Everything works without an account. */
class Sync {
  /** server address typed in the settings */
  server = $state('');
  user = $state<SyncUser | null>(null);
  status = $state<'out' | 'idle' | 'syncing' | 'error'>('out');
  message = $state('');
  lastSync = $state(0);
  /** take candles from the server (shared by all users) before fetching them locally */
  useCandles = $state(true);
  /** which of your scripts are public (reactive copy of the bookkeeping) */
  pub = $state<Record<string, boolean>>({});
  community = $state<Record<ScriptKind, Community[]>>({ indicators: [], strategies: [] });

  private token = '';
  private meta: Meta = { localAt: 0, seen: {}, public: {}, secrets: {} };
  private downUntil = 0;
  private stateTimer: ReturnType<typeof setTimeout> | undefined;
  private scriptTimer: ReturnType<typeof setTimeout> | undefined;
  private busy = false;

  get signedIn() { return !!this.user && !!this.token; }

  async init() {
    try {
      const a: Auth | null = JSON.parse((await kvGet('sync_auth')) ?? 'null');
      const m = JSON.parse((await kvGet('sync_meta')) ?? 'null');
      if (m) { this.meta = { localAt: m.localAt ?? 0, seen: m.seen ?? {}, public: m.public ?? {}, secrets: m.secrets ?? {} }; this.pub = { ...this.meta.public }; }
      if (a?.token) { this.server = a.server; this.token = a.token; this.user = a.user; this.useCandles = a.candles !== false; this.status = 'idle'; }
    } catch { /* no saved account */ }
    this.wire();
    if (this.signedIn) { void this.syncAll(); }
    // other devices change things too: look again when the window comes back and every few minutes
    window.addEventListener('focus', () => { if (this.signedIn) void this.syncAll(); });
    setInterval(() => { if (this.signedIn && document.visibilityState === 'visible') void this.syncAll(); }, 180000);
  }

  private wire() {
    app.onPersist = () => this.settingsChanged();
    library.onChange = (kind, name) => this.scriptChanged(kind, name);
    remote.candles = (symbol, tf, from, to) => this.fetchCandles(symbol, tf, from, to);
    remote.shared = {
      get: async (k) => { if (!this.signedIn || this.inBreaker()) return null; try { return (await this.http<{ value: string }>('GET', `/api/shared/${encodeURIComponent(k)}`)).value; } catch (e) { return this.soft(e); } },
      put: async (k, value) => { if (this.signedIn && !this.inBreaker()) await this.http('PUT', `/api/shared/${encodeURIComponent(k)}`, { value }).catch((e) => this.soft(e)); },
    };
  }

  // ---------- network ----------
  private inBreaker() { return Date.now() < this.downUntil; }
  /** a missing entry or a refusal is an answer; a dead, slow or overloaded server pauses all server calls for a minute */
  private soft(e: unknown): null {
    if (!(e instanceof HttpError) || e.status >= 500 || e.status === 429) this.downUntil = Date.now() + 60000;
    return null;
  }

  private async http<T = unknown>(method: string, path: string, body?: unknown, timeout = 25000): Promise<T> {
    const base = this.server.trim().replace(/\/+$/, '');
    if (!/^https?:\/\//.test(base)) throw new HttpError(0, 'Enter the server address (https://...)');
    let r: Response;
    try {
      r = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(timeout) });
    } catch (e) { throw new HttpError(503, (e as Error)?.name === 'TimeoutError' ? 'The server did not answer (a free server needs up to a minute to wake up)' : 'The server is not reachable'); }
    const j = await r.json().catch(() => ({}));
    if (r.status === 401 && this.token && path !== '/api/auth/login') { this.dropSession('Signed out: the session expired'); }
    if (!r.ok) throw new HttpError(r.status, (j as { error?: string }).error ?? `HTTP ${r.status}`);
    return j as T;
  }

  private async fetchCandles(symbol: string, tf: Tf, from: number, to: number): Promise<Raw | null> {
    if (!this.signedIn || !this.useCandles || this.inBreaker()) return null;
    try { return await this.http<Raw>('GET', `/api/candles?symbol=${encodeURIComponent(symbol)}&tf=${tf}&from=${Math.floor(from)}&to=${Math.floor(to)}`, undefined, 40000); }
    catch (e) { return this.soft(e); }
  }

  // ---------- account ----------
  private async saveAuth() {
    await kvSet('sync_auth', JSON.stringify(this.signedIn ? { server: this.server.trim(), token: this.token, user: this.user as SyncUser, candles: this.useCandles } satisfies Auth : null));
  }
  private async saveMeta() { await kvSet('sync_meta', JSON.stringify(this.meta)); }

  async signIn(mode: 'login' | 'register', email: string, password: string, name = '') {
    this.message = ''; this.status = 'syncing';
    try {
      const r = await this.http<{ token: string; user: SyncUser }>('POST', `/api/auth/${mode}`, { email, password, name });
      this.token = r.token; this.user = r.user; this.downUntil = 0;
      this.meta = { localAt: 0, seen: {}, public: {}, secrets: {} };
      await this.saveAuth(); await this.saveMeta();
      await this.syncAll();
    } catch (e) { this.status = 'out'; this.message = (e as Error).message; throw e; }
  }

  async signOut() {
    if (this.token) await this.http('POST', '/api/auth/logout', {}, 8000).catch(() => {});
    this.dropSession('');
  }

  private dropSession(msg: string) {
    this.token = ''; this.user = null; this.status = 'out'; this.message = msg;
    void this.saveAuth();
  }

  async setUseCandles(v: boolean) { this.useCandles = v; await this.saveAuth(); }

  // ---------- settings (charts, drawings, watchlists, colours, ...) ----------
  private settingsChanged() {
    if (!this.signedIn) return;
    this.meta.localAt = Date.now();
    void this.saveMeta();
    clearTimeout(this.stateTimer);
    this.stateTimer = setTimeout(() => void this.pushState().catch(() => {}), 3000);
  }

  private async pushState() {
    const at = this.meta.localAt || Date.now();
    const r = await this.http<{ stored: boolean; updatedAt: number }>('PUT', '/api/kv/settings', { value: JSON.stringify(app.sharedState()), updatedAt: at });
    if (!r.stored) { this.meta.localAt = 0; await this.pullState(); } // another device was newer
  }

  private async pullState() {
    const all = await this.http<Record<string, { value: string; updatedAt: number }>>('GET', '/api/kv');
    const remoteS = all.settings ?? null;
    const dir = stateDirection(this.meta.localAt, remoteS ? remoteS.updatedAt : null);
    if (dir === 'pull' && remoteS) {
      try { app.adoptShared(JSON.parse(remoteS.value)); } catch { return; }
      this.meta.localAt = remoteS.updatedAt; await this.saveMeta();
      app.persist(true);
    } else if (dir === 'push') await this.pushState();
  }

  // ---------- scripts ----------
  private scriptChanged(kind: ScriptKind, name: string) {
    if (!this.signedIn) return;
    if (!library.get(kind, name)) delete this.meta.public[key(kind, name)];
    clearTimeout(this.scriptTimer);
    this.scriptTimer = setTimeout(() => void this.syncScripts().catch(() => {}), 1500);
  }

  isPublic(kind: ScriptKind, name: string) { return !!this.pub[key(kind, name)]; }
  async setPublic(kind: ScriptKind, name: string, v: boolean) {
    this.meta.public[key(kind, name)] = v; this.pub = { ...this.meta.public }; await this.saveMeta();
    await this.syncScripts();
  }

  async syncScripts() {
    for (const kind of KINDS) {
      const remoteList = await this.http<{ kind: ScriptKind; name: string; code: string; public: boolean; updatedAt: number }[]>('GET', '/api/scripts');
      const rem = remoteList.filter((s) => s.kind === kind);
      const seenK: Record<string, Seen> = {};
      for (const [k, v] of Object.entries(this.meta.seen)) if (k.startsWith(kind + '/')) seenK[k.slice(kind.length + 1)] = v;
      const local = library.list(kind).map((f) => ({ name: f.name, code: f.code, modified: f.modified, public: !!this.meta.public[key(kind, f.name)] }));
      for (const a of planScripts(local, rem, seenK)) {
        const k = key(kind, a.name);
        if (a.op === 'pull') { await library.save(kind, a.name, a.code, true); this.meta.public[k] = a.public; this.meta.seen[k] = { hash: hashCode(a.code), public: a.public }; }
        else if (a.op === 'push') { await this.http('PUT', `/api/scripts/${kind}/${encodeURIComponent(a.name)}`, { code: a.code, public: a.public, updatedAt: Date.now() }); this.meta.seen[k] = { hash: hashCode(a.code), public: a.public }; }
        else if (a.op === 'delLocal') { await library.remove(kind, a.name, true); delete this.meta.seen[k]; delete this.meta.public[k]; }
        else if (a.op === 'delRemote') { await this.http('DELETE', `/api/scripts/${kind}/${encodeURIComponent(a.name)}`); delete this.meta.seen[k]; delete this.meta.public[k]; }
        else this.meta.seen[k] = { hash: a.hash, public: a.public };
      }
    }
    this.pub = { ...this.meta.public };
    await this.saveMeta();
  }

  // ---------- API keys ----------
  private secretTimer: ReturnType<typeof setTimeout> | undefined;
  /** A key was saved or removed on this device: send it to the account shortly. */
  secretsChanged() {
    if (!this.signedIn) return;
    clearTimeout(this.secretTimer);
    this.secretTimer = setTimeout(() => void this.syncSecrets().catch(() => {}), 800);
  }

  async syncSecrets() {
    let remoteAll: Record<string, { value: string; updatedAt: number }>;
    try { remoteAll = await this.http('GET', '/api/secrets'); }
    catch (e) { if (e instanceof HttpError && e.status === 503) return; throw e; } // the server has no SECRETS_KEY: keys stay on the devices
    const rem = Object.fromEntries(Object.entries(remoteAll).map(([k, v]) => [k, v.value]));
    const local = await secretsExport();
    const plan = planSecrets(local, rem, this.meta.secrets);
    for (const n of plan.push) await this.http('PUT', `/api/secrets/${n}`, { value: local[n] });
    for (const n of plan.delRemote) await this.http('DELETE', `/api/secrets/${n}`);
    if (plan.setLocal.length || plan.delLocal.length) await secretsApply(Object.fromEntries(plan.setLocal.map((n) => [n, rem[n]])), plan.delLocal);
    this.meta.secrets = plan.seen;
    await this.saveMeta();
    if (plan.setLocal.length || plan.delLocal.length) this.keysVersion++;
  }
  /** counts up when keys arrived from the account (the settings read the key status again) */
  keysVersion = $state(0);

  async loadCommunity() {
    if (!this.signedIn) return;
    for (const kind of KINDS) {
      try { this.community[kind] = await this.http<Community[]>('GET', `/api/community?kind=${kind}`); } catch { /* keep the old list */ }
    }
  }

  /** Copy a public script of another user into your own library (next to your scripts, under a free name). */
  async importCommunity(c: Community): Promise<string> {
    const name = freeName(c.name, library.list(c.kind).map((f) => f.name), c.author);
    return library.save(c.kind, name, c.code);
  }

  async syncAll() {
    if (!this.signedIn || this.busy) return;
    this.busy = true; this.status = 'syncing'; this.message = '';
    try {
      await this.pullState();
      await this.syncScripts();
      await this.syncSecrets().catch(() => {});
      await this.loadCommunity();
      this.lastSync = Date.now(); this.status = 'idle';
    } catch (e) { if (this.signedIn) { this.status = 'error'; this.message = (e as Error).message; } }
    finally { this.busy = false; }
  }
}

export const sync = new Sync();
