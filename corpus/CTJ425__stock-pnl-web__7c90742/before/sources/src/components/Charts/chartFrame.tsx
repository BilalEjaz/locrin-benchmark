/**
 * 圖表外框：Y 軸格線與刻度、X 軸標籤、hover 命中區與 tooltip。
 * 各圖表只負責畫「標記」（長條 / 折線），座標由 geo 提供。
 *
 * 兩個受 PDF 擷取限制而來的設計決定：
 * 1. viewBox 寬度＝實測容器寬度（1:1，不縮放）。用固定 viewBox 等比縮放雖然免去量測，
 *    但字級會跟著容器放大縮小 —— 寬螢幕上刻度變兩倍大、手機上又小到看不清。
 * 2. 字級與顏色一律寫成 SVG 屬性，不靠 CSS。html2canvas 會把 inline SVG 序列化成圖片，
 *    外部樣式表與祖先層的 CSS 變數都解析不到，PDF 會變成一團黑色巨大文字。
 */
import { useEffect, useId, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { CHART_COLORS } from './chartColors'
import { domainTicks, fmtAxisNumber, scaleY, tickStep, type Domain } from './chartScale'

const PAD = { left: 58, right: 12, top: 10, bottom: 24 }
/** 尚未量到寬度（首次 render / 無 ResizeObserver 的測試環境）時的預設值 */
const FALLBACK_W = 560
const MIN_W = 240
const FONT_SIZE = 11

/** 量測容器寬度，讓 SVG 以 1:1 繪製 */
function useMeasuredWidth() {
  const ref = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(FALLBACK_W)
  useEffect(() => {
    const el = ref.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const update = () => setWidth(Math.max(Math.round(el.clientWidth), MIN_W))
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return { ref, width }
}

export interface PlotGeometry {
  innerW: number
  innerH: number
  count: number
  bandWidth: number
  /** 第 i 個資料點的中心 x（繪圖區座標） */
  bandCenter: (i: number) => number
  /** 數值 → 繪圖區 y 座標 */
  y: (v: number) => number
  /** 目前 hover 的索引（無則 null），供標記做高亮 */
  hover: number | null
}

interface ChartFrameProps {
  height: number
  domain: Domain
  /** X 軸標籤，長度即資料點數 */
  labels: string[]
  ariaLabel: string
  /** 回傳該點的 tooltip 文字；回 null 表示該點不顯示 */
  tooltipFor?: (index: number) => string | null
  children: (geo: PlotGeometry) => ReactNode
}

export function ChartFrame({
  height,
  domain,
  labels,
  ariaLabel,
  tooltipFor,
  children,
}: ChartFrameProps) {
  const [hover, setHover] = useState<number | null>(null)
  const { ref: wrapRef, width: viewW } = useMeasuredWidth()
  const titleId = useId()

  const innerW = viewW - PAD.left - PAD.right
  const innerH = height - PAD.top - PAD.bottom
  const count = Math.max(labels.length, 1)
  const bandWidth = innerW / count
  const geo: PlotGeometry = {
    innerW,
    innerH,
    count,
    bandWidth,
    bandCenter: (i) => bandWidth * (i + 0.5),
    y: (v) => scaleY(v, domain, innerH),
    hover,
  }

  const ticks = domainTicks(domain)
  const step = tickStep(domain)
  const tipText = hover === null ? null : (tooltipFor?.(hover) ?? null)
  // 以百分比定位 tooltip，免在 React state 裡再存一份像素座標
  const tipLeft = hover === null ? 0 : ((PAD.left + geo.bandCenter(hover)) / viewW) * 100
  const tipTop = (PAD.top / height) * 100

  return (
    <div className="chart-wrap" ref={wrapRef}>
      <svg
        className="chart-svg"
        viewBox={`0 0 ${viewW} ${height}`}
        width={viewW}
        height={height}
        role="img"
        aria-labelledby={titleId}
        onMouseLeave={() => setHover(null)}
      >
        <title id={titleId}>{ariaLabel}</title>
        <g transform={`translate(${PAD.left}, ${PAD.top})`}>
          {ticks.map((t) => (
            <g key={t}>
              <line
                x1={0}
                x2={innerW}
                y1={geo.y(t)}
                y2={geo.y(t)}
                stroke={t === 0 ? CHART_COLORS.zero : CHART_COLORS.grid}
                strokeWidth={t === 0 ? 1.2 : 1}
              />
              <text
                x={-8}
                y={geo.y(t) + FONT_SIZE / 3}
                textAnchor="end"
                fontSize={FONT_SIZE}
                fill={CHART_COLORS.axis}
              >
                {fmtAxisNumber(t, step)}
              </text>
            </g>
          ))}

          {children(geo)}

          {labels.map((label, i) => (
            <text
              key={`${label}-${i}`}
              x={geo.bandCenter(i)}
              y={innerH + FONT_SIZE + 4}
              textAnchor="middle"
              fontSize={FONT_SIZE}
              fill={CHART_COLORS.axis}
            >
              {label}
            </text>
          ))}

          {/* 透明命中區：整欄可 hover，比細長條好點；tabIndex 讓鍵盤也能讀到數值 */}
          {labels.map((label, i) => (
            <rect
              key={`hit-${label}-${i}`}
              x={bandWidth * i}
              y={0}
              width={bandWidth}
              height={innerH}
              fill="transparent"
              tabIndex={0}
              onMouseEnter={() => setHover(i)}
              onFocus={() => setHover(i)}
              onBlur={() => setHover(null)}
            />
          ))}
        </g>
      </svg>

      {tipText && (
        <div className="chart-tip" style={{ left: `${tipLeft}%`, top: `${tipTop}%` }} role="status">
          {tipText}
        </div>
      )}
    </div>
  )
}
