import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  findPhantomComponents,
  findStaleSkillNames,
  findUnnamedIconButtons,
} from './agent-docs-guards.mjs';

test('a README component the package does not export is caught', () => {
  const components = [
    { name: 'Button', kind: 'package' },
    { name: 'Carousel', kind: 'package' },
    { name: 'SignInForm', kind: 'template' },
  ];
  const sources = { packageExports: 'export { Button }', templateExports: 'export { SignInForm }' };
  assert.deepEqual(findPhantomComponents(components, sources), ['Carousel']);
});

test('a skill naming a removed API, tool, subpath or file is caught', () => {
  const skill =
    'Use `themeFromSeeds`, `gone_tool`, `get_guide`, `@thewhileloop/whileui/tokens`, ' +
    '`@thewhileloop/whileui/nope`, `dist/agent/llms.txt` and `dist/agent/old.txt`.';
  const stale = findStaleSkillNames(skill, {
    publicApi: 'export function themeFromSeeds() {}',
    mcpServer: "server.registerTool('get_guide', …)",
    subpaths: ['./tokens'],
    agentFiles: ['llms.txt'],
  });
  assert.deepEqual(stale, ['gone_tool', '@thewhileloop/whileui/nope', 'dist/agent/old.txt']);
});

test('an icon button example with no name is caught; named ones pass', () => {
  const docs = `
<Button size="icon"><Icon name="send" /></Button>
<Button size="icon" accessibilityLabel="Send"><Icon name="send" /></Button>
<Button size="icon" onPress={send}>
  <ButtonText>Send</ButtonText>
</Button>
<Button variant="ghost"><Icon name="x" /></Button>`;
  assert.deepEqual(findUnnamedIconButtons(docs), [
    '<Button size="icon"><Icon name="send" /></Button>',
  ]);
});
