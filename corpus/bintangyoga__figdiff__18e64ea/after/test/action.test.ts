import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { filterByPatterns, parseNameStatus } from "../src/action/changed-files.js";
import { buildComment, buildEmptyComment, COMMENT_MARKER } from "../src/action/comment.js";
import { globToRegExp, matchesAny, parsePatterns } from "../src/action/glob.js";
import { runAction } from "../src/action/main.js";
import { makeFigcraft } from "./helpers.js";

describe("globs", () => {
  it("handles *, ** and ?", () => {
    expect(globToRegExp("**/*.figcraft").test("app.figcraft")).toBe(true);
    expect(globToRegExp("**/*.figcraft").test("a/b/app.figcraft")).toBe(true);
    expect(globToRegExp("design/*.figcraft").test("design/x/app.figcraft")).toBe(false);
    expect(globToRegExp("design/**/*.figcraft").test("design/app.figcraft")).toBe(true);
    expect(globToRegExp("a?.figcraft").test("ab.figcraft")).toBe(true);
    expect(globToRegExp("a.figcraft").test("aXfigcraft")).toBe(false);
  });
  it("splits patterns on commas and new lines", () => {
    expect(parsePatterns("a/*.figcraft, ./b/*.figcraft\n\nc.figcraft")).toEqual(["a/*.figcraft", "b/*.figcraft", "c.figcraft"]);
    expect(matchesAny("b/x.figcraft", ["a/*.figcraft", "b/*.figcraft"])).toBe(true);
  });
});

describe("changed files", () => {
  it("parses git name-status output, including odd file names", () => {
    const out = "M\0a.figcraft\0A\0dir/with space.figcraft\0D\0old.figcraft\0R100\0x.figcraft\0y.figcraft\0";
    expect(parseNameStatus(out)).toEqual([
      { status: "modified", path: "a.figcraft" },
      { status: "added", path: "dir/with space.figcraft" },
      { status: "deleted", path: "old.figcraft" },
      { status: "renamed", path: "y.figcraft", oldPath: "x.figcraft" },
    ]);
  });
  it("keeps only matching files", () => {
    const files = parseNameStatus("M\0a.figcraft\0M\0readme.md\0");
    expect(filterByPatterns(files, ["**/*.figcraft"]).map((f) => f.path)).toEqual(["a.figcraft"]);
  });
});

describe("comment", () => {
  const summary = { changes: 1, frames: 1, added: 0, removed: 0, moved: 0, reordered: 0, modifiedNodes: 1, propertyChanges: 1 };
  it("includes a marker, details and survives backticks in names", () => {
    const body = buildComment(
      [{ file: { status: "modified", path: "we`ird.figcraft" }, summary, text: "Page \"X\"\n  ~ `code`\n", reportName: "r.html" }],
      { runUrl: "https://example.com/run", reportsUploaded: true },
    );
    expect(body.startsWith(COMMENT_MARKER)).toBe(true);
    expect(body).toContain("<details>");
    expect(body).toContain("[this workflow run](https://example.com/run)");
  });
  it("stays under the GitHub size limit", () => {
    const text = "line of text\n".repeat(20_000);
    const body = buildComment([{ file: { status: "modified", path: "a.figcraft" }, summary, text }], { reportsUploaded: false });
    expect(body.length).toBeLessThan(65_536);
    expect(body).toContain("more lines not shown");
  });
  it("has a message for pull requests that no longer change designs", () => {
    expect(buildEmptyComment()).toContain(COMMENT_MARKER);
  });
});

