import ts from "typescript";
import { describe, expect, it } from "vitest";
import { contentHash, similarity } from "@poetics/core";
import { fingerprint, normaliseNode } from "./normalise.ts";

const hashOf = (code: string, eraseTypes = false, file = "a.tsx") =>
  contentHash(normaliseNode(ts.createSourceFile(file, code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX), { eraseTypes }));

const same = (a: string, b: string, eraseTypes = false) => expect(hashOf(a, eraseTypes)).toBe(hashOf(b, eraseTypes));
const differ = (a: string, b: string, eraseTypes = false) => expect(hashOf(a, eraseTypes)).not.toBe(hashOf(b, eraseTypes));

describe("normaliseNode", () => {
  it("ignores formatting, comments, quotes, semicolons and trailing commas", () => {
    same(
      `export function f(a: number, b: string) { return [a, 'x', b]; }`,
      `// leading
       /** docs */
       export function f(
         a: number,
         b: string, // trailing
       ) {
         return [a, "x", b,]
       }`,
    );
  });

  it("ignores redundant parentheses, numeric spelling and quoted keys", () => {
    same(`const f = (a) => ((a + 1) * 2);`, `const f = a => (a + 1) * 2;`);
    same(`const n = [1.50, 0x10, 1_000];`, `const n = [1.5, 16, 1000];`);
    same(`const o = { "a": 1, b: 2 };`, `const o = { a: 1, "b": 2 };`);
    // A key that is not an identifier stays a string.
    differ(`const o = { "a-b": 1 };`, `const o = { a_b: 1 };`);
  });

  it("ignores how a declaration is exported", () => {
    same(`export default function f() {}`, `function f() {}`);
  });

  it("re-wraps JSX text the way JSX renders it", () => {
    same(`const x = <p>Hello   world</p>;`.replace("   ", " "), `const x = <p>\n  Hello\n  world\n</p>;`);
    // A space on the same line as an expression is rendered, so it counts.
    differ(`const x = <p>Hello {name}</p>;`, `const x = <p>Hello{name}</p>;`);
  });

  it("sees every change of meaning", () => {
    differ(`const x = !a;`, `const x = -a;`);
    differ(`const x = a++;`, `const x = a--;`);
    differ(`let x = 1;`, `const x = 1;`);
    differ(`const x = a + b;`, `const x = a - b;`);
    differ(`const x = "a";`, `const x = "b";`);
    differ(`const x = (a?.b).c;`, `const x = a?.b.c;`);
    differ(`type T = keyof A;`, `type T = readonly A;`);
    differ(`const x = import.meta;`, `const x = new.target;`);
    differ(`function* f() {}`, `function f() {}`);
    differ(`async function f() {}`, `function f() {}`);
  });

  it("keeps types in the tree unless they are erased", () => {
    differ(`function f(a: number): number { return a; }`, `function f(a: string): string { return a; }`);
    same(`function f(a: number): number { return a; }`, `function f(a: string): string { return a; }`, true);
    same(`const x = y as Foo satisfies Bar;`, `const x = y!;`, true);
    same(`function f(a?: number) {} interface I {} type T = 1;`, `function f(a) {}`, true);
    // Erasure removes declaration-level `?`, never the conditional operator.
    differ(`const x = a ? b : c;`, `const x = a;`, true);
    // Erasure keeps the runtime part of `extends Base<T>`.
    differ(`class A extends B<T> {}`, `class A extends C<T> {}`, true);
  });

  it("leaves out nodes it is told to omit", () => {
    const source = ts.createSourceFile("a.ts", "function f() { return 1; }", ts.ScriptTarget.Latest, true);
    const fn = source.statements[0] as ts.FunctionDeclaration;
    const renamed = ts.createSourceFile("a.ts", "function g() { return 1; }", ts.ScriptTarget.Latest, true).statements[0] as ts.FunctionDeclaration;
    expect(normaliseNode(fn, { omit: new Set([fn.name!]) })).toEqual(normaliseNode(renamed, { omit: new Set([renamed.name!]) }));
    expect(normaliseNode(fn)).not.toEqual(normaliseNode(renamed));
  });
});

describe("fingerprint", () => {
  const print = (code: string) => fingerprint(normaliseNode(ts.createSourceFile("a.ts", code, ts.ScriptTarget.Latest, true)));

  it("is sorted, without duplicates, and the same for a reformat", () => {
    const hashes = print(`function f(a) { return [a + 1, a + 1]; }`);
    expect(hashes).toEqual([...new Set(hashes)].sort());
    expect(print(`function f(a) {\n  return [a + 1, a + 1]\n}`)).toEqual(hashes);
  });

  it("keeps most subtrees through a small edit and few through a rewrite", () => {
    const base = print(`function f(a, b) { const x = a * 2; const y = b * 3; if (x > y) return x - y; return y - x; }`);
    const edited = print(`function f(a, b) { const x = a * 2; const y = b * 4; if (x > y) return x - y; return y - x; }`);
    const rewritten = print(`function f(a, b) { return Math.abs(a * 2 - b * 3); }`);
    const shared = (other: string[]) => other.filter((hash) => base.includes(hash)).length / base.length;
    expect(shared(edited)).toBeGreaterThan(0.6);
    expect(shared(rewritten)).toBeLessThan(0.4);
  });

  it("has one entry per internal node, numbering repeats so it counts like a multiset", () => {
    // The source file and its one statement; the identifier and end-of-file token are leaves.
    expect(print(`x`)).toHaveLength(2);
    expect(fingerprint(["Identifier", "x"])).toEqual([]);
    const repeated = print(`f(a); f(a);`);
    expect(repeated.filter((hash) => hash.endsWith("#2"))).toHaveLength(2);
  });

  it("keeps a rename that touches every statement local enough to match (resolveUnit's move in a5da380)", () => {
    const before = `async function resolveUnit(ctx: ReadContext, ref: string): Promise<Unit> {
      if (getUnit(ctx.db, ref)) return readUnit(ctx.paths, ref);
      const hashAt = ref.lastIndexOf("#");
      const [file, name] = hashAt > 0 ? [ref.slice(0, hashAt), ref.slice(hashAt + 1)] : [undefined, ref];
      const rows = findUnitsByName(ctx.db, name).filter((row) => file === undefined || row.file === file);
      if (rows.length === 1) return readUnit(ctx.paths, rows[0]!.uid);
      if (rows.length === 0) throw new Error(\`No unit matches \${ref}; try poetics_search\`);
      const candidates = rows.map((row) => \`\${row.uid} (\${row.file}#\${row.name})\`).join(", ");
      throw new Error(\`\${ref} is ambiguous: \${candidates}. Pass a uid or file#name\`);
    }`;
    const after = before
      .replace("ctx: ReadContext, ref", "paths: StorePaths, db: DatabaseSync, ref")
      .replaceAll("ctx.db", "db")
      .replaceAll("ctx.paths", "paths")
      .replace("try poetics_search", "search for it by name, docs or rationale");
    expect(similarity(print(before), print(after))).toBeGreaterThan(0.65);
  });

});
