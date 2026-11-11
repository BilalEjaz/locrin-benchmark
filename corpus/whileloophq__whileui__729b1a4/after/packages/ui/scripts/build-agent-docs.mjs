/**
 * Builds the agent-facing docs that ship inside the package, so an agent always reads
 * the docs for the version that is installed:
 *
 *   dist/agent/llms.txt             index: rules, composition grammar, every component
 *   dist/agent/llms-components.txt  every component and block with its API section
 *   dist/agent/llms-full.txt        the whole README
 *   dist/agent/catalog.json         the same data, structured; read by @thewhileloop/whileui-mcp
 *
 * README.md is the only source. The build fails if the README lists a component the
 * package does not export, because that is exactly the mistake an agent would copy.
 *
 * Run with Bun (`bun scripts/build-agent-docs.mjs`): it imports the TypeScript token
 * contracts directly.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { THEME_TOKEN_SPECS, VISUAL_TOKEN_SPECS, WHILEUI_DARK_THEME_COLORS } from '../src/tokens.ts';
import {
  findPhantomComponents,
  findStaleSkillNames,
  findUnnamedIconButtons,
  prepareForAgents,
} from './agent-docs-guards.mjs';
import { syncApiTables } from './api-docs.mjs';

const PKG = join(dirname(fileURLToPath(import.meta.url)), '..');
const ROOT = join(PKG, '../..');
const OUT = join(PKG, 'dist/agent');
const TEMPLATES = join(ROOT, 'apps/showcase/catalog/templates');

const readme = readFileSync(join(ROOT, 'README.md'), 'utf8');
// Guards check the README as written; everything shipped to agents reads this version.
const agentReadme = prepareForAgents(readme);
const { version } = JSON.parse(readFileSync(join(PKG, 'package.json'), 'utf8'));
const lines = agentReadme.split('\n');
const TEMPLATES_URL =
  'https://github.com/whileloophq/whileui/tree/main/apps/showcase/catalog/templates';

// Headings outside code fences, with the line each starts on.
const headings = [];
let inFence = false;
lines.forEach((line, index) => {
  if (line.startsWith('```')) inFence = !inFence;
  const match = !inFence && /^(#{2,3}) (.+)$/.exec(line);
  if (match) headings.push({ level: match[1].length, title: match[2], index });
});

/** A heading's text through the next heading of the same or higher level. */
function section(heading) {
  const next = headings.find((h) => h.index > heading.index && h.level <= heading.level);
  return lines
    .slice(heading.index, next?.index ?? lines.length)
    .join('\n')
    .trim();
}

function guide(title) {
  const heading = headings.find((h) => h.title === title);
  if (!heading) throw new Error(`README has no "${title}" section`);
  return section(heading);
}

