/** Catppuccin Mocha — matches the palette most terminals here already use,
 *  and degrades cleanly when the terminal reports no truecolor. */
export const color = {
  text: '#cdd6f4',
  subtext: '#a6adc8',
  muted: '#6c7086',
  overlay: '#585b70',
  surface: '#313244',
  mauve: '#cba6f7',
  blue: '#89b4fa',
  sapphire: '#74c7ec',
  green: '#a6e3a1',
  yellow: '#f9e2af',
  peach: '#fab387',
  red: '#f38ba8',
  pink: '#f5c2e7',
  teal: '#94e2d5',
} as const

const NERD = process.env.CCX_ICONS !== '0'

export const icon = {
  logo: NERD ? '◆' : '*',
  collapsed: NERD ? '▸' : '>',
  expanded: NERD ? '▾' : 'v',
  bullet: NERD ? '·' : '-',
  link: NERD ? '↗' : '@',
  real: NERD ? '●' : '#',
  ok: NERD ? '●' : 'o',
  off: NERD ? '○' : '.',
  warn: NERD ? '▲' : '!',
  err: NERD ? '✘' : 'x',
  good: NERD ? '✔' : 'v',
  auth: NERD ? '!' : '!',
  branch: NERD ? '⎇' : 'br',
  dirty: NERD ? '●' : '*',
  sep: NERD ? '›' : '>',
  dot: '·',
} as const

export const scopeColor: Record<string, string> = {
  project: color.green,
  workspace: color.blue,
  harness: color.mauve,
  ancestor: color.subtext,
  user: color.peach,
  plugin: color.pink,
}

export function statusColor(status: string): string {
  switch (status) {
    case 'connected': return color.green
    case 'failed': return color.red
    case 'auth': return color.yellow
    case 'pending': return color.peach
    default: return color.muted
  }
}

export function statusIcon(status: string): string {
  switch (status) {
    case 'connected': return icon.ok
    case 'failed': return icon.err
    case 'auth': return icon.auth
    case 'pending': return icon.off
    default: return icon.off
  }
}

export function bytes(n: number): string {
  if (n < 1024) return `${n}b`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10240 ? 1 : 0)}k`
  return `${(n / 1024 / 1024).toFixed(1)}M`
}
