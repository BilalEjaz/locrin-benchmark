import { basename } from 'node:path'
import type { ProjectReport } from '../scan/types.js'
import { bytes, color, icon, statusColor, statusIcon } from './theme.js'

export interface Row {
  kind: 'section' | 'group' | 'item'
  key: string
  section: string
  /** what → / ← expands or collapses when this row is focused */
  expandKey: string
  /** what ← collapses when this row is a child */
  parentKey: string
  label: string
  labelColor?: string
  meta: string
  metaColor?: string
  note?: string
  noteColor?: string
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

function section(ctx: Ctx, name: string, count: number, note: string, noteColor: string, detail: string): boolean {
  ctx.section = name
  const expanded = open(ctx, name)
  ctx.rows.push({
    kind: 'section',
    key: `s:${name}`,
    section: name,
    expandKey: name,
    parentKey: name,
    label: `${expanded ? icon.expanded : icon.collapsed} ${name}`,
    labelColor: color.text,
    meta: count === 0 ? '—' : String(count),
    metaColor: count === 0 ? color.muted : color.text,
    note,
    noteColor,
    indent: 0,
    haystack: name.toLowerCase(),
    detail,
  })
  return expanded
}

function item(ctx: Ctx, r: Omit<Row, 'kind' | 'section' | 'indent' | 'expandKey' | 'parentKey'> & { parentKey?: string; indent?: number }): void {
  ctx.rows.push({
    kind: 'item',
    section: ctx.section,
    indent: r.indent ?? 1,
    expandKey: r.parentKey ?? ctx.section,
    parentKey: r.parentKey ?? ctx.section,
    ...r,
  })
}

/** Plugins ship skills, agents and commands in bulk; collapsing them per
 *  plugin keeps what *this* tree defines at the top and one keypress away. */
function pluginGroups<T extends { plugin?: string }>(
  ctx: Ctx, items: T[], render: (t: T, parentKey: string) => void,
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
      meta: String(list.length),
      metaColor: color.muted,
      note: 'plugin',
      noteColor: color.pink,
      indent: 1,
      haystack: `${plugin} plugin`.toLowerCase(),
      detail: `${list.length} items provided by the ${plugin} plugin`,
    })
    if (expanded) for (const it of list) render(it, key)
  }
}

