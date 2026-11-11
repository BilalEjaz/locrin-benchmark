import gsap from "gsap"
import { ScrollTrigger } from "gsap/ScrollTrigger"
import Lenis from "lenis"
import { STEPS } from "../lib/site"

/**
 * Site-wide motion for the landing page: Lenis smooth scrolling, scroll
 * reveals, the nav's step indicator, copy buttons and keyboard shortcuts.
 * Everything renders complete without it; visitors who prefer reduced motion
 * get native scrolling and no choreography.
 */

gsap.registerPlugin(ScrollTrigger)

const root = document.documentElement
const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches

export let lenis: Lenis | null = null

if (!still) {
  lenis = new Lenis({ lerp: 0.11, anchors: { offset: -52 } })
  lenis.on("scroll", ScrollTrigger.update)
  gsap.ticker.add((time) => lenis!.raf(time * 1000))
  gsap.ticker.lagSmoothing(0)
}

/* ─── Reveals ──────────────────────────────────────────────────────────── */

const HIDDEN = { autoAlpha: 0, y: 26, filter: "blur(8px)" }
const SHOWN = { autoAlpha: 1, y: 0, filter: "blur(0px)", duration: 0.9, ease: "power3.out", clearProps: "filter,transform" }

if (!still) {
  // Sections build their frame first: the top rule draws across, the ticks pop in.
  gsap.utils.toArray<HTMLElement>("[data-choreo]").forEach((section) => {
    const rule = section.querySelector<HTMLElement>(":scope > .rule")
    const ticks = section.querySelectorAll<HTMLElement>(":scope > .rail > .tick")
    if (rule) gsap.set(rule, { scaleX: 0 })
    if (ticks.length) gsap.set(ticks, { scale: 0, opacity: 0 })
    ScrollTrigger.create({
      trigger: section,
      start: "top 90%",
      once: true,
      onEnter: () => {
        const tl = gsap.timeline()
        if (rule) tl.to(rule, { scaleX: 1, duration: 0.8, ease: "power2.out" }, 0)
        if (ticks.length) tl.to(ticks, { scale: 1, opacity: 1, duration: 0.35, stagger: 0.07, ease: "back.out(2)" }, 0.35)
      },
    })
  })

  // Content rises out of a blur as it arrives; siblings in a row cascade left to right.
  gsap.utils.toArray<HTMLElement>("[data-reveal]").forEach((el) => {
    gsap.set(el, HIDDEN)
    const parent = el.parentElement!
    const rect = parent.getBoundingClientRect()
    const delay = rect.width > 0 ? ((el.getBoundingClientRect().left - rect.left) / rect.width) * 0.2 : 0
    const inHero = Boolean(el.closest("#intro"))
    ScrollTrigger.create({
      trigger: el,
      start: "top 92%",
      once: true,
      onEnter: () => gsap.to(el, { ...SHOWN, delay: inHero ? 1.1 + [...parent.children].indexOf(el) * 0.08 : delay }),
    })
  })

  // Labels decode out of glyph dust, like cells being swept into place.
  gsap.utils.toArray<HTMLElement>("[data-decode]").forEach((el) => {
    const text = el.textContent ?? ""
    ScrollTrigger.create({
      trigger: el,
      start: "top 92%",
      once: true,
      onEnter: () => decode(el, text),
    })
  })
}
root.classList.add("motion-ready")

function decode(el: HTMLElement, text: string) {
  const dust = "░▒▓<>/{}[]=+*#"
  const start = performance.now()
  const duration = 520 + text.length * 14
  const tick = (now: number) => {
    const t = Math.min(1, (now - start) / duration)
    const settled = Math.floor(t * text.length)
    let out = ""
    for (let i = 0; i < text.length; i++) {
      const ch = text[i]!
      out += i < settled || ch === " " ? ch : dust[Math.floor(Math.random() * dust.length)]
    }
    el.textContent = out
    if (t < 1) requestAnimationFrame(tick)
    else el.textContent = text
  }
  requestAnimationFrame(tick)
}

/* ─── The nav's step indicator ─────────────────────────────────────────── */

const links = new Map(STEPS.map((step) => [step.id, document.querySelector<HTMLAnchorElement>(`[data-step="${step.id}"]`)]))
const compactNum = document.querySelector<HTMLElement>("[data-compact-num]")
const compactName = document.querySelector<HTMLElement>("[data-compact-name]")
const heroCorner = document.querySelector<HTMLElement>(".c-tr")

function setStep(current: number) {
  STEPS.forEach((step, i) => {
    const link = links.get(step.id)
    if (!link) return
    const state = i < current ? "passed" : i === current ? "here" : "ahead"
    link.dataset.state = state
    link.querySelector(".mark")!.textContent = state === "passed" ? "✓" : state === "here" ? "◆" : "○"
    if (state === "here") link.setAttribute("aria-current", "step")
    else link.removeAttribute("aria-current")
  })
  if (compactNum) compactNum.textContent = String(current + 1)
  if (compactName) compactName.textContent = STEPS[current]!.label
  if (heroCorner) heroCorner.textContent = `◆ ${current + 1} / ${STEPS.length} · ${STEPS[current]!.label.toLowerCase()}`
}

STEPS.forEach((step, i) => {
  const section = document.getElementById(step.id)
  if (!section) return
  ScrollTrigger.create({
    trigger: section,
    start: "top 45%",
    end: "bottom 45%",
    onToggle: (self) => {
      if (self.isActive) setStep(i)
    },
  })
})

/* ─── Copy buttons ─────────────────────────────────────────────────────── */

export async function copyText(text: string, button?: HTMLElement | null) {
  try {
    await navigator.clipboard.writeText(text)
  } catch {
    const area = document.createElement("textarea")
    area.value = text
    document.body.append(area)
    area.select()
    document.execCommand("copy")
    area.remove()
  }
  if (!button) return
  const label = button.querySelector<HTMLElement>("[data-copy-label]") ?? button
  const before = label.textContent
  button.dataset.copied = "true"
  label.textContent = "Copied ✓"
  setTimeout(() => {
    button.dataset.copied = "false"
    label.textContent = before
  }, 1600)
}

document.addEventListener("click", (event) => {
  const button = (event.target as HTMLElement).closest<HTMLElement>("[data-copy-from]")
  if (!button) return
  const source = document.querySelector<HTMLElement>(button.dataset.copyFrom!)
  if (source) void copyText(source.textContent?.trim() ?? "", button)
})

/* ─── Keyboard shortcuts (c copy · w wizard · d docs) ──────────────────── */

document.addEventListener("keydown", (event) => {
  if (event.metaKey || event.ctrlKey || event.altKey) return
  const target = event.target as HTMLElement
  if (target.closest("input, textarea, select, [contenteditable], [data-terminal]")) return
  const key = event.key.toLowerCase()
  if (key === "c") {
    const button = document.querySelector<HTMLElement>("#intro [data-copy-from]")
    const source = document.querySelector<HTMLElement>("[data-install-cmd]")
    if (source) void copyText(source.textContent ?? "", button)
  } else if (key === "w") {
    const wizard = document.getElementById("wizard")
    if (wizard) lenis ? lenis.scrollTo(wizard, { offset: -52 }) : wizard.scrollIntoView()
  } else if (key === "d") {
    window.location.href = "/docs/"
  }
})
