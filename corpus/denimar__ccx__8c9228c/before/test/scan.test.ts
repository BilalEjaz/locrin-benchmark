import { mkdtempSync, mkdirSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

/**
 * Builds a throwaway $HOME containing a layered tree that reproduces every
 * parser edge found on a real machine, then runs the whole scanner over it.
 */
let home: string
let project: string
let scan: typeof import('../src/scan/index.js').scan

function write(path: string, body: string): void {
  mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(path, body)
}

beforeAll(async () => {
  home = mkdtempSync(join(tmpdir(), 'ccx-home-'))
  process.env.HOME = home
  process.env.CCX_ICONS = '0'

  const harness = join(home, 'harness')
  const ws = join(harness, 'ws')
  project = join(ws, 'app')

  // ---- harness root -----------------------------------------------------
  write(join(harness, 'bin', 'sync.sh'), '#!/usr/bin/env bash\n')
  write(join(harness, 'CLAUDE.md'), '# global rules\n')
  write(join(harness, '.claude', 'skills', 'harness-sync', 'SKILL.md'), '---\nname: harness-sync\ndescription: syncs\n---\nbody\n')

  // ---- workspace --------------------------------------------------------
  write(join(ws, 'CLAUDE.md'), '# workspace rules\n')
  write(join(ws, 'projects.yaml'), 'projects:\n  app: https://github.com/org/app.git\n')
  write(join(ws, '.claude', 'skills', 'shared', 'SKILL.md'), '---\nname: shared\ndescription: workspace copy\n---\n')
  write(join(ws, '.mcp.json'), JSON.stringify({ mcpServers: { vanta: { type: 'http', url: 'https://mcp.vanta.com/mcp' } } }))

  // ---- project ----------------------------------------------------------
  write(join(project, 'AGENTS.md'), '# project memory\nreal content\n')
  write(join(project, 'CLAUDE.md'), '@AGENTS.md\n')
  write(join(project, '.claude', 'skills', 'own-skill', 'SKILL.md'), '---\nname: own-skill\ndescription: team owned\n---\n')
  write(join(project, '.claude', 'skills', 'shared', 'SKILL.md'), '---\nname: shared\ndescription: project copy\n---\n')
  // two-hop symlink, mirroring how sync.sh links skills
  symlinkSync(join(ws, '.claude', 'skills', 'shared'), join(project, '.claude', 'skills', 'linked'))
  symlinkSync(join(home, 'does-not-exist'), join(project, '.claude', 'skills', 'dangling'))

  write(join(project, '.claude', 'agents', 'no-frontmatter.md'), '# Just A Heading\n\nprose\n')
  write(join(project, '.claude', 'agents', 'full.md'), '---\nname: full\ndescription: a real agent\nmodel: sonnet\n---\n')
  write(join(project, '.claude', 'agents', 'skipme.md.tmpl'), '---\nname: template\n---\n')
  write(join(project, '.claude', 'commands', 'md-cmd.md'), '---\ndescription: markdown command\nargument-hint: <n>\n---\n')
  write(join(project, '.claude', 'commands', 'toml-cmd.toml'), 'description = "toml command"\nprompt = "do it"\n')

  write(join(project, '.claude', 'settings.json'), JSON.stringify({
    hooks: { PreToolUse: [{ matcher: 'Edit|Write', hooks: [{ type: 'command', command: 'echo hi', timeout: 5 }] }] },
    permissions: { allow: ['Bash(git status)'], deny: ['Read(./secrets/**)'], defaultMode: 'auto' },
  }))
  write(join(project, '.mcp.json'), JSON.stringify({
    mcpServers: {
      // no `type`: must be inferred
      typeless: { command: 'npx', args: ['-y', 'some-server'] },
      sseish: { url: 'https://example.com/sse' },
      leaky: { command: 'npx', args: ['pg-mcp', 'postgres://admin:hunter2@db/app'], env: { TOKEN: 'ghp_abcdefghijklmnopqrstuvwxyz1234' } },
    },
  }))

  // ---- user scope -------------------------------------------------------
  write(join(home, '.claude', 'settings.json'), JSON.stringify({ model: 'opus', enabledPlugins: { 'demo@market': true } }))
  write(join(home, '.claude.json'), JSON.stringify({
    mcpServers: { playwright: { type: 'stdio', command: 'npx', args: ['-y', '@playwright/mcp@latest'], env: {} } },
    projects: { [project]: { enabledMcpjsonServers: ['typeless'], disabledMcpServers: ['sseish'] } },
  }))

  // ---- a plugin, with hooks inline in the manifest ----------------------
  const plugin = join(home, '.claude', 'plugins', 'cache', 'market', 'demo', '1.0.0')
  write(join(plugin, '.claude-plugin', 'plugin.json'), JSON.stringify({
    name: 'demo',
    hooks: { SessionStart: [{ hooks: [{ type: 'command', command: 'node activate.js' }] }] },
  }))
  write(join(plugin, 'skills', 'plugin-skill', 'SKILL.md'), '---\nname: plugin-skill\ndescription: from a plugin\n---\n')
  write(join(plugin, 'hooks', 'hooks.json'), JSON.stringify({
    hooks: { PostToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'node post.mjs' }] }] },
  }))
  write(join(home, '.claude', 'plugins', 'installed_plugins.json'), JSON.stringify({
    version: 2, plugins: { 'demo@market': [{ scope: 'user', installPath: plugin, version: '1.0.0' }] },
  }))
  write(join(home, '.claude', 'plugins', 'known_marketplaces.json'), JSON.stringify({ market: { source: { source: 'github', repo: 'x/y' } } }))

  ;({ scan } = await import('../src/scan/index.js'))
})

