import { execFileSync } from 'node:child_process'
import type { GitInfo } from './types.js'

function git(root: string, args: string[]): string {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
}

export function scanGit(root: string): GitInfo {
  try {
    git(root, ['rev-parse', '--is-inside-work-tree'])
  } catch {
    return { isRepo: false, dirty: 0 }
  }
  let branch: string | undefined
  let dirty = 0
  let remote: string | undefined
  try { branch = git(root, ['rev-parse', '--abbrev-ref', 'HEAD']) } catch { /* detached */ }
  try { dirty = git(root, ['status', '--porcelain']).split('\n').filter(Boolean).length } catch { /* ignore */ }
  try { remote = git(root, ['remote', 'get-url', 'origin']).replace(/^https:\/\/[^@]+@/, 'https://') } catch { /* no remote */ }
  return { isRepo: true, branch, dirty, remote }
}