describe("runAction with a real git repository", () => {
  let repo = "";
  let base = "";
  let head = "";
  let eventPath = "";
  const git = (...args: string[]) => execFileSync("git", args, { cwd: repo, encoding: "utf8" }).trim();

  beforeAll(() => {
    repo = mkdtempSync(join(tmpdir(), "figdiff-action-"));
    git("init", "-q", "-b", "main");
    git("config", "user.email", "t@example.com");
    git("config", "user.name", "t");
    git("config", "commit.gpgsign", "false");
    mkdirSync(join(repo, "design"));
    writeFileSync(join(repo, "design/app.figcraft"), makeFigcraft(1));
    writeFileSync(join(repo, "design/same.figcraft"), makeFigcraft(1));
    writeFileSync(join(repo, "notes.md"), "a");
    git("add", "."); git("commit", "-q", "-m", "base");
    base = git("rev-parse", "HEAD");
    writeFileSync(join(repo, "design/app.figcraft"), makeFigcraft(0.5, true));
    writeFileSync(join(repo, "design/same.figcraft"), makeFigcraft(1)); // identical bytes: not listed as changed
    writeFileSync(join(repo, "design/new.figcraft"), makeFigcraft(1));
    writeFileSync(join(repo, "notes.md"), "b");
    git("add", "."); git("commit", "-q", "-m", "change");
    head = git("rev-parse", "HEAD");
    eventPath = join(repo, "..", `event-${Date.now()}.json`);
    writeFileSync(eventPath, JSON.stringify({ pull_request: { number: 7, base: { sha: base }, head: { sha: head } } }));
  });
  afterAll(() => undefined);

  function fakeGitHub(existing: { id: number; body: string }[] = []) {
    const calls: { method: string; url: string; body?: string }[] = [];
    const f = (async (url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      calls.push({ method, url, body: init?.body as string | undefined });
      const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status });
      if (method === "GET") return json(existing);
      return json({ id: 99 }, 201);
    }) as unknown as typeof fetch;
    return { f, calls };
  }

  const env = () => ({
    GITHUB_EVENT_PATH: eventPath,
    GITHUB_WORKSPACE: repo,
    GITHUB_TOKEN: "t",
    GITHUB_REPOSITORY: "o/r",
    GITHUB_API_URL: "https://api.test",
  });

  it("posts one comment about the modified file and the new file", async () => {
    const gh = fakeGitHub();
    const reportDir = join(repo, "reports");
    const r = await (runAction({ ...env(), INPUT_REPORT_DIR: reportDir }, { fetch: gh.f }));
    const result = r as Awaited<ReturnType<typeof runAction>>;
    expect(result.code).toBe(0);
    expect(result.comment).toBe("created");
    const post = gh.calls.find((c) => c.method === "POST");
    expect(post?.url).toBe("https://api.test/repos/o/r/issues/7/comments");
    const body = JSON.parse(post?.body ?? "{}").body as string;
    expect(body).toContain("design/app.figcraft");
    expect(body).toContain("Hint");
    expect(body).toContain("design/new.figcraft");
    expect(body).not.toContain("notes.md");
    expect(body).not.toContain("same.figcraft");
  });

  it("updates its earlier comment instead of adding another", async () => {
    const gh = fakeGitHub([{ id: 5, body: `${COMMENT_MARKER} old` }]);
    const r = (await (runAction({ ...env(), INPUT_REPORT_DIR: join(repo, "r2") }, { fetch: gh.f }))) as Awaited<ReturnType<typeof runAction>>;
    expect(r.comment).toBe("updated");
    expect(gh.calls.some((c) => c.method === "PATCH" && c.url.endsWith("/issues/comments/5"))).toBe(true);
    expect(gh.calls.some((c) => c.method === "POST")).toBe(false);
  });

  it("stays quiet when no design file matches", async () => {
    const gh = fakeGitHub();
    const r = (await (runAction({ ...env(), INPUT_FILES: "nothing/*.figcraft" }, { fetch: gh.f }))) as Awaited<ReturnType<typeof runAction>>;
    expect(r.comment).toBe("skipped");
    expect(gh.calls.some((c) => c.method !== "GET")).toBe(false);
  });

  it("does not fail the build when the token is read-only", async () => {
    const f = (async (_u: string, init?: RequestInit) =>
      (init?.method ?? "GET") === "GET" ? new Response("[]") : new Response(JSON.stringify({ message: "Resource not accessible" }), { status: 403 })) as unknown as typeof fetch;
    const r = (await (runAction({ ...env(), INPUT_REPORT_DIR: join(repo, "r3") }, { fetch: f }))) as Awaited<ReturnType<typeof runAction>>;
    expect(r.code).toBe(0);
    expect(r.log.join("\n")).toContain("403");
  });

  it("ignores events that are not pull requests", async () => {
    const p = join(repo, "..", `push-${Date.now()}.json`);
    writeFileSync(p, "{}");
    const r = await runAction({ GITHUB_EVENT_PATH: p });
    expect(r.code).toBe(0);
    expect(r.comment).toBe("skipped");
  });
});
