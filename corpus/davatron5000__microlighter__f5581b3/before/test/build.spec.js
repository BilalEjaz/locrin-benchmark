import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("build emits matching unminified and minified auto-run bundles", async () => {
  const [bundle, minifiedBundle] = await Promise.all([
    readFile(new URL("../dist/microlighter.js", import.meta.url), "utf8"),
    readFile(new URL("../dist/microlighter.min.js", import.meta.url), "utf8")
  ]);

  assert.doesNotMatch(bundle, /from\s+["']\.\/index\.js["']/);
  assert.match(bundle, /document\.addEventListener\(["']syntax-highlight["']/);
  assert.match(minifiedBundle, /document\.addEventListener\(["']syntax-highlight["']/);
  assert.ok(bundle.length > minifiedBundle.length);
});
