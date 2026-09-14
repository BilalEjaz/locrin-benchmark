/**
 * Supabase Edge Function：stock-report（盤後籌碼報告產生器）
 *
 * 由伺服器端代抓 TWSE 盤後籌碼並產出**結構化資料**（schema 2 起不再產生 HTML，
 * 畫面一律由前端 React 繪製）。報告內嵌最近 7 個交易日的 history 供前端自繪走勢圖。
 * 共用 raw 檔快取（chip_raw_cache 資料表，見 sources/supabase/schema.sql）。
 * 部署方式（需安裝 Supabase CLI 並登入）：
 *   supabase functions deploy stock-report --no-verify-jwt
 *
 * 介面：
 *   POST { action: 'generate', market: 'TPE', ticker: string, name: string, holding?: HoldingContext }
 *     → { reportId, generatedAt, dataDate, data }（即點即產，前端 fallback 用）
 *   POST { action: 'generate-all' }  header: x-cron-secret（盤後 pg_cron 觸發）
 *     → 產生全體持有台股的共用報告存入 Storage(reports bucket)，並清理超過 7 天的舊資料
 */
import { createClient } from 'jsr:@supabase/supabase-js@2'
import {
  fetchJson,
  t86Url,
  marginDatedUrl,
  marginDatedOk,
  MI_MARGN_URL,
  SBL_URL,
  extractInstitutional,
  extractMargin,
  extractMarginDated,
  extractBorrow,
  type MarginDatedResponse,
  type T86ResponseShape,
} from './twChips.ts'
import {
  buildReport,
  dashDate,
  isWeekendYmd,
  tradingDateCandidates,
  type ChipDay,
  type HoldingContext,
} from './report.ts'

// SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 由 Supabase 執行環境自動注入；
// service role 不受 RLS 限制，是 chip_raw_cache 唯一的讀寫途徑
const db = createClient(
  Deno.env.get('SUPABASE_URL') ?? '',
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
)

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json; charset=utf-8' },
  })
}

const TICKER_RE = /^[0-9A-Za-z]{2,8}$/

/** 報告內嵌的歷史交易日數（**交易日**，不是日曆日） */
const HISTORY_DAYS = 7
/** 往回推的日曆天數，需足夠涵蓋 HISTORY_DAYS 個交易日（含週末與連假） */
const LOOKBACK_DAYS = 14
/** 單次呼叫最多實抓幾個缺漏日；Edge Function 有 wall-clock 上限，不足的隔日排程補齊 */
const MAX_BACKFILL_DAYS = 5
/** 同時進行的外部抓取數上限（T86 單檔約 1–2MB） */
const FETCH_CONCURRENCY = 3

function t86Ok(r: T86ResponseShape): boolean {
  const data = r.data ?? r.tables?.[0]?.data
  return r.stat === 'OK' && Array.isArray(data) && data.length > 0
}

export function makeReportId(dateYmd: string, ticker: string): string {
  return `${dateYmd}_${ticker}_${crypto.randomUUID().slice(0, 8)}`
}

async function readCache<T>(ymd: string, dataset: string): Promise<T | null> {
  try {
    const { data, error } = await db
      .from('chip_raw_cache')
      .select('payload')
      .eq('ymd', ymd)
      .eq('dataset', dataset)
      .maybeSingle()
    if (error || !data?.payload) return null
    return data.payload as T
  } catch {
    return null
  }
}

async function writeCache(ymd: string, dataset: string, payload: unknown): Promise<void> {
  try {
    await db.from('chip_raw_cache').upsert({
      ymd,
      dataset,
      payload,
      updated_at: new Date().toISOString(),
    })
  } catch {
    // 快取寫入失敗不影響主流程
  }
}

/**
 * 哪些 (日期, dataset) 組合已有快取，回傳 `${ymd}:${dataset}` 集合。
 * 只查鍵、不取 payload —— 每筆 payload 是 1–2MB，全撈回來會直接吃爆記憶體。
 * 必須逐 dataset 判斷：v1 時期只快取了 T86，那些日子仍需補抓 MI_MARGN_D。
 */
async function cachedDayDatasets(candidates: string[]): Promise<Set<string>> {
  try {
    const { data, error } = await db
      .from('chip_raw_cache')
      .select('ymd, dataset')
      .in('dataset', ['T86', 'MI_MARGN_D'])
      .in('ymd', candidates)
    if (error || !data) return new Set()
    return new Set(data.map((r) => `${String(r.ymd)}:${String(r.dataset)}`))
  } catch {
    return new Set()
  }
}

