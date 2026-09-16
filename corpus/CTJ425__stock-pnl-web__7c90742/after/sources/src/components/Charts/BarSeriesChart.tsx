/**
 * 買賣超長條圖。零軸固定顯示，長條由零軸往上/往下長，值域強制含 0
 * （否則正負長條的視覺長度會失真）。
 *
 * 兩種上色模式，取決於顏色在該圖裡做什麼工作：
 * - **單一序列**：不指定 color → 紅正綠負（極性編碼，台股慣例）。
 * - **多序列**：每條序列一個類別色（身分編碼），正負改由零軸上下方向表達。
 *   顏色不能同時表達「是誰」與「正或負」，故兩者互斥。多序列時呼叫端必須附圖例。
 */
import { ChartFrame } from './chartFrame'
import { CHART_COLORS } from './chartColors'
import { niceDomain } from './chartScale'

export interface BarSeries {
  name: string
  /** 省略時走紅正綠負；多序列時必填 */
  color?: string
  values: Array<number | null>
}

interface BarSeriesChartProps {
  labels: string[]
  series: BarSeries[]
  /** 只標示這些索引的 X 軸標籤（未指定時每個都標）；日線一年 244 根時必要 */
  labelIndices?: number[]
  height?: number
  /** tooltip 的數值格式化（含單位） */
  formatValue: (v: number) => string
  ariaLabel: string
}

/** 同組內長條間留 2px 空隙，相鄰色塊才不會黏成一塊 */
const BAR_GAP = 2

export function BarSeriesChart({
  labels,
  series,
  labelIndices,
  height = 170,
  formatValue,
  ariaLabel,
}: BarSeriesChartProps) {
  const domain = niceDomain(series.flatMap((s) => s.values), { includeZero: true })
  const multi = series.length > 1

  return (
    <ChartFrame
      height={height}
      domain={domain}
      labels={labels}
      labelIndices={labelIndices}
      ariaLabel={ariaLabel}
      tooltipFor={(i) => {
        if (!labels[i]) return null
        if (!multi) {
          const v = series[0]?.values[i]
          return `${labels[i]}　${v === null || v === undefined ? '無資料' : formatValue(v)}`
        }
        // 多序列：一次列出當日各法人，省得逐條 hover 比對
        const lines = series.map((s) => {
          const v = s.values[i]
          return `${s.name} ${v === null || v === undefined ? '無資料' : formatValue(v)}`
        })
        return `${labels[i]}｜${lines.join('　')}`
      }}
    >
      {(geo) => {
        const zeroY = geo.y(0)
        // 單序列佔欄寬一半；多序列平分欄寬的八成，各留 2px 間隙
        const groupW = multi ? geo.bandWidth * 0.8 : geo.bandWidth * 0.52
        const slotW = groupW / series.length
        const barW = Math.max(multi ? slotW - BAR_GAP : slotW, 2)

        return (
          <>
            {series.map((s, si) =>
              s.values.map((value, i) => {
                if (value === null || value === undefined) return null
                const valueY = geo.y(value)
                const top = Math.min(valueY, zeroY)
                // 值為 0 時仍畫 1px，讓「有資料但為 0」與「無資料」看得出差別
                const h = Math.max(Math.abs(valueY - zeroY), 1)
                const center = geo.bandCenter(i)
                const x = multi
                  ? center - groupW / 2 + slotW * si + (slotW - barW) / 2
                  : center - barW / 2
                const fill = s.color ?? (value < 0 ? CHART_COLORS.down : CHART_COLORS.up)
                return (
                  <rect
                    key={`${s.name}-${i}`}
                    x={x}
                    y={top}
                    width={barW}
                    height={h}
                    rx={1.5}
                    fill={fill}
                    opacity={geo.hover === null || geo.hover === i ? 1 : 0.45}
                  />
                )
              }),
            )}
          </>
        )
      }}
    </ChartFrame>
  )
}
