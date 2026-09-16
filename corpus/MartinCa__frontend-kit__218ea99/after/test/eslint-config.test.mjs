// Exercises the shared ESLint config against real files.
//
// validate.yml used to only assert that `config()` returned an array, which is
// true of a config whose rules never fire. Both bugs these fixtures cover were
// invisible to that check.
import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { ESLint } from "eslint";

const fixtures = path.join(import.meta.dirname, "fixtures");

const eslint = new ESLint({
  cwd: fixtures,
  overrideConfigFile: path.join(fixtures, "eslint.config.js"),
});

/** Rule IDs reported for one fixture, with how many times each fired. */
async function lintFixture(name) {
  const [result] = await eslint.lintFiles([path.join(fixtures, name)]);
  const counts = new Map();
  for (const message of result.messages) {
    // A parse error has no ruleId and would make every assertion below
    // vacuously pass, so surface it instead.
    assert.ok(message.ruleId, `${name}: ${message.message}`);
    counts.set(message.ruleId, (counts.get(message.ruleId) ?? 0) + 1);
  }
  return counts;
}

test("config files keep their Node globals", async () => {
  const counts = await lintFixture("node.config.js");
  assert.equal(
    counts.get("no-undef"),
    undefined,
    "process/__dirname flagged as undefined: the disable-type-checked spread has clobbered languageOptions.globals again",
  );
});

test("fetching in a Zustand store is caught in both call shapes", async () => {
  const counts = await lintFixture("store.ts");
  assert.equal(
    counts.get("no-restricted-syntax"),
    2,
    "expected both create<S>(init) and the curried create<S>()(init) to be flagged",
  );
});

test("the mechanical DESIGN.md rules fire", async () => {
  const counts = await lintFixture("violations.tsx");
  assert.equal(
    counts.get("no-restricted-imports"),
    3,
    "deep relative, primitive and moment imports",
  );
  assert.equal(counts.get("no-restricted-syntax"), 1, "inline style prop");
  assert.equal(counts.get("@typescript-eslint/no-explicit-any"), 1);
});

test("vendored directories are exempt", async () => {
  const config = await eslint.calculateConfigForFile(
    path.join(fixtures, "src/components/ui/button.tsx"),
  );
  assert.equal(
    config.rules["no-restricted-imports"][0],
    0,
    "src/components/ui/** must not be policed",
  );
  assert.equal(config.rules["no-restricted-syntax"][0], 0);
});
