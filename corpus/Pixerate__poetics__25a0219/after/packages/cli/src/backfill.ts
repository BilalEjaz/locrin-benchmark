// poetics backfill --snapshot (ADR 0011): a unit file for every export that has
// none, with a rationale extracted from evidence already in the repository and
// an `inferred` record saying how sure it is. Units that have a file are never
// written to; what they lack is listed for someone to add.
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { createTypeScriptIndexer } from "@poetics/adapter-typescript";
import type { IndexedUnit } from "@poetics/adapter-typescript";
import { isRemoved } from "@poetics/core";
import type { Actor, Inferred, Link, Unit } from "@poetics/core";
import { createUnit, filesInScope, parseUnit, readUnitFiles, storePaths } from "@poetics/store";
import type { PoeticsConfig, StoreLayout } from "@poetics/store";
import { git, showAt } from "./git.ts";
import { planIndex } from "./indexing.ts";

/** One piece of evidence about why a unit exists. */
export interface Evidence {
  source: Inferred["sources"][number];
  /** Where it came from: a commit, a file, a path. */
  ref: string;
  text?: string;
}

export interface BackfillPlan {
  /** New units, each with its inferred rationale, ready to write. */
  created: Array<{ unit: Unit; evidence: Evidence[] }>;
  byConfidence: Record<Inferred["confidence"], number>;
  /** Existing units with code changes nobody recorded: `poetics index` is the tool for those. */
  unrecorded: number;
  /** Existing units the code has TSDoc or a sibling test for that the unit file lacks. */
  missingDocs: Array<{ uid: string; name: string; file: string }>;
  missingTests: Array<{ uid: string; name: string; file: string; test: string }>;
  /** Comments that read like a workaround or an invariant: candidates for a note, never written. */
  candidateNotes: Array<{ file: string; line: number; text: string }>;
}

