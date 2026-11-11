import type { Candles } from './chart/data';
import { synthColumns } from './chart/data';

export type Tf = '1m' | '5m' | '15m' | '30m' | '1h' | '4h' | '1d' | '1w' | '1M';
export const TIMEFRAMES: Tf[] = ['1m', '5m', '15m', '30m', '1h', '4h', '1d', '1w', '1M'];
export const TF_SECONDS: Record<Tf, number> = {
  '1m': 60, '5m': 300, '15m': 900, '30m': 1800, '1h': 3600, '4h': 14400, '1d': 86400, '1w': 604800, '1M': 2592000
};

export interface SymbolHit { symbol: string; name: string; exchange: string; kind: string }

export const inTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

async function call<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<T>(cmd, args);
}

export interface Raw { t: number[]; o: number[]; h: number[]; l: number[]; c: number[]; v: number[] }

function toCandles(r: Raw): Candles {
  const n = r.t.length;
  return {
    n,
    t: Float64Array.from(r.t),
    o: Float64Array.from(r.o),
    h: Float64Array.from(r.h),
    l: Float64Array.from(r.l),
    c: Float64Array.from(r.c),
    v: Float64Array.from(r.v)
  };
}

/** Registered by the account sync (sync.svelte.ts): candles and caches that every user shares through the server. */
export const remote: {
  candles?: (symbol: string, tf: Tf, from: number, to: number) => Promise<Raw | null>;
  shared?: { get(key: string): Promise<string | null>; put(key: string, value: string): Promise<void> };
} = {};

/** Shared cache key for something long (a news id, a calendar event): its hash. */
async function sharedKey(...parts: string[]): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(parts.join('|')));
  return 'aisum:' + [...new Uint8Array(d)].slice(0, 16).map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** A summary somebody already generated is reused; a new one is shared with everybody. */
async function sharedOr<T>(key: string, force: boolean, make: () => Promise<T>): Promise<T> {
  if (!force && remote.shared) { try { const v = await remote.shared.get(key); if (v) return JSON.parse(v) as T; } catch { /* the server is optional */ } }
  const r = await make();
  remote.shared?.put(key, JSON.stringify(r)).catch(() => {});
  return r;
}

export async function getCandles(symbol: string, tf: Tf, from: number, to: number): Promise<Candles> {
  if (remote.candles) { try { const r = await remote.candles(symbol, tf, from, to); if (r) return toCandles(r); } catch { /* server down or slow: the local path below */ } }
  if (!inTauri) return synthColumns(symbol, TF_SECONDS[tf], from, to);
  return toCandles(await call<Raw>('get_candles', { symbol, tf, from, to }));
}

/** Background download of the test universe (daily to 4 hour candles); later rounds fetch only the newest candles. */
export const prefetchStart = (symbols: readonly string[]) => (inTauri ? call<void>('prefetch_start', { symbols }) : Promise.resolve());
export const prefetchStatus = () => (inTauri ? call<{ running: boolean; done: number; total: number }>('prefetch_status') : Promise.resolve({ running: false, done: 0, total: 0 }));

export async function searchSymbols(query: string): Promise<SymbolHit[]> {
  if (!inTauri) {
    const q = query.toUpperCase();
    return ['AAPL', 'MSFT', 'NVDA', 'TSLA', 'AMZN', 'GOOGL', 'META', 'SPY', 'QQQ', 'BTC/USD', 'ETH/USD']
      .filter((s) => s.includes(q))
      .map((s) => ({ symbol: s, name: s, exchange: 'DEMO', kind: 'EQUITY' }));
  }
  return call<SymbolHit[]>('search_symbols', { query });
}

export const saveAlpacaKeys = (keyId: string, secret: string) =>
  inTauri ? call<void>('save_alpaca_keys', { keyId, secret }) : Promise.resolve();
export const clearAlpacaKeys = () => (inTauri ? call<void>('clear_alpaca_keys') : Promise.resolve());
export const alpacaKeysSet = () => (inTauri ? call<boolean>('alpaca_keys_set') : Promise.resolve(false));

export async function kvGet(key: string): Promise<string | null> {
  if (inTauri) return call<string | null>('kv_get', { key });
  try { return localStorage.getItem('oviate:' + key); } catch { return null; }
}
export async function kvSet(key: string, value: string): Promise<void> {
  if (inTauri) return call<void>('kv_set', { key, value });
  try { localStorage.setItem('oviate:' + key, value); } catch { /* ignore */ }
}

export const streamSymbols = (symbols: string[]) => (inTauri ? call<void>('stream_symbols', { symbols }) : Promise.resolve());

export interface Tick { symbol: string; price: number; size: number; t: number }
export async function onTick(cb: (t: Tick) => void): Promise<() => void> {
  if (!inTauri) return () => {};
  const { listen } = await import('@tauri-apps/api/event');
  return listen<Tick>('tick', (e) => cb(e.payload));
}

export interface NewsItem { id: string; headline: string; source: string; provider: string; summary: string; url: string; ts: number; symbols: string[] }
export interface NewsResult { items: NewsItem[]; errors: { provider: string; error: string }[] }
export interface NewsStatus { fmp: boolean; finnhub: boolean; newsapi: boolean; alpaca: boolean; liquid: boolean; groq: boolean; openrouter: boolean }
export interface Unusual { symbol: string; multiple: number; volume: string }

