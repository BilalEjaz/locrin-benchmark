import { execFile } from 'node:child_process'
import { resolve } from 'node:path'
import { resolveBin } from '../util/env.js'
import { HOME, isDir, isFile } from '../util/walk.js'
import { buildContext, scopeChain } from './context.js'
import { scanAgents } from './agents.js'
import { scanCommands } from './commands.js'
import { scanGit } from './git.js'
import { scanHarness } from './harness.js'
import { scanHealth } from './health.js'
import { scanHooks } from './hooks.js'
import { applyHealth, scanMcp } from './mcp.js'
import { scanMemory } from './memory.js'
import { scanPlugins } from './plugins.js'
import { scanSettings } from './settings.js'
import { scanSkills } from './skills.js'
import type { McpEntry, ProjectReport } from './types.js'

export * from './types.js'
export { permissionMode } from './settings.js'
export { buildContext } from './context.js'

/** Nearest ancestor that looks like a project: a repo, or anything with Claude infra. */
export function findProjectRoot(from: string): string {
  let dir = resolve(from)
  for (;;) {
    if (isDir(`${dir}/.git`) || isDir(`${dir}/.claude`) || isFile(`${dir}/CLAUDE.md`)) return dir
    const parent = resolve(dir, '..')
    if (parent === dir || dir === HOME) return resolve(from)
    dir = parent
  }
}

export function scan(rootInput: string): ProjectReport {
  const started = Date.now()
  const root = resolve(rootInput)
  const ctx = buildContext(root)

  const plugins = scanPlugins(ctx)
  const memory = scanMemory(ctx)
  const skills = scanSkills(ctx, plugins)
  const mcp = scanMcp(ctx, plugins)
  const agents = scanAgents(ctx, plugins)
  const commands = scanCommands(ctx, plugins)
  const hooks = scanHooks(ctx, plugins)
  const settings = scanSettings(ctx)
  const harness = scanHarness(ctx)
  const health = scanHealth(ctx, { skills, mcp, plugins, harness, memory })

  return {
    root,
    name: ctx.name,
    scopeChain: scopeChain(ctx),
    scannedAt: new Date().toISOString(),
    durationMs: Date.now() - started,
    git: scanGit(root),
    memory, skills, mcp, agents, commands, hooks, settings, plugins, harness, health,
    watchPaths: [...ctx.watch],
  }
}

/**
 * `claude mcp list` health-checks every server, so it is slow (seconds) and
 * always runs detached from the first paint.
 */
export function fetchMcpHealth(root: string, entries: McpEntry[]): Promise<McpEntry[]> {
  return new Promise((res) => {
    const claude = resolveBin('claude')
    if (!claude) { res(entries); return }
    execFile(claude, ['mcp', 'list'], { cwd: root, timeout: 30_000, encoding: 'utf8' }, (_err, stdout) => {
      res(applyHealth(entries, stdout ?? ''))
    })
  })
}
