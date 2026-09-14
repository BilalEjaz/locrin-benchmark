import { readdirSync } from "node:fs";
import { test, expect } from "@playwright/test";

// Playwright serves the whole repo root (see playwright.config.js), so the
// published demo lives under /docs/ and its module graph resolves from
// /docs/microlighter/*.js (the build.sh output copy), not /microlighter/*.js.
const HOMEPAGE = "/docs/";

const canonicalGrammars = readdirSync(new URL("../src/grammars", import.meta.url))
  .map(file => file.replace(/\.js$/, ""))
  .sort();

/**
 * Read the live CSS Custom Highlight registry state from the page.
 */
const readHighlights = page =>
  page.evaluate(() => {
    let total = 0;
    for (const highlight of CSS.highlights.values()) total += highlight.size;
    return {
      categories: [...CSS.highlights.keys()].sort(),
      total,
      blocks: document.querySelectorAll("pre > code[class*='language-']").length
    };
  });

test.describe("MicroLighter demo site (docs/index.html)", () => {
  test("registers highlight ranges across every code block", async ({ page }) => {
    await page.goto(HOMEPAGE, { waitUntil: "networkidle" });

    const { categories, total, blocks } = await readHighlights(page);

    expect(blocks).toBeGreaterThan(0);
    expect(categories.length).toBeGreaterThan(10);
    expect(total).toBeGreaterThan(100);
  });

  test("exposes the core token categories", async ({ page }) => {
    await page.goto(HOMEPAGE, { waitUntil: "networkidle" });

    const { categories } = await readHighlights(page);

    for (const category of ["keyword", "string", "comment", "function", "numeric"]) {
      expect(categories).toContain(category);
    }
  });

  test("maps TextMate scopes to stable semantic categories", async ({ page }) => {
    await page.goto(HOMEPAGE, { waitUntil: "networkidle" });

    const actual = await page.evaluate(async () => {
      const { highlight } = await import("/docs/microlighter/highlight.js");
      const mappings = [
        ["comment.block.html", "comment"],
        ["markup.quote", "quote"],
        ["markup.inserted.diff", "inserted"],
        ["markup.deleted.diff", "deleted"],
        ["constant.character.entity", "character-entity"],
        ["keyword.control.doctype", "doctype"],
        ["keyword.control.at-rule", "at-rule"],
        ["keyword.other.important", "important"],
        ["entity.name.section", "section"],
        ["string.regexp", "regexp"],
        ["string.quoted.attribute-value", "attribute-value"],
        ["string.other.link", "link"],
        ["markup.raw", "raw"],
        ["string.unquoted.fenced-code", "string"],
        ["constant.numeric.line-number.diff", "numeric"],
        ["constant.language.boolean", "boolean"],
        ["constant.other.symbol", "symbol"],
        ["constant.language", "constant"],
        ["keyword.operator", "operator"],
        ["storage.type", "storage"],
        ["keyword.control.ts", "keyword"],
        ["support.class.builtin", "support"],
        ["entity.name.type.class", "type"],
        ["entity.name.function.macro", "function"],
        ["entity.name.decorator", "decorator"],
        ["entity.name.animation", "animation"],
        ["entity.name.variable.assignment", "variable"],
        ["entity.name.interpolation", "interpolation"],
        ["support.type.property-name", "property"],
        ["entity.name.key", "key"],
        ["entity.name.tag", "tag"],
        ["entity.other.attribute-name", "attribute-name"],
        ["entity.name.selector", "selector"],
        ["punctuation.definition.string.begin", "punctuation"],
        ["entity.name.anchor", "anchor"]
      ];
      const tokens = mappings.map((_, index) => `@${index}`);
      const code = document.createElement("code");
      code.textContent = tokens.join(" ");
      document.body.append(code);

      for (const category of CSS.highlights.keys()) CSS.highlights.delete(category);

      const grammar = {
        scopeName: "source.test",
        patterns: mappings.map(([scope], index) => ({
          match: `${tokens[index]}\\b`,
          name: scope
        }))
      };
      highlight([code], () => grammar, new Map());

      return Object.fromEntries(
        [...CSS.highlights].map(([category, ranges]) => [
          category,
          [...ranges].map(range => range.toString())
        ])
      );
    });

    const expected = {
      comment: ["@0"],
      quote: ["@1"],
      inserted: ["@2"],
      deleted: ["@3"],
      "character-entity": ["@4"],
      doctype: ["@5"],
      "at-rule": ["@6"],
      important: ["@7"],
      section: ["@8"],
      regexp: ["@9"],
      "attribute-value": ["@10"],
      link: ["@11"],
      raw: ["@12"],
      string: ["@13"],
      numeric: ["@14"],
      boolean: ["@15"],
      symbol: ["@16"],
      constant: ["@17"],
      operator: ["@18"],
      storage: ["@19"],
      keyword: ["@20"],
      support: ["@21"],
      type: ["@22"],
      function: ["@23"],
      decorator: ["@24"],
      animation: ["@25"],
      variable: ["@26"],
      interpolation: ["@27"],
      property: ["@28"],
      key: ["@29"],
      tag: ["@30"],
      "attribute-name": ["@31"],
      selector: ["@32"],
      punctuation: ["@33"],
      anchor: ["@34"]
    };

    expect(actual).toEqual(expected);
  });

  test("re-highlights after switching themes via the syntax-highlight event", async ({ page }) => {
    await page.goto(HOMEPAGE, { waitUntil: "networkidle" });

    const before = await readHighlights(page);

    await page.evaluate(() => {
      document.documentElement.dataset.syntaxTheme = "dracula";
      document.dispatchEvent(new Event("syntax-highlight"));
    });
    await page.waitForTimeout(200);

    const theme = await page.evaluate(() => document.documentElement.dataset.syntaxTheme);
    const after = await readHighlights(page);

    expect(theme).toBe("dracula");
    expect(after.total).toBe(before.total);
  });

  test("loads every bundled theme without changing highlight ranges", async ({ page }) => {
    await page.goto(HOMEPAGE, { waitUntil: "networkidle" });

    const before = await readHighlights(page);
    const themes = await page.locator("#theme option").evaluateAll(options =>
      options.map(option => option.value)
    );

    expect(themes).toEqual(expect.arrayContaining([
      "github", "vscode-plus", "dracula", "monokai", "night-owl",
      "solarized-light", "vesper", "min", "cobalt2", "tokyo-night"
    ]));

    for (const theme of themes) {
      await page.selectOption("#theme", theme);

      const styles = await page.evaluate(() => {
        const root = getComputedStyle(document.documentElement);
        // Find a live, currently-rendered code block robustly: one of the
        // curated static samples is always present, regardless of which
        // playground language happens to be selected.
        const pre = document.querySelector("pre > code[class*='language-']")?.closest("pre");
        const code = getComputedStyle(pre);
        return {
          theme: document.documentElement.dataset.syntaxTheme,
          background: root.getPropertyValue("--syntax-background").trim(),
          foreground: root.getPropertyValue("--syntax-foreground").trim(),
          inserted: root.getPropertyValue("--syntax-inserted").trim(),
          deleted: root.getPropertyValue("--syntax-deleted").trim(),
          codeBackground: code.backgroundColor
        };
      });

      expect(styles.theme).toBe(theme);
      expect(styles.background).not.toBe("");
      expect(styles.foreground).not.toBe("");
      expect(styles.inserted).not.toBe("");
      expect(styles.deleted).not.toBe("");
      expect(styles.codeBackground).not.toBe("rgba(0, 0, 0, 0)");
      expect((await readHighlights(page)).total).toBe(before.total);
    }
  });

  test("supports standard classes, data attributes, and deprecated lang attributes", async ({ page }) => {
    await page.goto(HOMEPAGE, { waitUntil: "networkidle" });

    const highlighted = await page.evaluate(async () => {
      const fixtures = [
        '<pre><code id="class-language" class="example language-js">const classValue = true;</code></pre>',
        '<pre><code id="code-data-language" data-language="json">{"code": true}</code></pre>',
        '<pre data-language="python"><code id="pre-data-language">value = True</code></pre>',
        '<pre lang="ruby"><code id="legacy-lang">legacy = true</code></pre>'
      ];
      document.body.insertAdjacentHTML("beforeend", fixtures.join(""));
      document.dispatchEvent(new Event("syntax-highlight"));
      await new Promise(resolve => setTimeout(resolve, 100));

      const ids = new Set();
      for (const highlight of CSS.highlights.values()) {
        for (const range of highlight) {
          const id = range.startContainer.parentElement?.closest("code")?.id;
          if (id) ids.add(id);
        }
      }
      return [...ids];
    });

    expect(highlighted).toEqual(expect.arrayContaining([
      "class-language",
      "code-data-language",
      "pre-data-language",
      "legacy-lang"
    ]));
  });

  test("accepts exported and custom language aliases through the import API", async ({ page }) => {
    await page.goto(HOMEPAGE, { waitUntil: "networkidle" });

    const highlighted = await page.evaluate(async () => {
      const root = document.createElement("div");
      root.innerHTML = [
        '<pre><code id="exported-alias" class="language-jsx">const exported = true;</code></pre>',
        '<pre><code id="custom-alias" class="language-ecmascript">const custom = true;</code></pre>'
      ].join("");
      document.body.append(root);

      const { highlightAll } = await import("/docs/microlighter/index.js");
      const { default: languageAliases } =
        await import("/docs/microlighter/language-aliases.js");
      await highlightAll({
        root,
        languageAliases: {
          ...languageAliases,
          ecmascript: "javascript"
        }
      });

      const ids = new Set();
      for (const highlight of CSS.highlights.values()) {
        for (const range of highlight) {
          const id = range.startContainer.parentElement?.closest("code")?.id;
          if (id) ids.add(id);
        }
      }
      return [...ids];
    });

    expect(highlighted).toEqual(expect.arrayContaining([
      "exported-alias",
      "custom-alias"
    ]));
  });

  test("removes stale ranges when code blocks disappear", async ({ page }) => {
    await page.goto(HOMEPAGE, { waitUntil: "networkidle" });

    await page.evaluate(() => {
      document.querySelectorAll("pre > code[class*='language-']").forEach(code => code.remove());
      document.dispatchEvent(new Event("syntax-highlight"));
    });

    await expect.poll(() => readHighlights(page)).toMatchObject({
      categories: [],
      total: 0
    });
  });

  test("curates exactly six full static language samples", async ({ page }) => {
    await page.goto(HOMEPAGE, { waitUntil: "networkidle" });

    const sampleLanguages = await page.evaluate(() =>
      [...document.querySelectorAll("section.sample:not(.playground) > pre > code[class*='language-']")]
        .map(code => [...code.classList]
          .find(className => className.startsWith("language-"))
          .slice("language-".length)));

    expect(sampleLanguages).toEqual(["html", "markdown", "python", "sql", "cpp", "tsx"]);
  });

  test("loads without runtime errors", async ({ page }) => {
    const errors = [];
    page.on("pageerror", error => errors.push(String(error)));
    page.on("console", message => {
      if (message.type() !== "error") return;
      // Ignore the harmless missing-favicon request the demo makes; its URL
      // lives on the message location, not in the generic error text.
      const url = message.location()?.url ?? "";
      if (/favicon\.ico/.test(url) || /favicon\.ico/.test(message.text())) return;
      errors.push(message.text());
    });

    await page.goto(HOMEPAGE, { waitUntil: "networkidle" });
    await page.waitForTimeout(200);

    expect(errors).toEqual([]);
  });
});

