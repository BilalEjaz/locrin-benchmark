// Packs tsdraft the way `npm publish` would, installs the tarball into a throwaway
// consumer, then type-checks and runs code that imports "tsdraft". The unit tests
// import src/, so this is the check that covers the published dist/.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const tmp = mkdtempSync(join(tmpdir(), "tsdraft-smoke-"));
const run = (cmd: string, args: string[], cwd: string) =>
  execFileSync(cmd, args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] });

try {
  // npm pack runs `prepack`, which builds dist/ first.
  const [pack] = JSON.parse(run("npm", ["pack", "--json", "--pack-destination", tmp], root)) as {
    filename: string;
    files: { path: string }[];
  }[];
  assert.ok(pack, "npm pack produced a tarball");
  const files = pack.files.map((f) => f.path).sort();
  for (const required of [
    "LICENSE",
    "README.md",
    "package.json",
    "dist/index.js",
    "dist/index.d.ts",
  ]) {
    assert.ok(files.includes(required), `tarball contains ${required}`);
  }
  const stray = files.filter(
    (f) => !/^(LICENSE|README\.md|CHANGELOG\.md|package\.json|dist\/[\w-]+\.(js|d\.ts))$/.test(f),
  );
  assert.deepEqual(stray, [], "tarball contains only dist/ and package metadata");

  const consumer = join(tmp, "consumer");
  const installed = join(consumer, "node_modules", "tsdraft");
  mkdirSync(installed, { recursive: true });
  run("tar", ["-xzf", join(tmp, pack.filename), "-C", installed, "--strip-components=1"], root);

  writeFileSync(
    join(consumer, "package.json"),
    JSON.stringify({ name: "consumer", private: true, type: "module" }),
  );
  writeFileSync(
    join(consumer, "main.ts"),
    [
      `import { createDrawing, toDXF, toSVG, type Drawing } from "tsdraft";`,
      `const d: Drawing = createDrawing({ units: "ft" }).layer("A", { color: 1 }, () => {}).rect([0, 0], 10, 5).build();`,
      `const dxf: string = toDXF(d);`,
      `const svg: string = toSVG(d);`,
      `if (!dxf.endsWith("EOF\\r\\n") || !svg.startsWith("<svg")) throw new Error("unexpected output");`,
      `console.log("consumer ok");`,
      ``,
    ].join("\n"),
  );

  // Type-check the consumer with both module resolution modes that consumers use.
  const tsc = join(root, "node_modules", "typescript", "bin", "tsc");
  for (const [mode, options] of [
    ["nodenext", { module: "nodenext", moduleResolution: "nodenext" }],
    ["bundler", { module: "preserve", moduleResolution: "bundler" }],
  ] as const) {
    const config = `tsconfig.${mode}.json`;
    writeFileSync(
      join(consumer, config),
      JSON.stringify({
        compilerOptions: { ...options, strict: true, noEmit: true, skipLibCheck: false, types: [] },
        files: ["main.ts"],
      }),
    );
    run(process.execPath, [tsc, "-p", config], consumer);
  }

  // Run it. The consumer's own .ts is type-stripped; tsdraft itself is plain dist/ JavaScript.
  assert.equal(run(process.execPath, ["main.ts"], consumer).trim(), "consumer ok");
  console.log(`package smoke test passed: ${pack.filename}, ${files.length} files`);
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
