import { spawn } from 'node:child_process'
import { Box, Text, useApp, useInput, useStdout } from 'ink'
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { fetchMcpHealth, scan } from '../scan/index.js'
import type { McpStatus, ProjectReport } from '../scan/types.js'
import { buildRows, SECTIONS, type Row } from './rows.js'
import { color, icon } from './theme.js'

const DEFAULT_OPEN = ['Memory', 'Skills', 'MCP']

/** Cheap identity of everything the panel draws. */
function reportSignature(r: ProjectReport): string {
  return [
    r.git.branch, r.git.dirty,
    r.memory.files.map((f) => f.path + f.bytes).join(','),
    r.skills.map((s) => s.name + s.scope + s.broken).join(','),
    r.mcp.map((m) => m.name + m.transport + m.enabled).join(','),
    r.agents.map((a) => a.path).join(','),
    r.commands.map((c) => c.path).join(','),
    r.hooks.map((h) => h.event + h.command).join(','),
    r.permissions.map((p) => p.kind + p.rule).join(','),
    r.plugins.map((p) => p.id + p.enabled + p.version).join(','),
    r.settings.map((x) => x.key + x.value).join(','),
    r.health.map((h) => h.title).join(','),
  ].join('|')
}

/** Only re-run the (slow) health check when the server set itself changed. */
function mcpSignature(r: ProjectReport): string {
  return r.mcp.map((m) => `${m.name}:${m.transport}:${m.url ?? m.command ?? ''}:${m.enabled}`).join('|')
}

function useTerminalSize(): { columns: number; rows: number } {
  const { stdout } = useStdout()
  const [size, setSize] = useState({ columns: stdout.columns || 80, rows: stdout.rows || 24 })
  useEffect(() => {
    const onResize = () => setSize({ columns: stdout.columns || 80, rows: stdout.rows || 24 })
    stdout.on('resize', onResize)
    return () => { stdout.off('resize', onResize) }
  }, [stdout])
  return size
}

function openInEditor(path: string): void {
  const editor = process.env.VISUAL || process.env.EDITOR
  if (!editor) return
  spawn(editor, [path], { stdio: 'inherit', detached: true }).unref()
}

interface Props { root: string }

