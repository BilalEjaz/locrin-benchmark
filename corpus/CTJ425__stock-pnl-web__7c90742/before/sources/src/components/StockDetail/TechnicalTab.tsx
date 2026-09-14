/**
 * 技術面分頁（佔位）。
 * 日線 / 週線 / 季線需要 ≥60 個交易日的收盤價，而 chip_raw_cache 只留 7 天，
 * 必須另立 price_daily 儲存（見 docs/agent/PLAN.md §G）。版面先留好，接上時不必再動。
 */
import { LineChart } from 'lucide-react'

export function TechnicalTab() {
  return (
    <section className="rpt-section">
      <h3>技術面</h3>
      <div className="empty-state">
        <div className="empty-icon">
          <LineChart size={32} />
        </div>
        <div>日線、週線、季線還在開發中。</div>
        <div className="hint" style={{ marginTop: 6 }}>
          這些線要用到過去好幾個月的收盤價，目前系統只留最近 7 天的資料，
          等歷史股價存好之後就會出現在這裡。
        </div>
      </div>
    </section>
  )
}
