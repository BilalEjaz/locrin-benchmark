// Commit -> origin session resolver ("which Paseo session made commit 714efcf?").
//
// A message often names a commit another session made ("另一个会话的 714efcf"). A commit hash
// is not a session id, so the session pills in client/session-lineage-web.ts leave it alone.
// This module answers it from evidence on disk, never from a guess:
//
//   1. git: find the commit in the repositories Paseo sessions work in (their cwd repos, the
//      plugin repos, and repos up to two levels under those) -> full hash, commit time T, subject.
//   2. Paseo agent records: sessions that were active at T.
//   3. Their transcripts (Claude Code jsonl, Antigravity transcript.jsonl): the session whose
//      first mention of the hash is earliest and inside [T - 10 min, T + 3 min] made it. A
//      reviewer that reads the hash later falls outside the window, so a commit made outside
//      Paseo stays "unattributed" instead of being pinned on whoever mentioned it first.
//
// Front doors: the inline commit pill (client/commit-origin-web.ts) and the
// `resolve_commit_origin` agent tool (index.server.ts).
import type { RpcInput, RpcOutput } from "@getpaseo/plugin";
import { execCommand } from "@getpaseo/plugin/server";
import { createReadStream } from "node:fs";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import * as readline from "node:readline";
import {
  COMMIT_SHA_TOKEN_RE,
  type CommitOriginResult,
  type CommitOriginSession,
  resolveCommitOriginRpc,
} from "../shared/commit-origin-contracts";

/** An agent step can start before its `git commit` finishes (agy `created_at` is step start). */
export const ATTRIBUTION_WINDOW_BEFORE_MS = 10 * 60_000;
/** The author sees the hash in its own command output, within seconds of the commit. */
export const ATTRIBUTION_WINDOW_AFTER_MS = 3 * 60_000;
/** A session counts as active at T if its life overlaps T with this slack. */
const ACTIVE_SLACK_MS = 2 * 60_000;
const AGENTS_TTL_MS = 30_000;
const REPOS_TTL_MS = 10 * 60_000;
const RESULT_TTL_ATTRIBUTED_MS = 6 * 60 * 60_000;
const RESULT_TTL_OTHER_MS = 5 * 60_000;
const MAX_REPOS = 400;
/** Discovery stops here; ranking by recency then keeps MAX_REPOS, so a recent repo is not cut by listing order. */
const DISCOVERY_CAP = 3000;
const SAFE_ID_RE = /^[A-Za-z0-9._-]+$/;
const GIT_CONCURRENCY = 8;
const SKIP_DIR_NAMES = new Set([
  "node_modules",
  "brain",
  "dist",
  "build",
  "output",
  "cache",
  "tmp",
  "vendor",
  "conversations",
  "logs",
  "graphify-out",
]);

export interface CommitOriginEnv {
  paseoDir: string;
  claudeProjectsDir: string;
  antigravityBrainDirs: string[];
  /** Directories whose child folders are repositories in their own right (e.g. ~/.paseo/plugins). */
  extraRepoParents: string[];
  run: (command: string, args: string[], options?: { cwd?: string; timeout?: number }) => Promise<string>;
  now: () => number;
}

export function defaultCommitOriginEnv(): CommitOriginEnv {
  const home = os.homedir();
  return {
    paseoDir: path.join(home, ".paseo"),
    claudeProjectsDir: path.join(home, ".claude", "projects"),
    antigravityBrainDirs: [
      path.join(home, ".gemini", "antigravity-cli", "brain"),
      path.join(home, ".gemini", "antigravity", "brain"),
    ],
    extraRepoParents: [path.join(home, ".paseo", "plugins")],
    run: async (command, args, options) => {
      const res = await execCommand(command, args, {
        cwd: options?.cwd,
        timeout: options?.timeout ?? 8_000,
        maxBuffer: 8 * 1024 * 1024,
        env: { ...process.env, GIT_OPTIONAL_LOCKS: "0", GIT_TERMINAL_PROMPT: "0" },
      });
      return res.stdout;
    },
    now: () => Date.now(),
  };
}

// ---------------------------------------------------------------------------
// Pure helpers (tested in test/commit-origin.test.ts)

