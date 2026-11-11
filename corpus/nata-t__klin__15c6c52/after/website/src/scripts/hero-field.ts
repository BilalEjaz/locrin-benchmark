import { Canvas } from "@cli/ui/canvas"
import { drawLogo, logoWidth } from "@cli/ui/logo"
import { drawGeometric, FONT_STACK } from "../wizard/glyphs"

/**
 * The hero: code dust swept into the KLIN logo.
 *
 * The logo's cells come from the CLI's own drawLogo() — the same chrome
 * gradient, shadow glyphs and sparkles as the wizard's header. Each cell
 * starts out as a stray character floating in the hero. A band of light
 * crosses the logo (the CLI's intro sweep, at the same angle); as it passes,
 * every cell solidifies into its glyph and springs into place. The cursor
 * nudges cells aside, a click scatters them for another sweep, and scrolling
 * away lets them drift apart.
 */

type Kind = "face" | "shadow" | "spark"

interface Cell {
  col: number
  row: number
  glyph: string
  kind: Kind
  shade: number
  /** Where the sweep reaches it, 0..1 across the logo. */
  at: number
  x: number
  y: number
  vx: number
  vy: number
  dust: string
  swept: boolean
  sweptAt: number
  spread: [number, number]
  phase: number
}

interface Mote {
  x: number
  y: number
  vx: number
  vy: number
  text: string
  alpha: number
  size: number
  depth: number
}

const LOGO_SIZE = 6
const ROW_RATIO = 2.05
const DUST = "{}[]()<>;:=+*/|&!?#@$%~^.,_01xz".split("")
const TOKENS = ["z.object()", "createZodDto", "@Public()", "useAppForm", "prisma", "klin:if", "→", "✓", "z.infer", "betterAuth", "queryOptions", "@repo/validators", "turbo dev", "pnpm", "bun", "klin:only", "// TODO", "export", "import", "<Route />"]

const rand = (a: number, b: number) => a + Math.random() * (b - a)
const pick = <T>(list: readonly T[]) => list[Math.floor(Math.random() * list.length)]!
const clamp = (v: number, a = 0, b = 1) => Math.max(a, Math.min(b, v))
const pad = (n: number, width: number) => String(Math.round(Math.max(0, n))).padStart(width, "0")

function logoCells(): { cells: Omit<Cell, "x" | "y" | "vx" | "vy" | "dust" | "swept" | "sweptAt" | "spread" | "phase">[]; columns: number; rows: number } {
  const columns = logoWidth(LOGO_SIZE) + 2
  const art = new Canvas(columns, LOGO_SIZE)
  drawLogo(art, 0, columns, 0, LOGO_SIZE)
  const cells = []
  for (let row = 0; row < LOGO_SIZE; row++) {
    for (let col = 0; col < columns; col++) {
      const cell = art.cells[row * columns + col]!
      if (cell.ch === " " || cell.ch === "") continue
      const fg = cell.style.fg
      const shade = Array.isArray(fg) ? fg[0] : 0xc4
      const kind: Kind = cell.ch === "█" ? "face" : "✦✧·".includes(cell.ch) ? "spark" : "shadow"
      // Same band position as the CLI's sweep: across the columns, two per row.
      const at = (col + row * 2) / (columns + LOGO_SIZE * 2)
      cells.push({ col, row, glyph: cell.ch, kind, shade, at })
    }
  }
  return { cells, columns, rows: LOGO_SIZE }
}

