import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';

/** The shape of `dist/agent/catalog.json`, written by `packages/ui/scripts/build-agent-docs.mjs`. */
export interface Catalog {
  package: string;
  version: string;
  guides: Record<'quickReference' | 'compositionGrammar' | 'installation' | 'theming', string>;
  components: {
    name: string;
    category: string;
    kind: 'package' | 'template';
    summary: string;
    docs: string | null;
  }[];
  themeTokens: {
    key: string;
    cssVar: string;
    appVar: string;
    group: string;
    light: string;
    dark: string;
  }[];
  visualTokens: {
    key: string;
    cssVar: string;
    kind: string;
    group: string;
    fallback: number | boolean;
  }[];
}

/**
 * Reads the catalog shipped inside the WhileUI installed in `projectDir`, so every answer
 * describes the version the agent's code will actually run against.
 */
export function loadCatalog(projectDir: string): Catalog {
  const require = createRequire(join(projectDir, 'package.json'));
  let path: string;
  try {
    path = require.resolve('@thewhileloop/whileui/agent/catalog.json');
  } catch {
    throw new Error(
      `No WhileUI agent catalog found from ${projectDir}. Start the server in a project ` +
        'that has @thewhileloop/whileui installed (a version that ships dist/agent).'
    );
  }
  return JSON.parse(readFileSync(path, 'utf8')) as Catalog;
}
