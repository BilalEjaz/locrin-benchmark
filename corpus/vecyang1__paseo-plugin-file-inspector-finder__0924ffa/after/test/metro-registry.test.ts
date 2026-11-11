import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

// In Paseo's production bundle `window.__c` is Metro's clear() (`function o(){return t=new Map}`).
// Calling it wipes the module registry, so lazy routes and settings screens fail later with
// "Requiring unknown module". It shipped twice (T-045 web.ts, then markdown-table-web.ts:493).
// Use client/metro-registry.ts instead. This scans client source for a direct call.
const DIRECT_CALL = [/\b__c\s*\(/, /\b__c\s+as\s+\(\)\s*=>\s*[^)]*\)\s*\(/];

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
}

const callsMetroClear = (source: string) => DIRECT_CALL.some((re) => re.test(stripComments(source)));

test("Metro registry 1: the scan flags both shipped forms and ignores types and comments", () => {
  assert.equal(callsMetroClear("const res = (targetWin.__c as () => unknown)();"), true);
  assert.equal(callsMetroClear("const m = window.__c();"), true);
  assert.equal(callsMetroClear("type W = { __c?: () => Map<number, unknown> };"), false);
  assert.equal(callsMetroClear("// never invoke real Metro's `window.__c()`"), false);
  assert.equal(callsMetroClear("if (target.__c instanceof Map) return target.__c;"), false);
});

test("Metro registry 2: no client module calls window.__c directly", () => {
  const root = path.join(import.meta.dirname, "..");
  const files = [
    "index.client.tsx",
    ...fs.readdirSync(path.join(root, "client")).filter((f) => /\.tsx?$/.test(f)).map((f) => `client/${f}`),
  ];
  const offenders = files.filter((f) => callsMetroClear(fs.readFileSync(path.join(root, f), "utf8")));
  console.log(`graded ${files.length} client files for direct window.__c calls`);
  assert.ok(files.length >= 20, "the scan found the client sources");
  assert.deepEqual(offenders, []);
});
