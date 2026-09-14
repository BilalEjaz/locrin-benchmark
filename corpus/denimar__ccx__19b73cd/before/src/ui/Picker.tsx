import { readFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { Box, Text, useApp, useInput, useStdout } from 'ink'
import React, { useEffect, useMemo, useState } from 'react'
import { parseProjectsYaml } from '../scan/harness.js'
import { readJsonc } from '../util/jsonc.js'
import { HOME, isDir, isFile, listDirs, tilde } from '../util/walk.js'
import { color, icon } from './theme.js'

export interface Candidate { path: string; name: string; group: string; registered: boolean }

/** Harness workspaces first (they are the curated list), then anything Claude
 *  Code has actually been run in. */
export function findProjects(): Candidate[] {
  const out = new Map<string, Candidate>()

  const harnessRoots = [
    join(HOME, 'projects', 'personal', 'personal-harness'),
    process.env.HARNESS_ROOT ?? '',
  ].filter((p) => p && isDir(p))

  for (const root of harnessRoots) {
    for (const ws of listDirs(root)) {
      const registry = join(root, ws, 'projects.yaml')
      if (!isFile(registry)) continue
      for (const name of Object.keys(parseProjectsYaml(readFileSync(registry, 'utf8')))) {
        const path = join(root, ws, name)
        if (isDir(path)) out.set(path, { path, name, group: `${basename(root)}/${ws}`, registered: true })
      }
    }
  }

  const claudeJson = readJsonc<any>(join(HOME, '.claude.json'))
  for (const path of Object.keys(claudeJson?.projects ?? {})) {
    if (out.has(path) || !isDir(path)) continue
    out.set(path, { path, name: basename(path), group: tilde(join(path, '..')), registered: false })
  }

  return [...out.values()].sort((a, b) =>
    Number(b.registered) - Number(a.registered) || a.group.localeCompare(b.group) || a.name.localeCompare(b.name))
}

export function Picker({ onPick }: { onPick: (path: string) => void }): React.ReactElement {
  const { exit } = useApp()
  useEffect(() => { process.stdout.write('\x1b]2;ccx\x07') }, [])
  const { stdout } = useStdout()
  const [query, setQuery] = useState('')
  const [cursor, setCursor] = useState(0)
  const all = useMemo(() => findProjects(), [])

  const hits = useMemo(() => {
    if (!query) return all
    const q = query.toLowerCase()
    return all.filter((c) => `${c.name} ${c.group}`.toLowerCase().includes(q))
  }, [all, query])

  const clamped = Math.min(cursor, Math.max(hits.length - 1, 0))
  const height = Math.max(5, (stdout.rows || 24) - 6)
  const start = Math.max(0, Math.min(clamped - Math.floor(height / 2), hits.length - height))

  useInput((input, key) => {
    if (key.escape || (key.ctrl && input === 'c')) { exit(); return }
    if (key.return) { const pick = hits[clamped]; if (pick) onPick(pick.path); return }
    if (key.downArrow || (key.ctrl && input === 'n')) { setCursor((c) => Math.min(c + 1, hits.length - 1)); return }
    if (key.upArrow || (key.ctrl && input === 'p')) { setCursor((c) => Math.max(c - 1, 0)); return }
    if (key.backspace || key.delete) { setQuery((q) => q.slice(0, -1)); setCursor(0); return }
    if (input && !key.ctrl && !key.meta) { setQuery((q) => q + input); setCursor(0) }
  })

  return (
    <Box flexDirection="column">
      <Box borderStyle="round" borderColor={color.mauve} paddingX={1}>
        <Text color={color.mauve} bold>{icon.logo} ccx </Text>
        <Text color={color.muted}>open a project</Text>
      </Box>
      <Box paddingX={1}>
        <Text color={color.mauve}>{'❯ '}</Text>
        <Text color={color.text}>{query}</Text>
        <Text color={color.surface}>▏</Text>
      </Box>
      <Box flexDirection="column" height={height} overflow="hidden">
        {hits.slice(start, start + height).map((c, i) => {
          const selected = start + i === clamped
          return (
            <Box key={c.path}>
              <Text color={selected ? color.mauve : color.surface}>{selected ? '❯' : ' '}</Text>
              <Box width={30} marginRight={2}>
                <Text color={selected ? color.text : color.subtext} bold={selected} wrap="truncate-end"> {c.name}</Text>
              </Box>
              <Text color={color.muted} wrap="truncate-end">{c.group}</Text>
            </Box>
          )
        })}
      </Box>
      <Box paddingX={1}>
        <Text color={color.muted}>{hits.length} projects  ·  enter open  ·  esc cancel</Text>
      </Box>
    </Box>
  )
}