const BY = "poetics-backfill";
const NOTE_COMMENT = /\/\/\s*(.*\b(?:HACK|XXX|workaround|work around|do not|don't|never|must)\b.*)$/i;
const AGENT_TRAILER = /\b(claude|copilot|codex|gemini|cursor|devin|aider|chatgpt)\b/i;

/** What a snapshot backfill would write. Nothing is written until `applyBackfill`. */
export async function planBackfill(root: string, config: PoeticsConfig): Promise<BackfillPlan> {
  const index = await planIndex(root, config, { rationale: "backfill" });
  // The same index planIndex just built, from its cache: spans for blame, docs for the gaps.
  const { parseable } = await filesInScope(root, config);
  const tsconfig = config.typescript?.tsconfig;
  const code = createTypeScriptIndexer({ root, files: parseable, cacheFile: join(storePaths(root).cache, "typescript.json"), ...(tsconfig ? { tsconfig } : {}) }).index().units;
  const place = (file: string, name: string, kind: string) => `${file}#${name}#${kind === "type"}`;
  const codeAt = new Map(code.map((unit) => [place(unit.span.file, unit.name, unit.kind), unit]));
  const blame = blameLines(root);
  const commits = commitReader(root);

  // How many new units each commit introduced: text shared by many units speaks to none of them in particular.
  const introducedBy = new Map<string, string | undefined>();
  for (const unit of index.created) {
    const at = codeAt.get(place(unit.location.file, unit.name, unit.kind));
    // The declaration's first line: the commit that wrote the unit's header as it stands.
    introducedBy.set(unit.uid, at ? blame(unit.location.file, at.startLine) : undefined);
  }
  const perCommit = new Map<string, number>();
  for (const sha of introducedBy.values()) if (sha) perCommit.set(sha, (perCommit.get(sha) ?? 0) + 1);

  const plan: BackfillPlan = {
    created: [],
    byConfidence: { high: 0, medium: 0, low: 0 },
    unrecorded: new Set([...index.versions, ...index.moves, ...index.removed].map((entry) => entry.uid)).size,
    missingDocs: [],
    missingTests: [],
    candidateNotes: [],
  };
  const docsMentioning = docMentions(root);

  for (const unit of index.created) {
    const sha = introducedBy.get(unit.uid);
    const commit = sha ? commits(sha) : undefined;
    const evidence: Evidence[] = [];
    const links: Link[] = [];
    let rationale: string | undefined;
    let confidence: Inferred["confidence"] = "low";

    const changeset = commit ? changesetFor(root, commit.sha, packageOf(root, unit.location.file)) : undefined;
    if (changeset) {
      evidence.push({ source: "changeset", ref: changeset.path, text: changeset.text });
      links.push({ kind: "changeset", ref: changeset.path });
      rationale = changeset.text;
      // A changeset describes its package's change; it speaks to this unit only when it names it.
      confidence = names(changeset.text, unit.name) ? "high" : "medium";
    }
    if (commit) {
      evidence.push({ source: "commit", ref: commit.sha, ...(commit.body || commit.subject ? { text: commit.body || commit.subject } : {}) });
      for (const issue of commit.issues) links.push({ kind: "github-issue", ref: issue });
      if (!rationale && (commit.body || commit.subject)) {
        rationale = commit.body || commit.subject;
        confidence = perCommit.get(commit.sha) === 1 || names(rationale, unit.name) ? "high" : "medium";
      }
    }
    if (unit.docs) {
      evidence.push({ source: "comment", ref: unit.location.file, text: unit.docs });
      rationale ??= unit.docs;
    }
    for (const test of unit.tests ?? []) evidence.push({ source: "test", ref: test.file });
    for (const doc of docsMentioning(unit.name)) {
      evidence.push({ source: "doc", ref: doc });
      links.push({ kind: "doc", ref: doc });
    }

    const version = unit.versions[0]!;
    version.rationale = rationale ?? `Present in ${unit.location.file} when Poetics was adopted; nothing in the repository says why.`;
    if (links.length > 0) version.links = dedupe(links);
    if (commit) version.commit = commit.sha;
    version.actor = commit?.agent ? { kind: "agent", tool: commit.agent, reviewed: false } : { kind: "human" };
    version.inferred = { by: BY, confidence, sources: [...new Set(evidence.map((e) => e.source))], drafted: false, reviewed: false };
    plan.byConfidence[confidence]++;
    plan.created.push({ unit, evidence });
  }

  const existing = (await readUnitFiles(storePaths(root))).map(parseUnit).filter((unit) => !isRemoved(unit));
  listGaps(root, parseable, existing, codeAt, plan);
  return plan;
}

/** Writes the planned units, each as the actor its evidence names. Returns how many were written. */
export async function applyBackfill(root: string, plan: BackfillPlan, layout: StoreLayout = "flat"): Promise<number> {
  for (const { unit } of plan.created) {
    await createUnit({ paths: storePaths(root), actor: unit.versions[0]!.actor as Actor }, unit, layout);
  }
  return plan.created.length;
}

/** The report for people: confidence counts, then what to add or record by hand. */
export function formatBackfillPlan(plan: BackfillPlan, written?: number): string {
  const lines: string[] = [];
  for (const { unit } of plan.created) {
    const version = unit.versions[0]!;
    lines.push(`+ ${unit.location.file}#${unit.name} [${version.inferred!.confidence}] ${firstLine(version.rationale)}`);
  }
  for (const gap of plan.missingDocs) lines.push(`docs? ${gap.file}#${gap.name} has TSDoc its unit file lacks`);
  for (const gap of plan.missingTests) lines.push(`tests? ${gap.file}#${gap.name} looks tested by ${gap.test}`);
  for (const note of plan.candidateNotes) lines.push(`note? ${note.file}:${note.line} ${note.text}`);
  if (plan.unrecorded > 0) lines.push(`${plan.unrecorded} existing unit(s) have unrecorded changes; poetics index records those.`);
  const { high, medium, low } = plan.byConfidence;
  const counts = `${plan.created.length} new unit(s) (${high} high, ${medium} medium, ${low} low confidence)`;
  lines.push(written === undefined ? `Would create ${counts}. Run with --write to write them.` : `Created ${counts}.`);
  return lines.join("\n");
}

/** Whether there is anything to write. */
export function hasBackfill(plan: BackfillPlan): boolean {
  return plan.created.length > 0;
}

// Docs, tests and candidate notes for units that already have a file: listed, never written.
function listGaps(root: string, parseable: readonly string[], existing: readonly Unit[], codeAt: ReadonlyMap<string, IndexedUnit>, plan: BackfillPlan): void {
  for (const unit of existing) {
    const at = codeAt.get(`${unit.location.file}#${unit.name}#${unit.kind === "type"}`);
    if (!at) continue;
    if (!unit.docs && at.docs) plan.missingDocs.push({ uid: unit.uid, name: unit.name, file: unit.location.file });
    const test = siblingTest(root, unit.location.file, unit.name);
    if (test && !(unit.tests ?? []).some((t) => t.file === test)) plan.missingTests.push({ uid: unit.uid, name: unit.name, file: unit.location.file, test });
  }
  for (const file of parseable) {
    readFileSync(join(root, file), "utf8")
      .split("\n")
      .forEach((line, i) => {
        const match = NOTE_COMMENT.exec(line);
        if (match) plan.candidateNotes.push({ file, line: i + 1, text: match[1]!.trim() });
      });
  }
}

/** Line-by-line authorship from `git blame`, one run per file; undefined for uncommitted lines or untracked files. */
function blameLines(root: string): (file: string, line: number) => string | undefined {
  const files = new Map<string, string[]>();
  return (file, line) => {
    if (!files.has(file)) {
      const shas: string[] = [];
      try {
        // Porcelain gives every line's full hash and final line number; `-l` shortens boundary commits to 39 characters.
        for (const row of git(root, ["blame", "--porcelain", "--", file]).split("\n")) {
          const header = /^([0-9a-f]{40}) \d+ (\d+)/.exec(row);
          if (header) shas[Number(header[2]) - 1] = header[1]!;
        }
      } catch {
        // Untracked, or no commits yet: nothing to attribute.
      }
      files.set(file, shas);
    }
    const sha = files.get(file)![line - 1];
    return sha && !/^0+$/.test(sha) ? sha : undefined;
  };
}

interface CommitInfo {
  sha: string;
  subject: string;
  body: string;
  issues: string[];
  /** The agent a `Co-Authored-By` trailer names, by its display name only. */
  agent?: string;
}

function commitReader(root: string): (sha: string) => CommitInfo {
  const cache = new Map<string, CommitInfo>();
  return (sha) => {
    if (!cache.has(sha)) {
      const [subject = "", raw = ""] = git(root, ["show", "-s", "--format=%s%x00%b", sha]).split("\0");
      const trailers = raw.split("\n").filter((line) => /^[A-Za-z-]+: .+/.test(line.trim()));
      const body = raw
        .split("\n")
        .filter((line) => !trailers.includes(line))
        .join("\n")
        .split(/\n\s*\n/)[0]!
        .replace(/\s+/g, " ")
        .trim();
      const agentTrailer = trailers.find((line) => /^co-authored-by:/i.test(line) && AGENT_TRAILER.test(line));
      const info: CommitInfo = {
        sha,
        // The Conventional Commit prefix says what kind of change, not why.
        subject: subject.replace(/^[a-z]+(\([^)]*\))?!?:\s*/, "").trim(),
        body,
        issues: [...new Set([...`${subject}\n${raw}`.matchAll(/(?:^|[\s(])#(\d+)\b/g)].map((m) => `#${m[1]}`))],
      };
      const agent = agentTrailer?.replace(/^co-authored-by:\s*/i, "").replace(/\s*<[^>]*>\s*$/, "").trim();
      if (agent) info.agent = agent;
      cache.set(sha, info);
    }
    return cache.get(sha)!;
  };
}

/** A changeset added in `sha` that names the unit's package: the most specific "why" the repository keeps. */
function changesetFor(root: string, sha: string, pkg: string | undefined): { path: string; text: string } | undefined {
  if (!pkg) return undefined;
  const files = git(root, ["show", "--name-only", "--diff-filter=A", "--format=", sha]).split("\n");
  for (const path of files.filter((f) => /^\.changeset\/[^/]+\.md$/.test(f))) {
    const text = showAt(root, sha, path);
    if (!text) continue;
    const [, front = "", body = ""] = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(text) ?? [];
    if (front.includes(`"${pkg}"`) || front.includes(`'${pkg}'`) || new RegExp(`^${pkg}:`, "m").test(front)) {
      return { path, text: body.trim().split(/\n\s*\n/)[0]!.replace(/\s+/g, " ") };
    }
  }
  return undefined;
}

/** The name in the nearest package.json above `file`. */
function packageOf(root: string, file: string): string | undefined {
  for (let dir = dirname(file); ; dir = dirname(dir)) {
    const path = join(root, dir, "package.json");
    if (existsSync(path)) return (JSON.parse(readFileSync(path, "utf8")) as { name?: string }).name;
    if (dir === "." || dir === "/" || dir === "") return undefined;
  }
}

/** Markdown files under docs/ and READMEs that mention a name in code style. */
function docMentions(root: string): (name: string) => string[] {
  let docs: Array<{ path: string; text: string }> | undefined;
  return (name) => {
    docs ??= git(root, ["ls-files", "--", "*.md"])
      .split("\n")
      .filter((path) => path && (path.startsWith("docs/") || /(^|\/)README\.md$/.test(path)))
      .map((path) => ({ path, text: readFileSync(join(root, path), "utf8") }));
    return docs.filter((doc) => doc.text.includes(`\`${name}\``)).map((doc) => doc.path);
  };
}

function siblingTest(root: string, file: string, name: string): string | undefined {
  const test = file.replace(/\.(tsx?|mts|cts)$/, ".test.$1");
  if (test === file || !existsSync(join(root, test))) return undefined;
  return readFileSync(join(root, test), "utf8").includes(name) ? test : undefined;
}

/** Whether `text` names `name` as a word, as prose about a unit does. */
function names(text: string, name: string): boolean {
  return new RegExp(`(?<![\\w$])${name.replace(/[$]/g, "\\$")}(?![\\w$])`).test(text);
}

function dedupe(links: Link[]): Link[] {
  const seen = new Set<string>();
  return links.filter((link) => {
    const key = typeof link === "string" ? link : `${link.kind}:${link.ref}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function firstLine(text: string): string {
  const line = text.split("\n")[0]!;
  return line.length > 100 ? `${line.slice(0, 99)}…` : line;
}

