import { rm } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  INDEX_SCHEMA_VERSION,
  dependentsOf,
  dumpIndex,
  findUnitsByName,
  getUnit,
  openIndex,
  rebuildIndex,
  searchUnits,
} from "./index-db.ts";
import { storePaths } from "./paths.ts";
import { UID_A, UID_B, UID_C, hash, makeRepo, makeUnit, writeUnit } from "./test-helpers.ts";

const withDep = (uid: string, dep: string) => {
  const unit = makeUnit(uid);
  unit.versions[0]!.deps = { [dep]: hash("1") };
  return unit;
};

describe("rebuildIndex", () => {
  it("indexes units, versions, deps, tests and lineage", async () => {
    const unit = makeUnit(UID_A, {
      name: "formatPrice",
      tests: [{ file: "src/lib.ts", via: "explicit" }],
      lineage: [{ kind: "rename", from: "fmtPrice" }],
    });
    const paths = storePaths(await makeRepo([unit, withDep(UID_B, UID_A)]));
    const db = openIndex(paths.indexDb);

    expect(await rebuildIndex(paths, db)).toEqual({ added: 2, updated: 0, removed: 0, unchanged: 0 });
    expect(getUnit(db, UID_A)).toMatchObject({ name: "formatPrice", version_count: 1, latest_content_hash: hash("1") });
    expect(findUnitsByName(db, "formatPrice").map((row) => row.uid)).toEqual([UID_A]);
    expect(dependentsOf(db, UID_A)).toEqual([UID_B]);
    const dump = dumpIndex(db);
    expect(dump["test_links"]).toEqual([{ uid: UID_A, file: "src/lib.ts", name: "", via: "explicit" }]);
    expect(dump["lineage"]).toEqual([{ uid: UID_A, seq: 0, kind: "rename", from_path: "fmtPrice" }]);
  });

  it("skips unit files whose bytes have not changed", async () => {
    const paths = storePaths(await makeRepo([makeUnit(UID_A), makeUnit(UID_B)]));
    const db = openIndex(paths.indexDb);
    await rebuildIndex(paths, db);
    expect(await rebuildIndex(paths, db)).toEqual({ added: 0, updated: 0, removed: 0, unchanged: 2 });
  });

  it("matches a from-scratch rebuild after edits, additions, deletions and moves", async () => {
    const root = await makeRepo([makeUnit(UID_A), makeUnit(UID_B)]);
    const paths = storePaths(root);
    const db = openIndex(paths.indexDb);
    await rebuildIndex(paths, db);

    const edited = makeUnit(UID_A, { name: "renamed" });
    edited.versions.push({ ...edited.versions[0]!, contentHash: hash("2"), parent: hash("1"), change: "behaviour" });
    await writeUnit(root, edited);
    await rm(join(root, ".poetics", "units", `${UID_B}.json`));
    await writeUnit(root, withDep(UID_C, UID_A), join(".poetics", "units", "01", `${UID_C}.json`));
    expect(await rebuildIndex(paths, db)).toEqual({ added: 1, updated: 1, removed: 1, unchanged: 0 });

    // Move C between layouts without changing its contents.
    await rm(join(root, ".poetics", "units", "01", `${UID_C}.json`));
    await writeUnit(root, withDep(UID_C, UID_A));
    expect(await rebuildIndex(paths, db)).toEqual({ added: 1, updated: 0, removed: 1, unchanged: 1 });
    const incremental = dumpIndex(db);
    db.close();

    await rm(paths.cache, { recursive: true });
    const fresh = openIndex(paths.indexDb);
    await rebuildIndex(paths, fresh);
    expect(dumpIndex(fresh)).toEqual(incremental);
    expect(getUnit(fresh, UID_A)).toMatchObject({ name: "renamed", version_count: 2 });
    expect(dependentsOf(fresh, UID_A)).toEqual([UID_C]);
  });

  it("rolls back and leaves the index untouched when a unit file is unreadable", async () => {
    const root = await makeRepo([makeUnit(UID_A)]);
    const paths = storePaths(root);
    const db = openIndex(paths.indexDb);
    await rebuildIndex(paths, db);
    const before = dumpIndex(db);

    await writeUnit(root, makeUnit(UID_B));
    const { writeFile } = await import("node:fs/promises");
    await writeFile(join(root, ".poetics", "units", `${UID_C}.json`), "{ broken");
    await expect(rebuildIndex(paths, db)).rejects.toThrow(SyntaxError);
    expect(dumpIndex(db)).toEqual(before);
  });
});

