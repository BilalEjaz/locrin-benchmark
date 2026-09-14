import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";

vi.mock("../../src/utils/git.js", () => ({
  isGitRepo: vi.fn(async () => true),
  // git ls-files failed
  getTrackedFiles: vi.fn(async () => null),
}));

import { scanFiles } from "../../src/indexing/file-scanner.js";
import { ProjectConfigSchema } from "../../src/config/schema.js";

describe("scanFiles when git ls-files fails", () => {
  let projectPath: string;

  beforeAll(async () => {
    projectPath = await mkdtemp(join(tmpdir(), "vectordb-scan-fallback-"));
    await mkdir(join(projectPath, "src"));
    await writeFile(join(projectPath, "src/app.ts"), "export const app = 1;\n");
  });

  afterAll(async () => {
    await rm(projectPath, { recursive: true, force: true });
  });

  it("falls back to glob discovery", async () => {
    const result = await scanFiles(projectPath, ProjectConfigSchema.parse({}).files);

    expect(result).toEqual(["src/app.ts"]);
  });
});
