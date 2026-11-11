// Commit -> origin session: resolver (server/commit-origin.ts) and pills (client/commit-origin-web.ts).
// Hermetic: every path the resolver reads is a temp sandbox, and the git repositories are real
// repositories created here, so the object-store prefilter is checked against what git writes.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import test from "node:test";
import {
  ATTRIBUTION_WINDOW_AFTER_MS,
  ATTRIBUTION_WINDOW_BEFORE_MS,
  claudeProjectSlug,
  createCommitOriginResolver,
  defaultCommitOriginEnv,
  mentionStrength,
  normalizeCommitToken,
  parseGitLogBatch,
  pickCommitOrigin,
  repoObjectPrefixes,
  scanTranscriptMentions,
  transcriptLineTimestampMs,
  type CommitOriginEnv,
} from "../server/commit-origin";
import {
  COMMIT_PILL_ATTR,
  commitTokenOf,
  createCommitOriginState,
  describeCommitHover,
  describeCommitPill,
  enhanceCommitOriginPills,
} from "../client/commit-origin-web";
import type { CommitOriginResult } from "../shared/commit-origin-contracts";

const T = Date.parse("2026-11-10T02:33:43Z");
const iso = (ms: number) => new Date(ms).toISOString();

function sandbox(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "commit-origin-test-"));
}

function git(cwd: string, args: string[], env: Record<string, string> = {}): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    env: {
      ...process.env,
      GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_CONFIG_SYSTEM: "/dev/null",
      GIT_AUTHOR_NAME: "t",
      GIT_AUTHOR_EMAIL: "t@example.invalid",
      GIT_COMMITTER_NAME: "t",
      GIT_COMMITTER_EMAIL: "t@example.invalid",
      ...env,
    },
  }).trim();
}

function makeRepo(dir: string, commitIso: string, subject: string): string {
  fs.mkdirSync(dir, { recursive: true });
  git(dir, ["init", "-q", "-b", "main"]);
  fs.writeFileSync(path.join(dir, "file.txt"), `${subject}\n`);
  git(dir, ["add", "file.txt"]);
  git(dir, ["commit", "-q", "-m", subject], { GIT_AUTHOR_DATE: commitIso, GIT_COMMITTER_DATE: commitIso });
  return git(dir, ["rev-parse", "HEAD"]);
}

// ---------------------------------------------------------------------------
// Pure helpers

test("commit origin 1: tokens are 7-40 lowercase hex; anything else is refused", () => {
  assert.equal(normalizeCommitToken("714efcf"), "714efcf");
  assert.equal(normalizeCommitToken("`714EFCF`"), "714efcf");
  assert.equal(normalizeCommitToken("714efcf,"), "714efcf");
  assert.equal(normalizeCommitToken("abcdeff"), "abcdeff", "a hash with no digit is still a hash");
  assert.equal(normalizeCommitToken("714efc"), null, "6 chars is too short");
  assert.equal(normalizeCommitToken("wks_123"), null);
  assert.equal(normalizeCommitToken("g14efcf"), null);
  assert.equal(normalizeCommitToken("a".repeat(41)), null);
  assert.equal(commitTokenOf(" 8AD30A3 "), "8ad30a3");
  assert.equal(commitTokenOf("main"), null);
});

test("commit origin 2: Claude project slug replaces every non-alphanumeric with '-'", () => {
  assert.equal(
    claudeProjectSlug("/srv/work space/2026-11-08 Demo project"),
    "-srv-work-space-2026-11-08-Demo-project",
  );
  assert.equal(claudeProjectSlug("/srv/.cache/plugins"), "-srv--cache-plugins");
});

