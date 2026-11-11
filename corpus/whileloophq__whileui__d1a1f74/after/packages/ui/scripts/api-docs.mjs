/**
 * Keeps the README's API tables equal to the TypeScript types. Each table sits between
 * `<!-- api:Name -->` and `<!-- /api:Name -->` and is generated from `NameProps`.
 *
 *   node scripts/api-docs.mjs --write   regenerate every table in README.md
 *   node scripts/api-docs.mjs --check   fail if a table differs from the types
 *
 * Describe a prop with a doc comment on it; give a default the code cannot show with an
 * `@default` tag.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import prettier from 'prettier';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createApiReader, renderTable } from './api-tables.mjs';

const README = join(dirname(fileURLToPath(import.meta.url)), '../../../README.md');
const BLOCK = /<!-- api:(\w+) -->\n[\s\S]*?<!-- \/api:\1 -->/g;

/**
 * The README with every marked table regenerated and formatted the way the repo's
 * Prettier formats it, so this and `format` never undo each other. Throws on a marked
 * name with no props type.
 */
export async function syncApiTables(readme, reader = createApiReader()) {
  const generated = readme.replace(BLOCK, (_, name) => {
    const props = reader.propsOf(name);
    if (!props) throw new Error(`README marks api:${name}, but no ${name}Props type is exported`);
    return `<!-- api:${name} -->\n${renderTable(props)}\n<!-- /api:${name} -->`;
  });
  const options = await prettier.resolveConfig(README);
  return prettier.format(generated, { ...options, filepath: README });
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const readme = readFileSync(README, 'utf8');
  const synced = await syncApiTables(readme);
  if (process.argv.includes('--write')) {
    writeFileSync(README, synced);
    console.log('README API tables regenerated');
  } else if (synced !== readme) {
    console.error('README API tables differ from the props types. Run: bun run docs:api');
    process.exit(1);
  } else {
    console.log(`README API tables match the types (${[...readme.matchAll(BLOCK)].length} tables)`);
  }
}
