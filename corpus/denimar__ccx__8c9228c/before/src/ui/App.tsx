import { spawn } from 'node:child_process'
import { Box, Text, useApp, useInput, useStdout } from 'ink'
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { fetchMcpHealth, scan } from '../scan/index.js'
import type { McpStatus, ProjectReport } from '../scan/types.js'
import { tilde } from '../util/walk.js'
import { densify, metrics, thumb, truncMiddle, windowStart } from './layout.js'
import { buildRows, SECTIONS, type Row } from './rows.js'
import { color, icon, SCOPES, scopeColor } from './theme.js'

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
  /** a row to land on once the list has been rebuilt around it */
  const [focusKey, setFocusKey] = useState<string | null>(null)
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

  const errors = report.health.filter((h) => h.level === 'error').length
  const warns = report.health.length - errors
  const hasAlert = report.health.length > 0
  const m = metrics(columns, termRows, { alert: hasAlert })

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

  const matches = useMemo(() => {
    if (!filter) return null
    const q = filter.toLowerCase()
    return allRows.filter((r) => r.kind === 'item' && r.haystack.includes(q))
  }, [allRows, filter])

  const visible = useMemo(() => {
    if (!matches) return allRows
    const sections = new Set(matches.map((h) => h.section))
    // filtering is a dense mode: the breathing room goes away with the noise
    return allRows.filter((r) => r.kind !== 'spacer'
      && (r.kind === 'section' ? sections.has(r.section) : matches.includes(r)))
  }, [allRows, matches])

  const list = useMemo(() => densify(visible, m.listHeight), [visible, m.listHeight])

  const clamped = Math.min(cursor, Math.max(list.length - 1, 0))
  const current = list[clamped]?.kind === 'spacer' ? list[clamped + 1] ?? list[clamped - 1] : list[clamped]

  const start = windowStart(list.length, m.listHeight, clamped)
  const bar = thumb(list.length, m.listHeight, start)

  // the section the top of the window belongs to, pinned so a long scroll
  // never leaves you wondering what you are looking at
  const stickyName = useMemo(() => {
    const top = list[start]
    if (!top || top.kind === 'section') return null
    for (let i = start; i >= 0; i--) if (list[i]?.kind === 'section') return list[i]!.section
    return null
  }, [list, start])

  const windowRows = list.slice(start, start + m.listHeight - (stickyName ? 1 : 0))

  // expanding a section reflows the list, so jumps land by key, not by index
  useEffect(() => {
    if (!focusKey) return
    const idx = list.findIndex((r) => r.key === focusKey)
    if (idx >= 0) setCursor(idx)
    setFocusKey(null)
  }, [focusKey, list])

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

    /** never land on a blank spacer row */
    const step = (from: number, dir: 1 | -1, by = 1): number => {
      let i = Math.max(0, Math.min(from + dir * by, list.length - 1))
      while (list[i]?.kind === 'spacer') {
        const next = i + dir
        if (next < 0 || next >= list.length) { i -= dir; break }
        i = next
      }
      return Math.max(0, Math.min(i, list.length - 1))
    }

    const toggle = (name: string, open?: boolean) => setExpanded((prev) => {
      const next = new Set(prev)
      const want = open ?? !next.has(name)
      if (want) next.add(name); else next.delete(name)
      return next
    })

    const jumpTo = (name: string) => {
      toggle(name, true)
      setFocusKey(`s:${name}`)
    }

    if (input === 'q' || key.escape) { exit(); return }
    if (input === '?') { setShowHelp(true); return }
    if (input === '/') { setFiltering(true); setFilter(''); setCursor(0); return }
    if (input === 'r') { refresh(true); setFlash('rescanned'); setTimeout(() => setFlash(null), 1200); return }
    if (input === '!') { setFilter(''); setFiltering(false); jumpTo('Health'); return }
    if (input === 'o' && current?.path) { openInEditor(current.path); return }

    if (key.downArrow || input === 'j') { setCursor((c) => step(Math.min(c, list.length - 1), 1)); return }
    if (key.upArrow || input === 'k') { setCursor((c) => step(Math.min(c, list.length - 1), -1)); return }
    if (key.pageDown) { setCursor((c) => step(c, 1, m.listHeight)); return }
    if (key.pageUp) { setCursor((c) => step(c, -1, m.listHeight)); return }

    if (key.rightArrow || key.return || input === 'l') { if (current) toggle(current.expandKey, true); return }
    if (key.leftArrow || input === 'h') {
      if (!current) return
      // on a header, collapse it; on a child, collapse the group it belongs to
      const target = current.kind === 'item' ? current.parentKey : current.expandKey
      toggle(target, false)
      const header = list.find((r) => r.expandKey === target && r.kind !== 'item' && r.kind !== 'spacer')
      if (header) setFocusKey(header.key)
      return
    }
    if (input === 'a') { setExpanded(new Set(allKeys)); return }
    if (input === 'z') { setExpanded(new Set()); setCursor(0); return }

    const n = input === '0' ? 10 : Number.parseInt(input, 10)
    if (!Number.isNaN(n) && n >= 1 && n <= SECTIONS.length) jumpTo(SECTIONS[n - 1]!)
  })

  if (showHelp) return <HelpView columns={columns} />

  return (
    <Box flexDirection="column" width={columns}>
      <Header report={report} columns={columns} flash={flash} />
      <Text> </Text>

      <Box flexDirection="column" height={m.listHeight} overflow="hidden">
        {stickyName && (
          <Box>
            <Box width={2}><Text> </Text></Box>
            <Text color={color.overlay} wrap="truncate-end">{stickyName}</Text>
          </Box>
        )}
        {windowRows.map((row, i) => (
          <RowView
            key={row.key}
            row={row}
            selected={start + i === clamped}
            scroll={bar && i >= bar.from && i <= bar.to ? 'thumb' : bar ? 'track' : 'none'}
            nameW={m.nameW}
            stateW={m.showState ? m.stateW : 0}
            summaries={m.showSummary}
          />
        ))}
        {list.length === 0 && (
          <Box>
            <Box width={2}><Text> </Text></Box>
            <Text color={color.muted}>nothing matches “{filter}”</Text>
          </Box>
        )}
      </Box>

      <Text color={color.surface}>{icon.rule.repeat(Math.max(1, columns))}</Text>
      {hasAlert && <AlertLine errors={errors} warns={warns} />}
      <Inspector row={current} columns={columns} />
      <Footer
        filtering={filtering}
        filter={filter}
        hits={matches?.length ?? 0}
        hasAlert={hasAlert}
        columns={columns}
      />
    </Box>
  )
}

