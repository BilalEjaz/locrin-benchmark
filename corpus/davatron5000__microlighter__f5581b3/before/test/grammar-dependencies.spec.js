import assert from "node:assert/strict";
import test from "node:test";

import {
  createGrammarLoader,
  externalLanguagesFor,
  normalizeLanguage
} from "../src/grammar-dependencies.js";
import cpp from "../src/grammars/cpp.js";
import html from "../src/grammars/html.js";
import markdown from "../src/grammars/markdown.js";
import objectiveC from "../src/grammars/objective-c.js";
import scss from "../src/grammars/scss.js";
import tsx from "../src/grammars/tsx.js";
import typescript from "../src/grammars/typescript.js";

test("finds external grammar languages in nested rules", () => {
  const grammar = {
    patterns: [
      { include: "#comments" },
      { include: "$self" },
      { include: "source.js#strings" }
    ],
    repository: {
      frontMatter: {
        patterns: [
          { include: "source.yaml" },
          { include: "source.js#comments" }
        ]
      }
    }
  };

  assert.deepEqual([...externalLanguagesFor(grammar)], ["javascript", "yaml"]);
});

test("recognizes source and text scopes but ignores unsupported includes", () => {
  const grammar = {
    patterns: [
      { include: "text.html#tags" },
      { include: "source.css" },
      { include: "meta.embedded.block" }
    ]
  };

  assert.deepEqual([...externalLanguagesFor(grammar)], ["html", "css"]);
});

test("normalizes language aliases and preserves canonical names", () => {
  assert.equal(normalizeLanguage("js"), "javascript");
  assert.equal(normalizeLanguage("yml"), "yaml");
  assert.equal(normalizeLanguage("python"), "python");
});

test("normalizes aliases for the expanded grammar set", () => {
  assert.equal(normalizeLanguage("c++"), "cpp");
  assert.equal(normalizeLanguage("cc"), "cpp");
  assert.equal(normalizeLanguage("cxx"), "cpp");
  assert.equal(normalizeLanguage("h"), "c");
  assert.equal(normalizeLanguage("hpp"), "cpp");
  assert.equal(normalizeLanguage("cs"), "csharp");
  assert.equal(normalizeLanguage("kt"), "kotlin");
  assert.equal(normalizeLanguage("kts"), "kotlin");
  assert.equal(normalizeLanguage("ps1"), "powershell");
  assert.equal(normalizeLanguage("pwsh"), "powershell");
  assert.equal(normalizeLanguage("gql"), "graphql");
  assert.equal(normalizeLanguage("docker"), "dockerfile");
  assert.equal(normalizeLanguage("xml"), "html");
  assert.equal(normalizeLanguage("svg"), "html");
  assert.equal(normalizeLanguage("webmanifest"), "json");
  // tsx is now a genuine canonical grammar, not an alias to typescript.
  assert.equal(normalizeLanguage("tsx"), "tsx");
});

test("normalizes aliases for the second expanded grammar set", () => {
  assert.equal(normalizeLanguage("objc"), "objective-c");
  assert.equal(normalizeLanguage("objectivec"), "objective-c");
  assert.equal(normalizeLanguage("obj-c"), "objective-c");
  assert.equal(normalizeLanguage("asm"), "assembly");
  assert.equal(normalizeLanguage("nasm"), "assembly");
  assert.equal(normalizeLanguage("x86asm"), "assembly");
  assert.equal(normalizeLanguage("pl"), "perl");
  assert.equal(normalizeLanguage("lua"), "lua");
  assert.equal(normalizeLanguage("dart"), "dart");
  assert.equal(normalizeLanguage("r"), "r");
});

test("reports dependencies used by the shipped grammars", () => {
  assert.deepEqual([...externalLanguagesFor(scss)], ["css"]);
  assert.deepEqual([...externalLanguagesFor(markdown)], ["yaml"]);
  assert.deepEqual([...externalLanguagesFor(typescript)], ["javascript"]);
  assert.deepEqual([...externalLanguagesFor(html)], ["css", "json", "javascript"]);
  assert.deepEqual([...externalLanguagesFor(cpp)], ["c"]);
  assert.deepEqual([...externalLanguagesFor(tsx)], ["javascript", "typescript"]);
  assert.deepEqual([...externalLanguagesFor(objectiveC)], ["c"]);
});

test("loads external dependencies once and indexes grammars by language and scope", async () => {
  const grammarFixtures = {
    html: {
      scopeName: "text.html",
      patterns: [{ include: "source.js" }]
    },
    javascript: {
      scopeName: "source.js",
      patterns: []
    }
  };
  const importedLanguages = [];
  const load = createGrammarLoader(async language => {
    importedLanguages.push(language);
    return grammarFixtures[language] ?? null;
  });

  const loaded = await load(["html"]);
  await load(["html"]);

  assert.deepEqual(importedLanguages, ["html", "javascript"]);
  assert.deepEqual(loaded.byLanguage, grammarFixtures);
  assert.equal(loaded.byScope.get("text.html"), grammarFixtures.html);
  assert.equal(loaded.byScope.get("source.js"), grammarFixtures.javascript);
});

test("dynamically loads every new canonical grammar and transitively resolves its dependencies", async () => {
  const load = createGrammarLoader();
  const newLanguages = [
    "sql", "dockerfile", "toml", "c", "cpp", "csharp", "java", "php",
    "graphql", "kotlin", "swift", "powershell", "tsx"
  ];

  const loaded = await load(newLanguages);

  for (const language of newLanguages) {
    assert.ok(loaded.byLanguage[language], `expected ${language} to load`);
  }

  // cpp reuses the shared C grammar via external includes.
  assert.ok(loaded.byLanguage.c, "cpp should transitively load c");
  assert.equal(loaded.byScope.get("source.c"), loaded.byLanguage.c);

  // tsx reuses TypeScript and JavaScript via external includes.
  assert.ok(loaded.byLanguage.javascript, "tsx should transitively load javascript");
  assert.ok(loaded.byLanguage.typescript, "tsx should transitively load typescript");
});

test("dynamically loads every second-batch canonical grammar and transitively resolves its dependencies", async () => {
  const load = createGrammarLoader();
  const newLanguages = ["objective-c", "lua", "dart", "assembly", "perl", "r"];

  const loaded = await load(newLanguages);

  for (const language of newLanguages) {
    assert.ok(loaded.byLanguage[language], `expected ${language} to load`);
  }

  // objective-c reuses the shared C grammar via external includes.
  assert.ok(loaded.byLanguage.c, "objective-c should transitively load c");
  assert.equal(loaded.byScope.get("source.c"), loaded.byLanguage.c);
});
