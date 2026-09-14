import { readdirSync } from "node:fs";
import { test, expect } from "@playwright/test";

const FIXTURE = "/test/fixtures/grammar-exhaustive.html";

const canonicalGrammars = readdirSync(new URL("../src/grammars", import.meta.url))
  .map(file => file.replace(/\.js$/, ""))
  .sort();

/**
 * Map every live pre > code[class*='language-'] block to whether any CSS
 * Custom Highlight range currently points into it.
 */
const readBlockCoverage = page =>
  page.evaluate(() => {
    const highlightedCodes = new Set();
    for (const highlight of CSS.highlights.values()) {
      for (const range of highlight) {
        const code = range.startContainer.parentElement?.closest("pre > code[class*='language-']");
        if (code) highlightedCodes.add(code);
      }
    }

    return [...document.querySelectorAll("pre > code[class*='language-']")].map(code => ({
      lang: [...code.classList]
        .find(className => className.startsWith("language-"))
        .slice("language-".length),
      nonEmpty: code.textContent.trim().length > 0,
      highlighted: highlightedCodes.has(code)
    }));
  });

test.describe("Grammar exhaustive fixture (test/fixtures/grammar-exhaustive.html)", () => {
  test("loads without runtime errors", async ({ page }) => {
    const errors = [];
    page.on("pageerror", error => errors.push(String(error)));
    page.on("console", message => {
      if (message.type() !== "error") return;
      // Ignore the harmless missing-favicon request; this fixture has none.
      const url = message.location()?.url ?? "";
      if (/favicon\.ico/.test(url) || /favicon\.ico/.test(message.text())) return;
      errors.push(message.text());
    });

    await page.goto(FIXTURE, { waitUntil: "networkidle" });
    await page.waitForTimeout(200);

    expect(errors).toEqual([]);
  });

  test("declares a non-empty code[class*='language-'] block for every canonical grammar", async ({ page }) => {
    await page.goto(FIXTURE, { waitUntil: "networkidle" });

    const blocks = await readBlockCoverage(page);
    const declaredLangs = blocks.map(block => block.lang).sort();

    expect(declaredLangs).toEqual(canonicalGrammars);
    expect(blocks.every(block => block.nonEmpty)).toBe(true);
  });

  test("highlights every canonical grammar's block with no unhighlighted leftovers", async ({ page }) => {
    await page.goto(FIXTURE, { waitUntil: "networkidle" });

    const blocks = await readBlockCoverage(page);
    const unhighlighted = blocks.filter(block => !block.highlighted).map(block => block.lang);

    expect(unhighlighted).toEqual([]);
  });

  test("registers highlight ranges for every core token category across the grammar set", async ({ page }) => {
    await page.goto(FIXTURE, { waitUntil: "networkidle" });

    const categories = await page.evaluate(() => [...CSS.highlights.keys()].sort());

    for (const category of ["keyword", "string", "comment", "function", "numeric"]) {
      expect(categories).toContain(category);
    }
  });

  test("categorizes inserted and deleted git-diff lines correctly", async ({ page }) => {
    await page.goto(FIXTURE, { waitUntil: "networkidle" });

    const diffHighlights = await page.evaluate(() => {
      const linesFor = category => [...CSS.highlights.get(category) ?? []]
        .filter(range => range.startContainer.parentElement?.closest("pre > code.language-git-diff"))
        .map(range => range.toString());

      return {
        inserted: linesFor("inserted"),
        deleted: linesFor("deleted"),
        keywords: linesFor("keyword")
      };
    });

    expect(diffHighlights.inserted).toEqual(expect.arrayContaining(["+const answer = 42;"]));
    expect(diffHighlights.deleted).toEqual(expect.arrayContaining(["-const answer = 0;"]));
    expect(diffHighlights.keywords).toEqual([]);
  });
});