afterAll(() => { delete process.env.CCX_ICONS })

describe('scan', () => {
  it('walks up through workspace and harness for memory files', () => {
    const r = scan(project)
    const labels = r.memory.files.map((f) => `${f.label}:${f.kind}`)
    expect(labels).toContain('app:AGENTS.md')
    expect(labels).toContain('ws/:CLAUDE.md')
    expect(labels).toContain('harness:CLAUDE.md')
    expect(r.memory.files.find((f) => f.kind === 'CLAUDE.md' && f.label === 'app')?.isImportStub).toBe(true)
  })

  it('resolves skill provenance, hops, precedence and broken links', () => {
    const r = scan(project)
    const by = (n: string) => r.skills.filter((s) => s.name === n)

    expect(by('own-skill')[0]?.origin).toBe('real')
    expect(by('dangling')[0]?.broken).toBe(true)

    // a symlinked skill keeps the name declared in its SKILL.md, not the link's
    const linked = r.skills.find((s) => s.path.endsWith('/linked'))
    expect(linked?.name).toBe('shared')
    expect(linked?.origin).toBe('link')
    expect(linked?.hops).toBeGreaterThanOrEqual(1)

    // the project copy of `shared` shadows the workspace one
    const shared = by('shared').filter((s) => !s.plugin)
    expect(shared.find((s) => s.scope === 'project')?.winner).toBe(true)
    expect(shared.find((s) => s.scope === 'workspace')?.winner).toBe(false)

    expect(r.skills.some((s) => s.plugin === 'demo' && s.name === 'plugin-skill')).toBe(true)
  })

  it('infers MCP transport when `type` is absent and honours gating flags', () => {
    const r = scan(project)
    const get = (n: string) => r.mcp.find((m) => m.name === n)
    expect(get('typeless')?.transport).toBe('stdio')
    expect(get('sseish')?.transport).toBe('sse')
    expect(get('vanta')?.transport).toBe('http')
    expect(get('sseish')?.enabled).toBe(false)
    expect(get('sseish')?.disabledReason).toBe('disabledMcpServers')
    // approved in ~/.claude.json, so not flagged as pending
    expect(get('typeless')?.status).not.toBe('pending')
    expect(get('vanta')?.status).toBe('pending')
  })

  it('never lets a credential reach the report', () => {
    const json = JSON.stringify(scan(project))
    expect(json).not.toContain('hunter2')
    expect(json).not.toContain('ghp_abcdefghijklmnopqrstuvwxyz1234')
    const leaky = scan(project).mcp.find((m) => m.name === 'leaky')
    expect(leaky?.secretsInline).toBe(true)
    expect(leaky?.envKeys).toEqual(['TOKEN'])
  })

  it('reads agents and commands in every on-disk format', () => {
    const r = scan(project)
    expect(r.agents.map((a) => a.name)).toContain('no-frontmatter')
    expect(r.agents.map((a) => a.name)).not.toContain('template') // .md.tmpl is skipped
    expect(r.agents.find((a) => a.name === 'full')?.model).toBe('sonnet')
    expect(r.commands.find((c) => c.name === 'toml-cmd')?.description).toBe('toml command')
    expect(r.commands.find((c) => c.name === 'md-cmd')?.argumentHint).toBe('<n>')
  })

  it('collects hooks from settings, plugin manifests and hooks.json alike', () => {
    const r = scan(project)
    const events = r.hooks.map((h) => `${h.event}:${h.command}`)
    expect(events).toContain('PreToolUse:echo hi')
    expect(events).toContain('SessionStart:node activate.js')
    expect(events).toContain('PostToolUse:node post.mjs')
  })

  it('reports harness registration and surfaces health issues', () => {
    const r = scan(project)
    expect(r.harness.isHarness).toBe(true)
    expect(r.harness.registered).toBe(true)
    expect(r.health.some((h) => h.title.includes('dangling'))).toBe(true)
    expect(r.health.some((h) => h.title.includes('leaky'))).toBe(true)
    expect(r.permissions.filter((p) => p.kind === 'deny')).toHaveLength(1)
  })
})
