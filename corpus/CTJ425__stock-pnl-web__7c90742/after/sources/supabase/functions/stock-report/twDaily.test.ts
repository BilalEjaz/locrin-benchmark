import { describe, it, expect } from 'vitest'
import {
  dailyUrl,
  extractDaily,
  tradingDateOf,
  yahooDailySymbols,
  type ChartResponse,
} from './twDaily.ts'

/**
 * fixture 的數值取自 2026-07-27 對 query1.finance.yahoo.com 的實際回應（2330.TW，range=1y）。
 * 特別保留索引 6 那一格：實測回應中 2025-08-01 的五個欄位全是 null，
 * 這是解析必須擋掉的真實情況，不是假想的邊界。
 */
const REAL: ChartResponse = {
  chart: {
    result: [
      {
        meta: { gmtoffset: 28800, symbol: '2330.TW' },
        timestamp: [1753318800, 1753405200, 1753923600, 1754010000, 1754269200, 1784854800],
        indicators: {
          quote: [
            {
              open: [1150, 1150, 1160, null, 1130, 2355],
              high: [1155, 1155, 1165, null, 1135, 2365],
              low: [1145, 1140, 1155, null, 1125, 2345],
              close: [1145, 1145, 1160, null, 1135, 2350],
              volume: [15055463, 22476546, 33230751, null, 23939021, 21646770],
            },
          ],
        },
      },
    ],
  },
}

describe('tradingDateOf', () => {
  it('以 gmtoffset 換算成當地交易日', () => {
    // 台股 09:00 開盤 = 01:00Z，加 8 小時後才是當地日期
    expect(tradingDateOf(1753318800, 28800)).toBe('2025-07-24')
    expect(tradingDateOf(1784854800, 28800)).toBe('2026-07-24')
  })

  it('不套用位移時會落到前一天 —— 證明 gmtoffset 不是可省略的裝飾', () => {
    // 這個案例是刻意留下的反證：若實作直接對原始 timestamp 取 UTC 日期，
    // 在 UTC+9 以上的時區就會整條序列偏一天。
    // 2026-07-24T16:00:00Z：套 +9h 就會跨到隔天，不套則否
    expect(tradingDateOf(1784908800, 0)).toBe('2026-07-24')
    expect(tradingDateOf(1784908800, 32400)).toBe('2026-07-25')
  })
})

describe('extractDaily', () => {
  it('抽出日線並丟棄無資料的交易日', () => {
    const rows = extractDaily(REAL)
    // 6 格輸入、1 格全 null → 5 根
    expect(rows).toHaveLength(5)
    expect(rows.map((r) => r[0])).toEqual([
      '2025-07-24',
      '2025-07-25',
      '2025-07-31',
      '2025-08-04',
      '2026-07-24',
    ])
    expect(rows[0]).toEqual(['2025-07-24', 1150, 1155, 1145, 1145, 15055463])
    expect(rows[4]).toEqual(['2026-07-24', 2355, 2365, 2345, 2350, 21646770])
  })

  it('由舊到新', () => {
    const dates = extractDaily(REAL).map((r) => r[0])
    expect([...dates].sort()).toEqual(dates)
  })

  it('成交量缺漏但有價格時以 0 補，不丟棄該根', () => {
    const rows = extractDaily({
      chart: {
        result: [
          {
            meta: { gmtoffset: 28800 },
            timestamp: [1753318800],
            indicators: {
              quote: [{ open: [10], high: [11], low: [9], close: [10], volume: [null] }],
            },
          },
        ],
      },
    })
    expect(rows).toEqual([['2025-07-24', 10, 11, 9, 10, 0]])
  })

  it('缺開高低任一項時丟棄該根（畫不出蠟燭）', () => {
    const rows = extractDaily({
      chart: {
        result: [
          {
            meta: { gmtoffset: 28800 },
            timestamp: [1753318800],
            indicators: {
              quote: [{ open: [null], high: [11], low: [9], close: [10], volume: [100] }],
            },
          },
        ],
      },
    })
    expect(rows).toEqual([])
  })

  it('結構不符 / 查無資料回空陣列（呼叫端據此改試 .TWO）', () => {
    expect(extractDaily({})).toEqual([])
    expect(extractDaily({ chart: { result: null } })).toEqual([])
    expect(extractDaily({ chart: { result: [{ meta: { gmtoffset: 28800 } }] } })).toEqual([])
  })
})

describe('dailyUrl / yahooDailySymbols', () => {
  it('一次取一年日線', () => {
    expect(dailyUrl('2330.TW')).toBe(
      'https://query1.finance.yahoo.com/v8/finance/chart/2330.TW?interval=1d&range=1y',
    )
  })

  it('上市優先、上櫃備援', () => {
    expect(yahooDailySymbols('2330')).toEqual(['2330.TW', '2330.TWO'])
  })
})
