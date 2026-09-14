import { basename } from 'node:path'
import type { ProjectReport } from '../scan/types.js'
import { tilde } from '../util/walk.js'
import { bytes, color, icon, scopeTone, statusColor, statusIcon, statusWord } from './theme.js'

export interface Row {
  kind: 'section' | 'group' | 'item' | 'spacer'
  key: string
  section: string
  /** what → / ← expands or collapses when this row is focused */
  expandKey: string
  /** what ← collapses when this row is a child */
  parentKey: string
  label: string
  labelColor?: string
  bold?: boolean
  /** the single right-aligned zone: a word, never a second column of labels */
  state?: string
  stateColor?: string
  /** 2 = broken / failed, 1 = worth a look — floats the row to the top of its section */
  severity?: number
  indent: number
  path?: string
  haystack: string
  detail?: string
}

export const SECTIONS = [
  'Memory', 'Skills', 'MCP', 'Agents', 'Commands', 'Hooks', 'Permissions', 'Plugins', 'Settings', 'Health',
] as const
export type SectionName = (typeof SECTIONS)[number]

interface Ctx {
  rows: Row[]
  expanded: Set<string>
  section: string
}

function open(ctx: Ctx, key: string): boolean { return ctx.expanded.has(key) }

/** A blank line before every section but the first; `densify` drops these when short on rows. */
function spacer(ctx: Ctx, name: string): void {
  if (ctx.rows.length === 0) return
  ctx.rows.push({
    kind: 'spacer', key: `sp:${name}`, section: name, expandKey: name, parentKey: name,
    label: '', indent: 0, haystack: '',
  })
}

function section(ctx: Ctx, name: string, count: number, summary: string, summaryColor: string, detail: string): boolean {
  spacer(ctx, name)
  ctx.section = name
  const expanded = open(ctx, name)
  const n = count === 0 ? '—' : String(count)
  ctx.rows.push({
    kind: 'section',
    key: `s:${name}`,
    section: name,
    expandKey: name,
    parentKey: name,
    label: `${expanded ? icon.expanded : icon.collapsed} ${name}`,
    labelColor: color.text,
    bold: true,
    state: summary ? `${n} ${icon.dot} ${summary}` : n,
    stateColor: summary ? summaryColor : count === 0 ? color.muted : color.subtext,
    indent: 0,
    haystack: name.toLowerCase(),
    detail,
  })
  return expanded
}

type ItemInput = Omit<Row, 'kind' | 'section' | 'indent' | 'expandKey' | 'parentKey'> & { parentKey?: string; indent?: number }

function makeItem(ctx: Ctx, r: ItemInput): Row {
  return {
    kind: 'item',
    section: ctx.section,
    indent: r.indent ?? 1,
    expandKey: r.parentKey ?? ctx.section,
    parentKey: r.parentKey ?? ctx.section,
    ...r,
  }
}

function item(ctx: Ctx, r: ItemInput): void { ctx.rows.push(makeItem(ctx, r)) }

/** Anything broken, failed or denied is what you opened the panel for: it goes first. */
export function problemsFirst(rows: Row[]): Row[] {
  return rows
    .map((r, i) => ({ r, i }))
    .sort((a, b) => (b.r.severity ?? 0) - (a.r.severity ?? 0) || a.i - b.i)
    .map(({ r }) => r)
}

function emit(ctx: Ctx, list: Row[]): void { for (const r of problemsFirst(list)) ctx.rows.push(r) }

/** Plugins ship skills, agents and commands in bulk; collapsing them per
 *  plugin keeps what *this* tree defines at the top and one keypress away. */
