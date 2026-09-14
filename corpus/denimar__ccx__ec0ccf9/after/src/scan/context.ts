import { basename, join } from 'node:path'
import { readJsonc } from '../util/jsonc.js'
import { HOME, ancestors, isDir, isFile, tilde } from '../util/walk.js'
import type { Scope } from './types.js'
import { gitToplevel } from './git.js'

export interface SettingsFile {
  path: string
  scope: Scope
  label: string
  data: Record<string, any>
}

export interface ScanContext {
  root: string
  name: string
  /** nearest-first list of ancestor dirs, $HOME inclusive */
  dirs: string[]
  scopeOf: Map<string, Scope>
  labelOf: Map<string, string>
  /** settings files in precedence order: weakest (user) → strongest (project local) */
  settingsFiles: SettingsFile[]
  claudeJson: Record<string, any>
  /** ~/.claude.json .projects["<projectEntryKey>"] */
  projectEntry: Record<string, any>
  /**
   * The .projects key Claude Code uses for this dir: the exact root when it
   * exists, else the git worktree toplevel (Claude Code keys local scope by
   * repo root, so a subdir of a repo shares its parent's entry), else the
   * nearest ancestor with an entry. undefined when nothing matched.
   */
  projectEntryKey?: string
  harnessRoot?: string
  workspace?: string
  watch: Set<string>
  track(path: string): string
}

function detectHarnessRoot(dirs: string[]): string | undefined {
  return dirs.find((d) => isFile(join(d, 'bin', 'sync.sh')) && isFile(join(d, 'CLAUDE.md')))
}

function detectWorkspace(dirs: string[], harnessRoot?: string): string | undefined {
  if (!harnessRoot) return undefined
  // the workspace is the child of the harness root on our ancestor path
  for (const d of dirs) {
    if (d === harnessRoot) break
    if (isFile(join(d, 'projects.yaml'))) return d
  }
  return undefined
}

function resolveProjectEntryKey(claudeJson: Record<string, any>, root: string, dirs: string[]): string | undefined {
  const projects: Record<string, unknown> = claudeJson.projects ?? {}
  if (projects[root]) return root
  const top = gitToplevel(root)
  if (top && top !== root && projects[top]) return top
  // nearest ancestor (excluding root itself and $HOME) that Claude Code knows about
  return dirs.find((d) => d !== root && d !== HOME && Boolean(projects[d]))
}

export function buildContext(rootInput: string): ScanContext {
  const root = rootInput
  const dirs = ancestors(root)
  const harnessRoot = detectHarnessRoot(dirs)
  const workspace = detectWorkspace(dirs, harnessRoot)

  const scopeOf = new Map<string, Scope>()
  const labelOf = new Map<string, string>()
  for (const d of dirs) {
    let scope: Scope = 'ancestor'
    let label = basename(d) || d
    if (d === root) { scope = 'project'; label = basename(d) }
    else if (d === workspace) { scope = 'workspace'; label = `${basename(d)}/` }
    else if (d === harnessRoot) { scope = 'harness'; label = basename(d) }
    else if (d === HOME) { scope = 'user'; label = '~' }
    scopeOf.set(d, scope)
    labelOf.set(d, label)
  }

  const watch = new Set<string>()
  const track = (p: string) => { watch.add(p); return p }

  // ---- settings files, weakest first -------------------------------------
  const settingsFiles: SettingsFile[] = []
  const pushSettings = (path: string, scope: Scope, label: string) => {
    track(path)
    const data = readJsonc<Record<string, any>>(path)
    if (data) settingsFiles.push({ path, scope, label, data })
  }

  pushSettings(join(HOME, '.claude', 'settings.json'), 'user', 'user')
  // ancestors, farthest → nearest so that nearer files win
  for (const d of [...dirs].reverse()) {
    if (d === HOME) continue
    const scope = scopeOf.get(d)!
    const label = labelOf.get(d)!
    pushSettings(join(d, '.claude', 'settings.json'), scope, label)
    pushSettings(join(d, '.claude', 'settings.local.json'), scope, `${label} (local)`)
  }

  const claudeJson = readJsonc<Record<string, any>>(join(HOME, '.claude.json')) ?? {}
  track(join(HOME, '.claude.json'))
  const projectEntryKey = resolveProjectEntryKey(claudeJson, root, dirs)
  const projectEntry = (projectEntryKey ? claudeJson.projects?.[projectEntryKey] as Record<string, any> | undefined : undefined) ?? {}

  return {
    root,
    name: basename(root),
    dirs,
    scopeOf,
    labelOf,
    settingsFiles,
    claudeJson,
    projectEntry,
    projectEntryKey,
    harnessRoot,
    workspace,
    watch,
    track,
  }
}

/** Scope chain shown in the HUD header: harness › workspace › project */
export function scopeChain(ctx: ScanContext): string[] {
  const out: string[] = []
  if (ctx.harnessRoot) out.push(basename(ctx.harnessRoot))
  if (ctx.workspace && ctx.workspace !== ctx.harnessRoot) out.push(basename(ctx.workspace))
  if (ctx.root !== ctx.workspace && ctx.root !== ctx.harnessRoot) out.push(ctx.name)
  return out.length ? out : [tilde(ctx.root)]
}

export function claudeDir(dir: string): string { return join(dir, '.claude') }
export function hasClaudeDir(dir: string): boolean { return isDir(claudeDir(dir)) }
