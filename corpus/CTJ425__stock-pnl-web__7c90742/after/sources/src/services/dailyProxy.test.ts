import { describe, it, expect, vi, beforeEach } from 'vitest'

const { storageDownload } = vi.hoisted(() => ({ storageDownload: vi.fn() }))
vi.mock('./supabase', () => ({
  isSupabaseConfigured: true,
  supabase: { storage: { from: () => ({ download: storageDownload }) } },
}))

import { fetchDailySeries } from './dailyProxy'

const blobOf = (obj: unknown) => ({ data: new Blob([JSON.stringify(obj)]), error: null })
const notFound = { data: null, error: { message: 'Not found' } }

const file = {
  schema: 1,
  ticker: '2330',
  asOf: '2026-07-27T09:31:00.000Z',
  lastDate: '2026-07-24',
  rows: [
    ['2026-07-23', 2385, 2405, 2370, 2405, 23190117],
    ['2026-07-24', 2355, 2365, 2345, 2350, 21646770],
  ],
}

describe('fetchDailySeries', () => {
  beforeEach(() => storageDownload.mockReset())

  it('命中：讀 daily/{ticker}.json', async () => {
    storageDownload.mockImplementation((path: string) =>
      Promise.resolve(path === 'daily/2330.json' ? blobOf(file) : notFound),
    )
    const s = await fetchDailySeries('2330')
    expect(s?.lastDate).toBe('2026-07-24')
    expect(s?.rows).toHaveLength(2)
    expect(s?.rows[1]).toEqual(['2026-07-24', 2355, 2365, 2345, 2350, 21646770])
  })

  it('查無檔案 → null（批次尚未跑過）', async () => {
    storageDownload.mockResolvedValue(notFound)
    expect(await fetchDailySeries('2330')).toBeNull()
  })

  it('接受比前端已知版本更新的 schema —— 後端加欄位不該讓技術面整個失效', async () => {
    // 釘住 0.4.0 的線上事故：那次是後端升到 schema 3、前端還鎖 === 2，籌碼分頁全掛。
    // 同一個錯誤不可以在日線上重演，故此處以測試把 `>=` 的行為固定住。
    storageDownload.mockResolvedValue(blobOf({ ...file, schema: 3, extraField: 'x' }))
    expect((await fetchDailySeries('2330'))?.rows).toHaveLength(2)

    storageDownload.mockResolvedValue(blobOf({ ...file, schema: 99 }))
    expect((await fetchDailySeries('2330'))?.rows).toHaveLength(2)
  })

  it('schema 低於下限 → null', async () => {
    storageDownload.mockResolvedValue(blobOf({ ...file, schema: 0 }))
    expect(await fetchDailySeries('2330')).toBeNull()
  })

  it('丟棄結構壞掉的列；全壞則回 null', async () => {
    storageDownload.mockResolvedValue(
      blobOf({ ...file, rows: [['2026-07-24', 1, 2, 3, 4, 5], ['bad'], [1, 2, 3, 4, 5, 6]] }),
    )
    const s = await fetchDailySeries('2330')
    expect(s?.rows).toHaveLength(1)

    storageDownload.mockResolvedValue(blobOf({ ...file, rows: [['bad'], null] }))
    expect(await fetchDailySeries('2330')).toBeNull()
  })

  it('lastDate 缺漏時以最後一根的日期補上', async () => {
    const { lastDate: _omit, ...withoutLastDate } = file
    storageDownload.mockResolvedValue(blobOf(withoutLastDate))
    expect((await fetchDailySeries('2330'))?.lastDate).toBe('2026-07-24')
  })
})
