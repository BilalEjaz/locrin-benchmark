import cli from "../../../packages/create-klin/package.json"

export const VERSION = cli.version
export const REPO = "https://github.com/nata-t/klin"
export const NPM = "https://www.npmjs.com/package/create-klin"

/**
 * The landing page's sections, shown in the nav the way the wizard shows its
 * steps (✓ passed · ◆ here · ○ ahead) — and capped at six, like the wizard.
 */
export const STEPS = [
  { id: "intro", label: "Intro" },
  { id: "wizard", label: "Wizard" },
  { id: "schema", label: "Schema" },
  { id: "kit", label: "Kit" },
  { id: "grow", label: "Grow" },
  { id: "ship", label: "Ship" },
] as const

export const INSTALL = {
  bun: "bun create klin",
  pnpm: "pnpm create klin",
  npm: "npm create klin@latest",
} as const
