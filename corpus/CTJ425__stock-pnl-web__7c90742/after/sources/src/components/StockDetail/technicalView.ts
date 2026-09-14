/**
 * 技術面的資料整備：由日線序列算出各指標，再裁切成要顯示的區間。
 *
 * **順序不能顛倒**：指標一律以完整序列計算後才裁切。
 * 若先裁切再算，切到「近 3 月」（60 根）時 MA60 只會在最後一根有值、KD 的遞迴也會從
 * 初值 50 重新起跑，整條線都是錯的。這是這個功能最容易寫錯的地方，故獨立成純函式並加測試。
 */
import type { DailyRow } from '../../services/dailyProxy'
import {
  kd,
  lastValue,
  macd,
  maAlignment,
  rsi,
  sma,
  type Bar,
} from '../../utils/indicators'

export type RangeKey = '3m' | '6m' | '1y'

/** 各區間顯示幾根 K 棒（**交易日**，非日曆日；台股約每月 20 個交易日） */
export const RANGE_BARS: Record<RangeKey, number> = {
  '3m': 60,
  '6m': 120,
  '1y': Number.MAX_SAFE_INTEGER,
}

export const RANGE_LABELS: Record<RangeKey, string> = {
  '3m': '近 3 月',
  '6m': '近 6 月',
  '1y': '近 1 年',
}

type Series = Array<number | null>

export interface TechnicalView {
  /** 顯示區間內的 X 軸標籤（MM/DD） */
  labels: string[]
  /** 顯示區間內的蠟燭 */
  candles: Array<{ label: string; open: number; high: number; low: number; close: number }>
  volumes: number[]
  ma5: Series
  ma20: Series
  ma60: Series
  k: Series
  d: Series
  /** X 軸要標出哪幾個索引（避免 244 根全標） */
  labelIndices: number[]
  /** 最新一根的指標摘要（取自完整序列，與顯示區間無關） */
  latest: {
    date: string
    close: number
    open: number
    high: number
    low: number
    volume: number
    /** 較前一交易日的漲跌 */
    change: number | null
    changePct: number | null
    ma5: number | null
    ma20: number | null
    ma60: number | null
    alignment: ReturnType<typeof maAlignment>
    k: number | null
    d: number | null
    rsi14: number | null
    macdHist: number | null
    /** 成交量相對 20 日均量的倍數 */
    volRatio: number | null
  }
}

/** 由 X 軸標籤挑出約 `want` 個等距索引（含頭尾） */
export function pickLabelIndices(count: number, want = 6): number[] {
  if (count <= want) return Array.from({ length: count }, (_, i) => i)
  const step = (count - 1) / (want - 1)
  const out = new Set<number>()
  for (let i = 0; i < want; i++) out.add(Math.round(i * step))
  return [...out].sort((a, b) => a - b)
}

/** YYYY-MM-DD → MM/DD */
function shortDate(date: string): string {
  return date.length >= 10 ? `${date.slice(5, 7)}/${date.slice(8, 10)}` : date
}

export function buildTechnicalView(rows: DailyRow[], range: RangeKey): TechnicalView | null {
  if (rows.length === 0) return null

  // ---- 1. 以「完整序列」算指標 ----
  const closes: Series = rows.map((r) => r[4])
  const volumes = rows.map((r) => r[5])
  const bars: Array<Bar | null> = rows.map((r) => ({ high: r[2], low: r[3], close: r[4] }))

  const ma5 = sma(closes, 5)
  const ma20 = sma(closes, 20)
  const ma60 = sma(closes, 60)
  const kdRes = kd(bars)
  const rsiRes = rsi(closes)
  const macdRes = macd(closes)
  const volMa20 = sma(volumes, 20)

  // ---- 2. 才裁切成顯示區間 ----
  const take = Math.min(RANGE_BARS[range], rows.length)
  const from = rows.length - take
  const slice = <T,>(arr: T[]): T[] => arr.slice(from)

  const viewRows = slice(rows)
  const labels = viewRows.map((r) => shortDate(r[0]))

  const lastIdx = rows.length - 1
  const last = rows[lastIdx]
  const prevClose = lastIdx > 0 ? rows[lastIdx - 1][4] : null
  const lastVolMa = lastValue(volMa20)

  return {
    labels,
    candles: viewRows.map((r) => ({
      label: shortDate(r[0]),
      open: r[1],
      high: r[2],
      low: r[3],
      close: r[4],
    })),
    volumes: slice(volumes),
    ma5: slice(ma5),
    ma20: slice(ma20),
    ma60: slice(ma60),
    k: slice(kdRes.k),
    d: slice(kdRes.d),
    labelIndices: pickLabelIndices(viewRows.length),
    latest: {
      date: last[0],
      open: last[1],
      high: last[2],
      low: last[3],
      close: last[4],
      volume: last[5],
      change: prevClose === null ? null : last[4] - prevClose,
      changePct: prevClose === null || prevClose === 0 ? null : (last[4] - prevClose) / prevClose,
      ma5: ma5[lastIdx],
      ma20: ma20[lastIdx],
      ma60: ma60[lastIdx],
      alignment: maAlignment(ma5[lastIdx], ma20[lastIdx], ma60[lastIdx]),
      k: kdRes.k[lastIdx],
      d: kdRes.d[lastIdx],
      rsi14: rsiRes[lastIdx],
      macdHist: macdRes.hist[lastIdx],
      volRatio: lastVolMa === null || lastVolMa === 0 ? null : last[5] / lastVolMa,
    },
  }
}