test("commit origin 3: git log batch maps each requested token to its commit, ignoring others", () => {
  const full = "714efcfabe64a3b97b577e16a943a547d1150f53";
  const other = "8ad30a3eb31be1f64589494531805c2beee66adc";
  const out = `${full}\u001f1794278023\u001ffeat: a\u001fb\n${other}\u001f1794281220\u001ffix: c\nnot a line\n`;
  const hits = parseGitLogBatch(out, ["714efcf", "8ad30a3", "deadbee"]);
  assert.equal(hits.get("714efcf")?.fullSha, full);
  assert.equal(hits.get("714efcf")?.committedAtMs, 1794278023000);
  assert.equal(hits.get("714efcf")?.subject, "feat: a\u001fb", "a separator inside the subject is kept");
  assert.equal(hits.get("8ad30a3")?.subject, "fix: c");
  assert.equal(hits.has("deadbee"), false);
});

test("commit origin 4: the earliest first mention inside the window is the origin", () => {
  const pick = pickCommitOrigin(T, [
    { agentId: "reviewer", firstMentionMs: T + 12 * 60_000 }, // read it later: outside the window
    { agentId: "second", firstMentionMs: T + 60_000, strength: "strong" }, // ran git log a minute later
    { agentId: "author", firstMentionMs: T - 1_000, strength: "strong" }, // agy step created_at precedes the commit
    { agentId: "silent", firstMentionMs: null },
  ]);
  assert.equal(pick?.agentId, "author");
  assert.equal(pick?.lagMs, -1_000);
  assert.equal(pick?.mentioningInWindow, 2);
});

test("commit origin 5: nobody is the author when every mention is outside the window", () => {
  assert.equal(
    pickCommitOrigin(T, [
      { agentId: "reviewer", firstMentionMs: T + ATTRIBUTION_WINDOW_AFTER_MS + 1 },
      { agentId: "too-early", firstMentionMs: T - ATTRIBUTION_WINDOW_BEFORE_MS - 1 },
    ]),
    null,
  );
  assert.equal(pickCommitOrigin(T, [{ agentId: "edge", firstMentionMs: T + ATTRIBUTION_WINDOW_AFTER_MS }])?.agentId, "edge");
});

test("commit origin 5b: a mere reader is not the author when the real author may be unreadable", () => {
  const unreadable = 1; // e.g. a Codex session, or `git commit -q` that never echoed the hash
  // Observer saw it in prose a minute later: weak evidence, possible hidden author -> unknown.
  assert.equal(
    pickCommitOrigin(T, [{ agentId: "observer", firstMentionMs: T + 60_000, strength: "weak" }], unreadable),
    null,
  );
  // Same prose, but every session active then was readable and only one mentions it -> that one.
  assert.equal(
    pickCommitOrigin(T, [{ agentId: "only", firstMentionMs: T + 60_000, strength: "weak" }], 0)?.agentId,
    "only",
  );
  // `git log` output a minute later is still a reader, not proof of authorship.
  assert.equal(
    pickCommitOrigin(T, [{ agentId: "observer", firstMentionMs: T + 60_000, strength: "strong" }], unreadable),
    null,
  );
  // `<hash> (HEAD -> main)` one second after the commit, or a step that started before it: author.
  assert.equal(
    pickCommitOrigin(T, [{ agentId: "author", firstMentionMs: T - 1_000, strength: "strong" }], unreadable)?.agentId,
    "author",
  );
  // `[main <hash>] subject` is git commit's own output: author whatever else is unreadable.
  assert.equal(
    pickCommitOrigin(T, [{ agentId: "author", firstMentionMs: T + 120_000, strength: "proof" }], 5)?.agentId,
    "author",
  );
  // Two sessions with the same earliest timestamp (a forked transcript): no confident answer.
  assert.equal(
    pickCommitOrigin(T, [
      { agentId: "a", firstMentionMs: T + 1_000, strength: "proof" },
      { agentId: "b", firstMentionMs: T + 1_000, strength: "proof" },
    ]),
    null,
  );
});