/** 讀取「最新交易日」型的 whole-market 檔（無 date 參數），按解析日期快取於 Postgres */
async function readLatest<T>(ymd: string, dataset: string, url: string): Promise<T | null> {
  const cached = await readCache<T>(ymd, dataset)
  if (cached) return cached
  try {
    const data = await fetchJson<T>(url)
    await writeCache(ymd, dataset, data)
    return data
  } catch {
    return null
  }
}

// ---- 逐日籌碼序列 ----

/** 一天的全市場原始檔。用完即棄：抽出各代號的籌碼後就釋放，避免同時持有數十 MB */
interface DayRaw {
  ymd: string
  t86: T86ResponseShape
  margin: MarginDatedResponse | null
}

/** 一天中「我們關心的代號」的籌碼（以 ticker 為鍵） */
interface DaySlice {
  ymd: string
  chips: Map<string, ChipDay>
}

/** 讀某日 T86（快取優先）；非交易日 / 尚未收盤回 null。fetch=false 時只讀快取 */
async function loadT86(ymd: string, fetchAllowed: boolean): Promise<T86ResponseShape | null> {
  const cached = await readCache<T86ResponseShape>(ymd, 'T86')
  if (cached && t86Ok(cached)) return cached
  if (!fetchAllowed) return null
  try {
    const resp = await fetchJson<T86ResponseShape>(t86Url(ymd))
    if (!t86Ok(resp)) return null // 非交易日 / 尚未收盤：不快取空回應
    await writeCache(ymd, 'T86', resp)
    return resp
  } catch {
    return null
  }
}

/** 讀某日帶 date 的融資融券（快取優先）；端點格式變動或抓取失敗回 null */
async function loadMarginDated(ymd: string, fetchAllowed: boolean): Promise<MarginDatedResponse | null> {
  const cached = await readCache<MarginDatedResponse>(ymd, 'MI_MARGN_D')
  if (cached && marginDatedOk(cached)) return cached
  if (!fetchAllowed) return null
  try {
    const resp = await fetchJson<MarginDatedResponse>(marginDatedUrl(ymd))
    if (!marginDatedOk(resp)) return null
    await writeCache(ymd, 'MI_MARGN_D', resp)
    return resp
  } catch {
    return null
  }
}

async function loadDayRaw(
  ymd: string,
  allow: { t86: boolean; margin: boolean },
): Promise<DayRaw | null> {
  const t86 = await loadT86(ymd, allow.t86)
  if (!t86) return null // T86 是交易日的判定依據，沒有就當這天沒資料
  const margin = await loadMarginDated(ymd, allow.margin)
  return { ymd, t86, margin }
}

/** 把一天的原始大檔壓成只含目標代號的切片，隨即釋放 raw */
function sliceDay(raw: DayRaw, tickers: string[]): DaySlice {
  const date = dashDate(raw.ymd)
  const chips = new Map<string, ChipDay>()
  for (const ticker of tickers) {
    chips.set(ticker, {
      date,
      institutional: extractInstitutional(raw.t86, ticker),
      margin: raw.margin ? extractMarginDated(raw.margin, ticker) : null,
    })
  }
  return { ymd: raw.ymd, chips }
}

export interface SeriesResult {
  /** 由舊到新的交易日切片，最多 HISTORY_DAYS 筆；空陣列代表完全無資料 */
  days: DaySlice[]
  /** 最新交易日 YYYYMMDD（無資料時退回最近的非週末候選日當標示） */
  dataYmd: string
  /** 是否因抓取額度用盡而少於 HISTORY_DAYS 天 */
  incomplete: boolean
  /** rwd 融資融券是否整批不可用（呼叫端據此回退 OpenAPI） */
  marginDatedFailed: boolean
}

/**
 * 組出最近 HISTORY_DAYS 個交易日的籌碼序列。
 *
 * 策略（見 docs/agent/PLAN.md §E）：
 * - 候選日往回推 LOOKBACK_DAYS 個日曆日，先剔除週六日（必定非交易日，省下白抓）。
 * - 已有快取的日子不佔抓取額度；其餘以 FETCH_CONCURRENCY 併發抓取。
 * - 單次呼叫最多實抓 MAX_BACKFILL_DAYS 個缺漏日，收集滿 HISTORY_DAYS 天即停。
 */