export function mountHeroField(hero: HTMLElement) {
  const canvas = hero.querySelector<HTMLCanvasElement>("canvas.field")!
  const slot = hero.querySelector<HTMLElement>("[data-logo-slot]")!
  const countLabel = hero.querySelector<HTMLElement>("[data-hero-count]")
  const pointerLabel = hero.querySelector<HTMLElement>("[data-hero-pointer]")
  const ctx = canvas.getContext("2d")
  if (!ctx) return
  hero.dataset.field = "on"

  const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches
  const art = logoCells()
  const faces = art.cells.filter((c) => c.kind !== "spark").length

  let width = 0
  let height = 0
  let dpr = 1
  let cw = 10
  let rh = 20
  let ox = 0
  let oy = 0

  const cells: Cell[] = art.cells.map((c) => ({
    ...c,
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    dust: pick(DUST),
    swept: false,
    sweptAt: 0,
    spread: [rand(-1, 1), rand(-1, 1)],
    phase: rand(0, Math.PI * 2),
  }))
  let motes: Mote[] = []

  const pointer = { x: -9999, y: -9999, active: false }
  let sweepStart = performance.now() + 450
  const SWEEP_MS = 1150
  let visible = true
  let scroll = 0

  function layout() {
    const rect = hero.getBoundingClientRect()
    const s = slot.getBoundingClientRect()
    width = rect.width
    height = rect.height
    dpr = Math.min(2, window.devicePixelRatio || 1)
    canvas.width = Math.round(width * dpr)
    canvas.height = Math.round(height * dpr)
    cw = s.width / art.columns
    rh = cw * ROW_RATIO
    ox = s.left - rect.left + (s.width - cw * art.columns) / 2
    oy = s.top - rect.top + (s.height - rh * art.rows) / 2
    const count = Math.round(clamp((width * height) / 11000, 40, 130))
    motes = Array.from({ length: count }, () => {
      const word = Math.random() < 0.22
      const depth = rand(0.3, 1)
      return {
        x: rand(0, width),
        y: rand(0, height),
        vx: rand(0.02, 0.12) * depth,
        vy: -rand(0.04, 0.16) * depth,
        text: word ? pick(TOKENS) : pick(DUST),
        alpha: word ? rand(0.1, 0.22) : rand(0.12, 0.38),
        size: word ? 11 : rand(10, 14) * depth,
        depth,
      }
    })
  }

  function scatter(fromX = width / 2, fromY = height / 2, force = 1) {
    for (const c of cells) {
      if (!c.x && !c.y) {
        // First placement: anywhere in a wide band around the logo.
        c.x = ox + c.col * cw + rand(-1, 1) * width * 0.42
        c.y = oy + c.row * rh + rand(-0.5, 1.6) * rh * 6
      } else {
        const dx = c.x - fromX
        const dy = c.y - fromY
        const d = Math.hypot(dx, dy) || 1
        const kick = rand(9, 22) * force
        c.vx += (dx / d) * kick + rand(-3, 3)
        c.vy += (dy / d) * kick + rand(-3, 3)
      }
      c.swept = false
      c.dust = pick(DUST)
    }
  }

  const target = (c: Cell) => {
    const drift = scroll * scroll
    return {
      x: ox + c.col * cw + c.spread[0] * drift * width * 0.35,
      y: oy + c.row * rh - scroll * height * 0.18 + c.spread[1] * drift * height * 0.25,
    }
  }

  function settleAll() {
    for (const c of cells) {
      const t = target(c)
      c.x = t.x
      c.y = t.y
      c.swept = true
      c.sweptAt = -1e9
    }
  }

  const colorOf = (shade: number, alpha = 1) => `rgba(${shade},${shade},${shade},${alpha})`

  function draw(now: number) {
    ctx!.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx!.clearRect(0, 0, width, height)
    const fade = 1 - clamp(scroll * 1.2) * 0.85

    // Dust motes in the air, slow and dim.
    ctx!.textBaseline = "middle"
    for (const m of motes) {
      // Keep the text column in the middle clear, so the copy stays easy to read.
      const side = clamp(Math.abs(m.x - width / 2) / (width * 0.3))
      const clear = 0.18 + 0.82 * side * side
      ctx!.font = `400 ${m.size}px ${FONT_STACK}`
      ctx!.fillStyle = `rgba(200,200,200,${m.alpha * clear * (0.6 + 0.4 * fade)})`
      ctx!.fillText(m.text, m.x, m.y - scroll * 120 * m.depth)
    }

    // The band of light while a sweep runs.
    const band = (now - sweepStart) / SWEEP_MS
    if (band > 0 && band < 1) {
      const at = -0.3 + band * 1.6
      const bx = ox + at * art.columns * cw
      const gradient = ctx!.createLinearGradient(bx - cw * 6, 0, bx + cw * 6, 0)
      gradient.addColorStop(0, "rgba(255,255,255,0)")
      gradient.addColorStop(0.5, "rgba(255,255,255,0.05)")
      gradient.addColorStop(1, "rgba(255,255,255,0)")
      ctx!.fillStyle = gradient
      ctx!.fillRect(bx - cw * 6, oy - rh * 2, cw * 12, rh * (art.rows + 4))
    }

    // The logo's cells.
    for (const c of cells) {
      let shade = c.shade
      let alpha = fade
      let glyph = c.glyph
      if (!c.swept) {
        glyph = c.dust
        shade = 0x6a
        alpha *= 0.5
      } else {
        const age = now - c.sweptAt
        // Solidify: ░ ▒ ▓ then the glyph, and a glint that settles to its shade.
        if (c.kind === "face" && age < 150) glyph = age < 50 ? "░" : age < 100 ? "▒" : "▓"
        const glint = clamp(1 - age / 650)
        shade = Math.round(shade + (0xff - shade) * glint)
        if (c.kind === "spark") alpha *= 0.55 + 0.45 * Math.sin(now / 520 + c.phase)
      }
      if (pointer.active && c.swept && c.kind === "face") {
        const d = Math.hypot(c.x + cw / 2 - pointer.x, c.y + rh / 2 - pointer.y)
        shade = Math.round(shade + (0xff - shade) * clamp(1 - d / 160) * 0.8)
      }
      const color = colorOf(shade, alpha)
      if (!drawGeometric(ctx!, glyph, c.x, c.y, cw + 0.35, rh + 0.35, color, 1)) {
        ctx!.font = `${c.kind === "spark" ? 400 : 500} ${c.swept ? cw * 1.45 : cw * 0.95}px ${FONT_STACK}`
        ctx!.fillStyle = color
        ctx!.textAlign = "center"
        ctx!.fillText(glyph, c.x + cw / 2, c.y + rh / 2)
        ctx!.textAlign = "left"
      }
    }
  }

  let last = performance.now()
  function step(now: number) {
    const dt = Math.min(2.5, (now - last) / 16.67)
    last = now
    const band = -0.3 + ((now - sweepStart) / SWEEP_MS) * 1.6
    let swept = 0
    for (const c of cells) {
      if (!c.swept && now > sweepStart && band >= c.at && (c.kind !== "spark" || band > 1.05)) {
        c.swept = true
        c.sweptAt = now
      }
      if (c.swept && c.kind !== "spark") swept++
      const t = target(c)
      if (c.swept) {
        // A damped spring to its place.
        c.vx += (t.x - c.x) * 0.075 * dt
        c.vy += (t.y - c.y) * 0.075 * dt
        if (pointer.active) {
          const dx = c.x + cw / 2 - pointer.x
          const dy = c.y + rh / 2 - pointer.y
          const d = Math.hypot(dx, dy)
          const reach = cw * 5.5
          if (d < reach && d > 0.01) {
            const push = (1 - d / reach) ** 2 * 2.6 * dt
            c.vx += (dx / d) * push
            c.vy += (dy / d) * push
          }
        }
        c.vx *= 0.8 ** dt
        c.vy *= 0.8 ** dt
      } else {
        // Loose dust drifts and slows down.
        c.vx = c.vx * 0.94 ** dt + rand(-0.04, 0.04)
        c.vy = c.vy * 0.94 ** dt - 0.01
      }
      c.x += c.vx * dt
      c.y += c.vy * dt
    }
    for (const m of motes) {
      m.x += m.vx * dt * (1 + scroll * 3)
      m.y += m.vy * dt * (1 + scroll * 3)
      if (m.y < -20) m.y = height + 10
      if (m.x > width + 60) m.x = -60
    }
    if (countLabel) countLabel.textContent = `cells ${pad(swept, 3)} / ${pad(faces, 3)} swept`
  }

  function frame(now: number) {
    if (visible && !document.hidden) {
      step(now)
      draw(now)
    } else {
      last = now
    }
    requestAnimationFrame(frame)
  }

  layout()
  if (still) {
    settleAll()
    draw(performance.now())
    if (countLabel) countLabel.textContent = `cells ${pad(faces, 3)} / ${pad(faces, 3)} swept`
    new ResizeObserver(() => {
      layout()
      settleAll()
      draw(performance.now())
    }).observe(hero)
    return
  }

  scatter()
  requestAnimationFrame(frame)

  new ResizeObserver(() => layout()).observe(hero)
  new IntersectionObserver(([entry]) => (visible = entry!.isIntersecting)).observe(hero)
  window.addEventListener(
    "scroll",
    () => {
      scroll = clamp(window.scrollY / Math.max(1, hero.offsetHeight))
    },
    { passive: true }
  )

  hero.addEventListener("pointermove", (event) => {
    const rect = hero.getBoundingClientRect()
    pointer.x = event.clientX - rect.left
    pointer.y = event.clientY - rect.top
    pointer.active = event.pointerType === "mouse"
    if (pointerLabel) pointerLabel.textContent = `x ${pad(pointer.x, 4)} · y ${pad(pointer.y, 4)}`
  })
  hero.addEventListener("pointerleave", () => {
    pointer.active = false
  })

  let lastScatter = 0
  slot.addEventListener("click", (event) => {
    const now = performance.now()
    if (now - lastScatter < 900) return
    lastScatter = now
    const rect = hero.getBoundingClientRect()
    scatter(event.clientX - rect.left, event.clientY - rect.top, 1)
    sweepStart = now + 650
  })
}
