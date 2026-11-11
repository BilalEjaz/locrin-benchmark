// Runs the built server the way an MCP client does: spawn the bin over stdio from a
// project that has WhileUI installed (this workspace), then call every tool.
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { URL, fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { loadCatalog } from '../dist/catalog.js';

const project = fileURLToPath(new URL('..', import.meta.url));
const catalog = loadCatalog(project);
const client = new Client({ name: 'whileui-mcp-test', version: '0.0.0' });

before(async () => {
  await client.connect(
    new StdioClientTransport({ command: process.execPath, args: ['dist/index.js'], cwd: project })
  );
});
after(() => client.close());

const call = async (name, args) => {
  const result = await client.callTool({ name, arguments: args });
  assert.equal(result.isError, undefined, result.content[0].text);
  return result.content[0].text;
};

test('reports the installed WhileUI version', () => {
  assert.equal(client.getServerVersion().version, catalog.version);
});

test('exposes the four tools', async () => {
  const { tools } = await client.listTools();
  assert.deepEqual(tools.map((t) => t.name).sort(), [
    'get_component_docs',
    'get_guide',
    'get_theme_tokens',
    'list_components',
  ]);
});

test('list_components lists every component, and filters by category', async () => {
  const all = await call('list_components', {});
  assert.equal(all.split('\n').length, catalog.components.length);
  const overlays = await call('list_components', { category: 'overlays & menus' });
  assert.match(overlays, /^Dialog \(/m);
  assert.doesNotMatch(overlays, /^Button \(/m);
});

test('get_component_docs returns API sections and names what does not exist', async () => {
  const docs = await call('get_component_docs', { names: ['button', 'Sheet', 'Carousel'] });
  assert.match(docs, /^## Button$/m);
  assert.match(docs, /^## Sheet$/m);
  assert.match(docs, /## Carousel\n\nNot a WhileUI component/);
});

test('get_theme_tokens returns the whole colour contract with both modes', async () => {
  const colors = (await call('get_theme_tokens', {})).split('\n');
  assert.equal(colors.length, catalog.themeTokens.length);
  assert.match(colors.join('\n'), /--color-primary \/ --app-color-primary {2}light #\w+ {2}dark #\w+/);
  const visual = await call('get_theme_tokens', { kind: 'visual' });
  assert.match(visual, /--ui-radius-sm/);
});

test('get_guide returns the composition grammar', async () => {
  assert.match(await call('get_guide', { topic: 'composition' }), /^### Composition grammar/);
});

test('fails with instructions outside a WhileUI project', () => {
  assert.throws(() => loadCatalog('/'), /Start the server in a project/);
});
