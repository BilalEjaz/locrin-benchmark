import { mkdtemp, readdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { Unit } from "@poetics/core";
import { applyBackfill, formatBackfillPlan, planBackfill } from "./backfill.ts";
import { applyIndex, planIndex } from "./indexing.ts";
import { runGit, write } from "./test-helpers.ts";

const CONFIG = { include: ["src/**/*.ts"], exclude: ["**/*.test.ts"] };

const commit = (root: string, message: string) => {
  runGit(root, "add", "-A");
  runGit(root, "commit", "-q", "-m", message);
};

/** A repository with history but no store: the case backfill exists for. */
async function adopted(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "poetics-backfill-"));
  runGit(root, "init", "-q", "-b", "main");
  await write(root, "package.json", JSON.stringify({ name: "@x/pkg", type: "module" }));
  await write(root, ".gitignore", ".poetics/cache/\n");
  await write(root, ".poetics/config.json", JSON.stringify({ version: 1, adapters: ["typescript"], ...CONFIG }));
  await write(root, "src/price.ts", "export function formatPrice(n: number) {\n  return n.toFixed(2);\n}\n");
  await write(root, "docs/guide.md", "Call `formatPrice` for invoices.\n");
  commit(root, "feat(core): add formatPrice\n\nInvoices need two decimals (#12).\n\nCo-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>");

  await write(root, "src/util.ts", "export function one() {\n  return 1;\n}\nexport function two() {\n  return 2;\n}\n");
  commit(root, "chore: initial import");

  await write(root, "src/tax.ts", "export function taxOf(n: number) {\n  return n * 0.2;\n}\n");
  await write(root, ".changeset/tax.md", '---\n"@x/pkg": minor\n---\n\nAdd taxOf so totals can show VAT separately.\n');
  commit(root, "feat: tax");

  // Not committed yet: one with TSDoc, one without.
  await write(root, "src/new.ts", "/** Rounds half up. */\nexport function roundHalf(n: number) {\n  return Math.round(n);\n}\nexport function bare() {}\n");
  return root;
}

const byName = (plan: Awaited<ReturnType<typeof planBackfill>>) => new Map(plan.created.map(({ unit }) => [unit.name, unit]));

describe("planBackfill", () => {
  it("infers each new unit's rationale from the most specific evidence, with a computed confidence", async () => {
    const root = await adopted();
    const plan = await planBackfill(root, CONFIG);
    const units = byName(plan);
    const sha = (subject: string) => runGit(root, "log", "--format=%H", `--grep=${subject}`).trim();

    expect(units.get("formatPrice")!.versions[0]).toMatchObject({
      change: "created",
      commit: sha("add formatPrice"),
      rationale: "Invoices need two decimals (#12).",
      actor: { kind: "agent", tool: "Claude Opus 5.5", reviewed: false },
      links: [
        { kind: "github-issue", ref: "#12" },
        { kind: "doc", ref: "docs/guide.md" },
      ],
      inferred: { by: "poetics-backfill", confidence: "high", sources: ["commit", "doc"], drafted: false, reviewed: false },
    });
    // The same commit introduced both, so its text speaks to neither in particular.
    expect(units.get("one")!.versions[0]).toMatchObject({ rationale: "initial import", actor: { kind: "human" }, inferred: { confidence: "medium" } });
    // The changeset names taxOf, so it speaks to this unit, not only to its package.
    expect(units.get("taxOf")!.versions[0]).toMatchObject({
      rationale: "Add taxOf so totals can show VAT separately.",
      links: [{ kind: "changeset", ref: ".changeset/tax.md" }],
      inferred: { confidence: "high", sources: ["changeset", "commit"] },
    });
    expect(units.get("roundHalf")!.versions[0]).toMatchObject({ rationale: "Rounds half up.", inferred: { confidence: "low", sources: ["comment"] } });
    expect(units.get("roundHalf")!.versions[0]!.commit).toBeUndefined();
    expect(units.get("bare")!.versions[0]).toMatchObject({ rationale: expect.stringContaining("nothing in the repository says why"), inferred: { confidence: "low", sources: [] } });
    expect(plan.byConfidence).toEqual({ high: 2, medium: 2, low: 2 });
  });

  it("treats a changeset that does not name the unit as speaking to its package, not to it", async () => {
    const root = await adopted();
    await write(root, "src/fee.ts", "export function feeOf(n: number) {\n  return n * 0.01;\n}\n");
    await write(root, ".changeset/fees.md", '---\n"@x/pkg": patch\n---\n\nCharge a card fee.\n');
    commit(root, "feat: fees");
    expect(byName(await planBackfill(root, CONFIG)).get("feeOf")!.versions[0]).toMatchObject({ rationale: "Charge a card fee.", inferred: { confidence: "medium" } });
  });

  it("never stores author names or emails", async () => {
    const root = await adopted();
    const text = JSON.stringify((await planBackfill(root, CONFIG)).created.map(({ unit }) => unit));
    expect(text).not.toContain("noreply@anthropic.com");
    expect(text).not.toContain("test@example.com");
    expect(text).not.toContain("Test");
  });

  it("writes the units, after which a second plan has nothing to create", async () => {
    const root = await adopted();
    expect(await applyBackfill(root, await planBackfill(root, CONFIG))).toBe(6);
    const files = await readdir(join(root, ".poetics/units"));
    const written = await Promise.all(files.map(async (f) => JSON.parse(await readFile(join(root, ".poetics/units", f), "utf8")) as Unit));
    expect(written.find((u) => u.name === "formatPrice")!.versions[0]!.actor).toEqual({ kind: "agent", tool: "Claude Opus 5.5", reviewed: false });
    expect((await planBackfill(root, CONFIG)).created).toEqual([]);
  });

  it("leaves existing units alone and lists their gaps, unrecorded changes and candidate notes", async () => {
    const root = await adopted();
    await applyIndex(root, await planIndex(root, CONFIG, { rationale: "Recorded by hand" }), { kind: "human" });
    const before = await readdir(join(root, ".poetics/units"));
    await write(root, "src/price.ts", "/** Formats a price. */\nexport function formatPrice(n: number) {\n  // HACK: toFixed rounds half to even on some engines\n  return n.toFixed(3);\n}\n");
    await write(root, "src/price.test.ts", "import { formatPrice } from './price.ts';\n");
    const plan = await planBackfill(root, CONFIG);
    expect(plan.created).toEqual([]);
    expect(plan.unrecorded).toBe(1);
    expect(plan.missingDocs.map((g) => g.name)).toEqual(["formatPrice"]);
    expect(plan.missingTests).toMatchObject([{ name: "formatPrice", test: "src/price.test.ts" }]);
    expect(plan.candidateNotes).toEqual([{ file: "src/price.ts", line: 3, text: "HACK: toFixed rounds half to even on some engines" }]);
    expect(await readdir(join(root, ".poetics/units"))).toEqual(before);
  });
});

describe("formatBackfillPlan", () => {
  it("lists new units with their confidence, then what to add by hand, then a summary", async () => {
    const root = await adopted();
    const text = formatBackfillPlan(await planBackfill(root, CONFIG));
    expect(text).toContain("+ src/price.ts#formatPrice [high] Invoices need two decimals (#12).");
    expect(text).toMatch(/Would create 6 new unit\(s\) \(2 high, 2 medium, 2 low confidence\)\. Run with --write to write them\.$/);
  });
});
