import { describe, it, expect } from 'vitest'
import { buildTechnicalView, pickLabelIndices } from './technicalView'
import type { DailyRow } from '../../services/dailyProxy'

/** 造 n 根遞增的日線，收盤 = 100 + i，讓期望值可以手算 */
function makeRows(n: number): DailyRow[] {
  const rows: DailyRow[] = []
  for (let i = 0; i < n; i++) {
    const day = new Date(Date.UTC(2026, 0, 1) + i * 86400000).toISOString().slice(0, 10)
    const close = 100 + i
    rows.push([day, close - 1, close + 1, close - 2, close, 1000 + i])
  }
  return rows
}

describe('buildTechnicalView', () => {
  it('指標以完整序列計算後才裁切 —— 切到近 3 月時 MA60 仍必須有值', () => {
    // 這是整個技術面最容易寫錯的地方：若先裁切再算指標，
    // 顯示 60 根時 MA60 只會在最後一根有值，前 59 根全是 null，整條線等於消失。
    const view = buildTechnicalView(makeRows(200), '3m')!
    expect(view.candles).toHaveLength(60)
    expect(view.ma60).toHaveLength(60)
    expect(view.ma60.every((v) => v !== null)).toBe(true)
    expect(view.ma20.every((v) => v !== null)).toBe(true)

    // 收盤為 100+i、共 200 根 → 最後一根 close = 299，
    // MA60 = 前 60 根（240..299）的平均 = 269.5
    expect(view.ma60[59]).toBeCloseTo(269.5, 6)
  })

  it('資料本身不足 60 根時 MA60 才會是 null', () => {
    const view = buildTechnicalView(makeRows(30), '1y')!
    expect(view.candles).toHaveLength(30)
    expect(view.ma60.every((v) => v === null)).toBe(true)
    expect(view.ma20[29]).not.toBeNull()
  })

  it('區間短於資料時只裁切顯示範圍，摘要仍取最新一根', () => {
    const rows = makeRows(200)
    const short = buildTechnicalView(rows, '3m')!
    const full = buildTechnicalView(rows, '1y')!
    expect(short.candles).toHaveLength(60)
    expect(full.candles).toHaveLength(200)
    // 摘要與顯示區間無關，兩者必須完全一致
    expect(short.latest).toEqual(full.latest)
  })

  it('摘要含漲跌與量能比', () => {
    const view = buildTechnicalView(makeRows(100), '1y')!
    expect(view.latest.close).toBe(199)
    expect(view.latest.change).toBe(1)
    expect(view.latest.changePct).toBeCloseTo(1 / 198, 8)
    expect(view.latest.alignment).toBe('多頭排列') // 一路上漲 → MA5 > MA20 > MA60
    expect(view.latest.volRatio).not.toBeNull()
  })

  it('空序列回 null', () => {
    expect(buildTechnicalView([], '1y')).toBeNull()
  })
})

describe('pickLabelIndices', () => {
  it('點數少於上限時全標', () => {
    expect(pickLabelIndices(4, 6)).toEqual([0, 1, 2, 3])
  })

  it('等距挑選且含頭尾', () => {
    const out = pickLabelIndices(244, 6)
    expect(out[0]).toBe(0)
    expect(out[out.length - 1]).toBe(243)
    expect(out).toHaveLength(6)
    // 嚴格遞增、不重複
    expect([...new Set(out)]).toEqual(out)
    expect([...out].sort((a, b) => a - b)).toEqual(out)
  })
})
