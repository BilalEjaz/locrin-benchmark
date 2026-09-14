import { basename } from 'node:path'
import type { ProjectReport } from '../scan/types.js'
import { bytes, color, icon, statusWord } from './theme.js'

const NO_COLOR = Boolean(process.env.NO_COLOR) || !process.stdout.isTTY

function hex(h: string, s: string): string {
  if (NO_COLOR) return s
  const r = parseInt(h.slice(1, 3), 16), g = parseInt(h.slice(3, 5), 16), b = parseInt(h.slice(5, 7), 16)
  return `\x1b[38;2;${r};${g};${b}m${s}\x1b[0m`
}
const bold = (s: string) => (NO_COLOR ? s : `\x1b[1m${s}\x1b[0m`)

function pad(s: string, n: number): string {
  // eslint-disable-next-line no-control-regex
  const plain = s.replace(/\x1b\[[0-9;]*m/g, '')
  return plain.length >= n ? s : s + ' '.repeat(n - plain.length)
}

export interface ReportOptions { width?: number; compact?: boolean }

/** Static, pipe-friendly rendering of the same data the HUD shows. */
export function renderReport(r: ProjectReport, opts: ReportOptions = {}): string {
  const width = opts.width ?? 80
  const out: string[] = []
  const line = (s = '') => out.push(s)

  const head = `${icon.logo} ccx  ${bold(r.name)}`
  line('')
  line(`  ${hex(color.mauve, head)}  ${hex(color.muted, r.scopeChain.join(` ${icon.sep} `))}`)
  if (r.git.isRepo) {
    line(`  ${hex(color.sapphire, r.git.branch ?? 'detached')}${r.git.dirty ? hex(color.yellow, ` ${icon.dirty}${r.git.dirty}`) : ''}  ${hex(color.muted, r.root)}`)
  }
  line('')

  const section = (name: string, count: number, extra = '') => {
    line(`  ${hex(color.mauve, icon.collapsed)} ${bold(pad(name, 13))} ${hex(count ? color.text : color.muted, pad(String(count || '—'), 4))} ${hex(color.muted, extra)}`)
  }
  const item = (a: string, b = '', c = '') => {
    line(`      ${hex(color.text, pad(a, 26))} ${hex(color.subtext, pad(b, 16))} ${hex(color.muted, c)}`)
  }

  section('Memory', r.memory.files.length, r.memory.autoMemoryFiles ? `+ ${r.memory.autoMemoryFiles} auto-memories` : '')
  for (const f of r.memory.files) {
    const note = f.symlinkTo ? 'link' : f.isImportStub ? `→ @${basename(f.imports[0] ?? '')}` : `${f.lines}L ${bytes(f.bytes)}`
    item(f.kind, f.label, note)
  }
  if (r.memory.autoMemoryDirectory) item('memory/', 'auto-memory', `${r.memory.autoMemoryFiles} files`)

  const liveSkills = r.skills.filter((s) => !s.broken)
  const brokenSkills = r.skills.length - liveSkills.length
  section('Skills', liveSkills.length, brokenSkills ? `${icon.warn} ${brokenSkills} broken` : '')
  // plugin skills ship in bulk and would bury the ones this tree actually defines
  const ownSkills = r.skills.filter((s) => !s.plugin)
  if (!opts.compact) {
    for (const s of ownSkills) {
      item(s.name, s.label, s.broken ? 'broken' : s.origin === 'real' ? 'own' : `link${s.hops > 1 ? ` ×${s.hops}` : ''}`)
    }
    const byPlugin = new Map<string, number>()
    for (const s of r.skills) if (s.plugin) byPlugin.set(s.plugin, (byPlugin.get(s.plugin) ?? 0) + 1)
    for (const [plugin, n] of byPlugin) item(`${n} skills`, plugin, 'via plugin')
  }

  section('MCP', r.mcp.length)
  for (const m of r.mcp) item(m.name, m.transport, !m.enabled ? 'off' : m.status === 'unknown' ? m.label : statusWord(m.status))

  const ownAgents = r.agents.filter((a) => !a.plugin)
  section('Agents', r.agents.length, r.agents.length - ownAgents.length ? `${r.agents.length - ownAgents.length} from plugins` : '')
  if (!opts.compact) for (const a of ownAgents) item(a.name, a.label, a.model ?? '')

  const ownCommands = r.commands.filter((c) => !c.plugin)
  section('Commands', r.commands.length, r.commands.length - ownCommands.length ? `${r.commands.length - ownCommands.length} from plugins` : '')
  if (!opts.compact) for (const c of ownCommands) item(`/${c.name}`, c.label, c.format === 'toml' ? 'toml' : '')

  const events = new Map<string, number>()
  for (const h of r.hooks) events.set(h.event, (events.get(h.event) ?? 0) + 1)
  section('Hooks', r.hooks.length, [...events].map(([e, n]) => `${e} ${n}`).join(' · '))
  if (!opts.compact) for (const h of r.hooks) item(h.event, h.matcher, h.plugin ?? h.label)

  const on = r.plugins.filter((p) => p.enabled)
  section('Plugins', on.length, `${r.plugins.length - on.length} off`)
  for (const p of on) item(p.name, p.version, `${p.contributes.skills} skills · ${p.contributes.hooks} hooks`)

  section('Health', r.health.length, r.health.length ? '' : `${icon.good} clean`)
  for (const h of r.health) {
    const c = h.level === 'error' ? color.red : color.yellow
    line(`      ${hex(c, h.level === 'error' ? icon.err : icon.warn)} ${hex(color.text, h.title)}`)
    line(`        ${hex(color.muted, h.detail.slice(0, Math.max(20, width - 10)))}`)
  }

  line('')
  line(`  ${hex(color.muted, `scanned in ${r.durationMs}ms`)}`)
  line('')
  return out.join('\n')
}