export function normalizeCommitToken(raw: string | null | undefined): string | null {
  const token = (raw ?? "").trim().replace(/^[`'"(]+|[`'"),.;:!?]+$/g, "").toLowerCase();
  return COMMIT_SHA_TOKEN_RE.test(token) ? token : null;
}

/** Claude Code names a session's project folder after its cwd, every non-alphanumeric turned into '-'. */
export function claudeProjectSlug(cwd: string): string {
  return cwd.replace(/[^A-Za-z0-9]/g, "-");
}

export interface GitCommitHit {
  fullSha: string;
  committedAtMs: number;
  subject: string;
}

/** Parses `git log --format=%H%x1f%ct%x1f%s` output and maps every requested token to its commit. */
export function parseGitLogBatch(stdout: string, tokens: string[]): Map<string, GitCommitHit> {
  const hits = new Map<string, GitCommitHit>();
  for (const line of stdout.split("\n")) {
    const [fullSha, ct, ...rest] = line.split("\u001f");
    if (!fullSha || !/^[0-9a-f]{40}$/.test(fullSha.trim())) continue;
    const committedAtMs = Number.parseInt(ct ?? "", 10) * 1000;
    if (!Number.isFinite(committedAtMs)) continue;
    const hit = { fullSha: fullSha.trim(), committedAtMs, subject: rest.join("\u001f").trim() };
    for (const token of tokens) {
      if (hit.fullSha.startsWith(token)) hits.set(token, hit);
    }
  }
  return hits;
}

/**
 * How strongly one transcript line says "this session made the commit":
 *   proof  - git commit's own output, `[main 714efcf] subject` (also merge, cherry-pick, rebase);
 *   strong - `714efcf (HEAD -> main)`, `714efcf <subject>` (git's one-line format; no decoration when stdout
 *            is not a terminal) or the full 40-char hash, as printed right after commit / commit-tree;
 *   weak   - any other mention (prose, a later `git log`, a push summary).
 */
export type MentionStrength = "proof" | "strong" | "weak";

const STRENGTH_RANK: Record<MentionStrength, number> = { weak: 0, strong: 1, proof: 2 };

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function mentionStrength(
  line: string,
  needle: string,
  fullSha?: string | null,
  subject?: string | null,
): MentionStrength {
  if (new RegExp(`\\[[^\\]\\s]+(?: \\(root-commit\\))? ${needle}[0-9a-f]*\\]`).test(line)) return "proof";
  if ((fullSha && line.includes(fullSha)) || new RegExp(`${needle}[0-9a-f]* \\(HEAD -> `).test(line)) return "strong";
  const head = (subject ?? "").slice(0, 16);
  if (head.length >= 6) {
    // Transcripts are JSON lines, so the subject may appear escaped.
    const forms = new Set([head, JSON.stringify(head).slice(1, -1)]);
    for (const form of forms) {
      if (new RegExp(`${needle}[0-9a-f]* ${escapeRegExp(form)}`).test(line)) return "strong";
    }
  }
  return "weak";
}

/** A strong mention counts as authorship only this soon after the commit (a reader's `git log` comes later). */
export const STRONG_LAG_MAX_MS = 30_000;

export interface SessionMention {
  agentId: string;
  firstMentionMs: number | null;
  strength?: MentionStrength;
}

export interface CommitOriginPick {
  agentId: string;
  firstMentionMs: number;
  lagMs: number;
  strength: MentionStrength;
  mentioningInWindow: number;
}

/**
 * Earliest first mention inside the attribution window, then a confidence gate, because a session
 * that only read the hash must not be named as its author:
 *   - proof wins outright;
 *   - strong wins when it is at most STRONG_LAG_MAX_MS after the commit (any time before is the
 *     step that ran it);
 *   - weak wins only when no session active then is unreadable and nobody else mentions it.
 * Two sessions tied on the earliest timestamp (a forked transcript) give no answer.
 */
export function pickCommitOrigin(
  committedAtMs: number,
  mentions: SessionMention[],
  unreadableActive = 0,
): CommitOriginPick | null {
  const inWindow = mentions
    .filter(
      (m): m is SessionMention & { firstMentionMs: number } =>
        m.firstMentionMs !== null &&
        m.firstMentionMs >= committedAtMs - ATTRIBUTION_WINDOW_BEFORE_MS &&
        m.firstMentionMs <= committedAtMs + ATTRIBUTION_WINDOW_AFTER_MS,
    )
    .sort((a, b) => a.firstMentionMs - b.firstMentionMs || a.agentId.localeCompare(b.agentId));
  const first = inWindow[0];
  if (!first) return null;
  if (inWindow[1] && inWindow[1].firstMentionMs === first.firstMentionMs) return null;
  const strength = first.strength ?? "weak";
  const lagMs = first.firstMentionMs - committedAtMs;
  const confident =
    strength === "proof" ||
    (strength === "strong" && lagMs <= STRONG_LAG_MAX_MS) ||
    (unreadableActive === 0 && inWindow.length === 1);
  if (!confident) return null;
  return { agentId: first.agentId, firstMentionMs: first.firstMentionMs, lagMs, strength, mentioningInWindow: inWindow.length };
}

/** Timestamp of a transcript line: Claude Code `timestamp`, Antigravity `created_at`. */
export function transcriptLineTimestampMs(line: string): number | null {
  try {
    const obj = JSON.parse(line) as { timestamp?: unknown; created_at?: unknown };
    const raw = typeof obj.timestamp === "string" ? obj.timestamp : obj.created_at;
    if (typeof raw !== "string") return null;
    const ms = Date.parse(raw);
    return Number.isFinite(ms) ? ms : null;
  } catch {
    return null;
  }
}

export interface MentionProbe {
  lowerBound: number;
  fullSha?: string | null;
  subject?: string | null;
}

export interface FirstMention {
  ms: number;
  /** Strongest shape among this session's mentions in the first STRONG_LAG_MAX_MS after the first one. */
  strength: MentionStrength;
}

/**
 * One pass over a transcript: for every needle, the first line that mentions it at or after its
 * lower bound, upgraded to the strongest shape seen shortly after (a Claude tool_use line can
 * precede the tool_result that prints `[main <hash>]`). Transcripts are chronological, so the
 * pass stops once every needle is settled.
 */
export async function scanTranscriptMentions(
  filePath: string,
  probes: Map<string, MentionProbe>,
): Promise<Map<string, FirstMention>> {
  const pending = new Map(probes);
  const found = new Map<string, FirstMention>();
  if (!pending.size) return found;
  const stream = createReadStream(filePath, { encoding: "utf8" });
  const lines = readline.createInterface({ input: stream, crlfDelay: Infinity });
  try {
    for await (const line of lines) {
      for (const [needle, probe] of pending) {
        if (!line.includes(needle)) continue;
        const ms = transcriptLineTimestampMs(line);
        if (ms === null || ms < probe.lowerBound) continue;
        const strength = mentionStrength(line, needle, probe.fullSha, probe.subject);
        const prior = found.get(needle);
        if (!prior) {
          found.set(needle, { ms, strength });
        } else if (ms - prior.ms > STRONG_LAG_MAX_MS) {
          pending.delete(needle);
          continue;
        } else if (STRENGTH_RANK[strength] > STRENGTH_RANK[prior.strength]) {
          found.set(needle, { ms: prior.ms, strength });
        }
        if (found.get(needle)!.strength === "proof") pending.delete(needle);
      }
      if (!pending.size) break;
    }
  } catch {
    // unreadable tail: keep what was found
  } finally {
    lines.close();
    stream.destroy();
  }
  return found;
}

export async function firstMentionMs(
  filePath: string,
  needle: string,
  lowerBoundMs: number,
): Promise<number | null> {
  return (await scanTranscriptMentions(filePath, new Map([[needle, { lowerBound: lowerBoundMs }]]))).get(needle)?.ms ?? null;
}

// ---------------------------------------------------------------------------
// Agent records

export interface CommitOriginAgent {
  id: string;
  provider: string;
  cwd: string | null;
  title: string;
  workspaceId: string;
  createdAtMs: number | null;
  lastActiveMs: number | null;
  status: string;
  sessionId: string | null;
  conversationId: string | null;
}

interface RawAgentJson {
  id?: string;
  provider?: string;
  cwd?: string;
  title?: string | null;
  workspaceId?: string;
  createdAt?: string | null;
  updatedAt?: string | null;
  lastActivityAt?: string | null;
  lastStatus?: string | null;
  archivedAt?: string | null;
  labels?: Record<string, string>;
  persistence?: {
    sessionId?: string | null;
    metadata?: { pluginProviderPersistence?: { data?: { conversationId?: string | null } } };
  } | null;
}

function parseMs(value: string | null | undefined): number | null {
  const ms = Date.parse(value ?? "");
  return Number.isFinite(ms) ? ms : null;
}

function readPersistenceIds(rec: RawAgentJson): { sessionId: string | null; conversationId: string | null } {
  let conversationId = rec.persistence?.metadata?.pluginProviderPersistence?.data?.conversationId ?? null;
  let sessionId = (rec.persistence?.sessionId ?? "").trim() || null;
  if (sessionId?.startsWith("plugin:")) {
    try {
      const parsed = JSON.parse(sessionId.slice("plugin:".length)) as { data?: { conversationId?: string } };
      conversationId = conversationId ?? parsed.data?.conversationId ?? null;
    } catch {
      // not plugin persistence JSON
    }
    sessionId = null;
  }
  return { sessionId, conversationId: conversationId?.trim() || null };
}

function effectiveStatus(rec: RawAgentJson, archived: boolean): string {
  if (archived || rec.archivedAt) return "archived";
  const raw = String(rec.lastStatus ?? "idle").toLowerCase();
  if (raw === "running" || raw === "starting") return "running";
  if (raw === "failed" || raw === "error") return "failed";
  return "done";
}

export async function loadCommitOriginAgents(paseoDir: string): Promise<CommitOriginAgent[]> {
  const root = path.join(paseoDir, "agents");
  const out: CommitOriginAgent[] = [];
  let buckets: string[] = [];
  try {
    buckets = await fs.readdir(root);
  } catch {
    return out;
  }
  for (const bucket of buckets) {
    let files: string[] = [];
    try {
      files = await fs.readdir(path.join(root, bucket));
    } catch {
      continue;
    }
    for (const file of files) {
      if (!file.endsWith(".json")) continue;
      try {
        const rec = JSON.parse(await fs.readFile(path.join(root, bucket, file), "utf8")) as RawAgentJson;
        const id = (rec.id ?? "").trim();
        if (!id || rec.labels?.["paseo.internal"] === "true") continue;
        const ids = readPersistenceIds(rec);
        out.push({
          id,
          provider: String(rec.provider ?? ""),
          cwd: rec.cwd ?? null,
          title: String(rec.title ?? "").trim(),
          workspaceId: String(rec.workspaceId ?? ""),
          createdAtMs: parseMs(rec.createdAt),
          lastActiveMs: parseMs(rec.lastActivityAt) ?? parseMs(rec.updatedAt),
          status: effectiveStatus(rec, bucket === "archived"),
          ...ids,
        });
      } catch {
        // malformed record
      }
    }
  }
  return out;
}

export function isActiveAt(agent: CommitOriginAgent, atMs: number): boolean {
  if (agent.createdAtMs !== null && agent.createdAtMs > atMs + ACTIVE_SLACK_MS) return false;
  if (agent.lastActiveMs !== null && agent.lastActiveMs < atMs - ACTIVE_SLACK_MS) return false;
  return agent.createdAtMs !== null || agent.lastActiveMs !== null;
}

async function isFile(p: string): Promise<boolean> {
  try {
    return (await fs.stat(p)).isFile();
  } catch {
    return false;
  }
}

/** Transcript files for an agent; empty for providers whose transcript is not on disk in a known shape. */
export async function transcriptPathsFor(
  agent: CommitOriginAgent,
  env: Pick<CommitOriginEnv, "claudeProjectsDir" | "antigravityBrainDirs">,
  claudeDirIndex?: () => Promise<string[]>,
): Promise<string[]> {
  if (agent.provider.startsWith("claude") && agent.sessionId && SAFE_ID_RE.test(agent.sessionId)) {
    const file = `${agent.sessionId}.jsonl`;
    if (agent.cwd) {
      const guess = path.join(env.claudeProjectsDir, claudeProjectSlug(agent.cwd), file);
      if (await isFile(guess)) return [guess];
    }
    for (const dir of (await claudeDirIndex?.()) ?? []) {
      const candidate = path.join(env.claudeProjectsDir, dir, file);
      if (await isFile(candidate)) return [candidate];
    }
    return [];
  }
  if (agent.provider.startsWith("antigravity") && agent.conversationId && SAFE_ID_RE.test(agent.conversationId)) {
    const found: string[] = [];
    for (const brain of env.antigravityBrainDirs) {
      for (const name of ["transcript.jsonl", "transcript_full.jsonl"]) {
        const candidate = path.join(brain, agent.conversationId, ".system_generated", "logs", name);
        if (await isFile(candidate)) found.push(candidate);
      }
    }
    return found;
  }
  return [];
}

// ---------------------------------------------------------------------------
// Repositories

/** Nearest ancestor holding `.git` (a directory, or a file for worktrees); no git process needed. */
async function gitToplevel(dir: string): Promise<string | null> {
  let current = path.resolve(dir);
  for (;;) {
    if (await hasGitDir(current)) return current;
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

/** Last time the repository moved: commits and checkouts touch the reflog, staging touches the index. */
async function repoRecencyMs(repo: string): Promise<number> {
  let best = 0;
  for (const rel of [".git/logs/HEAD", ".git/index", ".git/HEAD", ".git"]) {
    try {
      best = Math.max(best, (await fs.stat(path.join(repo, rel))).mtimeMs);
    } catch {
      // absent in worktrees and bare layouts
    }
  }
  return best;
}

async function hasGitDir(dir: string): Promise<boolean> {
  try {
    await fs.stat(path.join(dir, ".git"));
    return true;
  } catch {
    return false;
  }
}

async function childDirs(dir: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    return entries
      .filter((e) => e.isDirectory() && !e.name.startsWith(".") && !SKIP_DIR_NAMES.has(e.name))
      .map((e) => path.join(dir, e.name));
  } catch {
    return [];
  }
}

/** Repositories Paseo sessions work in, most recently changed first. */
export async function discoverRepos(env: CommitOriginEnv, agents: CommitOriginAgent[]): Promise<string[]> {
  const repos = new Set<string>();
  const cwds = new Set(agents.map((a) => a.cwd).filter((c): c is string => Boolean(c)));
  for (const parent of env.extraRepoParents) {
    for (const child of await childDirs(parent)) cwds.add(child);
  }
  const toplevels = new Set<string>();
  for (const cwd of cwds) {
    try {
      if (!(await fs.stat(cwd)).isDirectory()) continue;
    } catch {
      continue;
    }
    const top = await gitToplevel(cwd);
    if (top) toplevels.add(top);
  }
  for (const top of toplevels) {
    repos.add(top);
    // Repos nested inside a container repo (A-coding/<project>, A-coding/A-Sync/<project>) are
    // separate repositories the container's history does not include.
    for (const child of await childDirs(top)) {
      if (repos.size >= DISCOVERY_CAP) break;
      if (await hasGitDir(child)) {
        repos.add(child);
        continue;
      }
      for (const grandchild of await childDirs(child)) {
        if (repos.size >= DISCOVERY_CAP) break;
        if (await hasGitDir(grandchild)) repos.add(grandchild);
      }
    }
  }
  const ranked = await Promise.all(
    Array.from(repos).map(async (repo) => ({ repo, at: await repoRecencyMs(repo) })),
  );
  ranked.sort((a, b) => b.at - a.at);
  return ranked.slice(0, MAX_REPOS).map((r) => r.repo);
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index]);
    }
  });
  await Promise.all(workers);
  return results;
}

