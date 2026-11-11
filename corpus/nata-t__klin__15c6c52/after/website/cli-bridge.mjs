import { dirname, resolve, sep } from "node:path"
import { fileURLToPath } from "node:url"

/**
 * Lets the landing page run the CLI's own wizard in the browser.
 *
 * The wizard, its form renderer and the logo live in
 * packages/create-klin/src and expect a terminal: Node's fs, path and
 * readline, `process.env` for color detection, and a full-screen `screen`.
 * For modules inside that folder only, this plugin swaps those for the small
 * browser stand-ins in src/wizard/shims/ — so what visitors click through is
 * the real wizard, not a copy that could drift from it.
 */

const here = dirname(fileURLToPath(import.meta.url))
export const cliSrc = resolve(here, "../packages/create-klin/src")
const shims = resolve(here, "src/wizard/shims")

const builtins = {
  "node:fs": `${shims}/node-fs.ts`,
  "node:path": `${shims}/node-path.ts`,
  "node:readline": `${shims}/node-empty.ts`,
  "node:child_process": `${shims}/node-empty.ts`,
  "node:os": `${shims}/node-empty.ts`,
  "node:url": `${shims}/node-empty.ts`,
}

/** CLI modules that only make sense in a terminal, and their browser versions. */
const modules = {
  [resolve(cliSrc, "context.ts")]: `${shims}/context.ts`,
  [resolve(cliSrc, "ui/term.ts")]: `${shims}/term.ts`,
  [resolve(cliSrc, "utils/fs.ts")]: `${shims}/utils-fs.ts`,
}

const inCli = (id) => id.startsWith(cliSrc + sep)
const clean = (id) => id.split("?")[0]

export function cliBridge() {
  return {
    name: "klin-cli-bridge",
    enforce: "pre",
    async resolveId(source, importer, options) {
      if (!importer || !inCli(clean(importer))) return null
      if (builtins[source]) return builtins[source]
      if (!source.startsWith(".")) return null
      const resolved = await this.resolve(source, importer, { ...options, skipSelf: true })
      const target = resolved && modules[clean(resolved.id)]
      return target ?? null
    },
    transform(code, id) {
      if (!inCli(clean(id))) return null
      // `process` (env, platform, stdout size) becomes a module-local stand-in.
      return { code: `import { process } from ${JSON.stringify(`${shims}/process.ts`)};\n${code}`, map: null }
    },
  }
}