function Header({ report, columns, flash }: { report: ProjectReport; columns: number; flash: string | null }): React.ReactElement {
  const g = report.git
  return (
    <Box flexDirection="column">
      <Box width={columns} justifyContent="space-between">
        <Box>
          <Text color={color.mauve} bold>{icon.logo} ccx </Text>
          <Text color={color.text} bold wrap="truncate-end">{report.name}</Text>
        </Box>
        <Box>
          {flash
            ? <Text color={color.green}>{icon.good} {flash}</Text>
            : (
              <>
                {g.isRepo && <Text color={color.sapphire}>{g.branch ?? 'detached'}</Text>}
                {g.dirty > 0 && <Text color={color.yellow}> {icon.dirty}{g.dirty}</Text>}
              </>
            )}
        </Box>
      </Box>
      <Text color={color.muted} wrap="truncate-end">{report.scopeChain.join(` ${icon.sep} `)}</Text>
    </Box>
  )
}

function RowView({ row, selected, scroll, nameW, stateW, summaries }: {
  row: Row; selected: boolean; scroll: 'thumb' | 'track' | 'none'; nameW: number; stateW: number; summaries: boolean
}): React.ReactElement {
  const scrollChar = scroll === 'thumb' ? icon.thumb : scroll === 'track' ? icon.track : ' '
  if (row.kind === 'spacer') {
    return (
      <Box>
        <Box width={2}><Text> </Text></Box>
        <Box flexGrow={1}><Text> </Text></Box>
        <Text color={scroll === 'thumb' ? color.overlay : color.surface}>{scrollChar}</Text>
      </Box>
    )
  }
  const pad = ' '.repeat(row.indent * 2)
  // a narrow pane keeps the count and drops the section summary rather than
  // truncating both into `70 · ▲4 bro…`
  const state = !summaries && row.kind === 'section' ? (row.state ?? '').split(` ${icon.dot} `)[0] : row.state
  const labelColor = selected
    ? (row.severity === 2 ? color.red : color.text)
    : row.labelColor
  return (
    <Box>
      <Box width={2}>
        <Text color={selected ? color.mauve : color.surface}>{selected ? icon.marker : ' '}</Text>
      </Box>
      <Box width={nameW}>
        <Text color={labelColor} bold={row.bold || selected} wrap="truncate-end">{pad}{row.label}</Text>
      </Box>
      {stateW > 0 && (
        <Box width={stateW} marginLeft={2} justifyContent="flex-end">
          <Text color={row.stateColor ?? color.muted} wrap="truncate-end">{state ?? ''}</Text>
        </Box>
      )}
      <Text color={scroll === 'thumb' ? color.overlay : color.surface}>{scrollChar}</Text>
    </Box>
  )
}

function AlertLine({ errors, warns }: { errors: number; warns: number }): React.ReactElement {
  const tone = errors ? color.red : color.yellow
  const glyph = errors ? icon.err : icon.warn
  return (
    <Box>
      <Text color={tone}>{glyph} {errors || warns} {errors ? `error${errors === 1 ? '' : 's'}` : `warning${warns === 1 ? '' : 's'}`}</Text>
      {errors > 0 && warns > 0 && <Text color={color.yellow}>  {icon.warn} {warns}</Text>}
      <Text color={color.muted}>   press !</Text>
    </Box>
  )
}

