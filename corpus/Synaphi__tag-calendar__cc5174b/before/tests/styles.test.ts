import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("calendar density styles", () => {
  it("keeps compact calendar rows below half the expanded row height", () => {
    const css = readFileSync(new URL("../styles.css", import.meta.url), "utf8");
    const expanded = css.match(/\.follow-up-calendar-grid\s*\{[^}]*grid-auto-rows:\s*([\d.]+)rem/su);
    const compact = css.match(/\.follow-up-calendar\.is-compact \.follow-up-calendar-grid\s*\{[^}]*grid-auto-rows:\s*([\d.]+)rem/su);

    expect(expanded).not.toBeNull();
    expect(compact).not.toBeNull();
    expect(Number(compact?.[1])).toBeLessThan(Number(expanded?.[1]) / 2);
  });
});
