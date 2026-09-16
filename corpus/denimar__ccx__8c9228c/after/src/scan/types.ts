/** Where a piece of infra came from. Ordered loosest → tightest. */
export type Scope = 'user' | 'plugin' | 'ancestor' | 'harness' | 'workspace' | 'project'

export type Health = 'ok' | 'warn' | 'error'

export interface MemoryFile {
  kind: 'CLAUDE.md' | 'CLAUDE.local.md' | 'AGENTS.md'
  path: string
  dir: string
  scope: Scope
  label: string
  bytes: number
  lines: number
  imports: string[]
  symlinkTo?: string
  isImportStub: boolean
}

export interface MemoryInfo {
  files: MemoryFile[]
  autoMemoryDirectory?: string
  autoMemoryFiles: number
  autoMemorySource?: string
}

export interface SkillEntry {
  name: string
  description: string
  path: string
  realPath: string
  scope: Scope
  label: string
  origin: 'real' | 'link'
  hops: number
  broken: boolean
  winner: boolean
  shadows: string[]
  disableModelInvocation: boolean
  allowedTools?: string
  plugin?: string
}

export type Transport = 'stdio' | 'http' | 'sse' | 'ws' | 'unknown'
export type McpStatus = 'connected' | 'failed' | 'auth' | 'pending' | 'unknown'

export interface McpEntry {
  name: string
  transport: Transport
  command?: string
  args: string[]
  url?: string
  envKeys: string[]
  scope: Scope
  label: string
  source: string
  enabled: boolean
  /** disabled via disabledMcpServers / disabledMcpjsonServers */
  disabledReason?: string
  status: McpStatus
  statusText?: string
  secretsInline: boolean
}

export interface AgentEntry {
  name: string
  description: string
  path: string
  scope: Scope
  label: string
  model?: string
  tools?: string
  mcpServers?: string
  hasFrontmatter: boolean
  plugin?: string
}

export interface CommandEntry {
  name: string
  description: string
  path: string
  scope: Scope
  label: string
  argumentHint?: string
  format: 'md' | 'toml'
  plugin?: string
}

export interface HookEntry {
  event: string
  matcher: string
  command: string
  type: string
  timeout?: number
  statusMessage?: string
  source: string
  scope: Scope
  label: string
  plugin?: string
}

export interface SettingEntry {
  key: string
  value: string
  source: string
  scope: Scope
  label: string
  overrides: string[]
}

export interface PluginEntry {
  id: string
  name: string
  marketplace: string
  version: string
  enabled: boolean
  enabledSource?: string
  scope: Scope
  label: string
  installPath: string
  marketplaceKnown: boolean
  installed: boolean
  contributes: { skills: number; agents: number; commands: number; hooks: number; mcp: number }
}

export interface HarnessInfo {
  isHarness: boolean
  harnessRoot?: string
  workspace?: string
  projectLayer?: string
  registered?: boolean
  registryPath?: string
  orphanLayers: string[]
  envrc?: string
  secretsEnv?: string
}

export interface HealthIssue {
  level: Health
  title: string
  detail: string
  path?: string
}

export interface GitInfo {
  isRepo: boolean
  branch?: string
  dirty: number
  remote?: string
}

export interface ProjectReport {
  root: string
  name: string
  scopeChain: string[]
  scannedAt: string
  durationMs: number
  git: GitInfo
  memory: MemoryInfo
  skills: SkillEntry[]
  mcp: McpEntry[]
  agents: AgentEntry[]
  commands: CommandEntry[]
  hooks: HookEntry[]
  settings: SettingEntry[]
  plugins: PluginEntry[]
  harness: HarnessInfo
  health: HealthIssue[]
  watchPaths: string[]
}