export const newsStatus = () => (inTauri ? call<NewsStatus>('news_status') : Promise.resolve({ fmp: false, finnhub: false, newsapi: false, alpaca: false, liquid: false, groq: false, openrouter: false }));
/** Empty value clears the key. */
export const saveNewsKey = (provider: 'finnhub' | 'newsapi' | 'groq' | 'openrouter' | 'fmp', value: string) => (inTauri ? call<void>('save_news_key', { provider, value }) : Promise.resolve());
export const liquidLogin = () => (inTauri ? call<void>('liquid_login') : Promise.reject('Liquid login needs the desktop app'));
export const liquidLogout = () => (inTauri ? call<void>('liquid_logout') : Promise.resolve());
/** News in [from, to] (unix seconds); symbol null = market-wide. Cached locally by the backend. */
export const newsWindow = (symbol: string | null, from: number, to: number) =>
  inTauri ? call<NewsResult>('news_window', { symbol, from, to }) : Promise.resolve({ items: [], errors: [] } as NewsResult);

export interface CalEvent { id: string; ts: number; country: string; title: string; impact: 'high' | 'medium' | 'low' | 'holiday'; actual: string | null; forecast: string | null; previous: string | null; provider: string; kind: 'macro' | 'earnings' | 'dividend' | 'split' | 'ipo'; symbol: string | null; detail: string | null }
export interface CalendarResult { items: CalEvent[]; errors: { provider: string; error: string }[]; /** company data is still being fetched: ask again shortly */ pending: boolean }
/** Calendar events in [from, to]: macro and company events (earnings, dividends, splits, IPOs) (unix seconds). Cached by the backend, refreshed hourly (`force` refreshes now). */
export const calendarWindow = (from: number, to: number, force = false) =>
  inTauri ? call<CalendarResult>('calendar_window', { from, to, force }) : Promise.resolve({ items: previewCalendar(from, to), errors: [], pending: false } as CalendarResult);

/** Browser preview (no backend): a few synthetic events so the calendar page and the chart markers can be checked. */
function previewCalendar(from: number, to: number): CalEvent[] {
  const out: CalEvent[] = [];
  const base = Math.floor(from / 86400) * 86400;
  const mk = (ts: number, kind: CalEvent['kind'], country: string, title: string, impact: CalEvent['impact'], extra: Partial<CalEvent> = {}): CalEvent =>
    ({ id: `${kind}:${ts}:${country}:${title}`, ts, country, title, impact, actual: null, forecast: null, previous: null, provider: 'preview', kind, symbol: null, detail: null, ...extra });
  for (let d = base; d < to; d += 86400) {
    out.push(mk(d + 12 * 3600 + 30 * 60, 'macro', 'USD', 'CPI y/y', 'high', { forecast: '2.9%', previous: '2.8%', actual: d < Date.now() / 1000 ? '3.1%' : null }));
    out.push(mk(d + 14 * 3600, 'macro', 'EUR', 'ECB Speaks', 'medium', { forecast: '', previous: '' }));
    out.push(mk(d + 9 * 3600, 'macro', 'GBP', 'Retail Sales m/m', 'low', { forecast: '0.3%', previous: '0.1%' }));
    out.push(mk(d + 21 * 3600, 'earnings', 'US', 'Apple Inc. earnings', 'high', { symbol: 'AAPL', forecast: '$1.62', previous: '$1.46', detail: 'quarter Sep/2026 · market cap $3.20T · 38 estimates' }));
    out.push(mk(d + 21 * 3600, 'earnings', 'US', 'Small Co earnings', 'low', { symbol: 'SMLL', forecast: '$0.12', previous: '$0.10' }));
  }
  return out.filter((e) => e.ts >= from && e.ts <= to);
}

/** Calendar currencies of a symbol the bundled table does not know: Nasdaq profile, else the AI (cached by the backend). */
export const symbolRegions = (symbol: string) => (inTauri ? call<string[]>('symbol_regions', { symbol }) : Promise.reject('needs the desktop app'));

export interface CalSummary { what: string; why: string; above: string; below: string; assets: string[]; volatility: number; model: string }
export const calendarSummary = async (event: CalEvent, lang: string, force = false) =>
  inTauri ? sharedOr(await sharedKey('cal', event.id, lang, String(event.actual ?? '')), force, () => call<CalSummary>('calendar_summary', { event, lang, force })) : Promise.reject('AI summaries need the desktop app');

export interface AiSummary { what: string; impact: string; direction: 'bullish' | 'bearish' | 'neutral' | 'mixed'; intensity: number; assets: string[]; horizon: string; model: string }
export const aiSummary = async (id: string, lang: string, force = false) =>
  inTauri ? sharedOr(await sharedKey('news', id, lang), force, () => call<AiSummary>('ai_summary', { id, lang, force })) : Promise.reject('AI summaries need the desktop app');

export type ChatMsg = { role: 'system' | 'user' | 'assistant'; content: string };
export const aiComplete = (messages: ChatMsg[]) =>
  inTauri ? call<string>('ai_complete', { messages }) : Promise.reject('AI needs the desktop app');

/** Light structured tasks (builder conversions): Groq first, OpenRouter as fallback. */
export const aiLight = (messages: ChatMsg[]) =>
  inTauri ? call<string>('ai_complete_light', { messages }) : Promise.reject('AI needs the desktop app');

export async function openUrl(url: string) {
  if (!inTauri) { window.open(url, '_blank'); return; }
  const m = await import('@tauri-apps/plugin-opener');
  await m.openUrl(url);
}
export const liquidUnusual = () => (inTauri ? call<Unusual[]>('liquid_unusual') : Promise.resolve([] as Unusual[]));
