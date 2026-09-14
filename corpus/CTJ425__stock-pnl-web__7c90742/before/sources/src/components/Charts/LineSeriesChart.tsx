/**
 * 餘額走勢折線圖（單一序列）。值域不強制含 0 —— 融資餘額動輒數萬張，
 * 從 0 起算會把每日變化壓成一條直線。融資與融券量級差距大，各自畫一張、不共用 Y 軸。
 * 缺資料的日子斷線（不內插），避免看起來像真有那天的數字。
 */
import { ChartFrame } from './chartFrame'
import { CHART_COLORS } from './chartColors'
import { niceDomain } from './chartScale'
import type { PlotGeometry } from './chartFrame'

export interface LinePoint {
  label: string
  value: number | null
}

interface LineSeriesChartProps {
  points: LinePoint[]
  height?: number
  color?: string
  formatValue: (v: number) => string
  ariaLabel: string
}

/** 把連續有值的區段切成多條折線（遇 null 斷開） */
function segments(points: LinePoint[], geo: PlotGeometry): string[] {
  const out: string[] = []
  let current: string[] = []
  points.forEach((p, i) => {
    if (p.value === null) {
      if (current.length > 1) out.push(current.join(' '))
      current = []
      return
    }
    current.push(`${geo.bandCenter(i).toFixed(2)},${geo.y(p.value).toFixed(2)}`)
  })
  if (current.length > 1) out.push(current.join(' '))
  return out
}

export function LineSeriesChart({
  points,
  height = 170,
  color = CHART_COLORS.line,
  formatValue,
  ariaLabel,
}: LineSeriesChartProps) {
  const domain = niceDomain(points.map((p) => p.value))

  return (
    <ChartFrame
      height={height}
      domain={domain}
      labels={points.map((p) => p.label)}
      ariaLabel={ariaLabel}
      tooltipFor={(i) => {
        const p = points[i]
        if (!p) return null
        return `${p.label}　${p.value === null ? '無資料' : formatValue(p.value)}`
      }}
    >
      {(geo) => (
        <>
          {segments(points, geo).map((d, i) => (
            <polyline
              key={i}
              points={d}
              fill="none"
              stroke={color}
              strokeWidth={2}
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          ))}
          {points.map((p, i) =>
            p.value === null ? null : (
              <circle
                key={`${p.label}-${i}`}
                cx={geo.bandCenter(i)}
                cy={geo.y(p.value)}
                r={geo.hover === i ? 4.5 : 2.8}
                fill={color}
              />
            ),
          )}
        </>
      )}
    </ChartFrame>
  )
}
