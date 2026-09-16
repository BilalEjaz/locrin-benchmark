/**
 * 公開 `reports` bucket 的共用讀取。
 *
 * 盤後排程把兩種東西寫進同一個 bucket，前端都是直接下載、不經 Edge Function：
 * - `manifest.json` / `{ymd}/{ticker}.json` —— 籌碼報告（reportProxy.ts）
 * - `daily/{ticker}.json`                  —— 日線 OHLCV（dailyProxy.ts）
 *
 * 兩邊各寫一份下載邏輯必然會走鐘，這裡是單一來源。
 * 走 Storage 而非 Edge Function 是刻意的：0.3.9 的教訓是 invocation 額度燒光
 * 會連帶讓 stock-price 一起停擺，能不打 Edge Function 就不打。
 */
import { isSupabaseConfigured, supabase } from './supabase'

export const REPORTS_BUCKET = 'reports'

/** 從 reports bucket 讀一個 JSON 檔（公開 bucket，anon 可讀）；查無 / 失敗回 null */
export async function downloadReportsJson<T>(path: string): Promise<T | null> {
  if (!isSupabaseConfigured || !supabase) return null
  try {
    const { data, error } = await supabase.storage.from(REPORTS_BUCKET).download(path)
    if (error || !data) return null
    return JSON.parse(await data.text()) as T
  } catch {
    return null
  }
}
