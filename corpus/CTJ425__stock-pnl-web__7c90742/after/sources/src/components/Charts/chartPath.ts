/**
 * SVG 路徑組裝的共用純函式。
 *
 * 為什麼獨立成一個檔而不是放在 chartFrame.tsx：那個檔匯出元件，
 * 從元件檔一併匯出非元件會觸發 react(only-export-components) —— Fast Refresh 會整檔重載。
 */
import type { PlotGeometry } from './chartFrame'

/**
 * 把連續有值的區段切成多條折線的 points 字串（遇 null 斷開、不內插）。
 * 折線圖、均線疊圖、KD 圖三處共用 —— 各寫一份必然會在「缺資料要不要連起來」上走鐘。
 */
export function lineSegments(values: Array<number | null>, geo: PlotGeometry): string[] {
  const out: string[] = []
  let current: string[] = []
  values.forEach((v, i) => {
    if (v === null || v === undefined) {
      if (current.length > 1) out.push(current.join(' '))
      current = []
      return
    }
    current.push(`${geo.bandCenter(i).toFixed(2)},${geo.y(v).toFixed(2)}`)
  })
  if (current.length > 1) out.push(current.join(' '))
  return out
}