test.describe("Supported languages index", () => {
  test("lists every canonical grammar grouped by category", async ({ page }) => {
    await page.goto(HOMEPAGE, { waitUntil: "networkidle" });

    const listed = await page.evaluate(() =>
      [...document.querySelectorAll(".language-index [data-lang]")].map(item => item.dataset.lang));

    expect(listed.sort()).toEqual(canonicalGrammars);
    expect(new Set(listed).size).toBe(listed.length);
  });

  test("organizes languages into meaningful, labeled groups", async ({ page }) => {
    await page.goto(HOMEPAGE, { waitUntil: "networkidle" });

    const groups = await page.evaluate(() =>
      [...document.querySelectorAll(".language-group")].map(group => ({
        name: group.querySelector("h3")?.textContent.trim(),
        languages: [...group.querySelectorAll("[data-lang]")].map(item => item.dataset.lang)
      })));

    const byName = Object.fromEntries(groups.map(group => [group.name, group.languages]));

    expect(Object.keys(byName).length).toBeGreaterThanOrEqual(4);
    // Formats and markup/styling languages aren't shoved into "programming".
    expect(byName["Web"]).toEqual(expect.arrayContaining(["html", "css", "scss"]));
    expect(byName["Data, config & docs"]).toEqual(expect.arrayContaining(["git-diff", "toml", "yaml"]));
  });
});

