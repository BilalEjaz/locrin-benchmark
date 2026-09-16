import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "fs/promises";
import { tmpdir } from "os";
import { dirname, join } from "path";
import { execFileSync } from "child_process";
import { scanFiles } from "../../src/indexing/file-scanner.js";
import { ProjectConfigSchema, type FilesConfig } from "../../src/config/schema.js";

const PROJECT_FILES: Record<string, string> = {
  "src/app.ts": "export const app = 1;\n",
  "src/größe.ts": "export const size = 2;\n",
  "docs/guide.md": "# Guide\n",
  "node_modules/pkg/index.js": "module.exports = 1;\n",
  "packages/web/node_modules/lib/index.js": "module.exports = 2;\n",
  "dist/bundle.js": "var bundle;\n",
  "package-lock.json": "{}\n",
  "jquery.min.js": "var $;\n",
};

const EXCLUDED_BY_DEFAULT = [
  "node_modules/pkg/index.js",
  "packages/web/node_modules/lib/index.js",
  "dist/bundle.js",
  "package-lock.json",
  "jquery.min.js",
];

async function createProject(prefix: string): Promise<string> {
  const projectPath = await mkdtemp(join(tmpdir(), prefix));
  for (const [file, content] of Object.entries(PROJECT_FILES)) {
    await mkdir(dirname(join(projectPath, file)), { recursive: true });
    await writeFile(join(projectPath, file), content);
  }
  return projectPath;
}

function filesConfig(overrides: Partial<FilesConfig> = {}): FilesConfig {
  return ProjectConfigSchema.parse({ files: overrides }).files;
}

describe.each([
  ["a git repository", true],
  ["a plain directory", false],
])("scanFiles in %s", (_label, useGit) => {
  let projectPath: string;

  beforeAll(async () => {
    projectPath = await createProject("vectordb-scan-");
    if (useGit) {
      execFileSync("git", ["init", "-q"], { cwd: projectPath });
    }
  });

  afterAll(async () => {
    await rm(projectPath, { recursive: true, force: true });
  });

  it("applies the default exclude patterns", async () => {
    const result = await scanFiles(projectPath, filesConfig({ gitOnly: useGit }));

    expect(result).toContain("src/app.ts");
    expect(result).toContain("docs/guide.md");
    for (const excluded of EXCLUDED_BY_DEFAULT) {
      expect(result).not.toContain(excluded);
    }
  });

  it("applies include patterns", async () => {
    const result = await scanFiles(projectPath, filesConfig({ gitOnly: useGit, include: ["src/**"] }));

    expect(result.sort()).toEqual(["src/app.ts", "src/größe.ts"]);
  });

  it("keeps files with non-ASCII names", async () => {
    const result = await scanFiles(projectPath, filesConfig({ gitOnly: useGit }));

    expect(result).toContain("src/größe.ts");
  });
});
