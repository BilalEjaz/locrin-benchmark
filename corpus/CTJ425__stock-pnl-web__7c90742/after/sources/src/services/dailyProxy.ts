/**
 * 日線 OHLCV：讀取盤後排程預產、存於公開 `reports` bucket 的 `daily/{ticker}.json`。
 *
 * 沒有「即點即產」的 fallback，這是刻意的：日線只服務個股分析頁，而該頁的下拉選單
 * 本來就只列使用者的台股持股 —— 那些代號正是夜間批次 `generate-all` 會涵蓋的清單。
 * 查無檔案代表批次還沒跑過，UI 顯示「稍晚會自動補上」比多開一個公開端點健康。
 *
 * 此檔的型別是**網路介面契約**，須與 sources/supabase/functions/stock-report/twDaily.ts
 * 的 DailyFile 對齊。
 */
import { downloadReportsJson } from './reportsBucket'

/** 一根日線：[交易日, 開, 高, 低, 收, 量] */
export type DailyRow = [string, number, number, number, number, number]

export interface DailySeries {
  ticker: string
  /** 我們實際抓到它的時間 ISO */
  asOf: string
  /** 最新一根的交易日 YYYY-MM-DD */
  lastDate: string
  /** 由舊到新 */
  rows: DailyRow[]
}

/**
 * 前端認得的**最低**日線結構版本。
 *
 * 必須是「>=」而不是「===」：伺服器每次為檔案加欄位就會升 schema，而新增欄位對舊前端
 * 是無害的加法。用等號的話，後端一升版就會讓技術面分頁當場全掛 ——
 * 這正是 0.4.0 在籌碼報告上真實發生過的事（見 reportProxy.ts 的 MIN_REPORT_SCHEMA）。
 */
export const MIN_DAILY_SCHEMA = 1

interface StoredDaily {
  schema?: number
  ticker?: string
  asOf?: string
  lastDate?: string
  rows?: unknown
}

function isValidRow(r: unknown): r is DailyRow {
  return (
    Array.isArray(r) &&
    r.length === 6 &&
    typeof r[0] === 'string' &&
    r.slice(1).every((v) => typeof v === 'number' && Number.isFinite(v))
  )
}

function isSupported(d: unknown): d is Required<StoredDaily> {
  if (!d || typeof d !== 'object') return false
  const f = d as StoredDaily
  return typeof f.schema === 'number' && f.schema >= MIN_DAILY_SCHEMA && Array.isArray(f.rows)
}

/** 讀某檔的日線序列；查無 / 格式不符 / 無有效資料回 null */
export async function fetchDailySeries(ticker: string): Promise<DailySeries | null> {
  const stored = await downloadReportsJson<StoredDaily>(`daily/${ticker}.json`)
  if (!isSupported(stored)) return null

  const rows = (stored.rows as unknown[]).filter(isValidRow)
  if (rows.length === 0) return null

  return {
    ticker: typeof stored.ticker === 'string' ? stored.ticker : ticker,
    asOf: typeof stored.asOf === 'string' ? stored.asOf : '',
    lastDate: typeof stored.lastDate === 'string' ? stored.lastDate : rows[rows.length - 1][0],
    rows,
  }
}