export function App({ root }: Props): React.ReactElement {
  const { exit } = useApp()
  const { columns, rows: termRows } = useTerminalSize()

  const [report, setReport] = useState<ProjectReport>(() => scan(root))
  const [mcpLoading, setMcpLoading] = useState(true)
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(DEFAULT_OPEN))
  const [cursor, setCursor] = useState(0)
  const [filter, setFilter] = useState('')
  const [filtering, setFiltering] = useState(false)
  const [showHelp, setShowHelp] = useState(false)
  const [flash, setFlash] = useState<string | null>(null)
  const generation = useRef(0)
  /** last known connection status per server, so a rescan does not wipe it */
  const healthCache = useRef(new Map<string, { status: McpStatus; statusText?: string }>())
  const signature = useRef('')
  const mcpSignatureCache = useRef('')

  const applyCachedHealth = useCallback((list: ProjectReport['mcp']) => list.map((m) => {
    const cached = healthCache.current.get(m.name)
    return cached && cached.status !== 'unknown' ? { ...m, ...cached } : m
  }), [])

  const refresh = useCallback((withHealth: boolean) => {
    const next = scan(root)
    next.mcp = applyCachedHealth(next.mcp)

    // Claude Code rewrites ~/.claude.json constantly; only re-render when the
    // thing we are showing actually changed
    const sig = reportSignature(next)
    const changed = sig !== signature.current
    signature.current = sig
    if (changed || withHealth) setReport(next)

    if (withHealth || (changed && mcpSignature(next) !== mcpSignatureCache.current)) {
      mcpSignatureCache.current = mcpSignature(next)
      const gen = ++generation.current
      setMcpLoading(true)
      void fetchMcpHealth(root, next.mcp.map((m) => ({ ...m }))).then((mcp) => {
        if (gen !== generation.current) return
        for (const m of mcp) healthCache.current.set(m.name, { status: m.status, statusText: m.statusText })
        setReport((r) => ({ ...r, mcp: [...mcp] }))
        setMcpLoading(false)
      })
    }
    return changed
  }, [root, applyCachedHealth])

  // live health on first paint
  useEffect(() => { refresh(true) }, [refresh])

  // watch exactly the paths the scan touched
  useEffect(() => {
    let timer: NodeJS.Timeout | undefined
    let watcher: { close: () => Promise<void> } | undefined
    let cancelled = false
    void import('chokidar').then(({ watch }) => {
      if (cancelled) return
      const w = watch(report.watchPaths, {
        ignoreInitial: true,
        depth: 2,
        followSymlinks: false,
        awaitWriteFinish: { stabilityThreshold: 120, pollInterval: 30 },
      })
      watcher = w as unknown as { close: () => Promise<void> }
      const onChange = () => {
        clearTimeout(timer)
        timer = setTimeout(() => {
          if (refresh(false)) {
            setFlash('updated')
            setTimeout(() => setFlash(null), 1400)
          }
        }, 250)
      }
      w.on('add', onChange).on('change', onChange).on('unlink', onChange)
        .on('addDir', onChange).on('unlinkDir', onChange)
    })
    return () => { cancelled = true; clearTimeout(timer); void watcher?.close() }
    // re-arm only when the watch set itself changes
  }, [report.watchPaths.join('|'), refresh])

  const allRows = useMemo(() => buildRows(report, expanded, mcpLoading), [report, expanded, mcpLoading])

  const allKeys = useMemo(() => {
    const keys: string[] = [...SECTIONS]
    for (const [sectionName, items] of [
      ['Skills', report.skills], ['Agents', report.agents], ['Commands', report.commands],
    ] as const) {
      for (const it of items) if (it.plugin) keys.push(`${sectionName}/${it.plugin}`)
    }
    return [...new Set(keys)]
  }, [report])

  const visible = useMemo(() => {
    if (!filter) return allRows
    const q = filter.toLowerCase()
    const hits = allRows.filter((r) => r.kind === 'item' && r.haystack.includes(q))
    const sections = new Set(hits.map((h) => h.section))
    return allRows.filter((r) => (r.kind === 'section' ? sections.has(r.section) : hits.includes(r)))
  }, [allRows, filter])

  const clamped = Math.min(cursor, Math.max(visible.length - 1, 0))
  const current = visible[clamped]

  const chrome = 7 // header box + scope line + detail box + footer
  const listHeight = Math.max(3, termRows - chrome)
  const start = Math.max(0, Math.min(clamped - Math.floor(listHeight / 2), visible.length - listHeight))
  const window = visible.slice(start, start + listHeight)

  useInput((rawInput, key) => {
    if (showHelp) { setShowHelp(false); return }

    // a paste, or a fast burst, arrives as one chunk: the first character is
    // the command, the rest is text only the filter cares about
    const input = filtering ? rawInput : (rawInput.length > 1 ? rawInput[0] ?? '' : rawInput)
    if (!filtering && rawInput.length > 1 && rawInput.startsWith('/')) {
      setFiltering(true)
      setFilter(rawInput.slice(1))
      setCursor(0)
      return
    }

    if (filtering) {
      if (key.escape) { setFiltering(false); setFilter(''); return }
      if (key.return) { setFiltering(false); return }
      if (key.backspace || key.delete) { setFilter((f) => f.slice(0, -1)); return }
      if (input && !key.ctrl && !key.meta) setFilter((f) => f + input)
      return
    }

    if (input === 'q' || key.escape) { exit(); return }
    if (input === '?') { setShowHelp(true); return }
    if (input === '/') { setFiltering(true); setFilter(''); setCursor(0); return }
    if (input === 'r') { refresh(true); setFlash('rescanned'); setTimeout(() => setFlash(null), 1200); return }
    if (input === 'o' && current?.path) { openInEditor(current.path); return }

    if (key.downArrow || input === 'j') { setCursor((c) => Math.min(c + 1, visible.length - 1)); return }
    if (key.upArrow || input === 'k') { setCursor((c) => Math.max(c - 1, 0)); return }
    if (key.pageDown) { setCursor((c) => Math.min(c + listHeight, visible.length - 1)); return }
    if (key.pageUp) { setCursor((c) => Math.max(c - listHeight, 0)); return }

    const toggle = (name: string, open?: boolean) => setExpanded((prev) => {
      const next = new Set(prev)
      const want = open ?? !next.has(name)
      if (want) next.add(name); else next.delete(name)
      return next
    })

    if (key.rightArrow || key.return || input === 'l') { if (current) toggle(current.expandKey, true); return }
    if (key.leftArrow || input === 'h') {
      if (!current) return
      // on a header, collapse it; on a child, collapse the group it belongs to
      const target = current.kind === 'item' ? current.parentKey : current.expandKey
      toggle(target, false)
      const idx = visible.findIndex((r) => r.expandKey === target && r.kind !== 'item')
      if (idx >= 0) setCursor(idx)
      return
    }
    if (input === 'a') { setExpanded(new Set(allKeys)); return }
    if (input === 'z') { setExpanded(new Set()); setCursor(0); return }

    const n = Number.parseInt(input, 10)
    if (!Number.isNaN(n) && n >= 1 && n <= SECTIONS.length) {
      const name = SECTIONS[n - 1]!
      toggle(name, true)
      const idx = allRows.findIndex((r) => r.kind === 'section' && r.section === name)
      if (idx >= 0) setCursor(idx)
    }
  })

  const narrow = columns < 62
  const veryNarrow = columns < 40
  const inner = Math.max(20, columns - 3) // cursor gutter + two column gaps
  const labelW = Math.max(10, Math.floor(inner * (narrow ? 0.5 : 0.44)))
  const metaW = veryNarrow ? 0 : Math.max(6, Math.floor(inner * 0.22))
  const noteW = Math.max(0, inner - labelW - metaW - 1)

  if (showHelp) return <HelpView columns={columns} />

  return (
    <Box flexDirection="column" width={columns}>
      <Header report={report} columns={columns} flash={flash} />

      <Box flexDirection="column" height={listHeight} overflow="hidden">
        {window.map((row, i) => {
          const selected = start + i === clamped
          return (
            <RowView
              key={row.key}
              row={row}
              selected={selected}
              labelW={labelW}
              metaW={metaW}
              noteW={noteW}
            />
          )
        })}
        {visible.length === 0 && (
          <Text color={color.muted}>  no match for “{filter}”</Text>
        )}
      </Box>

      <Box borderStyle="single" borderColor={color.surface} paddingX={1} height={3} flexDirection="column">
        <Text color={color.subtext} wrap="truncate-end">
          {current?.detail ?? ''}
        </Text>
      </Box>

      <Footer filtering={filtering} filter={filter} columns={columns} />
    </Box>
  )
}

