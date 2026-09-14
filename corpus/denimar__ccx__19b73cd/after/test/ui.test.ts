import { describe, expect, it } from 'vitest'
import type { ProjectReport } from '../src/scan/types.js'
import { densify, fit, metrics, thumb, truncMiddle, windowStart } from '../src/ui/layout.js'
import { buildRows, problemsFirst, type Row } from '../src/ui/rows.js'

function report(over: Partial<ProjectReport> = {}): ProjectReport {
  return {
    root: '/tmp/app', name: 'app', scopeChain: ['ws', 'app'], scannedAt: '', durationMs: 1,
    git: { isRepo: true, branch: 'master', dirty: 0 },
    memory: { files: [], autoMemoryFiles: 0 },
    skills: [], mcp: [], agents: [], commands: [], hooks: [], permissions: [], settings: [], plugins: [],
    harness: { isHarness: false, orphanLayers: [] },
    health: [], watchPaths: [],
    ...over,
  }
}

function skill(name: string, over: Partial<ProjectReport['skills'][number]> = {}): ProjectReport['skills'][number] {
  return {
    name, description: '', path: `/tmp/app/.claude/skills/${name}`, realPath: `/tmp/app/.claude/skills/${name}`,
    scope: 'project', label: 'app', origin: 'real', hops: 0, broken: false, winner: true, shadows: [],
    disableModelInvocation: false, ...over,
  }
}

function mcp(name: string, over: Partial<ProjectReport['mcp'][number]> = {}): ProjectReport['mcp'][number] {
  return {
    name, transport: 'stdio', args: [], envKeys: [], scope: 'user', label: 'user',
    source: '~/.claude.json', enabled: true, status: 'connected', secretsInline: false, ...over,
  }
}

const rowsOf = (r: ProjectReport, open: string[]) => buildRows(r, new Set(open), false)
const labels = (rows: Row[], section: string) =>
  rows.filter((x) => x.section === section && x.kind === 'item').map((x) => x.label)
const stateOf = (rows: Row[], label: string) => rows.find((x) => x.label === label)?.state

describe('buildRows', () => {
  it('floats broken skills and failed servers to the top of their section', () => {
    const rows = rowsOf(report({
      skills: [skill('alpha'), skill('dangling', { broken: true }), skill('beta')],
      mcp: [mcp('good'), mcp('bad', { status: 'failed' }), mcp('needs-auth', { status: 'auth' })],
    }), ['Skills', 'MCP'])

    expect(labels(rows, 'Skills')[0]).toBe('dangling')
    expect(labels(rows, 'MCP')).toEqual(['bad', 'needs-auth', 'good', ])
  })

  it('says the state in words, not glyphs', () => {
    const rows = rowsOf(report({
      skills: [skill('own-one'), skill('linked', { origin: 'link', hops: 2 }), skill('gone', { broken: true })],
      mcp: [mcp('live'), mcp('sleeping', { enabled: false })],
    }), ['Skills', 'MCP'])

    expect(stateOf(rows, 'own-one')).toBe('own')
    expect(stateOf(rows, 'linked')).toBe('link ×2')
    expect(stateOf(rows, 'gone')).toBe('broken')
    expect(stateOf(rows, 'live')).toBe('ready')
    expect(stateOf(rows, 'sleeping')).toBe('off')
  })

  it('opens every section with a spacer except the first', () => {
    const rows = rowsOf(report(), [])
    expect(rows[0]?.kind).toBe('section')
    const sections = rows.filter((r) => r.kind === 'section')
    const spacers = rows.filter((r) => r.kind === 'spacer')
    expect(spacers).toHaveLength(sections.length - 1)
    for (const s of spacers) expect(s.label).toBe('')
  })

  it('never emits a second text column', () => {
    const rows = rowsOf(report({ skills: [skill('one')] }), ['Skills'])
    for (const r of rows) expect(Object.keys(r)).not.toContain('meta')
  })

  it('keeps a stable order for equal severity', () => {
    const rows = [
      { key: 'a', severity: 0 }, { key: 'b', severity: 2 }, { key: 'c', severity: 0 }, { key: 'd', severity: 2 },
    ] as Row[]
    expect(problemsFirst(rows).map((r) => r.key)).toEqual(['b', 'd', 'a', 'c'])
  })
})

describe('metrics', () => {
  it('drops the state column only when the pane is too narrow for two zones', () => {
    expect(metrics(28, 40).showState).toBe(false)
    expect(metrics(38, 40).showState).toBe(true)
    expect(metrics(46, 40).showSummary).toBe(false)
    expect(metrics(64, 40).showSummary).toBe(true)
    expect(metrics(80, 40).stateW).toBeGreaterThan(metrics(46, 40).stateW)
  })

  it('always leaves room for the name, the scrollbar and the chrome', () => {
    for (const columns of [28, 30, 38, 46, 64, 80, 120]) {
      const m = metrics(columns, 44, { alert: true })
      const used = 2 + m.nameW + (m.showState ? m.stateW + 2 : 0) + 1
      expect(used).toBeLessThanOrEqual(Math.max(columns, 12))
      expect(m.nameW).toBeGreaterThan(7)
    }
    expect(metrics(64, 10).listHeight).toBeGreaterThanOrEqual(3)
    expect(metrics(64, 44, { alert: true }).listHeight).toBe(metrics(64, 44).listHeight - 1)
  })
})

describe('densify', () => {
  const rows = [
    { kind: 'section' }, { kind: 'item' }, { kind: 'spacer' }, { kind: 'section' }, { kind: 'item' },
  ] as Array<{ kind: string }>

  it('keeps the breathing room when everything fits', () => {
    expect(densify(rows, 10)).toHaveLength(5)
  })

  it('drops spacers when that is what makes it fit', () => {
    expect(densify(rows, 4).map((r) => r.kind)).not.toContain('spacer')
  })

  it('keeps them when it has to scroll either way', () => {
    expect(densify(rows, 2)).toHaveLength(5)
  })
})

describe('scroll window', () => {
  it('centres the cursor and stops at both ends', () => {
    expect(windowStart(100, 10, 0)).toBe(0)
    expect(windowStart(100, 10, 50)).toBe(45)
    expect(windowStart(100, 10, 99)).toBe(90)
    expect(windowStart(5, 10, 3)).toBe(0)
  })

  it('shows a thumb only when the list overflows, and never past the track', () => {
    expect(thumb(5, 10, 0)).toBeNull()
    const top = thumb(100, 10, 0)!
    const bottom = thumb(100, 10, 90)!
    expect(top.from).toBe(0)
    expect(bottom.to).toBeLessThanOrEqual(9)
    expect(bottom.from).toBeGreaterThan(top.from)
  })
})

describe('text fitting', () => {
  it('truncates names at the end and paths in the middle', () => {
    expect(fit('short', 10)).toBe('short')
    expect(fit('a-very-long-name', 8)).toBe('a-very-…')
    expect(truncMiddle('/home/me/projects/app/.claude/settings.json', 20)).toHaveLength(20)
    expect(truncMiddle('/home/me/x.json', 40)).toBe('/home/me/x.json')
    expect(truncMiddle('~/a/b/c/settings.json', 12)).toMatch(/^~\/a.*json$/)
  })
})