/** "DatePickerModal / DatePickerInline" and "SettingsSection / SettingsItem" name several. */
const namesIn = (title) =>
  title.split(/\s*(?:\/|,| and )\s*/).map((part) => part.replace(/[`()]/g, '').trim());

// Every `| **Name** | … |` row between "Components" and the end of the block tables.
const first = headings.findIndex((h) => h.title === 'Components');
const last = headings.findIndex((h) => h.title === 'Layout Primitives (Stack, Row)');
const components = [];
for (let h = first; h < last; h++) {
  const category = headings[h];
  if (category.level !== 3) continue;
  for (let i = category.index + 1; i < headings[h + 1].index; i++) {
    const row = /^\|\s*\*\*([A-Za-z]+)\*\*\s*\|(.*)\|\s*$/.exec(lines[i]);
    if (!row) continue;
    const cells = row[2].split('|').map((cell) => cell.trim());
    const docs = headings.find((heading) => namesIn(heading.title).includes(row[1]));
    components.push({
      name: row[1],
      category: category.title.replace(/\s*\(.*\)$/, ''),
      kind: category.title.includes('templates') ? 'template' : 'package',
      summary: cells[cells.length - 1],
      docs: docs ? section(docs) : null,
      ...(category.title.includes('templates') ? { source: TEMPLATES_URL } : {}),
    });
  }
}

/** An entry file's source plus every module it re-exports with `export * from`. */
function exportedSource(file) {
  const source = readFileSync(file, 'utf8');
  const reexports = [...source.matchAll(/export \* from '(\.[^']+)'/g)].map(([, spec]) => {
    const base = join(dirname(file), spec);
    const candidates = [`${base}.ts`, `${base}.tsx`, join(base, 'index.ts')];
    const found = candidates.find((path) => existsSync(path));
    if (!found) throw new Error(`Cannot resolve "${spec}" re-exported from ${file}`);
    return exportedSource(found);
  });
  return [source, ...reexports].join('\n');
}

// An agent reproduces whatever the docs name, so a name the package cannot import is a bug.
const packageExports = exportedSource(join(PKG, 'src/index.ts'));
const templateExports = ['auth', 'profile']
  .map((dir) => exportedSource(join(TEMPLATES, dir, 'index.ts')))
  .join('\n');
const phantom = findPhantomComponents(components, { packageExports, templateExports });
if (phantom.length > 0) {
  throw new Error(`README lists components that are not exported: ${phantom.join(', ')}`);
}

// API tables are generated from the props types; a table that differs is stale.
if ((await syncApiTables(readme)) !== readme) {
  throw new Error('README API tables differ from the props types. Run: bun run docs:api');
}

// Agents copy the examples exactly, so an example must not teach an unnamed control.
const unnamed = findUnnamedIconButtons(readme);
if (unnamed.length > 0) {
  throw new Error(`README shows icon buttons with no name:\n  ${unnamed.join('\n  ')}`);
}

// The skill (skills/whileui/SKILL.md) is hand-written and installed into consumers'
// agents; every API, MCP tool, subpath and agent file it names must still exist.
const stale = findStaleSkillNames(readFileSync(join(ROOT, 'skills/whileui/SKILL.md'), 'utf8'), {
  publicApi: [
    packageExports,
    exportedSource(join(PKG, 'src/tokens.ts')),
    readFileSync(join(PKG, 'src/metro.cjs'), 'utf8'),
  ].join('\n'),
  mcpServer: readFileSync(join(ROOT, 'packages/mcp/src/server.ts'), 'utf8'),
  subpaths: Object.keys(JSON.parse(readFileSync(join(PKG, 'package.json'), 'utf8')).exports),
  agentFiles: ['llms.txt', 'llms-components.txt', 'llms-full.txt', 'catalog.json'],
});
if (stale.length > 0) {
  throw new Error(`skills/whileui/SKILL.md names things that no longer exist: ${stale.join(', ')}`);
}

const catalog = {
  package: '@thewhileloop/whileui',
  version,
  guides: {
    quickReference: guide('Quick Reference (AI / Code Generation)'),
    compositionGrammar: guide('Composition grammar'),
    installation: guide('Installation'),
    theming: guide('Theming'),
  },
  components,
  themeTokens: THEME_TOKEN_SPECS.map(({ key, cssVar, appVar, group, fallback }) => ({
    key,
    cssVar,
    appVar,
    group,
    light: fallback,
    dark: WHILEUI_DARK_THEME_COLORS[key],
  })),
  visualTokens: VISUAL_TOKEN_SPECS.map(({ key, cssVar, kind, group, fallback }) => ({
    key,
    cssVar,
    kind,
    group,
    fallback,
  })),
};

const describe = (c) =>
  `- **${c.name}** (${c.category}${c.kind === 'template' ? ', copy-paste template' : ''}) — ${c.summary}`;

const header = `# WhileUI ${version}

> React Native components and blocks for iOS, Android and web, styled with Uniwind and
> themed through a typed token contract. Package: \`@thewhileloop/whileui\`.`;

const index = `${header}

Files in this folder:
- llms-components.txt — every component and block with its API section
- llms-full.txt — the complete README, including setup and theming
- catalog.json — the same data, structured (served by \`@thewhileloop/whileui-mcp\`)

Components import from \`@thewhileloop/whileui\`. Copy-paste templates are not in the
package; copy them from ${TEMPLATES_URL}.

${catalog.guides.quickReference}

## Components and blocks

${components.map(describe).join('\n')}
`;

// Several components share one section ("SettingsSection / SettingsItem"); print it once.
const printedUnder = new Map();
const entry = (c) => {
  if (!c.docs) return 'No API section yet; the summary above is the full description.';
  if (printedUnder.has(c.docs)) return `Documented under ${printedUnder.get(c.docs)}.`;
  printedUnder.set(c.docs, c.name);
  return c.docs;
};
const componentDocs = `${header}

${components.map((c) => `${describe(c)}\n\n${entry(c)}`).join('\n\n---\n\n')}
`;

mkdirSync(OUT, { recursive: true });
writeFileSync(join(OUT, 'llms.txt'), index);
writeFileSync(join(OUT, 'llms-components.txt'), componentDocs);
writeFileSync(join(OUT, 'llms-full.txt'), agentReadme);
writeFileSync(join(OUT, 'catalog.json'), `${JSON.stringify(catalog, null, 2)}\n`);

// stderr: `npm pack --json` runs this build and parses stdout as JSON.
const documented = components.filter((c) => c.docs).length;
console.error(
  `agent docs: ${components.length} components (${documented} with an API section), ` +
    `${catalog.themeTokens.length} theme tokens, ${catalog.visualTokens.length} visual tokens`
);