function Header({ report, columns, flash }: { report: ProjectReport; columns: number; flash: string | null }): React.ReactElement {
  const g = report.git
  const errors = report.health.filter((h) => h.level === 'error').length
  const warns = report.health.filter((h) => h.level === 'warn').length
  return (
    <Box flexDirection="column">
      <Box borderStyle="round" borderColor={color.mauve} paddingX={1} width={columns} justifyContent="space-between">
        <Box>
          <Text color={color.mauve} bold>{icon.logo} ccx </Text>
          <Text color={color.text} bold>{report.name}</Text>
          <Text color={color.muted}>  </Text>
          {g.isRepo && <Text color={color.sapphire}>{g.branch ?? 'detached'}</Text>}
          {g.dirty > 0 && <Text color={color.yellow}> {icon.dirty}{g.dirty}</Text>}
        </Box>
        <Box>
          {flash
            ? <Text color={color.green}>{icon.good} {flash}</Text>
            : errors > 0
              ? <Text color={color.red}>{icon.err} {errors}{warns > 0 ? <Text color={color.yellow}>  {icon.warn} {warns}</Text> : null}</Text>
              : warns > 0
                ? <Text color={color.yellow}>{icon.warn} {warns}</Text>
                : <Text color={color.green}>{icon.good} clean</Text>}
        </Box>
      </Box>
      <Box paddingX={1}>
        <Text color={color.muted} wrap="truncate-end">
          {report.scopeChain.join(` ${icon.sep} `)}
        </Text>
      </Box>
    </Box>
  )
}