/** `<repo>/.git/objects`, following a worktree's `.git` file and `commondir` to the shared store. */
async function objectsDirOf(repo: string): Promise<string | null> {
  const dotGit = path.join(repo, ".git");
  try {
    const stat = await fs.stat(dotGit);
    if (stat.isDirectory()) return path.join(dotGit, "objects");
    const pointer = (await fs.readFile(dotGit, "utf8")).match(/^gitdir:\s*(.+)$/m)?.[1]?.trim();
    if (!pointer) return null;
    const gitDir = path.resolve(repo, pointer);
    let common = gitDir;
    try {
      common = path.resolve(gitDir, (await fs.readFile(path.join(gitDir, "commondir"), "utf8")).trim());
    } catch {
      // not a linked worktree
    }
    return path.join(common, "objects");
  } catch {
    return null;
  }
}

const IDX_V2_MAGIC = 0xff744f63; // "\377tOc"

/** Prefixes present among one pack index's object names (idx v2: fanout table + sorted names). */
async function idxHasPrefixes(idxPath: string, prefixes: string[]): Promise<Set<string> | "unknown"> {
  const hits = new Set<string>();
  let handle: fs.FileHandle | null = null;
  try {
    handle = await fs.open(idxPath, "r");
    const header = Buffer.alloc(8 + 256 * 4);
    await handle.read(header, 0, header.length, 0);
    if (header.readUInt32BE(0) !== IDX_V2_MAGIC || header.readUInt32BE(4) !== 2) return "unknown";
    const fanout = (i: number) => header.readUInt32BE(8 + i * 4);
    for (const prefix of prefixes) {
      const firstByte = Number.parseInt(prefix.slice(0, 2), 16);
      const lo = firstByte === 0 ? 0 : fanout(firstByte - 1);
      const hi = fanout(firstByte);
      if (hi <= lo) continue;
      const names = Buffer.alloc((hi - lo) * 20);
      await handle.read(names, 0, names.length, 8 + 256 * 4 + lo * 20);
      let left = 0;
      let right = hi - lo;
      while (left < right) {
        const mid = (left + right) >> 1;
        if (names.toString("hex", mid * 20, mid * 20 + 20) < prefix) left = mid + 1;
        else right = mid;
      }
      if (left < hi - lo && names.toString("hex", left * 20, left * 20 + 20).startsWith(prefix)) hits.add(prefix);
    }
    return hits;
  } catch {
    return "unknown";
  } finally {
    await handle?.close();
  }
}