test("commit origin 5c: mention strength reads git's own output shapes", () => {
  const full = "714efcfabe64a3b97b577e16a943a547d1150f53";
  assert.equal(mentionStrength("[main 714efcf] feat: x", "714efcf", full), "proof");
  assert.equal(mentionStrength("[feature/a (root-commit) 714efcf] init", "714efcf", full), "proof");
  assert.equal(mentionStrength("Command output:\\n714efcf (HEAD -> main) feat", "714efcf", full), "strong");
  assert.equal(mentionStrength(`printed ${full}`, "714efcf", full), "strong");
  assert.equal(mentionStrength("pushed 714efcf to origin", "714efcf", full), "weak");
  const subject = 'fix(sidebar): suspend "sub-session" ordering';
  assert.equal(mentionStrength("main: 384411d -> 714efcf\\n714efcf fix(sidebar): suspend", "714efcf", full, subject), "strong", "one-line log, no decoration");
  const quoted = 'say "hi" to every user';
  assert.equal(mentionStrength(JSON.stringify({ c: `714efcfa ${quoted}` }), "714efcf", full, quoted), "strong", "escaped inside a JSON line");
  assert.equal(mentionStrength("714efcf is the fix(sidebar) commit", "714efcf", full, subject), "weak");
});

test("commit origin 6: transcript timestamps come from Claude `timestamp` or Antigravity `created_at`", () => {
  assert.equal(transcriptLineTimestampMs(JSON.stringify({ type: "user", timestamp: iso(T) })), T);
  assert.equal(transcriptLineTimestampMs(JSON.stringify({ step_index: "1", created_at: "2026-11-10T02:33:43Z" })), T);
  assert.equal(transcriptLineTimestampMs(JSON.stringify({ type: "summary" })), null);
  assert.equal(transcriptLineTimestampMs("not json 714efcf"), null);
});

test("commit origin 7: one transcript pass settles several hashes, each with its own lower bound", async () => {
  const dir = sandbox();
  const file = path.join(dir, "t.jsonl");
  fs.writeFileSync(
    file,
    [
      JSON.stringify({ timestamp: iso(T - 3_600_000), content: "old mention of aaaaaaa" }),
      JSON.stringify({ timestamp: iso(T + 5_000), content: "[main aaaaaaa] feat" }),
      JSON.stringify({ timestamp: iso(T + 9_000), content: "bbbbbbb and aaaaaaa" }),
      "garbage line bbbbbbb",
    ].join("\n"),
  );
  const found = await scanTranscriptMentions(
    file,
    new Map([
      ["aaaaaaa", { lowerBound: T - 60_000 }],
      ["bbbbbbb", { lowerBound: T - 60_000 }],
      ["ccccccc", { lowerBound: T - 60_000 }],
    ]),
  );
  assert.deepEqual(found.get("aaaaaaa"), { ms: T + 5_000, strength: "proof" }, "the mention before the lower bound is skipped");
  assert.deepEqual(found.get("bbbbbbb"), { ms: T + 9_000, strength: "weak" });
  assert.equal(found.has("ccccccc"), false);
});

// ---------------------------------------------------------------------------
// Object-store prefilter against real git

test("commit origin 8: object prefilter finds loose and packed commits and rejects absent ones", () => {
  const dir = path.join(sandbox(), "repo");
  const sha = makeRepo(dir, "2026-11-10T02:33:43Z", "feat: one");
  const short = sha.slice(0, 7);
  return (async () => {
    assert.deepEqual([...(await repoObjectPrefixes(dir, [short, "0000000"]))], [short], "loose object");
    git(dir, ["gc", "-q", "--prune=now"]);
    assert.equal(fs.readdirSync(path.join(dir, ".git", "objects", "pack")).some((f) => f.endsWith(".idx")), true);
    const packed = await repoObjectPrefixes(dir, [short, sha, "0000000"]);
    assert.deepEqual([...packed].sort(), [sha, short].sort(), "packed object via .idx, short and full");
    const wt = path.join(path.dirname(dir), "wt");
    git(dir, ["worktree", "add", "-q", wt]);
    assert.equal((await repoObjectPrefixes(wt, [short])).has(short), true, "worktree .git file -> shared store");
  })();
});

// ---------------------------------------------------------------------------
// End-to-end resolver in a sandbox