async function loadSeries(tickers: string[], now: Date): Promise<SeriesResult> {
  const candidates = tradingDateCandidates(now, LOOKBACK_DAYS - 1).filter((d) => !isWeekendYmd(d))
  const cached = await cachedDayDatasets(candidates)
  let fetchBudget = MAX_BACKFILL_DAYS
  const collected: DaySlice[] = []
  let marginSeen = false

  // 由新到舊分批處理；同批內併發，批間序列，以此同時控住併發數與總抓取量
  for (let i = 0; i < candidates.length && collected.length < HISTORY_DAYS; i += FETCH_CONCURRENCY) {
    const batch = candidates.slice(i, i + FETCH_CONCURRENCY)
    const jobs: Array<Promise<DayRaw | null>> = []
    for (const ymd of batch) {
      const needT86 = !cached.has(`${ymd}:T86`)
      const needMargin = !cached.has(`${ymd}:MI_MARGN_D`)
      if (fetchBudget <= 0) {
        // 額度用盡：T86 沒快取就無從判定是不是交易日，只能跳過；
        // T86 有快取則照樣出圖，那天單純沒有融資融券資料。
        if (needT86) continue
        jobs.push(loadDayRaw(ymd, { t86: false, margin: false }))
        continue
      }
      if (needT86 || needMargin) fetchBudget--
      jobs.push(loadDayRaw(ymd, { t86: needT86, margin: needMargin }))
    }
    const raws = await Promise.all(jobs)
    for (const raw of raws) {
      if (!raw) continue
      if (raw.margin) marginSeen = true
      collected.push(sliceDay(raw, tickers))
    }
  }

  // collected 為由新到舊；轉成由舊到新並裁到 HISTORY_DAYS
  collected.sort((a, b) => a.ymd.localeCompare(b.ymd))
  const days = collected.slice(-HISTORY_DAYS)
  const latest = days[days.length - 1]
  return {
    days,
    dataYmd: latest?.ymd ?? candidates[0] ?? '',
    incomplete: days.length < HISTORY_DAYS,
    marginDatedFailed: days.length > 0 && !marginSeen,
  }
}

interface GenerateReportRequestBody {
  action?: string
  market?: string
  ticker?: string
  name?: string
  holding?: HoldingContext | null
}

type MarginRows = Record<string, string>[] | null
type SblRows = Parameters<typeof extractBorrow>[0] | null

/** 由已抓好的序列組出單一代號的報告資料。holding 為 null 時前端不顯示持股概況。 */
function assembleOne(opts: {
  ticker: string
  name: string
  holding: HoldingContext | null
  series: SeriesResult
  marginFallbackRows: MarginRows
  sblRows: SblRows
}): ReturnType<typeof buildReport> {
  const { ticker, name, holding, series, marginFallbackRows, sblRows } = opts
  const notes: string[] = []

  // 複製一份再組：series 的切片可能被多個代號共用讀取，下面的 fallback 會就地補值
  const history: ChipDay[] = series.days.map((d) => {
    const chip = d.chips.get(ticker)
    return chip ? { ...chip } : { date: dashDate(d.ymd), institutional: null, margin: null }
  })
  const latest = history[history.length - 1] ?? null

  if (series.days.length === 0) {
    notes.push('三大法人資料暫無（可能尚未收盤或逢假日）。')
  } else if (series.incomplete) {
    notes.push(
      `歷史資料回補中：目前只取到 ${history.length} 個交易日（共需 ${HISTORY_DAYS} 天），走勢圖會逐日補齊。`,
    )
  }

  // rwd 端點整批失敗時，用 OpenAPI 補上「最新交易日」的餘額（缺買進 / 賣出拆項）
  if (latest && latest.margin === null && marginFallbackRows) {
    const fallback = extractMargin(marginFallbackRows, ticker)
    if (fallback) {
      latest.margin = fallback
      notes.push('融資融券改用備援來源，只有今日餘額，無買進 / 賣出拆項與走勢。')
    }
  }
  if (latest && latest.margin === null) {
    notes.push('融資融券來源暫時無回應。')
  }

  const borrow = sblRows ? extractBorrow(sblRows, ticker) : null

  if (latest && latest.institutional === null && latest.margin === null) {
    notes.push('此代號查無上市籌碼資料（可能為上櫃 / 興櫃，暫不支援上櫃）。')
  }

  return buildReport({
    ticker,
    name,
    dataDateYmd: series.dataYmd,
    holding,
    history,
    borrow,
    notes,
  })
}

