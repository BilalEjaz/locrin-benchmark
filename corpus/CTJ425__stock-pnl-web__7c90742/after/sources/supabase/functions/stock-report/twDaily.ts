/**
 * 台股日線 OHLCV 抓取與解析（Yahoo Finance chart 端點）。
 *
 * 為什麼是 Yahoo 而不是 TWSE：TWSE 的 `exchangeReport/STOCK_DAY` 是「逐股逐月」的檔案，
 * 要湊滿季線所需的 60 個交易日得打 4～5 次、每檔如此。Yahoo 的 chart 端點一次就回一整年，
 * 而且這個端點本來就在專案內（stock-price 已在用它取現價，只是丟掉了 timestamp 與 indicators）。
 *
 * 實測（2330.TW，range=1y&interval=1d）：回 244 個交易日、16.8KB，
 * `indicators.quote[0]` 的 open/high/low/close/volume 五個欄位齊全。
 *
 * 兩個必須處理的陷阱（皆為實測所見，不是防禦性臆測）：
 * 1. **回應會包含沒有資料的交易日**：實測 2025-08-01 那一格五個欄位全是 null。
 *    這種列直接丟棄 —— 它不帶任何資訊，留著只會讓均線計算要處處防 null。
 * 2. **timestamp 是 UTC 秒數，指向當地開盤時刻**（台股 09:00 → 01:00Z）。
 *    直接 `toISOString().slice(0,10)` 在台股時區碰巧會對，但那是巧合而非保證；
 *    一律先加 `meta.gmtoffset` 再取 UTC 日期，這樣換到任何時區都成立。
 *
 * 解析函式為純函式、不觸網，便於單元測試；HTTP 抓取在 index.ts 組合。
 */

/** 一根日線。tuple 形式是為了壓縮 Storage 體積（244 天的物件陣列約為 tuple 的 3 倍大） */
export type DailyRow = [
  date: string,
  open: number,
  high: number,
  low: number,
  close: number,
  volume: number,
]

/** Storage 內 daily/{ticker}.json 的結構 */
export interface DailyFile {
  schema: number
  ticker: string
  /** 我們實際抓到它的時間 ISO */
  asOf: string
  /** 最新一根的交易日 YYYY-MM-DD；批次據此判斷要不要重抓 */
  lastDate: string
  /** 由舊到新 */
  rows: DailyRow[]
}

/**
 * 日線檔的結構版本。
 * 前端的守門必須用 `>=` 比對（見 src/services/dailyProxy.ts）——
 * 加欄位對舊前端是無害的加法，用等號會在後端升版時讓整個技術面分頁當場全掛。
 * 這正是 0.4.1 修過的線上故障。
 */
export const DAILY_SCHEMA = 1

/** 一年份足以涵蓋季線（60 個交易日）與各指標的暖身期，實測回 244 天 */
export function dailyUrl(symbol: string): string {
  return `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=1y`
}

/** 台股代號轉 Yahoo 格式：上市 .TW，查無時呼叫端再試上櫃 .TWO（與 stock-price 同構） */
export function yahooDailySymbols(ticker: string): string[] {
  return [`${ticker}.TW`, `${ticker}.TWO`]
}

interface ChartQuote {
  open?: Array<number | null>
  high?: Array<number | null>
  low?: Array<number | null>
  close?: Array<number | null>
  volume?: Array<number | null>
}

export interface ChartResponse {
  chart?: {
    result?: Array<{
      meta?: { gmtoffset?: number; symbol?: string }
      timestamp?: number[]
      indicators?: { quote?: ChartQuote[] }
    }> | null
    error?: unknown
  }
}

/** epoch 秒 + 時區位移 → 當地交易日 YYYY-MM-DD */
export function tradingDateOf(epochSeconds: number, gmtOffsetSeconds: number): string {
  return new Date((epochSeconds + gmtOffsetSeconds) * 1000).toISOString().slice(0, 10)
}

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

/**
 * 由 chart 回應抽出日線序列（由舊到新）。
 * 結構不符或無有效資料時回空陣列，呼叫端據此改試下一個 symbol。
 */
export function extractDaily(resp: ChartResponse): DailyRow[] {
  const result = resp?.chart?.result?.[0]
  const ts = result?.timestamp
  const q = result?.indicators?.quote?.[0]
  if (!Array.isArray(ts) || !q) return []

  const offset = num(result?.meta?.gmtoffset) ?? 0
  const rows: DailyRow[] = []
  for (let i = 0; i < ts.length; i++) {
    const close = num(q.close?.[i])
    // 收盤價是這根 K 棒存在與否的判定依據：實測那些「五欄全 null」的假日格就是這樣被濾掉的
    if (close === null) continue
    const open = num(q.open?.[i])
    const high = num(q.high?.[i])
    const low = num(q.low?.[i])
    const volume = num(q.volume?.[i])
    if (open === null || high === null || low === null) continue
    rows.push([tradingDateOf(ts[i], offset), open, high, low, close, volume ?? 0])
  }
  // Yahoo 回的本來就是由舊到新，但排序成本極低而順序錯掉會讓每一條均線都錯
  rows.sort((a, b) => a[0].localeCompare(b[0]))
  return rows
}