export function buildRows(report: ProjectReport, expanded: Set<string>, mcpLoading: boolean): Row[] {
  const ctx: Ctx = { rows: [], expanded, section: '' }

  // ---- Memory -----------------------------------------------------------
  {
    const m = report.memory
    const detail = `${m.files.length} memory files load here${m.autoMemoryDirectory ? `, auto-memory in ${m.autoMemoryDirectory}` : ''}`
    if (section(ctx, 'Memory', m.files.length + (m.autoMemoryDirectory ? 1 : 0),
      m.autoMemoryFiles ? `${m.autoMemoryFiles} auto` : '', color.muted, detail)) {
      for (const f of m.files) {
        item(ctx, {
          key: `mem:${f.path}`,
          label: f.kind,
          labelColor: f.isImportStub || f.symlinkTo ? color.subtext : color.text,
          meta: f.label, metaColor: color.subtext,
          note: f.symlinkTo ? `${icon.link} link` : f.isImportStub ? `→ @${basename(f.imports[0] ?? '')}` : `${f.lines}L ${bytes(f.bytes)}`,
          noteColor: color.muted,
          path: f.path,
          haystack: `${f.kind} ${f.label} ${f.path}`.toLowerCase(),
          detail: f.symlinkTo ? `${f.path}  →  ${f.symlinkTo}` : f.path,
        })
      }
      if (m.autoMemoryDirectory) {
        item(ctx, {
          key: 'mem:auto', label: 'memory/', labelColor: color.mauve,
          meta: 'auto-memory', metaColor: color.subtext,
          note: `${m.autoMemoryFiles} files`, noteColor: color.muted,
          path: m.autoMemoryDirectory,
          haystack: `auto memory ${m.autoMemoryDirectory}`.toLowerCase(),
          detail: m.autoMemoryDirectory,
        })
      }
    }
  }

  // ---- Skills -----------------------------------------------------------
  {
    const own = report.skills.filter((s) => !s.plugin)
    const live = report.skills.filter((s) => !s.broken).length
    const broken = report.skills.length - live
    const renderSkill = (s: typeof report.skills[number], parentKey?: string) => item(ctx, {
      key: `sk:${s.path}`,
      parentKey,
      indent: parentKey ? 2 : 1,
      label: s.name,
      labelColor: s.broken ? color.red : s.winner ? color.text : color.muted,
      meta: s.plugin ?? s.label, metaColor: color.subtext,
      note: s.broken ? 'broken' : s.origin === 'real' ? (s.plugin ? '' : `${icon.real} own`) : `${icon.link}${s.hops > 1 ? s.hops : ''} link`,
      noteColor: s.broken ? color.red : color.muted,
      path: s.path,
      haystack: `${s.name} ${s.label} ${s.description}`.toLowerCase(),
      detail: s.broken ? `broken symlink → ${s.realPath}` : (s.description || s.path),
    })

    if (section(ctx, 'Skills', live, broken ? `${icon.warn} ${broken} broken` : '', color.red,
      `${own.length} from this tree, ${report.skills.length - own.length} from plugins`)) {
      for (const s of own) renderSkill(s)
      pluginGroups(ctx, report.skills, (s, key) => renderSkill(s, key))
    }
  }

  // ---- MCP --------------------------------------------------------------
  {
    const dots = report.mcp.map((m) => (m.enabled ? statusIcon(m.status) : icon.off)).join('')
    if (section(ctx, 'MCP', report.mcp.length, mcpLoading ? 'checking…' : dots,
      mcpLoading ? color.muted : color.subtext, 'MCP servers resolvable from this directory')) {
      for (const m of report.mcp) {
        item(ctx, {
          key: `mcp:${m.name}`,
          label: m.name, labelColor: m.enabled ? color.text : color.muted,
          meta: m.transport, metaColor: color.subtext,
          note: `${statusIcon(m.status)} ${m.label}`, noteColor: statusColor(m.status),
          path: m.source,
          haystack: `${m.name} ${m.transport} ${m.label} ${m.command ?? ''} ${m.url ?? ''}`.toLowerCase(),
          detail: [
            m.command ? `${m.command} ${m.args.join(' ')}`.trim() : m.url,
            m.envKeys.length ? `env: ${m.envKeys.join(', ')}` : '',
            m.statusText,
            m.disabledReason ? `disabled via ${m.disabledReason}` : '',
            m.secretsInline ? `${icon.warn} plaintext credential in ${m.source}` : '',
          ].filter(Boolean).join('   '),
        })
      }
    }
  }

  // ---- Agents -----------------------------------------------------------
  {
    const own = report.agents.filter((a) => !a.plugin)
    const renderAgent = (a: typeof report.agents[number], parentKey?: string) => item(ctx, {
      key: `ag:${a.path}`, parentKey, indent: parentKey ? 2 : 1,
      label: a.name, labelColor: color.text,
      meta: a.plugin ?? a.label, metaColor: color.subtext,
      note: a.model ?? (a.hasFrontmatter ? '' : 'no header'),
      noteColor: a.hasFrontmatter ? color.muted : color.yellow,
      path: a.path,
      haystack: `${a.name} ${a.description} ${a.label}`.toLowerCase(),
      detail: a.description || a.path,
    })
    if (section(ctx, 'Agents', report.agents.length, '', color.muted, 'subagents callable from this directory')) {
      for (const a of own) renderAgent(a)
      pluginGroups(ctx, report.agents, (a, key) => renderAgent(a, key))
    }
  }

  // ---- Commands ---------------------------------------------------------
  {
    const own = report.commands.filter((c) => !c.plugin)
    const renderCmd = (c: typeof report.commands[number], parentKey?: string) => item(ctx, {
      key: `cmd:${c.path}`, parentKey, indent: parentKey ? 2 : 1,
      label: `/${c.name}`, labelColor: color.text,
      meta: c.plugin ?? c.label, metaColor: color.subtext,
      note: c.format === 'toml' ? 'toml' : '', noteColor: color.muted,
      path: c.path,
      haystack: `${c.name} ${c.description} ${c.label}`.toLowerCase(),
      detail: c.description || c.path,
    })
    if (section(ctx, 'Commands', report.commands.length, '', color.muted, 'slash commands available here')) {
      for (const c of own) renderCmd(c)
      pluginGroups(ctx, report.commands, (c, key) => renderCmd(c, key))
    }
  }

  // ---- Hooks ------------------------------------------------------------
  {
    const byEvent = new Map<string, number>()
    for (const h of report.hooks) byEvent.set(h.event, (byEvent.get(h.event) ?? 0) + 1)
    const summary = [...byEvent].map(([e, n]) => `${e.replace(/([a-z])([A-Z])/g, '$1$2')} ${n}`).join(` ${icon.dot} `)
    if (section(ctx, 'Hooks', report.hooks.length, summary, color.muted, 'every hook that will fire in this directory')) {
      for (const h of report.hooks) {
        item(ctx, {
          key: `hk:${h.event}:${h.source}:${h.command}`,
          label: h.event, labelColor: color.text,
          meta: h.matcher, metaColor: color.sapphire,
          note: h.plugin ?? h.label, noteColor: color.muted,
          path: h.source,
          haystack: `${h.event} ${h.matcher} ${h.command} ${h.label}`.toLowerCase(),
          detail: `${h.command}${h.statusMessage ? `   “${h.statusMessage}”` : ''}`,
        })
      }
    }
  }

  // ---- Permissions ------------------------------------------------------
  {
    const allow = report.permissions.filter((p) => p.kind === 'allow').length
    const deny = report.permissions.filter((p) => p.kind === 'deny').length
    if (section(ctx, 'Permissions', report.permissions.length, `${allow} allow ${icon.dot} ${deny} deny`, color.muted,
      'merged allow / deny rules across every settings file')) {
      for (const p of report.permissions) {
        item(ctx, {
          key: `pm:${p.kind}:${p.rule}:${p.source}`,
          label: p.rule, labelColor: p.kind === 'deny' ? color.red : color.text,
          meta: p.kind, metaColor: p.kind === 'deny' ? color.red : color.green,
          note: p.label, noteColor: color.muted,
          path: p.source,
          haystack: `${p.rule} ${p.kind} ${p.label}`.toLowerCase(),
          detail: p.source,
        })
      }
    }
  }

  // ---- Plugins ----------------------------------------------------------
  {
    const on = report.plugins.filter((p) => p.enabled).length
    if (section(ctx, 'Plugins', on, `${report.plugins.length - on} off`, color.muted, 'installed plugins and what they contribute')) {
      for (const p of report.plugins) {
        const c = p.contributes
        item(ctx, {
          key: `pl:${p.id}`,
          label: p.name, labelColor: p.enabled ? color.text : color.muted,
          meta: p.version, metaColor: color.subtext,
          note: p.enabled
            ? [c.skills && `${c.skills}s`, c.agents && `${c.agents}a`, c.commands && `${c.commands}c`, c.hooks && `${c.hooks}h`, c.mcp && `${c.mcp}m`].filter(Boolean).join(' ')
            : 'off',
          noteColor: color.muted,
          path: p.installPath,
          haystack: `${p.id} ${p.marketplace}`.toLowerCase(),
          detail: `${p.id}   ${p.installPath || 'not installed'}${p.marketplaceKnown ? '' : `   ${icon.warn} unknown marketplace`}`,
        })
      }
    }
  }

  // ---- Settings ---------------------------------------------------------
  if (section(ctx, 'Settings', report.settings.length, '', color.muted, 'effective settings and where each one came from')) {
    for (const s of report.settings) {
      item(ctx, {
        key: `st:${s.key}`,
        label: s.key, labelColor: color.text,
        meta: s.value, metaColor: color.subtext,
        note: s.label, noteColor: color.muted,
        path: s.source,
        haystack: `${s.key} ${s.value}`.toLowerCase(),
        detail: `${s.value}   ${s.source}${s.overrides.length ? `   overrides ${s.overrides.join(', ')}` : ''}`,
      })
    }
  }

  // ---- Health -----------------------------------------------------------
  {
    const errs = report.health.filter((h) => h.level === 'error').length
    const note = report.health.length === 0
      ? `${icon.good} clean`
      : `${errs ? icon.err : icon.warn} ${errs} error${errs === 1 ? '' : 's'}`
    if (section(ctx, 'Health', report.health.length, note,
      report.health.length === 0 ? color.green : errs ? color.red : color.yellow,
      'problems ccx found in this configuration')) {
      for (const h of report.health) {
        item(ctx, {
          key: `hl:${h.title}:${h.detail}`,
          label: h.title, labelColor: h.level === 'error' ? color.red : color.yellow,
          meta: '', metaColor: color.muted,
          note: '', noteColor: color.muted,
          path: h.path,
          haystack: `${h.title} ${h.detail}`.toLowerCase(),
          detail: h.detail,
        })
      }
    }
  }

  return ctx.rows
}
