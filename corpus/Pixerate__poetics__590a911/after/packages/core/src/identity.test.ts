import { describe, expect, it } from "vitest";
import { contentHash } from "./hash.ts";
import { matchIdentities, similarity, trackedUnits } from "./identity.ts";
import type { CodeUnit, LineageDeclaration, TrackedUnit } from "./identity.ts";
import type { Unit, UnitKind } from "./types.ts";

/** A code unit at `file#name`; `body` stands in for its content, `shape` for its subtrees. */
function code(ref: string, body: string, shape: string[] = [body], kind: UnitKind = "function"): CodeUnit {
  const [file, name] = ref.split("#") as [string, string];
  return { key: ref, file, name, kind, contentHash: contentHash(body), fingerprint: shape };
}

const tracked = (uid: string, unit: CodeUnit): TrackedUnit => ({ ...unit, uid });

// Ten subtrees, and variants sharing all but one or all but five of them.
const SHAPE = Array.from({ length: 10 }, (_, i) => `s${i}`);
const EDITED = [...SHAPE.slice(1), "x0"];
const UNRELATED = ["u1", "u2", "u3"];

describe("similarity", () => {
  it("is the share of subtrees two fingerprints have in common", () => {
    expect(similarity(SHAPE, SHAPE)).toBe(1);
    expect(similarity(SHAPE, EDITED)).toBeCloseTo(9 / 11);
    expect(similarity(SHAPE, UNRELATED)).toBe(0);
    expect(similarity([], [])).toBe(1);
    expect(similarity(["a", "a", "b"], ["a", "b"])).toBe(1);
  });
});