/** 借券與 OpenAPI 融資融券都沒有 date 參數，只對最新交易日有意義 */
async function loadLatestOnlySources(
  dataYmd: string,
  needMarginFallback: boolean,
): Promise<{ marginFallbackRows: MarginRows; sblRows: SblRows }> {
  const sblRows = await readLatest<Parameters<typeof extractBorrow>[0]>(dataYmd, 'SBL', SBL_URL)
  const marginFallbackRows = needMarginFallback
    ? await readLatest<Record<string, string>[]>(dataYmd, 'MI_MARGN', MI_MARGN_URL)
    : null
  return { marginFallbackRows, sblRows }
}

async function handleGenerate(body: GenerateReportRequestBody): Promise<Response> {
  if (body.market !== 'TPE') {
    return json({ error: '盤後籌碼報告僅支援台股（TPE）' }, 400)
  }
  const ticker = String(body.ticker ?? '').trim()
  if (!TICKER_RE.test(ticker)) {
    return json({ error: 'ticker 格式不正確' }, 400)
  }
  const name = String(body.name ?? '').trim().slice(0, 40)
  const holding = body.holding ?? null

  /*
   * 這個端點以 --no-verify-jwt 部署（夜間 cron 只帶 x-cron-secret 進來），
   * 也就是任何人拿到專案網址就能呼叫 —— 而網址就在 GitHub Pages 的公開 bundle 裡。
   *
   * 限制只接受「確實有人持有」的代號，把濫用的上限壓到最低：
   * 攻擊者最多只能打這幾檔，而它們的當日資料早已被夜間批次快取，
   * 因此無法逼這個專案去大量抓 TWSE（放大效應歸零），只剩單純的 DB 讀取。
   * 回應刻意不透露清單內容或長度。
   */
  const held = await heldTwTickers()
  if (!held.some((h) => h.ticker === ticker)) {
    return json({ error: '此代號不在持股清單內，無法產生報告' }, 403)
  }

  const series = await loadSeries([ticker], new Date())
  const { marginFallbackRows, sblRows } = await loadLatestOnlySources(
    series.dataYmd,
    series.marginDatedFailed || series.days.length === 0,
  )
  const data = assembleOne({ ticker, name, holding, series, marginFallbackRows, sblRows })

  const reportId = makeReportId(series.dataYmd, ticker)
  return json({ reportId, generatedAt: data.generatedAt, dataDate: data.dataDate, data })
}

// ---- 盤後批次：產生全體持有台股的共用報告存入 Storage(reports bucket)，保留最近 7 天 ----

const REPORTS_BUCKET = 'reports'

/** 報告在 Storage 保留幾個**日曆日**。前端只讀 manifest 指到的最新一份，舊的純粹留著備查 */
const REPORT_RETAIN_DAYS = 7
/**
 * 原始檔快取保留幾個**日曆日**，必須涵蓋整個 LOOKBACK_DAYS 視窗。
 *
 * 為什麼不是 7：`HISTORY_DAYS` 數的是**交易日**，而 prune 砍的是**日曆日** ——
 * 7 個交易日要跨 9–11 個日曆日。用 7 天會把隔天還要用的 2–3 天一起砍掉，
 * 於是每晚的批次都得重抓那幾天（實測正式區 prune 後只剩 6 個交易日可用，
 * 每次 generate 都還在補抓）。設成與 LOOKBACK_DAYS 相同最不容易再錯：
 * 那正是 loadSeries 會回頭找的範圍，更舊的資料本來就永遠不會被讀到。
 */
const CACHE_RETAIN_DAYS = LOOKBACK_DAYS

/** generate-all 會寫 Storage，端點為公開(--no-verify-jwt)，故要求 x-cron-secret 與環境變數相符 */
function assertCronSecret(req: Request): Response | null {
  const expected = Deno.env.get('CRON_SECRET') ?? ''
  const got = req.headers.get('x-cron-secret') ?? ''
  if (!expected || got !== expected) return json({ error: 'Unauthorized' }, 401)
  return null
}