/**
 * Which of `prefixes` name any object in the repository, read straight from the object store so
 * that a repository without the hash costs a few file reads instead of a git process. Returns
 * every prefix when the store has a shape this does not read, so git still gets to decide.
 */
export async function repoObjectPrefixes(repo: string, prefixes: string[]): Promise<Set<string>> {
  const objects = await objectsDirOf(repo);
  if (!objects) return new Set(prefixes);
  const hits = new Set<string>();
  const stores = [objects];
  try {
    const alternates = await fs.readFile(path.join(objects, "info", "alternates"), "utf8");
    for (const line of alternates.split("\n")) {
      if (line.trim()) stores.push(path.resolve(objects, line.trim()));
    }
  } catch {
    // no alternates
  }
  for (const store of stores) {
    const loose = new Map<string, string[]>();
    for (const prefix of prefixes) {
      if (hits.has(prefix)) continue;
      const fan = prefix.slice(0, 2);
      if (!loose.has(fan)) {
        try {
          loose.set(fan, await fs.readdir(path.join(store, fan)));
        } catch {
          loose.set(fan, []);
        }
      }
      if (loose.get(fan)!.some((name) => name.startsWith(prefix.slice(2)))) hits.add(prefix);
    }
    let idxFiles: string[] = [];
    try {
      idxFiles = (await fs.readdir(path.join(store, "pack"))).filter((f) => f.endsWith(".idx"));
    } catch {
      idxFiles = [];
    }
    for (const idx of idxFiles) {
      const wanted = prefixes.filter((p) => !hits.has(p));
      if (!wanted.length) break;
      const found = await idxHasPrefixes(path.join(store, "pack", idx), wanted);
      if (found === "unknown") return new Set(prefixes);
      found.forEach((p) => hits.add(p));
    }
  }
  return hits;
}

