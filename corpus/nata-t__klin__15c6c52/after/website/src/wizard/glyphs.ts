/**
 * Draws one terminal cell's glyph on a 2D canvas. Block elements and
 * box-drawing characters are drawn as geometry, so the KLIN logo and the
 * wizard's frames join seamlessly whatever fonts the visitor has; anything
 * else is plain text.
 */

export const FONT_STACK = '"Geist Mono Variable", "DejaVu Sans Mono", ui-monospace, SFMono-Regular, Menlo, monospace'

type Segment = "h" | "v" | "tl" | "tr" | "bl" | "br"

// Light/heavy/dashed lines: which half-lines from the center the glyph has (l, r, u, d).
const LINES: Record<string, { l?: 1; r?: 1; u?: 1; d?: 1; heavy?: 1; dash?: number; arc?: Segment }> = {
  "─": { l: 1, r: 1 },
  "│": { u: 1, d: 1 },
  "━": { l: 1, r: 1, heavy: 1 },
  "┃": { u: 1, d: 1, heavy: 1 },
  "┄": { l: 1, r: 1, dash: 3 },
  "┈": { l: 1, r: 1, dash: 4 },
  "╌": { l: 1, r: 1, dash: 2 },
  "┆": { u: 1, d: 1, dash: 3 },
  "┊": { u: 1, d: 1, dash: 4 },
  "╎": { u: 1, d: 1, dash: 2 },
  "┌": { r: 1, d: 1 },
  "┐": { l: 1, d: 1 },
  "└": { r: 1, u: 1 },
  "┘": { l: 1, u: 1 },
  "├": { u: 1, d: 1, r: 1 },
  "┤": { u: 1, d: 1, l: 1 },
  "┬": { l: 1, r: 1, d: 1 },
  "┴": { l: 1, r: 1, u: 1 },
  "┼": { l: 1, r: 1, u: 1, d: 1 },
  "┏": { r: 1, d: 1, heavy: 1 },
  "┓": { l: 1, d: 1, heavy: 1 },
  "┗": { r: 1, u: 1, heavy: 1 },
  "┛": { l: 1, u: 1, heavy: 1 },
  "╭": { arc: "tl" },
  "╮": { arc: "tr" },
  "╰": { arc: "bl" },
  "╯": { arc: "br" },
}

// Double lines: which sides connect (l, r, u, d).
const DOUBLE: Record<string, { l?: 1; r?: 1; u?: 1; d?: 1 }> = {
  "═": { l: 1, r: 1 },
  "║": { u: 1, d: 1 },
  "╔": { r: 1, d: 1 },
  "╗": { l: 1, d: 1 },
  "╚": { r: 1, u: 1 },
  "╝": { l: 1, u: 1 },
}

export function isGeometric(ch: string) {
  return ch in LINES || ch in DOUBLE || "█▀▄▌▐░▒▓".includes(ch)
}

/**
 * `x`, `y`, `w`, `h` in device pixels. `scale` is the device pixel ratio
 * (line thickness follows it). Returns false when the glyph isn't one of the
 * drawn ones and should be rendered as text.
 */
