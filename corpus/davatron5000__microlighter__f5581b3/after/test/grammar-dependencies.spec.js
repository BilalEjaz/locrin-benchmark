import assert from "node:assert/strict";
import test from "node:test";

import {
  createGrammarLoader,
  externalLanguagesFor,
  normalizeLanguage
} from "../src/grammar-dependencies.js";
import languageAliases from "../src/language-aliases.js";
import cpp from "../src/grammars/cpp.js";
import html from "../src/grammars/html.js";
import markdown from "../src/grammars/markdown.js";
import objectiveC from "../src/grammars/objective-c.js";
import scss from "../src/grammars/scss.js";
import tsx from "../src/grammars/tsx.js";
import typescript from "../src/grammars/typescript.js";
import svelte from "../src/grammars/svelte.js";
import vue from "../src/grammars/vue.js";

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

  assert.deepEqual([...externalLanguagesFor(grammar)], ["js", "yaml"]);
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
  assert.deepEqual(languageAliases, {
    docker: "dockerfile",
    gql: "graphql",
    js: "javascript",
    jsx: "javascript",
    md: "markdown",
    py: "python",
    rb: "ruby",
    sass: "scss",
    sh: "bash",
    shell: "bash",
    ts: "typescript",
    yml: "yaml",
    zsh: "bash"
  });
  assert.equal(normalizeLanguage("jsx", languageAliases), "javascript");
  assert.equal(normalizeLanguage("sass", languageAliases), "scss");
  assert.equal(normalizeLanguage("python", languageAliases), "python");
});

test("reports dependencies used by the shipped grammars", () => {
  assert.deepEqual([...externalLanguagesFor(scss)], ["css"]);
  assert.deepEqual([...externalLanguagesFor(markdown)], ["yaml"]);
  assert.deepEqual([...externalLanguagesFor(typescript)], ["js"]);
  assert.deepEqual([...externalLanguagesFor(html)], ["css", "json", "js"]);
  assert.deepEqual([...externalLanguagesFor(cpp)], ["c"]);
  assert.deepEqual([...externalLanguagesFor(tsx)], ["js", "ts"]);
  assert.deepEqual([...externalLanguagesFor(objectiveC)], ["c"]);
  assert.deepEqual(svelte.dependencies, ["html", "css", "scss", "javascript", "typescript"]);
  assert.deepEqual(vue.dependencies, ["html", "css", "scss", "javascript", "typescript"]);
});

test("loads external dependencies once and indexes grammars by language and scope", async () => {
  const grammarFixtures = {
    html: {
      scopeName: "text.html",
      dependencies: ["javascript"],
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

test("applies first-party aliases without caller configuration", async () => {
  const load = createGrammarLoader();
  const loaded = await load(["js"]);

  assert.equal(loaded.byLanguage.js, loaded.byLanguage.javascript);
  assert.equal(loaded.byScope.get("source.js"), loaded.byLanguage.javascript);
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