interface SandboxAgent {
  id: string;
  provider: "claude" | "antigravity";
  cwd: string;
  createdAt: string;
  lastActivityAt: string;
  title: string;
  workspaceId: string;
  lines: Array<{ ms: number; text: string }>;
}

function writeSandbox(root: string, agents: SandboxAgent[]): CommitOriginEnv {
  const paseoDir = path.join(root, "paseo");
  const claudeProjectsDir = path.join(root, "claude-projects");
  const brain = path.join(root, "brain");
  fs.mkdirSync(path.join(paseoDir, "agents", "bucket"), { recursive: true });
  fs.mkdirSync(path.join(paseoDir, "projects"), { recursive: true });
  fs.writeFileSync(
    path.join(paseoDir, "projects", "workspaces.json"),
    JSON.stringify(agents.map((a) => ({ workspaceId: a.workspaceId, title: `${a.title} ws`, projectId: "p1" }))),
  );
  fs.writeFileSync(path.join(paseoDir, "projects", "projects.json"), JSON.stringify([{ projectId: "p1", displayName: "Proj" }]));
  for (const a of agents) {
    const sid = `${a.id}-sid`;
    const persistence =
      a.provider === "claude"
        ? { provider: "claude", sessionId: sid }
        : { provider: "antigravity", sessionId: `plugin:${JSON.stringify({ version: 1, data: { conversationId: sid } })}` };
    fs.writeFileSync(
      path.join(paseoDir, "agents", "bucket", `${a.id}.json`),
      JSON.stringify({ id: a.id, provider: a.provider, cwd: a.cwd, title: a.title, workspaceId: a.workspaceId, createdAt: a.createdAt, lastActivityAt: a.lastActivityAt, lastStatus: "idle", persistence }),
    );
    const body = a.lines
      .map((l) => JSON.stringify(a.provider === "claude" ? { timestamp: iso(l.ms), message: l.text } : { created_at: iso(l.ms).replace(/\.\d{3}Z$/, "Z"), content: l.text }))
      .join("\n");
    const file =
      a.provider === "claude"
        ? path.join(claudeProjectsDir, claudeProjectSlug(a.cwd), `${sid}.jsonl`)
        : path.join(brain, sid, ".system_generated", "logs", "transcript.jsonl");
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, body);
  }
  return {
    ...defaultCommitOriginEnv(),
    paseoDir,
    claudeProjectsDir,
    antigravityBrainDirs: [brain],
    extraRepoParents: [],
  };
}

