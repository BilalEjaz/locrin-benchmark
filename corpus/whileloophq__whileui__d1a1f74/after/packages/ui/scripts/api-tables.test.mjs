import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApiReader, renderTable } from './api-tables.mjs';
import { syncApiTables } from './api-docs.mjs';

const reader = createApiReader();

test('reads own props, variant options and their defaults from the types', () => {
  const button = reader.propsOf('Button');
  const row = (name) => button.rows.find((r) => r.name === name);
  assert.equal(row('loading').default, 'false');
  assert.match(row('loading').description, /spinner/);
  assert.equal(row('variant').default, "'default'");
  assert.match(row('variant').type, /'destructive'/);
  assert.equal(button.base, 'PressableProps');
  // React Native's own props are summarised, not listed.
  assert.equal(row('onPressIn'), undefined);
});

test('reads frosted defaults passed to useFrostedSurface', () => {
  const rows = reader.propsOf('SelectContent').rows;
  assert.equal(rows.find((r) => r.name === 'blurTintToken').default, "'popover'");
  assert.deepEqual(rows.find((r) => r.name === 'blurIntensity').default, { plain: 'subtle preset' });
});

test('renders required props and escapes pipes in types', () => {
  const table = renderTable({
    rows: [{ name: 'value', type: "'a' | 'b'", optional: false, default: undefined, description: 'Pick one.' }],
    inherits: false,
  });
  assert.match(table, /\| value \(required\) \| `'a' \\\| 'b'` \| — \| Pick one\. \|/);
});

test('regenerates marked tables and rejects a name with no props type', async () => {
  const stale = '<!-- api:Switch -->\nold table\n<!-- /api:Switch -->';
  assert.match(await syncApiTables(stale, reader), /\| checked +\|/);
  await assert.rejects(syncApiTables('<!-- api:Nope -->\n<!-- /api:Nope -->', reader), /no NopeProps/);
});
