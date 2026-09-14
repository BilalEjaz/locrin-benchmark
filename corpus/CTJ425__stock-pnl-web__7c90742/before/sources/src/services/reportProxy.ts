/**
 * 盤後籌碼報告：呼叫 Supabase Edge Function `stock-report`，或直接讀盤後排程預產的共用報告。
 * 未設定 Supabase 時 isReportConfigured 為 false，UI 隱藏入口。
 *
 * 此檔的型別是**網路介面契約**，須與 sources/supabase/functions/stock-report/report.ts
 * 的 ReportData（schema 2）對齊；伺服器只回結構化資料，畫面全部由 React 繪製。
 */
import type { Market } from '../types/models'
import { isSupabaseConfigured, supabase } from './supabase'

/** 是否已設定 Supabase 網址與金鑰（未設定則整個盤後報告功能隱藏） */
export const isReportConfigured = isSupabaseConfigured

/**
 * 前端認得的**最低**報告結構版本。
 *
 * 必須是「>=」而不是「===」：伺服器每次為報告加欄位就會升 schema（2 → 3 加了 sources），
 * 而新增欄位對舊前端是無害的加法。用等號的話，後端一升版就會讓**所有**報告被判為不支援 ——
 * Storage-first 回 null、即點即產丟「格式不符」，整個籌碼分頁當場全掛。
 * 這正是 0.4.0 實際發生的事（後端升到 3、前端還鎖 2），故此處以測試釘住。
 */
export const MIN_REPORT_SCHEMA = 2

/** 前端帶入的持股脈絡（Edge Function 不重算，直接放進報告） */
export interface ReportHolding {
  qty: number
  avgCost: number
  price: number | null
  unrealized: number | null
  roi: number | null
}

/** 買進 / 賣出 / 買賣超三件組；來源缺該拆項時為 null */
export interface ChipLeg {
  buy: number | null
  sell: number | null
  net: number | null
}

/** 三大法人（單位：股） */
export interface InstitutionalChip {
  foreign: ChipLeg
  foreignDealer: ChipLeg
  trust: ChipLeg
  dealer: ChipLeg
  total: ChipLeg
}

/** 融資融券（單位：交易單位＝張）。融券 buy＝回補、sell＝放空 */
export interface MarginChip {
  marginBuy: number | null
  marginSell: number | null
  marginRedeem: number | null
  marginPrev: number | null
  marginToday: number | null
  marginChange: number | null
  marginLimit: number | null
  shortBuy: number | null
  shortSell: number | null
  shortRedeem: number | null
  shortPrev: number | null
  shortToday: number | null
  shortChange: number | null
  shortLimit: number | null
  offset: number | null
  /** 'openapi' 為備援來源：只有餘額，無買進 / 賣出拆項 */
  source: 'rwd' | 'openapi'
}

export interface BorrowChip {
  availableVolume: number | null
}

/** 單一交易日的籌碼快照 */
/**
 * 單一資料源的新鮮度（schema 3 起）。
 * 三個資料源公布時間差很多、批次又是分段執行，同一份報告裡各區塊的新舊本來就不同 ——
 * 只看整份報告的 generatedAt 會誤以為每塊都一樣新。
 */
export interface SourceStamp {
  /** 資料本身所屬日期 YYYY-MM-DD（借券是「下一個交易日」，會與籌碼的資料日期不同） */
  date: string | null
  /** 我們實際抓到它的時間 ISO */
  fetchedAt: string | null
}

export interface ReportSources {
  institutional: SourceStamp | null
  margin: SourceStamp | null
  borrow: SourceStamp | null
}

export interface ChipDay {
  date: string
  institutional: InstitutionalChip | null
  margin: MarginChip | null
}

/** 連買連賣 / 連增連減：正數＝連續 N 天買超（增加），負數＝連續 N 天賣超（減少） */
export interface ChipStreaks {
  foreign: number
  foreignDealer: number
  trust: number
  dealer: number
  total: number
  margin: number
  short: number
}

export interface ReportData {
  schema: number
  ticker: string
  name: string
  market: 'TPE'
  dataDate: string
  generatedAt: string
  holding: ReportHolding | null
  institutional: InstitutionalChip | null
  margin: MarginChip | null
  borrow: BorrowChip | null
  /** 由舊到新，最多 7 個交易日 */
  history: ChipDay[]
  streaks: ChipStreaks
  /** schema 3 起才有；schema 2 的報告為 undefined，UI 須容忍 */
  sources?: ReportSources
  notes: string[]
}

export interface GenerateReportInput {
  market: Market
  ticker: string
  name: string
  holding?: ReportHolding | null
}

interface GenerateReportResponse {
  reportId: string
  generatedAt: string
  dataDate: string
  data: ReportData
}

/** 結構是否為前端認得的報告（schema 1 的舊 HTML 格式一律當未命中） */
function isSupportedReport(d: unknown): d is ReportData {
  if (!d || typeof d !== 'object') return false
  const r = d as Partial<ReportData>
  return typeof r.schema === 'number' && r.schema >= MIN_REPORT_SCHEMA && Array.isArray(r.history)
}

/** 即點即產：未預產（不在持股清單 / 當日尚未產）時的 fallback，較慢但可用 */
export async function generateReport(input: GenerateReportInput): Promise<ReportData> {
  if (!isSupabaseConfigured || !supabase) {
    throw new Error('Supabase 未設定')
  }
  const { data, error } = await supabase.functions.invoke<GenerateReportResponse>('stock-report', {
    body: { action: 'generate', ...input },
  })
  if (error) {
    throw new Error(error.message || '產生報告失敗')
  }
  if (!isSupportedReport(data?.data)) {
    throw new Error('伺服器回傳的報告格式不符，請稍後再試')
  }
  return data.data
}

// ---- Storage-first：讀取盤後排程預先產好的共用報告（reports bucket）----

const REPORTS_BUCKET = 'reports'

/** 從 reports bucket 讀一個 JSON 檔（公開 bucket，anon 可讀）；查無 / 失敗回 null */
async function downloadJson<T>(path: string): Promise<T | null> {
  if (!supabase) return null
  try {
    const { data, error } = await supabase.storage.from(REPORTS_BUCKET).download(path)
    if (error || !data) return null
    return JSON.parse(await data.text()) as T
  } catch {
    return null
  }
}

/**
 * 讀取盤後排程預產的共用報告（不含個人持股，持股概況由前端自行渲染）。
 * 先讀 manifest 取得最近交易日，再讀 {ymd}/{ticker}.json。
 * 查無或格式非 schema 2 時回 null，呼叫端 fallback 即點即產。
 */
export async function fetchStoredReport(ticker: string): Promise<ReportData | null> {
  if (!isSupabaseConfigured || !supabase) return null
  const manifest = await downloadJson<{ ymd: string }>('manifest.json')
  if (!manifest?.ymd) return null
  const stored = await downloadJson<{ data?: unknown }>(`${manifest.ymd}/${ticker}.json`)
  return isSupportedReport(stored?.data) ? stored.data : null
}