async function findCommitsInRepo(
  env: CommitOriginEnv,
  repo: string,
  tokens: string[],
): Promise<Map<string, GitCommitHit>> {
  const args = ["log", "--no-walk=unsorted", "--ignore-missing", "--format=%H%x1f%ct%x1f%s"];
  // The trailing `--` keeps a file named like a hash from turning a revision into a path.
  try {
    return parseGitLogBatch(await env.run("git", [...args, ...tokens, "--"], { cwd: repo }), tokens);
  } catch {
    // One ambiguous short hash fails the whole batch; retry one at a time, bounded, since the
    // prefilter already said this repository holds every one of these prefixes.
    const hits = new Map<string, GitCommitHit>();
    if (tokens.length === 1) return hits;
    for (const token of tokens.slice(0, 12)) {
      try {
        const one = parseGitLogBatch(await env.run("git", [...args, token, "--"], { cwd: repo }), [token]);
        const hit = one.get(token);
        if (hit) hits.set(token, hit);
      } catch {
        // missing or ambiguous here
      }
    }
    return hits;
  }
}

// ---------------------------------------------------------------------------
// Resolver

interface CachedResult {
  result: CommitOriginResult;
  expiresAtMs: number;
}

export interface CommitOriginResolver {
  resolve(tokens: string[], options?: { refresh?: boolean }): Promise<{
    results: CommitOriginResult[];
    reposScanned: number;
  }>;
}