function RowView({ row, selected, labelW, metaW, noteW }: {
  row: Row; selected: boolean; labelW: number; metaW: number; noteW: number
}): React.ReactElement {
  const pad = ' '.repeat(row.indent === 0 ? 1 : row.indent === 1 ? 3 : 5)
  return (
    <Box>
      <Text color={selected ? color.mauve : color.surface}>{selected ? '❯' : ' '}</Text>
      <Box width={labelW} marginRight={1}>
        <Text
          color={selected ? color.text : row.labelColor}
          bold={row.kind === 'section'}
          wrap="truncate-end"
        >
          {pad}{row.label}
        </Text>
      </Box>
      {metaW > 0 && (
        <Box width={metaW} marginRight={1}>
          <Text color={row.metaColor} wrap="truncate-end">{row.meta}</Text>
        </Box>
      )}
      {noteW > 0 && (
        <Box width={noteW}>
          <Text color={row.noteColor} wrap="truncate-end">{row.note ?? ''}</Text>
        </Box>
      )}
    </Box>
  )
}

function Footer({ filtering, filter, columns }: { filtering: boolean; filter: string; columns: number }): React.ReactElement {
  if (filtering || filter) {
    return (
      <Box paddingX={1} width={columns}>
        <Text color={color.mauve}>/ </Text>
        <Text color={color.text}>{filter}</Text>
        <Text color={color.muted}>{filtering ? '▏' : ''}  esc clear</Text>
      </Box>
    )
  }
  const all: Array<[string, string]> = [
    ['↑↓', 'move'], ['→', 'open'], ['o', 'edit'], ['/', 'filter'], ['r', 'rescan'], ['?', 'help'], ['q', 'quit'],
  ]
  const keys = columns < 46 ? all.slice(0, 3).concat([['?', 'help']]) : columns < 66 ? all.slice(0, 5) : all
  return (
    <Box paddingX={1} width={columns}>
      <Text wrap="truncate-end">
        {keys.map(([k, v], i) => (
          <React.Fragment key={k}>
            {i > 0 && <Text color={color.surface}>  </Text>}
            <Text color={color.mauve}>{k}</Text>
            <Text color={color.muted}> {v}</Text>
          </React.Fragment>
        ))}
      </Text>
    </Box>
  )
}

function HelpView({ columns }: { columns: number }): React.ReactElement {
  const lines: Array<[string, string]> = [
    ['↑ ↓ / j k', 'move the cursor'],
    ['→ / enter', 'expand the focused section'],
    ['← / h', 'collapse it'],
    ['1 … 0', 'jump to section by number'],
    ['a / z', 'expand all / collapse all'],
    ['o', 'open the focused file in $EDITOR'],
    ['/', 'fuzzy filter every row'],
    ['r', 'rescan + re-check MCP health'],
    ['q / esc', 'quit'],
  ]
  return (
    <Box flexDirection="column" width={columns} borderStyle="round" borderColor={color.mauve} paddingX={1}>
      <Text color={color.mauve} bold>{icon.logo} ccx — keys</Text>
      <Text> </Text>
      {lines.map(([k, v]) => (
        <Box key={k}>
          <Box width={14}><Text color={color.sapphire}>{k}</Text></Box>
          <Text color={color.subtext}>{v}</Text>
        </Box>
      ))}
      <Text> </Text>
      <Text color={color.muted}>the panel rescans itself whenever Claude edits a config file</Text>
      <Text color={color.muted}>press any key to go back</Text>
    </Box>
  )
}