function Inspector({ row, columns }: { row?: Row; columns: number }): React.ReactElement {
  const width = Math.max(10, columns - 1)
  return (
    <Box flexDirection="column">
      <Text color={color.subtext} wrap="truncate-end">{row?.detail ?? ''}</Text>
      <Text color={color.muted}>{row?.path ? truncMiddle(tilde(row.path), width) : ''}</Text>
    </Box>
  )
}

function Footer({ filtering, filter, hits, hasAlert, columns }: {
  filtering: boolean; filter: string; hits: number; hasAlert: boolean; columns: number
}): React.ReactElement {
  if (filtering || filter) {
    return (
      <Box width={columns}>
        <Text color={color.mauve}>/</Text>
        <Text color={color.text}>{filter}</Text>
        <Text color={color.muted}>{filtering ? '▏' : ''}  {hits} match{hits === 1 ? '' : 'es'}  {icon.dot}  esc clear</Text>
      </Box>
    )
  }
  // always keep `?`: it is the way back to everything that did not fit
  const core: Array<[string, string]> = [['↑↓', 'move'], ['→', 'open']]
  const alert: Array<[string, string]> = hasAlert ? [['!', 'problems']] : []
  const rest: Array<[string, string]> = [['o', 'edit'], ['/', 'filter'], ['r', 'rescan'], ['q', 'quit']]
  const keys: Array<[string, string]> = columns < 52
    ? [...core, ...alert.slice(0, 1)]
    : columns < 62
      ? [...core, ...alert, ...rest.slice(1, 2)]
      : columns < 80
        ? [...core, ...alert, ...rest.slice(0, 2)]
        : [...core, ...alert, ...rest]
  keys.push(['?', 'keys'])
  return (
    <Box width={columns}>
      <Text wrap="truncate-end">
        {keys.map(([k, v], i) => (
          <React.Fragment key={k}>
            {i > 0 && <Text color={color.surface}>   </Text>}
            <Text color={color.mauve}>{k}</Text>
            <Text color={color.muted}> {v}</Text>
          </React.Fragment>
        ))}
      </Text>
    </Box>
  )
}

function HelpView({ columns }: { columns: number }): React.ReactElement {
  const keys: Array<[string, string]> = [
    ['↑ ↓ / j k', 'move the cursor'],
    ['→ / enter', 'expand the focused section'],
    ['← / h', 'collapse it'],
    ['1 … 0', 'jump to section by number'],
    ['!', 'jump to Health'],
    ['a / z', 'expand all / collapse all'],
    ['o', 'open the focused file in $EDITOR'],
    ['/', 'fuzzy filter every row'],
    ['r', 'rescan + re-check MCP health'],
    ['q / esc', 'quit'],
  ]
  const states: Array<[string, string]> = [
    ['own', 'a real directory in this tree'],
    ['link', 'a symlink (×n = hops)'],
    ['broken', 'the link target is gone'],
    ['ready / failed / auth', 'live MCP health'],
    ['off', 'present but disabled'],
  ]
  return (
    <Box flexDirection="column" width={columns}>
      <Text color={color.mauve} bold>{icon.logo} ccx {icon.sep} keys</Text>
      <Text> </Text>
      {keys.map(([k, v]) => (
        <Box key={k}>
          <Box width={12}><Text color={color.sapphire}>{k}</Text></Box>
          <Text color={color.subtext} wrap="truncate-end">{v}</Text>
        </Box>
      ))}
      <Text> </Text>
      <Text color={color.mauve} bold>name colour {icon.sep} where it comes from</Text>
      {SCOPES.map((s) => (
        <Box key={s}>
          <Box width={12}><Text color={scopeColor[s]}>{s}</Text></Box>
          <Text color={color.muted} wrap="truncate-end">
            {s === 'project' ? 'this directory' : s === 'workspace' ? 'the workspace above it'
              : s === 'harness' ? 'the harness root' : s === 'ancestor' ? 'another parent directory'
                : s === 'user' ? '~/.claude' : 'shipped by a plugin'}
          </Text>
        </Box>
      ))}
      <Text> </Text>
      <Text color={color.mauve} bold>right column</Text>
      {states.map(([k, v]) => (
        <Box key={k}>
          <Box width={24}><Text color={color.subtext}>{k}</Text></Box>
          <Text color={color.muted} wrap="truncate-end">{v}</Text>
        </Box>
      ))}
      <Box>
        <Box width={24}>
          <Text color={color.green}>{icon.ok}</Text><Text color={color.red}> {icon.err}</Text>
          <Text color={color.yellow}> {icon.auth}</Text><Text color={color.muted}> {icon.off}</Text>
        </Box>
        <Text color={color.muted} wrap="truncate-end">ready · failed · auth · off</Text>
      </Box>
      <Text> </Text>
      <Text color={color.muted}>the panel rescans itself whenever Claude edits a config file</Text>
      <Text color={color.muted}>press any key to go back</Text>
    </Box>
  )
}