function toSession(agent: CommitOriginAgent, workspaces: Map<string, { title: string; projectId: string | null }>, projects: Map<string, string>): CommitOriginSession {
  const ws = workspaces.get(agent.workspaceId);
  const projectId = ws?.projectId ?? null;
  return {
    agentId: agent.id,
    shortId: agent.id.slice(0, 7),
    agentTitle: agent.title || agent.id.slice(0, 7),
    workspaceId: agent.workspaceId,
    workspaceTitle: ws?.title || agent.title || agent.id.slice(0, 7),
    projectId,
    projectName: projectId ? projects.get(projectId) ?? null : null,
    status: agent.status,
    provider: agent.provider,
  };
}

async function loadWorkspaceTitles(paseoDir: string): Promise<{
  workspaces: Map<string, { title: string; projectId: string | null }>;
  projects: Map<string, string>;
}> {
  const workspaces = new Map<string, { title: string; projectId: string | null }>();
  const projects = new Map<string, string>();
  try {
    const raw = JSON.parse(await fs.readFile(path.join(paseoDir, "projects", "workspaces.json"), "utf8")) as Array<Record<string, unknown>>;
    for (const w of Array.isArray(raw) ? raw : []) {
      const id = String(w.workspaceId ?? w.id ?? "").trim();
      if (!id) continue;
      const display = String(w.displayName ?? "");
      workspaces.set(id, {
        title: String(w.title ?? "").trim() || (display && display !== "main" ? display : ""),
        projectId: (w.projectId as string | undefined) ?? null,
      });
    }
  } catch {
    // no workspace titles; the agent title is used instead
  }
  try {
    const raw = JSON.parse(await fs.readFile(path.join(paseoDir, "projects", "projects.json"), "utf8")) as Array<Record<string, unknown>>;
    for (const p of Array.isArray(raw) ? raw : []) {
      const id = String(p.projectId ?? "").trim();
      const name = String(p.customName ?? p.displayName ?? "").trim();
      if (id && name) projects.set(id, name);
    }
  } catch {
    // project names are optional
  }
  return { workspaces, projects };
}

function emptyResult(sha: string, status: CommitOriginResult["status"], evidence: string): CommitOriginResult {
  return {
    sha,
    status,
    fullSha: null,
    repoPath: null,
    repoName: null,
    subject: null,
    committedAt: null,
    origin: null,
    firstMentionAt: null,
    lagSeconds: null,
    candidatesChecked: 0,
    unreadableSessions: 0,
    mentioningSessions: 0,
    evidenceStrength: null,
    evidence,
  };
}

