import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import type { Change, Summary } from "../diff/types.js";
import { formatText } from "../report.js";
import { run as runFigdiff } from "../run.js";
import { filterByPatterns, parseNameStatus, type ChangedFile } from "./changed-files.js";
import { buildComment, buildEmptyComment, isSubstantive, type FileResult } from "./comment.js";
import { parsePatterns } from "./glob.js";
import { findComment, GitHubError, upsertComment, type GitHubApi } from "./github.js";

export interface ActionDeps {
  git(args: string[], cwd: string): string;
  readText(path: string): string;
  writeText(path: string, content: string): void;
  mkdirp(path: string): void;
  fetch: typeof fetch;
  run: typeof runFigdiff;
}

export interface ActionResult {
  code: number;
  log: string[];
  comment?: "created" | "updated" | "skipped";
  /** Number of design files with real changes. */
  changed: number;
}

const defaultDeps: ActionDeps = {
  git: (args, cwd) => execFileSync("git", args, { cwd, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }),
  readText: (p) => readFileSync(p, "utf8"),
  writeText: (p, c) => writeFileSync(p, c),
  mkdirp: (p) => void mkdirSync(p, { recursive: true }),
  fetch: (...a) => fetch(...a),
  run: runFigdiff,
};

type Env = Record<string, string | undefined>;

function input(env: Env, name: string, fallback: string): string {
  const v = env[`INPUT_${name.toUpperCase().replace(/-/g, "_")}`];
  return v !== undefined && v.trim() !== "" ? v.trim() : fallback;
}

interface PullEvent {
  number?: number;
  pull_request?: { number: number; base: { sha: string }; head: { sha: string } };
}

/** Compare one modified file with its version at the base commit. */
function compareFile(file: ChangedFile, root: string, base: string, reportDir: string, deps: ActionDeps): FileResult {
  const reportName = `${file.path.replace(/[^A-Za-z0-9._-]+/g, "_")}.html`;
  const result = deps.run([join(root, file.path), "--against", base, "--json", "--html", join(reportDir, reportName)]);
  if (result.code !== 0) {
    const message = result.stderr.replace(/^figdiff:\s*/gm, "").trim().split("\n")[0] ?? "unknown error";
    return { file, error: message };
  }
  for (const w of result.writes) {
    deps.mkdirp(reportDir);
    deps.writeText(w.path, w.content);
  }
  const parsed = JSON.parse(result.stdout) as { summary: Summary; changes: Change[] };
  return { file, summary: parsed.summary, text: formatText(parsed.changes), reportName };
}

/** The entry point of the GitHub Action. Everything it needs comes in through `env` and `deps`. */
export async function runAction(env: Env, overrides: Partial<ActionDeps> = {}): Promise<ActionResult> {
  const deps = { ...defaultDeps, ...overrides };
  const log: string[] = [];
  const done = (code: number, extra: Partial<ActionResult> = {}): ActionResult => ({ code, log, changed: 0, ...extra });

  if (!env.GITHUB_EVENT_PATH) {
    log.push("figdiff: GITHUB_EVENT_PATH is not set. Run this action in a GitHub workflow.");
    return done(2);
  }
  const event = JSON.parse(deps.readText(env.GITHUB_EVENT_PATH)) as PullEvent;
  const pr = event.pull_request;
  if (!pr) {
    log.push("figdiff: this action only works on pull_request events; nothing to do.");
    return done(0, { comment: "skipped" });
  }

  const root = env.GITHUB_WORKSPACE ?? process.cwd();
  const patterns = parsePatterns(input(env, "files", "**/*.figcraft"));
  const reportDir = input(env, "report-dir", "figdiff-reports");
  const wantComment = input(env, "comment", "true") !== "false";
  const maxFiles = Math.max(1, Number.parseInt(input(env, "max-files", "20"), 10) || 20);

  let listed: ChangedFile[];
  try {
    listed = parseNameStatus(deps.git(["diff", "--name-status", "-z", "--no-renames", `${pr.base.sha}...${pr.head.sha}`], root));
  } catch {
    log.push(
      "figdiff: could not list the changed files. Check out the repository with `fetch-depth: 0` so the base commit is available.",
    );
    return done(2);
  }
  const files = filterByPatterns(listed, patterns);
  log.push(`figdiff: ${files.length} design file(s) changed in this pull request.`);

  const results: FileResult[] = [];
  for (const file of files.slice(0, maxFiles)) {
    results.push(file.status === "modified" ? compareFile(file, root, pr.base.sha, reportDir, deps) : { file });
  }
  if (files.length > maxFiles) log.push(`figdiff: only the first ${maxFiles} files were compared (max-files).`);
  const changed = results.filter(isSubstantive);
  for (const r of results) log.push(`figdiff: ${r.file.path}: ${r.error ?? r.summary?.changes ?? r.file.status}`);

  if (!wantComment) return done(0, { comment: "skipped", changed: changed.length });

  const token = env.GITHUB_TOKEN ?? env.INPUT_TOKEN;
  const repo = env.GITHUB_REPOSITORY;
  if (!token || !repo) {
    log.push("figdiff: no token or repository available, so no comment was posted.");
    return done(0, { comment: "skipped", changed: changed.length });
  }
  const api: GitHubApi = { fetch: deps.fetch, baseUrl: env.GITHUB_API_URL ?? "https://api.github.com", token };
  try {
    const existing = await findComment(api, repo, pr.number);
    if (changed.length === 0 && existing === undefined) {
      log.push("figdiff: no design changes and no earlier comment; staying quiet.");
      return done(0, { comment: "skipped" });
    }
    const runUrl = env.GITHUB_SERVER_URL && env.GITHUB_RUN_ID ? `${env.GITHUB_SERVER_URL}/${repo}/actions/runs/${env.GITHUB_RUN_ID}` : undefined;
    const body =
      changed.length === 0
        ? buildEmptyComment()
        : buildComment(changed, { runUrl, reportsUploaded: input(env, "upload-reports", "true") !== "false", version: env.FIGDIFF_VERSION });
    const outcome = await upsertComment(api, repo, pr.number, body, existing);
    log.push(`figdiff: comment ${outcome}.`);
    return done(0, { comment: outcome, changed: changed.length });
  } catch (err) {
    if (err instanceof GitHubError && err.status === 403) {
      // Pull requests from forks get a read-only token: report instead of failing the build.
      log.push("figdiff: not allowed to comment (403). On pull requests from forks the token is read-only; the changes are in the job log.");
      for (const r of changed) log.push(`${basename(r.file.path)}:\n${r.text ?? r.error ?? r.file.status}`);
      return done(0, { comment: "skipped", changed: changed.length });
    }
    log.push(`figdiff: ${err instanceof Error ? err.message : String(err)}`);
    return done(2, { changed: changed.length });
  }
}
