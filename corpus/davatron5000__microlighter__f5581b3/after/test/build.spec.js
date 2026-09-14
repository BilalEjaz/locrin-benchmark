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

test("loads first-party language aliases outside the core bundle", async () => {
  const [bundle, aliases] = await Promise.all([
    readFile(new URL("../dist/microlighter.min.js", import.meta.url)),
    readFile(new URL("../dist/language-aliases.js", import.meta.url), "utf8")
  ]);

  assert.doesNotMatch(bundle.toString(), /jsx:"javascript"/);
  assert.match(aliases, /jsx:\s*"javascript"/);
});

test("exports the optional language alias map from the package", async () => {
  const { default: languageAliases } = await import("microlighter/language-aliases");

  assert.equal(languageAliases.js, "javascript");
  assert.equal(languageAliases.ts, "typescript");
  assert.equal(languageAliases.sass, "scss");
  assert.equal(languageAliases.docker, "dockerfile");
  assert.equal(languageAliases.gql, "graphql");
});
