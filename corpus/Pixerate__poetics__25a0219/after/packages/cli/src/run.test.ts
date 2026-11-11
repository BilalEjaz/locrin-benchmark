import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { COMMANDS } from "./commands.ts";
import { VERSION, run } from "./run.ts";
import { FN_A, makeGitRepo, write } from "./test-helpers.ts";

async function exec(...argv: string[]) {
  return execIn(process.cwd(), ...argv);
}

async function execIn(root: string, ...argv: string[]) {
  const out: string[] = [];
  const err: string[] = [];
  const code = await run(argv, { out: (t) => out.push(t), err: (t) => err.push(t) }, root);
  return { code, out: out.join("\n"), err: err.join("\n") };
}

describe("poetics CLI", () => {
  it("prints help with every command", async () => {
    const { code, out } = await exec();
    expect(code).toBe(0);
    for (const command of COMMANDS) expect(out).toContain(command.usage);
  });

  it("prints help as JSON for agents", async () => {
    const { out } = await exec("help", "--json");
    expect(JSON.parse(out)).toEqual({ version: VERSION, commands: COMMANDS });
  });

  it("prints the version matching package.json", async () => {
    const pkg = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8")) as { version: string };
    expect((await exec("--version")).out).toBe(pkg.version);
  });

  it("exits 2 for unknown commands", async () => {
    const { code, err } = await exec("frobnicate", "--json");
    expect(code).toBe(2);
    expect(JSON.parse(err)).toMatchObject({ error: "unknown-command" });
  });

  describe("changes", () => {
    // Signing off and a fixed identity, so tests never prompt the user's signer.
    const git = (root: string, ...args: string[]) =>
      execFileSync("git", ["-c", "user.name=Test", "-c", "user.email=test@example.com", "-c", "commit.gpgsign=false", ...args], {
        cwd: root,
        encoding: "utf8",
      });
    const unit = (rationales: string[]) => ({
      uid: "01JB8K0000000000000000000A",
      kind: "function",
      framework: "none",
      name: "formatPrice",
      location: { file: "src/price.ts" },
      versions: rationales.map((rationale, i) => ({
        contentHash: `git:${String(i + 1).repeat(40)}`,
        provisional: true,
        parent: i === 0 ? null : `git:${String(i).repeat(40)}`,
        change: i === 0 ? "created" : "behaviour",
        actor: { kind: "human" },
        rationale,
      })),
    });

    async function repo(): Promise<string> {
      const root = await mkdtemp(join(tmpdir(), "poetics-cli-"));
      await mkdir(join(root, ".poetics", "units"), { recursive: true });
      const file = join(root, ".poetics", "units", "01JB8K0000000000000000000A.json");
      await writeFile(file, JSON.stringify(unit(["Seed"])));
      git(root, "init", "-q", "-b", "main");
      git(root, "add", "-A");
      git(root, "commit", "-q", "-m", "Seed");
      await writeFile(file, JSON.stringify(unit(["Seed", "Round half up"])));
      git(root, "commit", "-q", "-am", "Fix rounding");
      return root;
    }

    it("prints the changes between two refs", async () => {
      const root = await repo();
      const { code, out } = await execIn(root, "changes", "HEAD~1", "HEAD");
      expect(code).toBe(0);
      expect(out).toContain("Fix rounding\n  ~ formatPrice (function, src/price.ts) behaviour\n      Round half up");
    });

    it("prints the change set as JSON for agents", async () => {
      const root = await repo();
      const { out } = await execIn(root, "changes", "HEAD~1", "HEAD", "--json");
      expect(JSON.parse(out)).toMatchObject({ commits: [{ subject: "Fix rounding", units: [{ name: "formatPrice" }] }], unrecorded: [] });
    });

    it("exits 2 for unknown refs, extra arguments and the planned --impact", async () => {
      const root = await repo();
      expect(JSON.parse((await execIn(root, "changes", "nope", "--json")).err)).toMatchObject({
        error: "invalid-argument",
        message: "Unknown git ref: nope",
      });
      expect((await execIn(root, "changes", "a", "b", "c")).code).toBe(2);
      expect(JSON.parse((await execIn(root, "changes", "--impact", "--json")).err)).toMatchObject({ error: "not-implemented" });
    });
  });

  it("exits 2 with a structured error for planned commands", async () => {
    const { code, err } = await exec("init", "--json");
    expect(code).toBe(2);
    expect(JSON.parse(err)).toMatchObject({ error: "not-implemented", command: "init" });
  });

  describe("log and why", () => {
    it("answer for a unit of this repository by name, uid or file#name", async () => {
      const log = await exec("log", "packages/store/src/index-db.ts#searchUnits");
      expect(log.code).toBe(0);
      expect(log.out).toMatch(/^searchUnits \(function, packages\/store\/src\/index-db\.ts\)/);
      expect(log.out).toMatch(/#0 created/);

      const why = JSON.parse((await exec("why", "searchUnits", "--json")).out) as { name: string; chain: Array<{ seq: number; change: string }> };
      expect(why.name).toBe("searchUnits");
      expect(why.chain[0]).toMatchObject({ seq: 0, change: "created" });

      const json = JSON.parse((await exec("log", "searchUnits", "--json")).out) as { uid: string; versions: Array<{ seq: number }> };
      expect(json.versions[0]!.seq).toBe(json.versions.length - 1);
      expect((await exec("why", json.uid)).out).toContain("Why searchUnits");
    });

    it("exit 2 for a missing, unknown or ambiguous unit", async () => {
      expect(JSON.parse((await exec("log", "--json")).err)).toMatchObject({ error: "usage", command: "log" });
      expect(JSON.parse((await exec("why", "noSuchUnit", "--json")).err)).toMatchObject({ error: "invalid-argument", command: "why" });
      // Io is exported by more than one module here.
      const ambiguous = await exec("log", "Io");
      expect(ambiguous.code).toBe(2);
      expect(ambiguous.err).toMatch(/Io is ambiguous/);
    });
  });

  describe("verify", () => {
    const UID = "01JB8K0000000000000000000A";
    const config = JSON.stringify({ version: 1, adapters: ["typescript"], include: ["src/**/*.ts"], exclude: ["**/*.test.ts"] });
    const repo = async () => {
      const root = await makeGitRepo(UID);
      await write(root, ".poetics/config.json", config);
      return root;
    };

    it("passes a clean tree and exits 1 on an unrecorded change", async () => {
      const root = await repo();
      expect((await execIn(root, "verify")).code).toBe(0);

      await write(root, "src/a.ts", FN_A.replace("1", "2"));
      const result = await execIn(root, "verify");
      expect(result.code).toBe(1);
      expect(result.err).toContain("error: stale: src/a.ts");
      expect(result.out).toMatch(/1 code file\(s\), 0 unit file\(s\) changed; 1 error\(s\), 0 warning\(s\)/);
    });

    it("emits the report as JSON and compares with --since", async () => {
      const root = await repo();
      expect(JSON.parse((await execIn(root, "verify", "--json", "--since", "HEAD")).out)).toMatchObject({ findings: [] });
    });

    it("exits 2 for bad arguments and unknown refs", async () => {
      const root = await repo();
      expect(JSON.parse((await execIn(root, "verify", "--since", "--json")).err)).toMatchObject({ error: "usage" });
      expect((await execIn(root, "verify", "main")).code).toBe(2);
      const unknown = await execIn(root, "verify", "--since", "nope", "--json");
      expect(unknown.code).toBe(2);
      expect(JSON.parse(unknown.err)).toMatchObject({ error: "invalid-argument", command: "verify" });
    });
  });

  describe("coverage", () => {
    const UID = "01JB8K0000000000000000000A";
    const config = { version: 1, adapters: ["typescript"], include: ["src/**/*.ts"], exclude: ["**/*.test.ts"] };

    it("reports coverage and exits 1 below a policy threshold", async () => {
      const root = await makeGitRepo(UID);
      await write(root, "src/b.ts", "export function b() {}\n");
      await write(root, ".poetics/config.json", JSON.stringify({ ...config, policy: { coverage: { tracked: 1 } } }));
      const result = await execIn(root, "coverage", "--json");
      expect(result.code).toBe(1);
      const report = JSON.parse(result.out) as { overall: { tracked: unknown; fresh: { ratio: number } }; failures: Array<{ metric: string }> };
      expect(report.overall.tracked).toEqual({ covered: 1, total: 2, ratio: 0.5 });
      expect(report.overall.fresh.ratio).toBe(1);
      expect(report.failures.map((f) => f.metric)).toEqual(["tracked"]);
      expect((await execIn(root, "coverage")).out).toContain("tracked");
    });

    it("exits 0 when every threshold is met, and 2 for extra arguments", async () => {
      const root = await makeGitRepo(UID);
      await write(root, ".poetics/config.json", JSON.stringify({ ...config, policy: { coverage: { tracked: 1 } } }));
      expect((await execIn(root, "coverage")).code).toBe(0);
      expect((await execIn(root, "coverage", "extra")).code).toBe(2);
    });
  });

  describe("hash and rehash", () => {
    const UID = "01JB8K0000000000000000000A";
    const config = JSON.stringify({ version: 1, adapters: ["typescript"], include: ["src/**/*.ts"], exclude: ["**/*.test.ts"] });

    it("prints a file's unit hashes, as text or JSON, and refuses an unknown unit", async () => {
      const root = await makeGitRepo(UID);
      await write(root, ".poetics/config.json", config);
      const text = await execIn(root, "hash", "src/a.ts");
      expect(text.code).toBe(0);
      expect(text.out).toMatch(/^a \(function, lines 1-3\)\n {2}contentHash {3}b3:[0-9a-f]{64}\n {2}interfaceHash b3:/);
      expect(JSON.parse((await execIn(root, "hash", "src/a.ts#a", "--json")).out)).toMatchObject({ file: "src/a.ts", units: [{ name: "a" }] });
      expect(JSON.parse((await execIn(root, "hash", "src/a.ts#nope", "--json")).err)).toMatchObject({ error: "invalid-argument" });
      expect((await execIn(root, "hash")).code).toBe(2);
    });

    it("plans by default, writes with --write as the given actor, and checks its flags", async () => {
      const root = await makeGitRepo(UID);
      await write(root, ".poetics/config.json", config);
      const dry = await execIn(root, "rehash");
      expect([dry.code, dry.out]).toEqual([0, "Would rehash 1 unit(s); 0 skipped; 0 already on b3: hashes."]);
      const written = JSON.parse((await execIn(root, "rehash", "--write", "--agent", "claude-code", "--model", "m", "--json")).out) as { written: number };
      expect(written.written).toBe(1);
      const unit = JSON.parse(await readFile(join(root, ".poetics/units", `${UID}.json`), "utf8")) as { versions: Array<{ change: string; actor: unknown }> };
      expect(unit.versions.at(-1)).toMatchObject({ change: "rehash", actor: { kind: "agent", tool: "claude-code", model: "m", reviewed: false } });
      expect((await execIn(root, "rehash")).out).toBe("Would rehash 0 unit(s); 0 skipped; 1 already on b3: hashes.");
      expect((await execIn(root, "rehash", "--model", "m")).code).toBe(2);
      expect((await execIn(root, "rehash", "--agent")).code).toBe(2);
      expect((await execIn(root, "rehash", "--force")).code).toBe(2);
    });

    it("exits 1 when units are skipped", async () => {
      const root = await makeGitRepo(UID);
      await write(root, ".poetics/config.json", config);
      await write(root, "src/a.ts", "export function a() {\n  return 2;\n}\n");
      const result = await execIn(root, "rehash");
      expect(result.code).toBe(1);
      expect(result.out).toMatch(/^skipped: src\/a\.ts#a/);
    });
  });

  describe("index", () => {
    const config = JSON.stringify({ version: 1, adapters: ["typescript"], include: ["src/**/*.ts"], exclude: ["**/*.test.ts"] });
    const fresh = async () => {
      const root = await mkdtemp(join(tmpdir(), "poetics-cli-index-"));
      execFileSync("git", ["init", "-q", "-b", "main"], { cwd: root });
      await write(root, ".poetics/config.json", config);
      await write(root, "src/a.ts", "export function a() {\n  return 1;\n}\n");
      return root;
    };

    it("plans by default and records with --write, as the given actor", async () => {
      const root = await fresh();
      const dry = await execIn(root, "index");
      expect(dry.code).toBe(0);
      expect(dry.out).toMatch(/^\+ src\/a\.ts#a \(function, new uid [0-9A-Z]{26}\)\nNo rationale yet/);
      expect(dry.out).toContain("Would record: 0 moved, 0 changed, 1 new, 0 removed, 0 relinked, 0 queued, 0 up to date.");

      const written = await execIn(root, "index", "--write", "--rationale", "Seed", "--agent", "claude-code", "--json");
      expect(JSON.parse(written.out)).toMatchObject({ written: 1, created: [{ name: "a" }] });
      const units = await readdir(join(root, ".poetics/units"));
      const unit = JSON.parse(await readFile(join(root, ".poetics/units", units[0]!), "utf8")) as { versions: Array<{ actor: unknown }> };
      expect(unit.versions[0]!.actor).toEqual({ kind: "agent", tool: "claude-code", reviewed: false });
      expect((await execIn(root, "index")).out).toBe("Would record: 0 moved, 0 changed, 0 new, 0 removed, 0 relinked, 0 queued, 1 up to date. Run with --write to record it.");
    });

    it("exits 2 for bad flags, an unknown ref or a write with no rationale, and 1 when matches are queued", async () => {
      const root = await fresh();
      expect((await execIn(root, "index", "--rationale")).code).toBe(2);
      expect((await execIn(root, "index", "--model", "m")).code).toBe(2);
      expect((await execIn(root, "index", "extra")).code).toBe(2);
      expect(JSON.parse((await execIn(root, "index", "--write", "--json")).err)).toMatchObject({ error: "usage", message: expect.stringContaining("No rationale") });

      const twin = "export function x(n: number) {\n  let s = 0;\n  for (let i = 0; i < n; i++) s += i * 2;\n  return s;\n}\n";
      await write(root, "src/a.ts", twin + twin.replace("function x(", "function y("));
      await execIn(root, "index", "--write", "--rationale", "Seed");
      execFileSync("git", ["add", "-A"], { cwd: root });
      execFileSync("git", ["-c", "user.name=T", "-c", "user.email=t@example.com", "-c", "commit.gpgsign=false", "commit", "-q", "-m", "Seed"], { cwd: root });
      expect(JSON.parse((await execIn(root, "index", "--since", "nope", "--json")).err)).toMatchObject({ error: "invalid-argument" });

      await rm(join(root, "src/a.ts"));
      await write(root, "src/b.ts", (twin + twin.replace("function x(", "function y(")).replace("function x(", "function p(").replace("function y(", "function q("));
      const queued = await execIn(root, "index");
      expect(queued.code).toBe(1);
      expect(queued.out).toMatch(/^\? 4 units share the same content: /);
    });
  });

  describe("backfill", () => {
    it("needs --snapshot, plans by default, and leaves --history as a stub", async () => {
      const root = await mkdtemp(join(tmpdir(), "poetics-cli-backfill-"));
      execFileSync("git", ["init", "-q", "-b", "main"], { cwd: root });
      await write(root, ".poetics/config.json", JSON.stringify({ version: 1, adapters: ["typescript"], include: ["src/**/*.ts"] }));
      await write(root, "src/a.ts", "/** Adds one. */\nexport function a(n: number) {\n  return n + 1;\n}\n");
      expect(JSON.parse((await execIn(root, "backfill", "--json")).err)).toMatchObject({ error: "usage", command: "backfill" });
      expect(JSON.parse((await execIn(root, "backfill", "--history", "--json")).err)).toMatchObject({ error: "not-implemented" });
      const dry = await execIn(root, "backfill", "--snapshot");
      expect([dry.code, dry.out]).toEqual([0, "+ src/a.ts#a [low] Adds one.\nWould create 1 new unit(s) (0 high, 0 medium, 1 low confidence). Run with --write to write them."]);
      expect(JSON.parse((await execIn(root, "backfill", "--snapshot", "--write", "--json")).out)).toMatchObject({ written: 1 });
      expect((await readdir(join(root, ".poetics/units"))).length).toBe(1);
    });
  });
});
