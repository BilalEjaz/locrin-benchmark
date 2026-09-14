/**
 * 多序列折線圖（KD 這種「同一量綱、同一縱軸」的指標用）。
 *
 * 與 LineSeriesChart 分開的理由：那支是單序列、用極性色（紅正綠負）並畫資料點圓點；
 * 這支是多序列、用類別色表達身分、不畫圓點（點太密會糊成一片）。
 * 兩者的差異不是參數多寡，是顏色在圖裡做的事不一樣，硬併成一支只會兩邊都彆扭。
 *
 * 呼叫端必須另外附圖例（SPEC：兩條以上序列一律附圖例，身分不能只靠顏色）。
 */
import { ChartFrame } from './chartFrame'
import { lineSegments } from './chartPath'
import { niceDomain, type Domain } from './chartScale'

export interface LineSeries {
  name: string
  color: string
  values: Array<number | null>
}

interface MultiLineChartProps {
  labels: string[]
  series: LineSeries[]
  labelIndices?: number[]
  height?: number
  /** 指定固定值域（KD 恆在 0–100，讓它隨資料浮動反而看不出高低檔） */
  domain?: Domain
  /** 額外的水平參考線（例如 KD 的 20 / 80） */
  guides?: number[]
  formatValue: (v: number) => string
  ariaLabel: string
}

export function MultiLineChart({
  labels,
  series,
  labelIndices,
  height = 170,
  domain,
  guides = [],
  formatValue,
  ariaLabel,
}: MultiLineChartProps) {
  const resolved = domain ?? niceDomain(series.flatMap((s) => s.values))

  return (
    <ChartFrame
      height={height}
      domain={resolved}
      labels={labels}
      labelIndices={labelIndices}
      ariaLabel={ariaLabel}
      tooltipFor={(i) => {
        if (!labels[i]) return null
        const parts = series.map((s) => {
          const v = s.values[i]
          return `${s.name} ${v === null || v === undefined ? '無資料' : formatValue(v)}`
        })
        return `${labels[i]}｜${parts.join('　')}`
      }}
    >
      {(geo) => (
        <>
          {guides.map((g) => (
            <line
              key={g}
              x1={0}
              x2={geo.innerW}
              y1={geo.y(g)}
              y2={geo.y(g)}
              stroke="rgba(138, 148, 163, 0.45)"
              strokeWidth={1}
              strokeDasharray="3 3"
            />
          ))}
          {series.map((s) =>
            lineSegments(s.values, geo).map((d, i) => (
              <polyline
                key={`${s.name}-${i}`}
                points={d}
                fill="none"
                stroke={s.color}
                strokeWidth={1.5}
                strokeLinejoin="round"
                strokeLinecap="round"
              />
            )),
          )}
        </>
      )}
    </ChartFrame>
  )
}
