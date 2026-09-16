/**
 * 技術指標：純函式、無 DOM 依賴，便於單元測試。
 *
 * 為什麼要自己算而不是丟給別的東西算：0.6.0 的 AI 助理會吃這裡的輸出。
 * 語言模型從 244 筆原始收盤價心算 MA60 或 KD 必定出錯，而錯的數字包在流暢的中文裡最難察覺。
 * 指標一律由程式算好、模型只負責解讀 —— 所以這個檔的正確性是整條功能的地基。
 *
 * 共同規則（三個都很容易寫錯，故明列）：
 * 1. **輸出與輸入等長**。暖身期不足的前段為 `null`，圖表據此斷線不內插。
 * 2. **null 不當成 0**。任何一根為 null 時該根輸出 null，且不更新遞迴狀態
 *    —— 把缺漏當成 0 會讓均線瞬間崩到接近零，那比沒有畫還糟。
 * 3. **期間切換只裁切顯示範圍**。指標必須以完整序列計算後再裁切，
 *    否則切到「近 3 月」時 MA60 會整條變成 null。
 */

/** 單根 K 棒（僅指標計算需要的欄位） */
export interface Bar {
  high: number
  low: number
  close: number
}

type Series = Array<number | null>

/** 簡單移動平均。視窗內含 null 即該根為 null */
export function sma(values: Series, period: number): Series {
  const out: Series = new Array(values.length).fill(null)
  if (period <= 0) return out
  for (let i = period - 1; i < values.length; i++) {
    let sum = 0
    let ok = true
    for (let k = i - period + 1; k <= i; k++) {
      const v = values[k]
      if (v === null) {
        ok = false
        break
      }
      sum += v
    }
    if (ok) out[i] = sum / period
  }
  return out
}

/**
 * 指數移動平均。以前 period 筆的簡單平均作為種子（與主流看盤軟體一致），
 * 之後才進遞迴 —— 直接拿第一筆當種子會讓前段數十根偏離。
 */
export function ema(values: Series, period: number): Series {
  const out: Series = new Array(values.length).fill(null)
  if (period <= 0) return out
  const k = 2 / (period + 1)
  let prev: number | null = null
  let seedSum = 0
  let seedCount = 0

  for (let i = 0; i < values.length; i++) {
    const v = values[i]
    if (v === null) continue // 狀態不動，該根留 null
    if (prev === null) {
      seedSum += v
      seedCount++
      if (seedCount === period) {
        prev = seedSum / period
        out[i] = prev
      }
      continue
    }
    prev = v * k + prev * (1 - k)
    out[i] = prev
  }
  return out
}

export interface MacdResult {
  /** 快線（DIF）＝ EMA(fast) − EMA(slow) */
  dif: Series
  /** 慢線（DEA / MACD 線）＝ DIF 的 EMA(signal) */
  dea: Series
  /** 柱狀體（OSC）＝ DIF − DEA */
  hist: Series
}

/** MACD(12, 26, 9)。柱狀體採國際慣例的 DIF − DEA，不乘 2 */
export function macd(closes: Series, fast = 12, slow = 26, signal = 9): MacdResult {
  const fastEma = ema(closes, fast)
  const slowEma = ema(closes, slow)
  const dif: Series = closes.map((_, i) => {
    const f = fastEma[i]
    const s = slowEma[i]
    return f === null || s === null ? null : f - s
  })
  const dea = ema(dif, signal)
  const hist: Series = dif.map((d, i) => {
    const e = dea[i]
    return d === null || e === null ? null : d - e
  })
  return { dif, dea, hist }
}

export interface KdResult {
  k: Series
  d: Series
}

/**
 * KD 隨機指標（台股慣用 9,3,3）。
 *
 * RSV = (收盤 − n 日最低) / (n 日最高 − n 日最低) × 100
 * K = 前一日 K × 2/3 + RSV × 1/3；D = 前一日 D × 2/3 + K × 1/3，K/D 初值皆為 50。
 *
 * n 日內最高等於最低（整段沒波動，如連續跌停鎖死）時 RSV 取 50 ——
 * 分母為零不能當作 0 或 100，那會憑空造出超賣 / 超買訊號。
 */
export function kd(bars: Array<Bar | null>, period = 9, kSmooth = 3, dSmooth = 3): KdResult {
  const k: Series = new Array(bars.length).fill(null)
  const d: Series = new Array(bars.length).fill(null)
  let prevK = 50
  let prevD = 50

  for (let i = 0; i < bars.length; i++) {
    if (i < period - 1) continue
    const window = bars.slice(i - period + 1, i + 1)
    if (window.some((b) => b === null)) continue
    const w = window as Bar[]
    const high = Math.max(...w.map((b) => b.high))
    const low = Math.min(...w.map((b) => b.low))
    const close = w[w.length - 1].close
    const rsv = high === low ? 50 : ((close - low) / (high - low)) * 100

    prevK = prevK * ((kSmooth - 1) / kSmooth) + rsv / kSmooth
    prevD = prevD * ((dSmooth - 1) / dSmooth) + prevK / dSmooth
    k[i] = prevK
    d[i] = prevD
  }
  return { k, d }
}

/**
 * RSI（Wilder 平滑，預設 14）。
 * 前 period 根的漲跌幅先取簡單平均當種子，之後 avg = (前值 × (n−1) + 本次) / n。
 * 平均跌幅為 0 時回 100（不是除以零）。
 */
export function rsi(closes: Series, period = 14): Series {
  const out: Series = new Array(closes.length).fill(null)
  if (period <= 0) return out

  let avgGain: number | null = null
  let avgLoss = 0
  let seedGain = 0
  let seedLoss = 0
  let seedCount = 0

  for (let i = 1; i < closes.length; i++) {
    const cur = closes[i]
    const prev = closes[i - 1]
    if (cur === null || prev === null) continue
    const diff = cur - prev
    const gain = diff > 0 ? diff : 0
    const loss = diff < 0 ? -diff : 0

    if (avgGain === null) {
      seedGain += gain
      seedLoss += loss
      seedCount++
      if (seedCount === period) {
        avgGain = seedGain / period
        avgLoss = seedLoss / period
        out[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss)
      }
      continue
    }
    avgGain = (avgGain * (period - 1) + gain) / period
    avgLoss = (avgLoss * (period - 1) + loss) / period
    out[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss)
  }
  return out
}

/** 均線排列狀態；任一條缺值時回 null（不猜） */
export function maAlignment(
  short: number | null,
  mid: number | null,
  long: number | null,
): '多頭排列' | '空頭排列' | '糾結' | null {
  if (short === null || mid === null || long === null) return null
  if (short > mid && mid > long) return '多頭排列'
  if (short < mid && mid < long) return '空頭排列'
  return '糾結'
}

/** 取序列中最後一個非 null 值；全空回 null */
export function lastValue(series: Series): number | null {
  for (let i = series.length - 1; i >= 0; i--) {
    if (series[i] !== null) return series[i]
  }
  return null
}