export function drawGeometric(ctx: CanvasRenderingContext2D, ch: string, x: number, y: number, w: number, h: number, color: string, scale = 1) {
  ctx.fillStyle = color
  ctx.strokeStyle = color
  switch (ch) {
    case "█":
      ctx.fillRect(x, y, Math.ceil(w), Math.ceil(h))
      return true
    case "▀":
      ctx.fillRect(x, y, Math.ceil(w), Math.ceil(h / 2))
      return true
    case "▄":
      ctx.fillRect(x, y + Math.floor(h / 2), Math.ceil(w), Math.ceil(h / 2))
      return true
    case "▌":
      ctx.fillRect(x, y, Math.ceil(w / 2), Math.ceil(h))
      return true
    case "▐":
      ctx.fillRect(x + Math.floor(w / 2), y, Math.ceil(w / 2), Math.ceil(h))
      return true
    case "░":
    case "▒":
    case "▓": {
      const alpha = ch === "░" ? 0.25 : ch === "▒" ? 0.5 : 0.75
      ctx.globalAlpha *= alpha
      ctx.fillRect(x, y, Math.ceil(w), Math.ceil(h))
      ctx.globalAlpha /= alpha
      return true
    }
  }

  const t = Math.max(1, Math.round(scale * Math.max(1, w / 9)))
  const cx = Math.round(x + w / 2 - t / 2)
  const cy = Math.round(y + h / 2 - t / 2)

  const line = LINES[ch]
  if (line) {
    const thick = line.heavy ? t * 2 : t
    const ox = Math.round(x + w / 2 - thick / 2)
    const oy = Math.round(y + h / 2 - thick / 2)
    if (line.arc) {
      const r = Math.min(w, h) / 2
      ctx.lineWidth = t
      ctx.beginPath()
      const mx = x + w / 2
      const my = y + h / 2
      if (line.arc === "tl") {
        ctx.moveTo(mx, y + h)
        ctx.lineTo(mx, my + r)
        ctx.arcTo(mx, my, mx + r, my, r)
        ctx.lineTo(x + w, my)
      } else if (line.arc === "tr") {
        ctx.moveTo(x, my)
        ctx.lineTo(mx - r, my)
        ctx.arcTo(mx, my, mx, my + r, r)
        ctx.lineTo(mx, y + h)
      } else if (line.arc === "bl") {
        ctx.moveTo(mx, y)
        ctx.lineTo(mx, my - r)
        ctx.arcTo(mx, my, mx + r, my, r)
        ctx.lineTo(x + w, my)
      } else {
        ctx.moveTo(x, my)
        ctx.lineTo(mx - r, my)
        ctx.arcTo(mx, my, mx, my - r, r)
        ctx.lineTo(mx, y)
      }
      ctx.stroke()
      return true
    }
    if (line.dash) {
      const n = line.dash
      if (line.l) {
        const seg = w / n
        for (let i = 0; i < n; i++) ctx.fillRect(Math.round(x + i * seg + seg * 0.15), oy, Math.max(1, Math.round(seg * 0.6)), thick)
      } else {
        const seg = h / n
        for (let i = 0; i < n; i++) ctx.fillRect(ox, Math.round(y + i * seg + seg * 0.15), thick, Math.max(1, Math.round(seg * 0.6)))
      }
      return true
    }
    if (line.l) ctx.fillRect(Math.floor(x), oy, Math.ceil(ox + thick - x), thick)
    if (line.r) ctx.fillRect(ox, oy, Math.ceil(x + w - ox), thick)
    if (line.u) ctx.fillRect(ox, Math.floor(y), thick, Math.ceil(oy + thick - y))
    if (line.d) ctx.fillRect(ox, oy, thick, Math.ceil(y + h - oy))
    return true
  }

  const double = DOUBLE[ch]
  if (double) {
    // Two strokes `gap` apart, centered on the cell's middle lines.
    const gap = Math.max(t * 2, Math.round(w / 4))
    const a = cx - Math.round(gap / 2)
    const b = a + gap
    const p = cy - Math.round(gap / 2)
    const q = p + gap
    const left = Math.floor(x)
    const right = Math.ceil(x + w)
    const top = Math.floor(y)
    const bottom = Math.ceil(y + h)
    if (double.l && double.r) {
      ctx.fillRect(left, p, right - left, t)
      ctx.fillRect(left, q, right - left, t)
    } else if (double.u && double.d) {
      ctx.fillRect(a, top, t, bottom - top)
      ctx.fillRect(b, top, t, bottom - top)
    } else {
      // Corners: the outer stroke runs to the far edges, the inner one is shorter.
      const outerX = double.r ? a : b
      const innerX = double.r ? b : a
      const outerY = double.d ? p : q
      const innerY = double.d ? q : p
      if (double.r) {
        ctx.fillRect(outerX, outerY, right - outerX, t)
        ctx.fillRect(innerX, innerY, right - innerX, t)
      } else {
        ctx.fillRect(left, outerY, outerX + t - left, t)
        ctx.fillRect(left, innerY, innerX + t - left, t)
      }
      if (double.d) {
        ctx.fillRect(outerX, outerY, t, bottom - outerY)
        ctx.fillRect(innerX, innerY, t, bottom - innerY)
      } else {
        ctx.fillRect(outerX, top, t, outerY + t - top)
        ctx.fillRect(innerX, top, t, innerY + t - top)
      }
    }
    return true
  }
  return false
}