test("commit origin 9: resolver pins a commit on the session that made it, not on a later reader", async () => {
  const root = sandbox();
  const work = path.join(root, "work dir");
  const plugin = path.join(work, "nested-plugin");
  const sha = makeRepo(plugin, iso(T), "feat(quote-reply): select text");
  const lonely = makeRepo(path.join(work, "lonely"), iso(T), "chore: by hand");
  const hidden = makeRepo(path.join(work, "hidden"), iso(T), "fix: made by a Cursor session");
  const short = sha.slice(0, 7);
  const lonelyShort = lonely.slice(0, 7);
  const hiddenShort = hidden.slice(0, 7);
  const base = { cwd: work, createdAt: iso(T - 3_600_000), lastActivityAt: iso(T + 3_600_000) };
  const env = writeSandbox(root, [
    // The author is an Antigravity session whose cwd is the container, not the nested repo.
    { ...base, id: "aaaaaaaa-0000-4000-8000-000000000001", provider: "antigravity", title: "add quote reply to the chat", workspaceId: "wks_author",
      lines: [{ ms: T - 1_000, text: `Command output: ${short} (HEAD -> main) feat` }] },
    // A Claude reviewer reads the hash 12 minutes later and mentions it a lot.
    { ...base, id: "bbbbbbbb-0000-4000-8000-000000000002", provider: "claude", title: "review", workspaceId: "wks_review",
      lines: [
        { ms: T + 60_000, text: `the other session already landed ${hiddenShort}` },
        { ms: T + 12 * 60_000, text: `pushed ${short} and ${lonelyShort}` },
      ] },
    // Not active at commit time: never a candidate even though it mentions the hash in the window.
    { ...base, id: "cccccccc-0000-4000-8000-000000000003", provider: "claude", title: "later", workspaceId: "wks_later",
      createdAt: iso(T + 3_600_000), lastActivityAt: iso(T + 7_200_000), lines: [{ ms: T + 30_000, text: short }] },
  ]);
  // A session whose transcript this resolver cannot read (Cursor) was active at commit time.
  fs.writeFileSync(
    path.join(env.paseoDir, "agents", "bucket", "dddddddd.json"),
    JSON.stringify({ id: "dddddddd-0000-4000-8000-000000000004", provider: "cursor", cwd: work, title: "cursor", workspaceId: "wks_cursor",
      createdAt: base.createdAt, lastActivityAt: base.lastActivityAt, lastStatus: "idle", persistence: { provider: "cursor", sessionId: "c-1" } }),
  );
  // The nested repos are found under the cwd even though no session's cwd is inside them.
  fs.mkdirSync(path.join(work, ".git"));

  const resolver = createCommitOriginResolver(env);
  const { results, reposScanned } = await resolver.resolve([short, lonelyShort, hiddenShort, "0000000", "nothex!"]);
  const byToken = new Map(results.map((r) => [r.sha, r]));

  const hit = byToken.get(short)!;
  assert.equal(hit.status, "attributed");
  assert.equal(hit.origin?.agentId, "aaaaaaaa-0000-4000-8000-000000000001");
  assert.equal(hit.origin?.workspaceTitle, "add quote reply to the chat ws");
  assert.equal(hit.origin?.projectName, "Proj");
  assert.equal(hit.fullSha, sha);
  assert.equal(hit.subject, "feat(quote-reply): select text");
  assert.equal(hit.repoName, "nested-plugin");
  assert.equal(hit.lagSeconds, -1);
  assert.equal(hit.candidatesChecked, 2, "the session created after the commit is not a candidate");
  assert.equal(hit.unreadableSessions, 1, "the Cursor session is counted, and strong evidence still wins");
  assert.equal(hit.mentioningSessions, 1);

  const hiddenResult = byToken.get(hiddenShort)!;
  assert.equal(hiddenResult.status, "unattributed", "a reader's prose is not authorship while a possible author is unreadable");
  assert.equal(hiddenResult.origin, null);
  assert.match(hiddenResult.evidence, /cannot be read/);

  const unattributed = byToken.get(lonelyShort)!;
  assert.equal(unattributed.status, "unattributed", "only a later reader mentions it");
  assert.equal(unattributed.origin, null);

  assert.equal(byToken.get("0000000")?.status, "not_found");
  assert.equal(byToken.get("nothex!")?.status, "invalid");
  assert.ok(reposScanned >= 4, `container + 3 nested repos, saw ${reposScanned}`);
});

// ---------------------------------------------------------------------------
// Client

const attributed = (over: Partial<CommitOriginResult> = {}): CommitOriginResult => ({
  sha: "714efcf",
  status: "attributed",
  fullSha: "714efcfabe64a3b97b577e16a943a547d1150f53",
  repoPath: "/r/file-inspector-finder",
  repoName: "file-inspector-finder",
  subject: "feat(quote-reply): select text",
  committedAt: iso(T),
  origin: {
    agentId: "aaaa1111-0000-4000-8000-000000000001",
    shortId: "aaaa111",
    agentTitle: "add quote reply to the chat window",
    workspaceId: "wks_x",
    workspaceTitle: "ws",
    projectId: null,
    projectName: "Demo project",
    status: "done",
    provider: "antigravity",
  },
  firstMentionAt: iso(T - 1000),
  lagSeconds: -1,
  candidatesChecked: 26,
  unreadableSessions: 2,
  mentioningSessions: 1,
  evidenceStrength: "strong",
  evidence: "",
  ...over,
});

