import { looksSecret, redact } from '../util/mask.js'
import { tilde } from '../util/walk.js'
import type { ScanContext } from './context.js'
import type { SettingEntry } from './types.js'

const SHOWN_KEYS = [
  'model', 'effortLevel', 'theme', 'tui', 'outputStyle', 'statusLine',
  'autoMemoryDirectory', 'includeCoAuthoredBy', 'cleanupPeriodDays', 'apiKeyHelper',
]

function display(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'string') return redact(value)
  if (typeof value === 'object') {
    const o = value as Record<string, unknown>
    if (typeof o.command === 'string') return redact(`${o.type ?? 'command'}: ${o.command}`)
    return redact(JSON.stringify(value))
  }
  return String(value)
}

export function scanSettings(ctx: ScanContext): SettingEntry[] {
  const merged = new Map<string, SettingEntry>()

  const put = (key: string, value: unknown, sf: { path: string; scope: any; label: string }) => {
    const prev = merged.get(key)
    merged.set(key, {
      key,
      value: display(value),
      source: tilde(sf.path),
      scope: sf.scope,
      label: sf.label,
      overrides: prev ? [...prev.overrides, prev.label] : [],
    })
  }

  for (const sf of ctx.settingsFiles) {
    for (const key of SHOWN_KEYS) {
      if (sf.data[key] !== undefined) put(key, sf.data[key], sf)
    }
    // env vars: names always, values only when they are not credential-shaped
    const env = sf.data.env
    if (env && typeof env === 'object') {
      for (const [k, v] of Object.entries(env as Record<string, unknown>)) {
        const s = String(v)
        put(`env.${k}`, looksSecret(s) ? '••••' : s, sf)
      }
    }
  }

  return [...merged.values()].sort((a, b) => a.key.localeCompare(b.key))
}

/** defaultMode / additionalDirectories, resolved across the settings chain. */
export function permissionMode(ctx: ScanContext): { mode: string; additionalDirectories: string[] } {
  let mode = 'default'
  const dirs: string[] = []
  for (const sf of ctx.settingsFiles) {
    const p = sf.data.permissions
    if (typeof p?.defaultMode === 'string') mode = p.defaultMode
    if (Array.isArray(p?.additionalDirectories)) dirs.push(...p.additionalDirectories.map(String))
  }
  return { mode, additionalDirectories: [...new Set(dirs)] }
}
