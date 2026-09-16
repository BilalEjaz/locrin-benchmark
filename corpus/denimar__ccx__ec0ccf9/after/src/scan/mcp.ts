import { basename, join } from 'node:path'
import { readJsonc } from '../util/jsonc.js'
import { envKeys, isInlineSecret, looksSecret, redact, redactArgs } from '../util/mask.js'
import { HOME, isFile, tilde } from '../util/walk.js'
import type { ScanContext } from './context.js'
import type { McpEntry, PluginEntry, Scope, Transport } from './types.js'

function transportOf(raw: any): Transport {
  const t = typeof raw?.type === 'string' ? raw.type.toLowerCase() : undefined
  if (t === 'stdio' || t === 'http' || t === 'sse' || t === 'ws') return t
  // real-world configs frequently omit `type`
  if (raw?.command) return 'stdio'
  if (typeof raw?.url === 'string') return raw.url.includes('/sse') ? 'sse' : 'http'
  return 'unknown'
}

function entry(name: string, raw: any, scope: Scope, label: string, source: string): McpEntry {
  const args = redactArgs(raw?.args)
  const rawArgs: string[] = Array.isArray(raw?.args) ? raw.args.map(String) : []
  const envPairs = raw?.env && typeof raw.env === 'object'
    ? Object.entries(raw.env as Record<string, unknown>).map(([k, v]) => [k, String(v)] as const)
    : []
  const secretsInline =
    rawArgs.some(looksSecret) ||
    envPairs.some(([k, v]) => isInlineSecret(k, v)) ||
    (typeof raw?.url === 'string' && looksSecret(raw.url))
  return {
    name,
    transport: transportOf(raw),
    command: raw?.command ? redact(String(raw.command)) : undefined,
    args,
    url: raw?.url ? redact(String(raw.url)) : undefined,
    envKeys: envKeys(raw?.env),
    scope,
    label,
    source: tilde(source),
    enabled: true,
    status: 'unknown',
    secretsInline,
  }
}

export function scanMcp(ctx: ScanContext, plugins: PluginEntry[]): McpEntry[] {
  const found: McpEntry[] = []

  // 1. user scope — ~/.claude.json .mcpServers
  for (const [name, raw] of Object.entries(ctx.claudeJson.mcpServers ?? {})) {
    found.push(entry(name, raw, 'user', 'user', join(HOME, '.claude.json')))
  }

  // 2. this project's entry inside ~/.claude.json (keyed the way Claude Code
  //    keys it — see resolveProjectEntryKey; may be the repo root of a subdir)
  const localLabel = ctx.projectEntryKey && ctx.projectEntryKey !== ctx.root
    ? `project (local · ${basename(ctx.projectEntryKey)})`
    : 'project (local)'
  for (const [name, raw] of Object.entries(ctx.projectEntry.mcpServers ?? {})) {
    found.push(entry(name, raw, 'project', localLabel, join(HOME, '.claude.json')))
  }

  // 3. .mcp.json at every ancestor (git-shareable, needs approval)
  for (const dir of [...ctx.dirs].reverse()) {
    const path = join(dir, '.mcp.json')
    ctx.track(path)
    if (!isFile(path)) continue
    const data = readJsonc<any>(path)
    for (const [name, raw] of Object.entries(data?.mcpServers ?? {})) {
      found.push(entry(name, raw, ctx.scopeOf.get(dir) ?? 'ancestor', ctx.labelOf.get(dir) ?? tilde(dir), path))
    }
  }

  // 4. non-standard: mcpServers inlined in .claude/settings*.json
  for (const sf of ctx.settingsFiles) {
    for (const [name, raw] of Object.entries(sf.data.mcpServers ?? {})) {
      found.push(entry(name, raw, sf.scope, sf.label, sf.path))
    }
  }

  // 5. plugin-bundled .mcp.json
  for (const p of plugins) {
    if (!p.enabled || !p.installed) continue
    const path = join(p.installPath, '.mcp.json')
    if (!isFile(path)) continue
    for (const [name, raw] of Object.entries(readJsonc<any>(path)?.mcpServers ?? {})) {
      found.push(entry(`${p.name}:${name}`, raw, 'plugin', p.name, path))
    }
  }

  // gating flags live in the project entry of ~/.claude.json
  const enabledJson: string[] = ctx.projectEntry.enabledMcpjsonServers ?? []
  const disabledJson: string[] = ctx.projectEntry.disabledMcpjsonServers ?? []
  const disabledAll: string[] = ctx.projectEntry.disabledMcpServers ?? []

  for (const e of found) {
    if (disabledAll.includes(e.name)) { e.enabled = false; e.disabledReason = 'disabledMcpServers' }
    else if (disabledJson.includes(e.name)) { e.enabled = false; e.disabledReason = 'disabledMcpjsonServers' }
    else if (e.source.endsWith('.mcp.json') && !enabledJson.includes(e.name) && e.scope !== 'plugin') {
      e.status = 'pending'
      e.statusText = 'not approved for this project yet'
    }
  }

  // de-dupe by name, tightest scope wins (mirrors Claude Code's own resolution)
  const RANK: Record<Scope, number> = { user: 0, plugin: 1, ancestor: 2, harness: 3, workspace: 4, project: 5 }
  const byName = new Map<string, McpEntry>()
  for (const e of found) {
    const prev = byName.get(e.name)
    if (!prev || RANK[e.scope] >= RANK[prev.scope]) byName.set(e.name, e)
  }

  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name))
}

/** Merge `claude mcp list` health output into an existing entry list. */
export function applyHealth(entries: McpEntry[], raw: string): McpEntry[] {
  const map = new Map<string, { status: McpEntry['status']; text: string }>()
  for (const line of raw.split('\n')) {
    const m = line.match(/^([A-Za-z0-9_.:@-]+):\s*(.*)$/)
    if (!m?.[1]) continue
    const rest = m[2] ?? ''
    let status: McpEntry['status'] = 'unknown'
    if (/✔|✓|Connected/i.test(rest)) status = 'connected'
    else if (/✘|✗|Failed/i.test(rest)) status = 'failed'
    else if (/Needs authentication|⏸|Pending/i.test(rest)) status = 'auth'
    const dash = rest.lastIndexOf(' - ')
    map.set(m[1], { status, text: (dash >= 0 ? rest.slice(dash + 3) : rest).trim() })
  }
  for (const e of entries) {
    // plugin-provided servers are reported as `plugin:<plugin>:<name>`
    const hit = map.get(e.name)
      ?? map.get(`plugin:${e.name}`)
      ?? [...map.entries()].find(([k]) => k.endsWith(`:${e.name}`))?.[1]
    if (hit) { e.status = hit.status; e.statusText = hit.text }
  }
  return entries
}
