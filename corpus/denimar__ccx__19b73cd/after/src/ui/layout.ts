/**
 * Every measurement the panel makes, as pure functions.
 *
 * The panel lives in a kitty split (`--bias 36`), so its real width is roughly
 * 46–80 columns. Keeping the arithmetic here — instead of inline in the render
 * — is what makes the breakpoints testable without a terminal.
 */

/** Chrome that is always on screen: title, scope chain, blank, rule, inspector×2, keys. */
export const CHROME = 8
export const MIN_LIST = 3
/** Reserved even when nothing overflows, so the name column never jumps width. */
export const SCROLLBAR_W = 1
/** cursor marker + its space */
export const GUTTER = 2

export interface Metrics {
  columns: number
  listHeight: number
  nameW: number
  stateW: number
  showState: boolean
  /** wide enough for `70 · ▲4`; below this a section shows its count alone */
  showSummary: boolean
}

export function metrics(columns: number, rows: number, opts: { alert?: boolean } = {}): Metrics {
  const listHeight = Math.max(MIN_LIST, rows - CHROME - (opts.alert ? 1 : 0))
  // under 30 columns the name is all that fits; above that the state word gets
  // just enough room for `broken`, `6L 291b`, `35 plugin`
  const stateW = columns < 30 ? 0 : columns < 46 ? 8 : columns < 56 ? 9 : columns < 72 ? 12 : 15
  const gap = stateW ? 2 : 0
  const nameW = Math.max(8, columns - GUTTER - gap - stateW - SCROLLBAR_W)
  return { columns, listHeight, nameW, stateW, showState: stateW > 0, showSummary: stateW >= 12 }
}

/**
 * Airy by default, dense under pressure: the blank line before each section is
 * dropped when — and only when — dropping it lets everything fit on screen.
 */
export function densify<T extends { kind: string }>(rows: T[], listHeight: number): T[] {
  if (rows.length <= listHeight) return rows
  const solid = rows.filter((r) => r.kind !== 'spacer')
  return solid.length <= listHeight ? solid : rows
}

/** Top index of the scroll window, keeping the cursor centred where possible. */
export function windowStart(total: number, height: number, cursor: number): number {
  if (total <= height) return 0
  return Math.max(0, Math.min(cursor - Math.floor(height / 2), total - height))
}

/** Inclusive thumb range in row units, or null when nothing overflows. */
export function thumb(total: number, height: number, start: number): { from: number; to: number } | null {
  if (total <= height || height <= 0) return null
  const size = Math.max(1, Math.round((height / total) * height))
  const maxStart = total - height
  const from = maxStart <= 0 ? 0 : Math.round((start / maxStart) * (height - size))
  return { from, to: from + size - 1 }
}

export function fit(s: string, w: number): string {
  if (w <= 0) return ''
  return s.length <= w ? s : `${s.slice(0, Math.max(0, w - 1))}…`
}

/** Paths lose their meaning from the middle, never from the end. */
export function truncMiddle(s: string, w: number): string {
  if (w <= 0) return ''
  if (s.length <= w) return s
  if (w <= 3) return s.slice(0, w)
  const head = Math.ceil((w - 1) / 2)
  const tail = w - 1 - head
  return `${s.slice(0, head)}…${tail ? s.slice(-tail) : ''}`
}