export function createCommitOriginResolver(env: CommitOriginEnv = defaultCommitOriginEnv()): CommitOriginResolver {
  const cache = new Map<string, CachedResult>();
  let agentsCache: { at: number; agents: CommitOriginAgent[] } | null = null;
  let reposCache: { at: number; repos: string[] } | null = null;
  let claudeDirsCache: { at: number; dirs: string[] } | null = null;

  const agentsNow = async () => {
    if (!agentsCache || env.now() - agentsCache.at > AGENTS_TTL_MS) {
      agentsCache = { at: env.now(), agents: await loadCommitOriginAgents(env.paseoDir) };
    }
    return agentsCache.agents;
  };
  const reposNow = async (agents: CommitOriginAgent[], refresh: boolean) => {
    if (refresh || !reposCache || env.now() - reposCache.at > REPOS_TTL_MS) {
      reposCache = { at: env.now(), repos: await discoverRepos(env, agents) };
    }
    return reposCache.repos;
  };
  const claudeDirs = async () => {
    if (!claudeDirsCache || env.now() - claudeDirsCache.at > REPOS_TTL_MS) {
      let dirs: string[] = [];
      try {
        dirs = await fs.readdir(env.claudeProjectsDir);
      } catch {
        dirs = [];
      }
      claudeDirsCache = { at: env.now(), dirs };
    }
    return claudeDirsCache.dirs;
  };

  /**
   * Object-store prefilter over every repository (file reads only), then git only where an object
   * with that prefix exists, most recently changed repository first.
   */
  const findCommits = async (repos: string[], tokens: string[]) => {
    const found = new Map<string, { repo: string; hit: GitCommitHit }>();
    const present = await mapLimit(repos, 16, async (repo) => ({
      repo,
      prefixes: await repoObjectPrefixes(repo, tokens),
    }));
    for (const { repo, prefixes } of present) {
      const wanted = tokens.filter((t) => prefixes.has(t) && !found.has(t));
      if (!wanted.length) continue;
      for (const [token, hit] of await findCommitsInRepo(env, repo, wanted)) {
        if (!found.has(token)) found.set(token, { repo, hit });
      }
      if (found.size === tokens.length) break;
    }
    return found;
  };

  const attributeAll = async (
    found: Map<string, { repo: string; hit: GitCommitHit }>,
    agents: CommitOriginAgent[],
  ): Promise<Map<string, CommitOriginResult>> => {
    const titles = await loadWorkspaceTitles(env.paseoDir);
    const transcriptCache = new Map<string, string[]>();
    const plans = new Map<
      string,
      {
        needle: string;
        lowerBound: number;
        fullSha: string;
        subject: string;
        filesByAgent: Map<string, string[]>;
        unreadable: number;
      }
    >();
    const allFiles = new Set<string>();
    for (const [token, { hit }] of found) {
      const lowerBound = hit.committedAtMs - ATTRIBUTION_WINDOW_BEFORE_MS;
      const filesByAgent = new Map<string, string[]>();
      let unreadable = 0;
      for (const agent of agents.filter((a) => isActiveAt(a, hit.committedAtMs))) {
        let paths = transcriptCache.get(agent.id);
        if (!paths) {
          paths = await transcriptPathsFor(agent, env, claudeDirs);
          transcriptCache.set(agent.id, paths);
        }
        // Active then, but no transcript this can read: a possible author nobody can rule out.
        if (!paths.length) unreadable += 1;
        const files: string[] = [];
        for (const file of paths) {
          try {
            if ((await fs.stat(file)).mtimeMs >= lowerBound) files.push(file);
          } catch {
            // vanished
          }
        }
        if (files.length) filesByAgent.set(agent.id, files);
        files.forEach((f) => allFiles.add(f));
      }
      plans.set(token, {
        needle: hit.fullSha.slice(0, 7),
        lowerBound,
        fullSha: hit.fullSha,
        subject: hit.subject,
        filesByAgent,
        unreadable,
      });
    }
    // One read per transcript for all hashes whose commit time falls in that session's life.
    const firstByFile = new Map<string, Map<string, FirstMention>>();
    await mapLimit(Array.from(allFiles), 6, async (file) => {
      const probes = new Map<string, MentionProbe>();
      for (const plan of plans.values()) {
        for (const files of plan.filesByAgent.values()) {
          if (!files.includes(file)) continue;
          const prior = probes.get(plan.needle);
          probes.set(plan.needle, {
            lowerBound: Math.min(prior?.lowerBound ?? Infinity, plan.lowerBound),
            fullSha: plan.fullSha,
            subject: plan.subject,
          });
        }
      }
      firstByFile.set(file, await scanTranscriptMentions(file, probes));
    });

    const out = new Map<string, CommitOriginResult>();
    for (const [token, { repo, hit }] of found) {
      const plan = plans.get(token)!;
      const mentions: SessionMention[] = [];
      for (const [agentId, files] of plan.filesByAgent) {
        let first: FirstMention | null = null;
        for (const file of files) {
          const m = firstByFile.get(file)?.get(plan.needle);
          if (!m || m.ms < plan.lowerBound) continue;
          if (!first || m.ms < first.ms || (m.ms === first.ms && STRENGTH_RANK[m.strength] > STRENGTH_RANK[first.strength])) first = m;
        }
        if (first) mentions.push({ agentId, firstMentionMs: first.ms, strength: first.strength });
      }
      const pick = pickCommitOrigin(hit.committedAtMs, mentions, plan.unreadable);
      const inWindow = mentions.filter(
        (m) =>
          m.firstMentionMs !== null &&
          m.firstMentionMs >= hit.committedAtMs - ATTRIBUTION_WINDOW_BEFORE_MS &&
          m.firstMentionMs <= hit.committedAtMs + ATTRIBUTION_WINDOW_AFTER_MS,
      ).length;
      const originAgent = pick ? agents.find((a) => a.id === pick.agentId) ?? null : null;
      const checked = plan.filesByAgent.size;
      const base = {
        sha: token,
        fullSha: hit.fullSha,
        repoPath: repo,
        repoName: path.basename(repo),
        subject: hit.subject || null,
        committedAt: new Date(hit.committedAtMs).toISOString(),
        candidatesChecked: checked,
        unreadableSessions: plan.unreadable,
      };
      if (!pick || !originAgent) {
        const window = `${ATTRIBUTION_WINDOW_BEFORE_MS / 60_000} min before to ${ATTRIBUTION_WINDOW_AFTER_MS / 60_000} min after the commit time`;
        const why =
          inWindow === 0
            ? `none of the ${checked} readable session transcripts active then mention it from ${window} (made by hand or outside Paseo)`
            : `${inWindow} session(s) mention it from ${window}, but only as readers (no \`[branch ${plan.needle}]\` commit output, ` +
              `no \`${plan.needle} (HEAD -> …)\` right after the commit, or a tie)` +
              (plan.unreadable ? ` and ${plan.unreadable} session(s) active then cannot be read, so the author may be one of them` : "");
        out.set(token, {
          ...base,
          status: "unattributed",
          origin: null,
          firstMentionAt: null,
          lagSeconds: null,
          mentioningSessions: inWindow,
          evidenceStrength: null,
          evidence: `Commit ${plan.needle} is in ${path.basename(repo)}; ${why}.`,
        });
        continue;
      }
      const lagSeconds = Math.round(pick.lagMs / 1000);
      out.set(token, {
        ...base,
        status: "attributed",
        origin: toSession(originAgent, titles.workspaces, titles.projects),
        firstMentionAt: new Date(pick.firstMentionMs).toISOString(),
        lagSeconds,
        mentioningSessions: pick.mentioningInWindow,
        evidenceStrength: pick.strength,
        evidence:
          `Session ${originAgent.id.slice(0, 7)} first mentions ${plan.needle} (${pick.strength}: ` +
          `${pick.strength === "proof" ? "git commit output" : pick.strength === "strong" ? "hash printed with its subject, HEAD or in full" : "only session to mention it, every active session readable"}) ` +
          `${Math.abs(lagSeconds)}s ` +
          `${lagSeconds < 0 ? "before the commit time (its step started first)" : "after the commit time"}; ` +
          `${pick.mentioningInWindow} of ${checked} sessions active then mention it in the window, earliest wins.`,
      });
    }
    return out;
  };

  // One resolve at a time: a second window or the agent tool asking for the same hashes waits and
  // then reads the cache instead of scanning the same transcripts again.
  let queue: Promise<unknown> = Promise.resolve();
  const serialized: CommitOriginResolver["resolve"] = (rawTokens, options) => {
    const run = queue.then(() => resolveNow(rawTokens, options));
    queue = run.catch(() => undefined);
    return run;
  };

  const resolveNow: CommitOriginResolver["resolve"] = async (rawTokens, options) => {
    const refresh = options?.refresh === true;
    const now = env.now();
    const tokens = Array.from(
      new Set(rawTokens.map((t) => normalizeCommitToken(t) ?? `invalid:${t}`)),
    );
    const results = new Map<string, CommitOriginResult>();
    const pending: string[] = [];
    for (const token of tokens) {
      if (token.startsWith("invalid:")) {
        const raw = token.slice("invalid:".length);
        results.set(token, emptyResult(raw, "invalid", "Not a commit hash: expected 7-40 hex characters."));
        continue;
      }
      const cached = cache.get(token);
      if (!refresh && cached && cached.expiresAtMs > now) results.set(token, cached.result);
      else pending.push(token);
    }

    let reposScanned = reposCache?.repos.length ?? 0;
    if (pending.length) {
      const agents = await agentsNow();
      const repos = await reposNow(agents, refresh);
      reposScanned = repos.length;
      const found = await findCommits(repos, pending);
      const attributed = await attributeAll(found, agents);
      for (const token of pending) {
        const result =
          attributed.get(token) ??
          emptyResult(token, "not_found", `No commit ${token} in the ${repos.length} repositories Paseo sessions work in.`);
        cache.set(token, {
          result,
          expiresAtMs:
            now + (result.status === "attributed" ? RESULT_TTL_ATTRIBUTED_MS : RESULT_TTL_OTHER_MS),
        });
        results.set(token, result);
      }
    }
    return {
      results: tokens.map((t) => results.get(t)).filter((r): r is CommitOriginResult => Boolean(r)),
      reposScanned,
    };
  };

  return { resolve: serialized };
}

let sharedResolver: CommitOriginResolver | null = null;

export async function handleResolveCommitOrigin(
  input: RpcInput<typeof resolveCommitOriginRpc>,
): Promise<RpcOutput<typeof resolveCommitOriginRpc>> {
  const started = Date.now();
  sharedResolver ??= createCommitOriginResolver();
  try {
    const { results, reposScanned } = await sharedResolver.resolve(input.shas, { refresh: input.refresh });
    const attributed = results.filter((r) => r.status === "attributed").length;
    return {
      ok: true,
      results,
      reposScanned,
      message: `${attributed} of ${results.length} commit(s) traced to the session that made them (${reposScanned} repositories).`,
      durationMs: Date.now() - started,
    };
  } catch (error) {
    return {
      ok: false,
      results: [],
      reposScanned: 0,
      message: `Commit origin lookup failed: ${error instanceof Error ? error.message : String(error)}`,
      durationMs: Date.now() - started,
    };
  }
}