describe("matchIdentities", () => {
  it("matches units that stayed put, even when edited, and reports new and removed ones", () => {
    const result = matchIdentities(
      [tracked("U1", code("a.ts#f", "f1", SHAPE)), tracked("U2", code("a.ts#gone", "g", UNRELATED))],
      [code("a.ts#f", "f2", ["changed"]), code("a.ts#fresh", "n", ["new"])],
    );
    expect(result.matched).toEqual([{ uid: "U1", key: "a.ts#f", via: "location", lineage: [] }]);
    expect(result.created).toEqual([{ key: "a.ts#fresh" }]);
    expect(result.removed).toEqual([{ uid: "U2" }]);
    expect(result.queued).toEqual([]);
  });

  it("follows unchanged content through a rename and a move, recording both", () => {
    const result = matchIdentities([tracked("U1", code("a.ts#f", "body"))], [code("b.ts#g", "body")]);
    expect(result.matched).toEqual([
      {
        uid: "U1",
        key: "b.ts#g",
        via: "content",
        lineage: [
          { kind: "move", from: "a.ts" },
          { kind: "rename", from: "f" },
        ],
      },
    ]);
    expect(result.created).toEqual([]);
    expect(result.removed).toEqual([]);
  });

  it("follows a unit edited as it moved by similarity, with the score", () => {
    const result = matchIdentities([tracked("U1", code("a.ts#f", "f1", SHAPE))], [code("b.ts#f", "f2", EDITED)]);
    expect(result.matched).toEqual([{ uid: "U1", key: "b.ts#f", via: "similarity", score: 0.818, lineage: [{ kind: "move", from: "a.ts" }] }]);
  });

  it("does not match below the threshold", () => {
    const half = [...SHAPE.slice(0, 5), "y0", "y1", "y2", "y3", "y4"];
    const result = matchIdentities([tracked("U1", code("a.ts#f", "f1", SHAPE))], [code("b.ts#g", "g", half)]);
    expect(result.matched).toEqual([]);
    expect(result.created).toEqual([{ key: "b.ts#g" }]);
    expect(result.removed).toEqual([{ uid: "U1" }]);
    expect(matchIdentities([tracked("U1", code("a.ts#f", "f1", SHAPE))], [code("b.ts#g", "g", half)], [], { threshold: 0.3 }).matched).toHaveLength(1);
  });

  it("queues rather than guesses when content or shape fits more than one unit", () => {
    const sameContent = matchIdentities(
      [tracked("U1", code("a.ts#f", "same")), tracked("U2", code("a.ts#g", "same"))],
      [code("b.ts#f2", "same"), code("b.ts#g2", "same")],
    );
    expect(sameContent.queued).toEqual([{ reason: "4 units share the same content", uids: ["U1", "U2"], keys: ["b.ts#f2", "b.ts#g2"] }]);
    expect([sameContent.matched, sameContent.created, sameContent.removed]).toEqual([[], [], []]);

    const twoLookAlikes = matchIdentities([tracked("U1", code("a.ts#f", "f", SHAPE))], [code("b.ts#x", "x", EDITED), code("b.ts#y", "y", [...SHAPE.slice(2), "z0", "z1"])]);
    expect(twoLookAlikes.queued).toEqual([{ reason: "similar to more than one unit", uids: ["U1"], keys: ["b.ts#x", "b.ts#y"] }]);
    expect(twoLookAlikes.created).toEqual([]);
  });

  it("never turns a function into a type", () => {
    const result = matchIdentities([tracked("U1", code("a.ts#P", "body"))], [code("b.ts#P", "body", ["body"], "type")]);
    expect(result.matched).toEqual([]);
  });

  it("treats a hook renamed to a plain function as the same value", () => {
    const result = matchIdentities([tracked("U1", code("a.ts#useF", "body", ["body"], "hook"))], [code("a.ts#f", "body")]);
    expect(result.matched).toMatchObject([{ uid: "U1", via: "content" }]);
  });

  describe("declared lineage", () => {
    const ref = (file: string, name: string, kind: UnitKind = "function") => ({ file, name, kind });

    it("comes first, over a location or content match", () => {
      // Without the declaration, U1 would keep a.ts#f by location and U2 would follow its content.
      const before = [tracked("U1", code("a.ts#f", "old")), tracked("U2", code("a.ts#g", "body"))];
      const after = [code("a.ts#f", "body"), code("a.ts#h", "other")];
      const result = matchIdentities(before, after, [
        { kind: "rename", uids: ["U1"], to: [ref("a.ts", "h")] },
        { kind: "rename", uids: ["U2"], to: [ref("a.ts", "f")] },
      ]);
      expect(result.matched).toEqual([
        { uid: "U1", key: "a.ts#h", via: "declared", lineage: [{ kind: "rename", from: "f" }] },
        { uid: "U2", key: "a.ts#f", via: "declared", lineage: [{ kind: "rename", from: "g" }] },
      ]);
    });

    it("applies a split: the first part keeps the uid, the others are created with lineage", () => {
      const result = matchIdentities(
        [tracked("U1", code("a.ts#f", "whole", SHAPE))],
        [code("a.ts#f", "half"), code("b.ts#fHelper", "rest")],
        [{ kind: "split", uids: ["U1"], to: [ref("a.ts", "f"), ref("b.ts", "fHelper")] }],
      );
      expect(result.matched).toEqual([{ uid: "U1", key: "a.ts#f", via: "declared", lineage: [], splitInto: ["b.ts#fHelper"] }]);
      expect(result.created).toEqual([{ key: "b.ts#fHelper", lineage: [{ kind: "split", uids: ["U1"] }] }]);
    });

    it("applies a merge: the first uid survives and the others are removed into it", () => {
      const result = matchIdentities(
        [tracked("U1", code("a.ts#f", "f")), tracked("U2", code("a.ts#g", "g"))],
        [code("a.ts#f", "fg")],
        [{ kind: "merge", uids: ["U1", "U2"], to: [ref("a.ts", "f")] }],
      );
      expect(result.matched).toEqual([{ uid: "U1", key: "a.ts#f", via: "declared", lineage: [{ kind: "merge", uids: ["U2"] }] }]);
      expect(result.removed).toEqual([{ uid: "U2", mergedInto: "U1" }]);
    });

    it("rejects declarations the snapshots disagree with, and matches as if they were not made", () => {
      const before = [tracked("U1", code("a.ts#f", "f")), tracked("U2", code("a.ts#g", "g"))];
      const after = [code("a.ts#f", "f"), code("a.ts#g", "g"), code("b.ts#f", "moved")];
      const cases: Array<[LineageDeclaration, string]> = [
        [{ kind: "rename", uids: ["U9"], to: [ref("a.ts", "f")] }, "U9 is not a tracked unit in the earlier snapshot"],
        [{ kind: "move", uids: ["U1"], to: [ref("c.ts", "f")] }, "there is no function f in c.ts"],
        [{ kind: "move", uids: ["U1"], to: [ref("b.ts", "f")] }, "f is still in a.ts, so it was not moved or renamed"],
        [{ kind: "rename", uids: ["U1"], to: [ref("a.ts", "f")] }, "f kept its name, so it was not renamed"],
        [{ kind: "move", uids: ["U1", "U2"], to: [ref("b.ts", "f")] }, "a move names one uid and one target"],
        [{ kind: "split", uids: ["U1"], to: [ref("b.ts", "f")] }, "a split names one uid and at least two parts"],
        [{ kind: "merge", uids: ["U1", "U2"], to: [ref("a.ts", "f")] }, "g is still in a.ts, so it was not merged"],
        [{ kind: "rename", uids: ["U1"], to: [ref("a.ts", "f", "type")] }, "there is no type f in a.ts"],
      ];
      for (const [declaration, reason] of cases) {
        const result = matchIdentities(before, after, [declaration]);
        expect(result.rejected).toEqual([{ declaration, reason }]);
        expect(result.matched.map((m) => [m.uid, m.via])).toEqual([
          ["U1", "location"],
          ["U2", "location"],
        ]);
      }
    });

    it("rejects a second claim on a uid or a target", () => {
      const before = [tracked("U1", code("a.ts#f", "f")), tracked("U2", code("a.ts#g", "g"))];
      const after = [code("b.ts#f", "f"), code("b.ts#h", "h")];
      const result = matchIdentities(before, after, [
        { kind: "move", uids: ["U1"], to: [ref("b.ts", "f")] },
        { kind: "move", uids: ["U1"], to: [ref("b.ts", "h")] },
        { kind: "move", uids: ["U2"], to: [ref("b.ts", "f")] },
      ]);
      expect(result.rejected.map((r) => r.reason)).toEqual([
        "U1 is already matched by an earlier declaration",
        "b.ts#f is already claimed by an earlier declaration",
      ]);
    });
  });
});

