import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  buildGuideMarkdown,
  LATEST_GUIDE_VERSION,
  RELEASE_NOTES
} from "../src/guide";

function readJson(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(new URL(path, import.meta.url), "utf8")) as Record<string, unknown>;
}

describe("built-in guide", () => {
  it("documents core syntax and recurring behavior in both languages", () => {
    for (const language of ["ko", "en"] as const) {
      const guide = buildGuideMarkdown(language, LATEST_GUIDE_VERSION);
      expect(guide).toContain(`v${LATEST_GUIDE_VERSION}`);
      expect(guide).toContain("📅 YYYY-MM-DD");
      expect(guide).toContain("#follow-up");
      expect(guide).toContain("🔁 monthly:15");
      expect(guide).toContain("tag-calendar");
      expect(guide).toContain("follow-up-calendar");
      expect(guide).toContain("density: compact");
      expect(guide).toContain("compact | expanded");
      expect(guide).toContain("_CALENDAR.md");
    }
  });

  it("keeps release notes newest first and renders every release", () => {
    expect(RELEASE_NOTES[0]?.version).toBe(LATEST_GUIDE_VERSION);
    const guide = buildGuideMarkdown("ko", LATEST_GUIDE_VERSION);
    for (const release of RELEASE_NOTES) {
      expect(guide).toContain(`v${release.version}`);
      expect(guide).toContain(release.date);
    }
  });

  it("keeps the guide, manifest, package, and compatibility map on the same version", () => {
    const manifest = readJson("../manifest.json");
    const packageJson = readJson("../package.json");
    const versions = readJson("../versions.json");

    expect(manifest.version).toBe(LATEST_GUIDE_VERSION);
    expect(packageJson.version).toBe(LATEST_GUIDE_VERSION);
    expect(versions).toHaveProperty(LATEST_GUIDE_VERSION);
  });
});