test.describe("Language playground", () => {
  test("defaults to a language not already shown as a static sample", async ({ page }) => {
    await page.goto(HOMEPAGE, { waitUntil: "networkidle" });

    const staticSamples = ["html", "markdown", "python", "sql", "cpp", "tsx"];
    const selected = await page.locator("#playground-language").inputValue();

    expect(staticSamples).not.toContain(selected);

    const renderedLang = await page.evaluate(() => {
      const code = document.querySelector("#playground-output code[class*='language-']");
      return [...code.classList]
        .find(className => className.startsWith("language-"))
        .slice("language-".length);
    });
    expect(renderedLang).toBe(selected);
  });

  test("keeps every language sample inert until selected", async ({ page }) => {
    await page.goto(HOMEPAGE, { waitUntil: "networkidle" });

    const { liveCount, templateCount, templatesInLiveDom } = await page.evaluate(() => ({
      liveCount: document.querySelectorAll("#playground-output code[class*='language-']").length,
      templateCount: document.querySelectorAll(".playground-body > template").length,
      // Template contents never render into the live document by themselves.
      templatesInLiveDom: document.querySelectorAll(".playground-body > template pre").length
    }));

    expect(liveCount).toBe(1);
    expect(templateCount).toBeGreaterThan(10);
    expect(templatesInLiveDom).toBe(0);
  });

  test("renders exactly one sample at a time and lazily highlights the new selection", async ({ page }) => {
    await page.goto(HOMEPAGE, { waitUntil: "networkidle" });

    await page.selectOption("#playground-language", "rust");
    await expect(page.locator("#playground-output code[class*='language-']")).toHaveCount(1);
    await expect(page.locator("#playground-output code.language-rust")).toHaveCount(1);

    const rustHighlighted = await page.evaluate(() => {
      const code = document.querySelector("#playground-output code.language-rust");
      for (const highlight of CSS.highlights.values()) {
        for (const range of highlight) {
          if (range.startContainer.parentElement?.closest("#playground-output pre > code") === code) return true;
        }
      }
      return false;
    });
    expect(rustHighlighted).toBe(true);

    await page.selectOption("#playground-language", "yaml");
    await expect(page.locator("#playground-output code[class*='language-']")).toHaveCount(1);
    await expect(page.locator("#playground-output code.language-yaml")).toHaveCount(1);
    await expect(page.locator("#playground-output code.language-rust")).toHaveCount(0);
  });

  test("select options cover every canonical grammar with a readable label", async ({ page }) => {
    await page.goto(HOMEPAGE, { waitUntil: "networkidle" });

    const options = await page.evaluate(() =>
      [...document.querySelectorAll("#playground-language option")].map(option => ({
        value: option.value,
        label: option.textContent.trim()
      })));

    expect(options.map(option => option.value).sort()).toEqual(canonicalGrammars);
    expect(options.every(option => option.label.length > 0)).toBe(true);
  });
});
