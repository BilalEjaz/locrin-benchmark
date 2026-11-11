// Identity matching on real code: index a project before and after a refactor
// and check every uid lands where a person would say it went.
import { describe, expect, it } from "vitest";
import { matchIdentities, trackedUnits } from "@poetics/core";
import type { CodeUnit, LineageDeclaration, Unit } from "@poetics/core";
import { createTypeScriptIndexer } from "./indexer.ts";
import { makeProject } from "./test-helpers.ts";

const TOTAL = `export function total(items: Array<{ price: number; qty: number }>, taxRate: number): number {
  let sum = 0;
  for (const item of items) {
    if (item.qty <= 0) continue;
    sum += item.price * item.qty;
  }
  const tax = Math.round(sum * taxRate * 100) / 100;
  return sum + tax;
}
`;

const FORMAT = `export function formatPrice(cents: number, currency = "EUR"): string {
  const value = (cents / 100).toFixed(2);
  return currency === "EUR" ? \`\${value} €\` : \`\${currency} \${value}\`;
}
`;

function snapshot(files: Record<string, string>): CodeUnit[] {
  const root = makeProject(files);
  return createTypeScriptIndexer({ root, files: Object.keys(files) })
    .index()
    .units
    .map((unit) => ({ key: unit.key, file: unit.span.file, name: unit.name, kind: unit.kind, contentHash: unit.contentHash, fingerprint: unit.fingerprint }));
}

/** Store units for every unit in `code`, uid `U<n>` in order. */
function storeFor(code: CodeUnit[]): Unit[] {
  return code.map((unit, i) => ({
    uid: `U${i + 1}`,
    kind: unit.kind,
    framework: "none",
    name: unit.name,
    location: { file: unit.file },
    versions: [{ contentHash: unit.contentHash, change: "created", actor: { kind: "human" }, rationale: "Seed" }],
  }));
}

function refactor(before: Record<string, string>, after: Record<string, string>, declarations: LineageDeclaration[] = []) {
  const old = snapshot(before);
  const { tracked } = trackedUnits(storeFor(old), old);
  return matchIdentities(tracked, snapshot(after), declarations);
}

describe("identity matching on indexed code", () => {
  it("keeps the uid through a reformat, a move, and a rename with an edit", () => {
    const result = refactor(
      { "src/cart.ts": TOTAL, "src/price.ts": FORMAT },
      {
        // total: renamed and given a discount parameter.
        "src/cart.ts": TOTAL.replace("function total(", "function cartTotal(").replace("taxRate: number)", "taxRate: number, discount = 0)").replace("return sum + tax;", "return sum + tax - discount;"),
        // formatPrice: reformatted and moved.
        "src/format/price.ts": FORMAT.replace("const value = ", "const value =\n    ").replace(/;$/gm, ""),
      },
    );
    expect(result.matched.map(({ uid, key, via, lineage }) => ({ uid, key, via, lineage }))).toEqual([
      { uid: "U2", key: "src/format/price.ts#formatPrice", via: "content", lineage: [{ kind: "move", from: "src/price.ts" }] },
      { uid: "U1", key: "src/cart.ts#cartTotal", via: "similarity", lineage: [{ kind: "rename", from: "total" }] },
    ]);
    expect(result.matched[1]!.score).toBeGreaterThan(0.6);
    expect([result.created, result.removed, result.queued]).toEqual([[], [], []]);
  });

  it("calls a rewrite a new unit rather than guessing", () => {
    const result = refactor(
      { "src/cart.ts": TOTAL },
      { "src/cart.ts": `export function sumItems(items: Array<{ price: number; qty: number }>): number {\n  return items.reduce((s, i) => s + i.price * i.qty, 0);\n}\n` },
    );
    expect(result.matched).toEqual([]);
    expect(result.created).toEqual([{ key: "src/cart.ts#sumItems" }]);
    expect(result.removed).toEqual([{ uid: "U1" }]);
  });

  it("queues two look-alikes that both moved", () => {
    const pair = TOTAL + TOTAL.replace("function total(", "function totalWithTax(");
    const result = refactor({ "src/cart.ts": pair }, { "src/sums.ts": pair.replace("function total(", "function sum(").replace("totalWithTax", "sumWithTax") });
    expect(result.queued).toEqual([{ reason: "4 units share the same content", uids: ["U1", "U2"], keys: ["src/sums.ts#sum", "src/sums.ts#sumWithTax"] }]);
  });

  it("applies a declared split of one function into two", () => {
    const split = `export function total(items: Array<{ price: number; qty: number }>, taxRate: number): number {
  const sum = subtotal(items);
  const tax = Math.round(sum * taxRate * 100) / 100;
  return sum + tax;
}

export function subtotal(items: Array<{ price: number; qty: number }>): number {
  let sum = 0;
  for (const item of items) {
    if (item.qty <= 0) continue;
    sum += item.price * item.qty;
  }
  return sum;
}
`;
    const ref = (name: string) => ({ file: "src/cart.ts", name, kind: "function" as const });
    const result = refactor({ "src/cart.ts": TOTAL }, { "src/cart.ts": split }, [{ kind: "split", uids: ["U1"], to: [ref("total"), ref("subtotal")] }]);
    expect(result.matched).toMatchObject([{ uid: "U1", key: "src/cart.ts#total", via: "declared", splitInto: ["src/cart.ts#subtotal"] }]);
    expect(result.created).toEqual([{ key: "src/cart.ts#subtotal", lineage: [{ kind: "split", uids: ["U1"] }] }]);
  });
});