test("commit origin 10: pill text names the session; hover carries commit, session and evidence", () => {
  const zh = describeCommitPill(attributed(), attributed().origin!, true);
  assert.equal(zh.meta, "· 来自 add quote reply to the… ↗");
  assert.match(zh.title, /提交 714efcf · feat\(quote-reply\): select text · file-inspector-finder/);
  assert.match(zh.title, /由会话 #aaaa111「add quote reply to the chat window」提交（已完成 · Demo project）/);
  assert.match(zh.title, /提交前 1 秒/);
  assert.match(zh.title, /26 个会话里有 1 个/);
  const en = describeCommitPill(attributed(), attributed().origin!, false);
  assert.match(en.meta, /^· from add quote reply/);
  assert.match(en.title, /Made by session #aaaa111/);
  assert.equal(describeCommitPill(attributed(), { ...attributed().origin!, status: "running" }, false).dot, "running");
});

test("commit origin 11: no pill, only hover text, for own commits and commits made outside Paseo", () => {
  assert.match(describeCommitHover(attributed(), true, true) ?? "", /由本会话提交/);
  assert.match(describeCommitHover(attributed({ status: "unattributed", origin: null }), false, false) ?? "", /No Paseo session made it/);
  assert.equal(describeCommitHover(attributed({ status: "not_found", origin: null, fullSha: null }), false, false), null);
});

// Minimal DOM: only what enhanceCommitOriginPills touches.
class FakeEl {
  attrs = new Map<string, string>();
  title = "";
  tabIndex = -1;
  listeners: string[] = [];
  styleProps = new Map<string, string>();
  style = {
    setProperty: (k: string, v: string) => this.styleProps.set(k, v),
    removeProperty: (k: string) => this.styleProps.delete(k),
  };
  textContent: string;
  ancestors: string[];
  constructor(textContent: string, ancestors: string[]) {
    this.textContent = textContent;
    this.ancestors = ancestors;
  }
  getAttribute(n: string) { return this.attrs.get(n) ?? null; }
  setAttribute(n: string, v: string) { this.attrs.set(n, v); }
  hasAttribute(n: string) { return this.attrs.has(n); }
  removeAttribute(n: string) { this.attrs.delete(n); }
  addEventListener(type: string) { this.listeners.push(type); }
  closest(selector: string) {
    return selector.split(",").some((s) => this.ancestors.includes(s.trim())) ? {} : null;
  }
}

test("commit origin 12: enhancer decorates other sessions' commits in messages without touching children", () => {
  const assistant = '[data-testid="assistant-message"]';
  const other = new FakeEl("714efcf", [assistant]);
  const own = new FakeEl("384411d", [assistant]);
  const unknown = new FakeEl("8ad30a3", [assistant]);
  const inComposer = new FakeEl("714efcf", [assistant, '[data-testid="message-input-root"]']);
  const outsideMessages = new FakeEl("714efcf", []);
  const sessionPill = new FakeEl("fa22464", [assistant]);
  sessionPill.setAttribute("data-vec-session-pill", "fa224642");
  const codes = [other, own, unknown, inComposer, outsideMessages, sessionPill];
  const doc = {
    querySelectorAll: (sel: string) => (sel === "code" ? codes : []),
    querySelector: () => null,
    documentElement: { style: {} },
  } as unknown as Document;
  const win = { location: { pathname: "/h/srv/ag/cccc3333-0000-4000-8000-000000000003" }, navigator: { language: "zh-CN" } } as unknown as Window;

  const state = createCommitOriginState();
  state.cache.set("714efcf", { kind: "done", result: attributed(), at: Date.now() });
  state.cache.set("384411d", {
    kind: "done",
    result: attributed({ sha: "384411d", origin: { ...attributed().origin!, agentId: "cccc3333-0000-4000-8000-000000000003" } }),
    at: Date.now(),
  });

  const missing = enhanceCommitOriginPills(state, doc, win, "zh-CN");
  assert.deepEqual(missing, ["8ad30a3"], "only the unresolved hash in a message is looked up");
  assert.equal(other.getAttribute(COMMIT_PILL_ATTR), "aaaa1111-0000-4000-8000-000000000001");
  assert.equal(other.getAttribute("data-testid"), "paseo-finder-inline-commit-pill-714efcf");
  assert.equal(other.textContent, "714efcf", "the hash text itself is untouched");
  assert.ok(other.styleProps.has("--vec-commit-dot"));
  assert.deepEqual(other.listeners, ["click", "keydown"]);
  assert.equal(own.hasAttribute(COMMIT_PILL_ATTR), false, "own commit: no pill");
  assert.match(own.title, /由本会话提交/);
  for (const el of [inComposer, outsideMessages, sessionPill]) {
    assert.equal(el.hasAttribute(COMMIT_PILL_ATTR), false);
  }

  enhanceCommitOriginPills(state, doc, win, "zh-CN");
  assert.deepEqual(other.listeners, ["click", "keydown"], "a second pass does not bind twice");

  // Clicking the pill opens the origin session. While the app switches, the message DOM can
  // render before the route says whose session it is; once it does, a pill that turns out to
  // point at the current session must go back to a plain hash with hover text.
  (win.location as { pathname: string }).pathname = "/h/srv/ag/aaaa1111-0000-4000-8000-000000000001";
  enhanceCommitOriginPills(state, doc, win, "zh-CN");
  assert.equal(other.hasAttribute(COMMIT_PILL_ATTR), false, "own commit after navigation: pill removed");
  assert.equal(other.getAttribute("data-testid"), null);
  assert.equal(other.styleProps.has("--vec-commit-dot"), false);
  assert.match(other.title, /由本会话提交/);
});

test("commit origin 13: a reused element follows its current text, binds once, and stale answers expire", () => {
  const assistant = '[data-testid="assistant-message"]';
  const el = new FakeEl("714efcf", [assistant]);
  const doc = {
    querySelectorAll: (sel: string) => (sel === "code" ? [el] : []),
    querySelector: () => null,
    documentElement: { style: {} },
  } as unknown as Document;
  const win = { location: { pathname: "/h/srv/ag/cccc3333-0000-4000-8000-000000000003" }, navigator: { language: "en" } } as unknown as Window;
  const state = createCommitOriginState();
  const otherOrigin = { ...attributed().origin!, agentId: "bbbbbbbb-0000-4000-8000-000000000002", agentTitle: "second" };
  state.cache.set("714efcf", { kind: "done", result: attributed(), at: Date.now() });
  state.cache.set("8ad30a3", { kind: "done", result: attributed({ sha: "8ad30a3", origin: otherOrigin }), at: Date.now() });

  enhanceCommitOriginPills(state, doc, win, "en");
  assert.equal(el.getAttribute(COMMIT_PILL_ATTR), attributed().origin!.agentId);
  // React reuses the element for another hash: the pill follows the text, not a cached attribute.
  el.textContent = "8ad30a3";
  enhanceCommitOriginPills(state, doc, win, "en");
  assert.equal(el.getAttribute(COMMIT_PILL_ATTR), otherOrigin.agentId);
  assert.deepEqual(el.listeners, ["click", "keydown"], "one listener pair, which reads the target at click time");
  assert.equal(el.getAttribute("data-vec-raw-token"), null, "no cached token that could outlive the text");

  // A new install (plugin reload) takes the element over; the old listeners stand down.
  const next = createCommitOriginState();
  next.cache = state.cache;
  enhanceCommitOriginPills(next, doc, win, "en");
  assert.equal(el.getAttribute("data-vec-commit-bound"), next.instanceId);
  assert.notEqual(next.instanceId, state.instanceId);

  // "No Paseo session made it" may only be true for now: re-ask after the TTL.
  state.cache.set("0abcdef", { kind: "done", result: attributed({ sha: "0abcdef", status: "unattributed", origin: null }), at: Date.now() - 6 * 60_000 });
  el.textContent = "0abcdef";
  assert.deepEqual(enhanceCommitOriginPills(state, doc, win, "en"), ["0abcdef"]);
  assert.equal(el.hasAttribute(COMMIT_PILL_ATTR), false, "while re-asking, the old answer still renders");
});