describe("trackedUnits", () => {
  const unit = (uid: string, file: string, name: string, kind: UnitKind, removed = false): Unit => ({
    uid,
    kind,
    framework: "none",
    name,
    location: { file },
    versions: [
      { contentHash: "git:0000000000000000000000000000000000000001", change: "created", actor: { kind: "human" }, rationale: "Seed" },
      ...(removed ? [{ contentHash: "git:e69de29bb2d1d6434b8b29ae775ad8c2e48c5391" as const, change: "removed" as const, actor: { kind: "human" as const }, rationale: "Gone" }] : []),
    ],
  });

  it("pairs live store units with the code at their recorded place, by namespace", () => {
    const codeUnits = [code("a.ts#f", "f"), code("a.ts#Io", "io", ["io"], "type"), code("a.ts#Io:fn", "iofn")];
    codeUnits[2] = { ...codeUnits[2]!, name: "Io" };
    const { tracked: found, missing } = trackedUnits(
      [unit("U1", "a.ts", "f", "function"), unit("U2", "a.ts", "Io", "type"), unit("U3", "a.ts", "gone", "function"), unit("U4", "a.ts", "old", "function", true)],
      codeUnits,
    );
    expect(found.map((t) => [t.uid, t.key])).toEqual([
      ["U1", "a.ts#f"],
      ["U2", "a.ts#Io"],
    ]);
    expect(missing).toEqual(["U3"]);
  });
});