function pluginGroups<T extends { plugin?: string }>(
  ctx: Ctx, items: T[], render: (t: T, parentKey: string) => Row,
): void {
  const byPlugin = new Map<string, T[]>()
  for (const it of items) {
    if (!it.plugin) continue
    const list = byPlugin.get(it.plugin) ?? []
    list.push(it)
    byPlugin.set(it.plugin, list)
  }
  for (const [plugin, list] of byPlugin) {
    const key = `${ctx.section}/${plugin}`
    const expanded = open(ctx, key)
    ctx.rows.push({
      kind: 'group',
      key: `g:${key}`,
      section: ctx.section,
      expandKey: key,
      parentKey: ctx.section,
      label: `${expanded ? icon.expanded : icon.collapsed} ${plugin}`,
      labelColor: color.subtext,
      state: `${list.length} plugin`,
      stateColor: color.muted,
      indent: 1,
      haystack: `${plugin} plugin`.toLowerCase(),
      detail: `${list.length} items provided by the ${plugin} plugin`,
    })
    if (expanded) emit(ctx, list.map((it) => render(it, key)))
  }
}

export function buildRows(report: ProjectReport, expanded: Set<string>, mcpLoading: boolean): Row[] {
  const ctx: Ctx = { rows: [], expanded, section: '' }

  // ---- Memory -----------------------------------------------------------
  {
    const m = report.memory
    const detail = `${m.files.length} memory files load here${m.autoMemoryDirectory ? `  ${icon.dot}  auto-memory in ${tilde(m.autoMemoryDirectory)}` : ''}`
    if (section(ctx, 'Memory', m.files.length + (m.autoMemoryDirectory ? 1 : 0),
      m.autoMemoryFiles ? `${m.autoMemoryFiles} auto` : '', color.muted, detail)) {
      const list = m.files.map((f) => makeItem(ctx, {
        key: `mem:${f.path}`,
        label: f.kind,
        labelColor: scopeTone(f.scope),
        state: f.symlinkTo ? 'link' : f.isImportStub ? `${icon.arrow} @${basename(f.imports[0] ?? '')}` : `${f.lines}L ${bytes(f.bytes)}`,
        stateColor: color.muted,
        path: f.path,
        haystack: `${f.kind} ${f.label} ${f.path}`.toLowerCase(),
        detail: f.symlinkTo ? `${f.label} ${icon.sep} link to ${f.symlinkTo}` : `${f.label} ${icon.sep} ${f.lines} lines`,
      }))
      emit(ctx, list)
      if (m.autoMemoryDirectory) {
        item(ctx, {
          key: 'mem:auto', label: 'memory/', labelColor: color.mauve,
          state: `${m.autoMemoryFiles} files`, stateColor: color.muted,
          path: m.autoMemoryDirectory,
          haystack: `auto memory ${m.autoMemoryDirectory}`.toLowerCase(),
          detail: `auto-memory${m.autoMemorySource ? ` via ${m.autoMemorySource}` : ''}`,
        })
      }
    }
  }

  // ---- Skills -----------------------------------------------------------
  {
    const own = report.skills.filter((s) => !s.plugin)
    const live = report.skills.filter((s) => !s.broken).length
    const broken = report.skills.length - live
    const renderSkill = (s: typeof report.skills[number], parentKey?: string) => makeItem(ctx, {
      key: `sk:${s.path}`,
      parentKey,
      indent: parentKey ? 2 : 1,
      label: s.name,
      labelColor: s.broken ? color.red : s.winner ? scopeTone(s.plugin ? 'plugin' : s.scope) : color.overlay,
      state: s.broken ? 'broken' : s.plugin ? '' : s.origin === 'real' ? 'own' : s.hops > 1 ? `link ×${s.hops}` : 'link',
      stateColor: s.broken ? color.red : color.muted,
      severity: s.broken ? 2 : s.winner ? 0 : 1,
      path: s.path,
      haystack: `${s.name} ${s.label} ${s.description}`.toLowerCase(),
      detail: s.broken ? `broken link ${icon.arrow} ${s.realPath}`
        : s.winner ? (s.description || s.label) : `shadowed by ${s.shadows[0] ?? 'a nearer copy'}`,
    })

    if (section(ctx, 'Skills', live, broken ? `${icon.warn}${broken}` : '', color.red,
      `${own.length} from this tree, ${report.skills.length - own.length} from plugins`)) {
      emit(ctx, own.map((s) => renderSkill(s)))
      pluginGroups(ctx, report.skills, (s, key) => renderSkill(s, key))
    }
  }

  // ---- MCP --------------------------------------------------------------
  {
    const dots = report.mcp.map((m) => (m.enabled ? statusIcon(m.status) : icon.off)).join('')
    if (section(ctx, 'MCP', report.mcp.length, mcpLoading ? 'checking…' : dots,
      mcpLoading ? color.muted : color.subtext, 'MCP servers resolvable from this directory')) {
      emit(ctx, report.mcp.map((m) => makeItem(ctx, {
        key: `mcp:${m.name}`,
        label: m.name,
        labelColor: m.enabled ? scopeTone(m.scope) : color.overlay,
        state: m.enabled ? statusWord(m.status) : 'off',
        stateColor: m.enabled ? statusColor(m.status) : color.muted,
        severity: !m.enabled ? 0 : m.status === 'failed' ? 2 : m.status === 'auth' ? 1 : 0,
        path: m.source,
        haystack: `${m.name} ${m.transport} ${m.label} ${m.command ?? ''} ${m.url ?? ''}`.toLowerCase(),
        detail: [
          m.transport,
          m.command ? `${m.command} ${m.args.join(' ')}`.trim() : m.url,
          m.envKeys.length ? `env: ${m.envKeys.join(', ')}` : '',
          m.statusText,
          m.disabledReason ? `disabled via ${m.disabledReason}` : '',
          m.secretsInline ? `${icon.warn} plaintext credential in ${m.source}` : '',
        ].filter(Boolean).join(`   ${icon.dot}   `),
      })))
    }
  }

  // ---- Agents -----------------------------------------------------------
  {
    const own = report.agents.filter((a) => !a.plugin)
    const renderAgent = (a: typeof report.agents[number], parentKey?: string) => makeItem(ctx, {
      key: `ag:${a.path}`, parentKey, indent: parentKey ? 2 : 1,
      label: a.name, labelColor: scopeTone(a.plugin ? 'plugin' : a.scope),
      state: a.hasFrontmatter ? (a.model ?? '') : 'no header',
      stateColor: a.hasFrontmatter ? color.muted : color.yellow,
      severity: a.hasFrontmatter ? 0 : 1,
      path: a.path,
      haystack: `${a.name} ${a.description} ${a.label}`.toLowerCase(),
      detail: a.description || a.label,
    })
    if (section(ctx, 'Agents', report.agents.length, '', color.muted, 'subagents callable from this directory')) {
      emit(ctx, own.map((a) => renderAgent(a)))
      pluginGroups(ctx, report.agents, (a, key) => renderAgent(a, key))
    }
  }

  // ---- Commands ---------------------------------------------------------
  {
    const own = report.commands.filter((c) => !c.plugin)
    const renderCmd = (c: typeof report.commands[number], parentKey?: string) => makeItem(ctx, {
      key: `cmd:${c.path}`, parentKey, indent: parentKey ? 2 : 1,
      label: `/${c.name}`, labelColor: scopeTone(c.plugin ? 'plugin' : c.scope),
      state: c.format === 'toml' ? 'toml' : '', stateColor: color.muted,
      path: c.path,
      haystack: `${c.name} ${c.description} ${c.label}`.toLowerCase(),
      detail: c.description || c.label,
    })
    if (section(ctx, 'Commands', report.commands.length, '', color.muted, 'slash commands available here')) {
      emit(ctx, own.map((c) => renderCmd(c)))
      pluginGroups(ctx, report.commands, (c, key) => renderCmd(c, key))
    }
  }

  // ---- Hooks ------------------------------------------------------------
  {
    const byEvent = new Map<string, number>()
    for (const h of report.hooks) byEvent.set(h.event, (byEvent.get(h.event) ?? 0) + 1)
    if (section(ctx, 'Hooks', report.hooks.length, '', color.muted,
      [...byEvent].map(([e, n]) => `${e} ${n}`).join(`  ${icon.dot}  `) || 'no hooks fire here')) {
      emit(ctx, report.hooks.map((h) => makeItem(ctx, {
        key: `hk:${h.event}:${h.source}:${h.command}`,
        label: h.event, labelColor: scopeTone(h.plugin ? 'plugin' : h.scope),
        state: h.matcher && h.matcher !== '*' ? h.matcher : '', stateColor: color.sapphire,
        path: h.source,
        haystack: `${h.event} ${h.matcher} ${h.command} ${h.label}`.toLowerCase(),
        detail: `${h.command}${h.statusMessage ? `   “${h.statusMessage}”` : ''}`,
      })))
    }
  }

  // ---- Permissions ------------------------------------------------------
  {
    const deny = report.permissions.filter((p) => p.kind === 'deny').length
    if (section(ctx, 'Permissions', report.permissions.length, deny ? `${deny} deny` : '', color.muted,
      'merged allow / deny rules across every settings file')) {
      emit(ctx, report.permissions.map((p) => makeItem(ctx, {
        key: `pm:${p.kind}:${p.rule}:${p.source}`,
        label: p.rule, labelColor: p.kind === 'deny' ? color.red : scopeTone(p.scope),
        state: p.kind, stateColor: p.kind === 'deny' ? color.red : p.kind === 'ask' ? color.yellow : color.green,
        path: p.source,
        haystack: `${p.rule} ${p.kind} ${p.label}`.toLowerCase(),
        detail: `${p.kind} ${icon.sep} ${p.label}`,
      })))
    }
  }

  // ---- Plugins ----------------------------------------------------------
  {
    const on = report.plugins.filter((p) => p.enabled).length
    if (section(ctx, 'Plugins', on, report.plugins.length - on ? `${report.plugins.length - on} off` : '', color.muted,
      'installed plugins and what they contribute')) {
      emit(ctx, report.plugins.map((p) => {
        const c = p.contributes
        return makeItem(ctx, {
          key: `pl:${p.id}`,
          label: p.name, labelColor: p.enabled ? scopeTone('plugin') : color.overlay,
          state: p.enabled
            ? [c.skills && `${c.skills}s`, c.agents && `${c.agents}a`, c.commands && `${c.commands}c`, c.hooks && `${c.hooks}h`, c.mcp && `${c.mcp}m`].filter(Boolean).join(' ')
            : 'off',
          stateColor: color.muted,
          severity: p.enabled && !p.installed ? 2 : 0,
          path: p.installPath,
          haystack: `${p.id} ${p.marketplace}`.toLowerCase(),
          detail: `${p.id} ${icon.sep} ${p.version}${p.installed ? '' : `   ${icon.warn} not installed`}${p.marketplaceKnown ? '' : `   ${icon.warn} unknown marketplace`}`,
        })
      }))
    }
  }

  // ---- Settings ---------------------------------------------------------
  if (section(ctx, 'Settings', report.settings.length, '', color.muted, 'effective settings and where each one came from')) {
    emit(ctx, report.settings.map((s) => makeItem(ctx, {
      key: `st:${s.key}`,
      label: s.key, labelColor: scopeTone(s.scope),
      state: s.value, stateColor: color.subtext,
      path: s.source,
      haystack: `${s.key} ${s.value}`.toLowerCase(),
      detail: `${s.value}${s.overrides.length ? `   overrides ${s.overrides.join(', ')}` : ''}`,
    })))
  }

  // ---- Health -----------------------------------------------------------
  {
    const errs = report.health.filter((h) => h.level === 'error').length
    const warns = report.health.length - errs
    const summary = report.health.length === 0
      ? 'clean'
      : [errs && `${icon.err}${errs}`, warns && `${icon.warn}${warns}`].filter(Boolean).join(' ')
    if (section(ctx, 'Health', report.health.length, summary,
      report.health.length === 0 ? color.green : errs ? color.red : color.yellow,
      'problems ccx found in this configuration')) {
      emit(ctx, report.health.map((h) => makeItem(ctx, {
        key: `hl:${h.title}:${h.detail}`,
        label: h.title, labelColor: h.level === 'error' ? color.red : color.yellow,
        state: h.level, stateColor: h.level === 'error' ? color.red : color.yellow,
        severity: h.level === 'error' ? 2 : 1,
        path: h.path,
        haystack: `${h.title} ${h.detail}`.toLowerCase(),
        detail: h.detail,
      })))
    }
  }

  return ctx.rows
}