describe("openIndex", () => {
  it("drops and recreates tables written by another index schema version", async () => {
    const paths = storePaths(await makeRepo([makeUnit(UID_A)]));
    const db = openIndex(paths.indexDb);
    await rebuildIndex(paths, db);
    db.prepare("UPDATE meta SET value = '0' WHERE key = 'schema_version'").run();
    db.close();

    const reopened = openIndex(paths.indexDb);
    expect(getUnit(reopened, UID_A)).toBeUndefined();
    expect(reopened.prepare("SELECT value FROM meta").get()).toEqual({ value: String(INDEX_SCHEMA_VERSION) });
  });
});

describe("searchUnits", () => {
  const searchable = async () => {
    const price = makeUnit(UID_A, { name: "formatPrice", docs: "Formats a price in the user's currency." });
    const total = makeUnit(UID_B, { name: "cartTotal", docs: "Sums line items." });
    total.versions[0]!.rationale = "Needed to show a price total at checkout";
    const other = makeUnit(UID_C, { name: "slugify", docs: "Lowercases and hyphenates." });
    const paths = storePaths(await makeRepo([price, total, other]));
    const db = openIndex(paths.indexDb);
    await rebuildIndex(paths, db);
    return db;
  };
  const uids = (rows: Array<{ uid: string }>) => rows.map((row) => row.uid);

  it("matches camelCase name parts, docs and rationale, name hits first", async () => {
    const db = await searchable();
    expect(uids(searchUnits(db, "price"))).toEqual([UID_A, UID_B]);
    expect(searchUnits(db, "price")[0]).toMatchObject({ name: "formatPrice", version_count: 1 });
  });

  it("requires every word, each as a prefix", async () => {
    const db = await searchable();
    expect(uids(searchUnits(db, "pri check"))).toEqual([UID_B]);
    expect(uids(searchUnits(db, "price nowhere"))).toEqual([]);
  });

  it("ranks units matching any word when asked, for task descriptions", async () => {
    const db = await searchable();
    const hits = uids(searchUnits(db, "fix the slug and the price", { match: "any" }));
    // Name hits (slugify, formatPrice) outrank cartTotal, which only mentions price in rationale.
    expect(hits.slice(0, 2).sort()).toEqual([UID_A, UID_C]);
    expect(hits[2]).toBe(UID_B);
    expect(uids(searchUnits(db, "fix the slug and the price"))).toEqual([]);
  });

  it("treats FTS syntax as text and returns nothing for an empty query", async () => {
    const db = await searchable();
    expect(uids(searchUnits(db, 'slug* OR "price" NEAR('))).toEqual([]);
    expect(uids(searchUnits(db, "slug-"))).toEqual([UID_C]);
    expect(searchUnits(db, "  ** ")).toEqual([]);
  });

  it("follows edits and deletions on rebuild", async () => {
    const root = await makeRepo([makeUnit(UID_A, { name: "formatPrice" }), makeUnit(UID_B, { name: "cartTotal" })]);
    const paths = storePaths(root);
    const db = openIndex(paths.indexDb);
    await rebuildIndex(paths, db);
    await writeUnit(root, makeUnit(UID_A, { name: "formatCost" }));
    await rm(join(root, ".poetics", "units", `${UID_B}.json`));
    await rebuildIndex(paths, db);
    expect(uids(searchUnits(db, "price"))).toEqual([]);
    expect(uids(searchUnits(db, "cost"))).toEqual([UID_A]);
    expect(uids(searchUnits(db, "cart"))).toEqual([]);
  });
});