function ymdMinusDays(ymd: string, days: number): string {
  const dt = new Date(Date.UTC(+ymd.slice(0, 4), +ymd.slice(4, 6) - 1, +ymd.slice(6, 8)))
  dt.setUTCDate(dt.getUTCDate() - days)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${dt.getUTCFullYear()}${p(dt.getUTCMonth() + 1)}${p(dt.getUTCDate())}`
}

/** 全體使用者「淨持有（買 − 賣 > 0）」的台股代號（service role 掃 transactions；跨使用者去重） */
async function heldTwTickers(): Promise<Array<{ ticker: string; name: string }>> {
  const { data, error } = await db
    .from('transactions')
    .select('ticker, name, tx_type, qty')
    .eq('market', 'TPE')
  if (error || !data) return []
  const acc = new Map<string, { net: number; name: string }>()
  for (const row of data) {
    const ticker = String(row.ticker ?? '').trim()
    if (!TICKER_RE.test(ticker)) continue
    const qty = Number(row.qty) || 0
    const delta = row.tx_type === 'BUY' ? qty : -qty
    const prev = acc.get(ticker) ?? { net: 0, name: '' }
    acc.set(ticker, { net: prev.net + delta, name: String(row.name ?? '').trim() || prev.name })
  }
  return [...acc.entries()]
    .filter(([, v]) => v.net > 0)
    .map(([ticker, v]) => ({ ticker, name: v.name }))
}

async function uploadJson(path: string, payload: unknown): Promise<boolean> {
  try {
    const blob = new Blob([JSON.stringify(payload)], { type: 'application/json' })
    const { error } = await db.storage.from(REPORTS_BUCKET).upload(path, blob, {
      upsert: true,
      contentType: 'application/json; charset=utf-8',
    })
    return !error
  } catch {
    return false
  }
}

/** 刪除 reports bucket 中資料日早於 cutoff 的整個 {ymd}/ 目錄 */
async function pruneStorage(cutoffYmd: string): Promise<void> {
  try {
    const { data: entries } = await db.storage.from(REPORTS_BUCKET).list('', { limit: 1000 })
    for (const e of entries ?? []) {
      if (!/^\d{8}$/.test(e.name) || e.name >= cutoffYmd) continue
      const { data: files } = await db.storage.from(REPORTS_BUCKET).list(e.name, { limit: 1000 })
      const paths = (files ?? []).map((f) => `${e.name}/${f.name}`)
      if (paths.length > 0) await db.storage.from(REPORTS_BUCKET).remove(paths)
    }
  } catch {
    // 清理失敗不影響主流程
  }
}

async function pruneChipCache(cutoffYmd: string): Promise<void> {
  try {
    await db.from('chip_raw_cache').delete().lt('ymd', cutoffYmd)
  } catch {
    // 清理失敗不影響主流程
  }
}

async function handleGenerateAll(): Promise<Response> {
  const tickers = await heldTwTickers()
  const series = await loadSeries(
    tickers.map((t) => t.ticker),
    new Date(),
  )
  const { marginFallbackRows, sblRows } = await loadLatestOnlySources(
    series.dataYmd,
    series.marginDatedFailed || series.days.length === 0,
  )

  let generated = 0
  for (const { ticker, name } of tickers) {
    const data = assembleOne({ ticker, name, holding: null, series, marginFallbackRows, sblRows })
    const okUp = await uploadJson(`${series.dataYmd}/${ticker}.json`, {
      ticker,
      dataDate: data.dataDate,
      generatedAt: data.generatedAt,
      data,
    })
    if (okUp) generated++
  }

  // 讓前端知道「最近一份」是哪個交易日，免在前端重算交易日
  await uploadJson('manifest.json', {
    ymd: series.dataYmd,
    dataDate: dashDate(series.dataYmd),
    generatedAt: new Date().toISOString(),
  })

  // 清掉過期的報告與原始檔快取；兩者保留期不同，原因見常數定義處
  await pruneStorage(ymdMinusDays(series.dataYmd, REPORT_RETAIN_DAYS))
  await pruneChipCache(ymdMinusDays(series.dataYmd, CACHE_RETAIN_DAYS))

  return json({
    ok: true,
    ymd: series.dataYmd,
    generated,
    total: tickers.length,
    historyDays: series.days.length,
  })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS })
  }
  if (req.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405)
  }

  let body: GenerateReportRequestBody
  try {
    body = await req.json()
  } catch {
    return json({ error: 'Invalid JSON body' }, 400)
  }

  if (body.action === 'generate') {
    return handleGenerate(body)
  }

  if (body.action === 'generate-all') {
    const denied = assertCronSecret(req)
    if (denied) return denied
    return handleGenerateAll()
  }

  return json({ error: 'Unknown action' }, 400)
})
