import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { toId } from 'storybook/internal/csf';
import {
  DOCUMENTED_IN,
  brokenLinks,
  collectPages,
  docsId,
  docsLinks,
  parseStoriesFile,
  runtimeExports,
  stripComments,
  undocumentedExports,
  unlinkedPages,
} from './docs-coverage.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (path) => readFileSync(resolve(ROOT, path), 'utf8');

const coreExports = runtimeExports(read('packages/core/src/index.ts'));
const proExports = runtimeExports(read('packages/pro/src/index.ts'));
const corePages = collectPages(ROOT, 'packages/core', ['.storybook/Introduction.mdx']);
const proPages = collectPages(ROOT, 'packages/pro', ['.storybook/ProIntroduction.mdx']);
const INTRO = read('.storybook/Introduction.mdx');
const PRO_INTRO = read('.storybook/ProIntroduction.mdx');

describe('docs coverage of the public API', () => {
  it('reads the runtime exports of both packages (types excluded)', () => {
    expect(coreExports).toEqual(expect.arrayContaining(['Input', 'Field', 'cn', 'useCombobox']));
    expect(coreExports).not.toContain('InputProps');
    expect(proExports.length).toBeGreaterThan(0);
  });

  it('(a) every runtime export of core is documented', () => {
    expect(undocumentedExports(coreExports, corePages)).toEqual([]);
  });

  it('(a) every runtime export of pro is documented', () => {
    expect(undocumentedExports(proExports, proPages)).toEqual([]);
  });

  it('DOCUMENTED_IN lists only names a package exports', () => {
    const all = new Set([...coreExports, ...proExports]);
    expect(Object.keys(DOCUMENTED_IN).filter((name) => !all.has(name))).toEqual([]);
  });

  it('(b) every public Docs page of core is linked from the Introduction', () => {
    expect(unlinkedPages(corePages, INTRO, 'Introduction')).toEqual([]);
  });

  it('(b) every Pro Docs page is linked from the Pro introduction', () => {
    expect(unlinkedPages(proPages, PRO_INTRO, 'Pro introduction')).toEqual([]);
  });

  it('(c) every Docs link of the Introductions points to an existing page', () => {
    expect(brokenLinks(corePages, INTRO, 'Introduction')).toEqual([]);
    expect(brokenLinks(proPages, PRO_INTRO, 'Pro introduction')).toEqual([]);
  });

  it('the Introduction has a Guides row and the Forms/Input page exists', () => {
    expect(INTRO).toMatch(/\*\*Guides\*\*/);
    expect(corePages.map((p) => p.id)).toContain('forms-input--docs');
  });
});

describe('docs coverage: the guard itself', () => {
  const pages = [
    { title: 'Forms/Input', id: 'forms-input--docs', components: ['Input'], source: 'Input' },
    { title: 'Foundations/Utilities', id: 'foundations-utilities--docs', components: [], source: 'cn(a)' },
  ];

  it('(a) names a fake export that has no page', () => {
    expect(undocumentedExports(['Input', 'FakeWidget'], pages, {})).toEqual([
      expect.stringContaining('FakeWidget: exported but not documented'),
    ]);
  });

  it('(a) accepts an explicit "documented in" entry, and rejects one whose page does not mention the name', () => {
    expect(undocumentedExports(['cn'], pages, { cn: ['Foundations/Utilities'] })).toEqual([]);
    expect(undocumentedExports(['composeRefs'], pages, { composeRefs: ['Foundations/Utilities'] })).toEqual([
      expect.stringContaining('never mentions it'),
    ]);
    expect(undocumentedExports(['cn'], pages, { cn: ['Nowhere/Page'] })).toEqual([expect.stringContaining('not a Docs page')]);
  });

  it('(b) names a page the Introduction does not link', () => {
    expect(unlinkedPages(pages, '[Input](?path=/docs/forms-input--docs)', 'Introduction')).toEqual([
      expect.stringContaining('foundations-utilities--docs'),
    ]);
  });

  it('(c) names a link to a page that does not exist', () => {
    const intro = '[Input](?path=/docs/forms-input--docs) [Gone](?path=/docs/forms-gone--docs)';
    expect(brokenLinks(pages, intro, 'Introduction')).toEqual([expect.stringContaining('forms-gone--docs')]);
  });

  it('parses a meta with component, subcomponents, wrapped values and !autodocs', () => {
    const parsed = parseStoriesFile(
      "const meta: Meta = { title: 'A/B c', component: X as never, subcomponents: { Y, Z: Z }, tags: ['x'] }; export default meta;",
    );
    expect(parsed).toEqual({ title: 'A/B c', components: ['X', 'Y', 'Z'], autodocs: true });
    expect(parseStoriesFile("export default { title: 'I/J', tags: ['!autodocs', 'internal'] };")?.autodocs).toBe(false);
    expect(docsId('Floorplans/Object Page/Layout')).toBe('floorplans-object-page-layout--docs');
    expect(docsLinks('(?path=/docs/a-b--docs) (?path=/story/a-b--c)')).toEqual(['a-b--docs']);
  });
});

describe('docs coverage: id sanitization (#416)', () => {
  const titles = [
    'Forms/My_Field',
    'Forms/Input',
    'Pro/Patterns/Form rebase',
    'Forms/Café',
    'Überblick/Ünïcode_Åpp',
    'A//B',
    'A/_x_/B',
    'Foo.Bar/Baz-Qux (beta)',
    'Forms/It’s — here',
    '_A/b_',
  ];

  it.each(titles)('docsId(%j) matches the id Storybook itself generates', (title) => {
    expect(docsId(title)).toBe(toId(title, 'Docs'));
  });

  it('keeps letters outside a-z, as Storybook does, and links to them resolve', () => {
    expect(docsId('Forms/Café')).toBe('forms-café--docs');
    const page = { title: 'Forms/Café', id: docsId('Forms/Café'), components: [], source: '' };
    expect(brokenLinks([page], '(?path=/docs/forms-café--docs)', 'Introduction')).toEqual([]);
    expect(unlinkedPages([page], '(?path=/docs/forms-café--docs)', 'Introduction')).toEqual([]);
  });

  it('turns an underscore into a hyphen (Forms/My_Field -> forms-my-field--docs)', () => {
    expect(docsId('Forms/My_Field')).toBe('forms-my-field--docs');
  });
});

describe('docs coverage: compound-component heuristic (#416)', () => {
  const page = (source) => ({ title: 'Forms/Field', id: 'forms-field--docs', components: ['Field'], source });

  it('does not accept FieldGroup because a comment of the Field page mentions it', () => {
    const pages = [page('// TODO: document FieldGroup\n/* FieldGroup */\nexport const S = () => <Field />;')];
    expect(undocumentedExports(['Field', 'FieldGroup'], pages, {})).toEqual([
      expect.stringContaining('FieldGroup: exported but not documented'),
    ]);
  });

  it('does not accept a comment inside JSX either', () => {
    const pages = [page('export const S = () => <Field>{/* FieldGroup later */}</Field>;')];
    expect(undocumentedExports(['FieldGroup'], pages, {})).toHaveLength(1);
  });

  it('does not accept a name that merely starts with a component name (Fieldset, Fields)', () => {
    const pages = [page('export const S = () => (<><Field /><Fieldset /><Fields /></>);')];
    expect(undocumentedExports(['Fieldset', 'Fields'], pages, {})).toHaveLength(2);
  });

  it('still accepts a real part of a compound component used in code', () => {
    const pages = [{ ...page('export const S = () => <Dialog><DialogTitle>x</DialogTitle></Dialog>;'), components: ['Dialog'] }];
    expect(undocumentedExports(['DialogTitle'], pages, {})).toEqual([]);
  });

  it('a DOCUMENTED_IN claim is not satisfied by a comment mention', () => {
    const pages = [
      { title: 'Foundations/Utilities', id: 'u--docs', components: [], source: '// composeRefs is documented elsewhere\ncn(a)' },
    ];
    expect(undocumentedExports(['composeRefs'], pages, { composeRefs: ['Foundations/Utilities'] })).toEqual([
      expect.stringContaining('never mentions it'),
    ]);
  });

  it('stripComments keeps code, strings and line numbers', () => {
    const src = "const a = 'http://x'; // gone\n/* gone\ntoo */ const b = `// kept`;";
    const out = stripComments(src);
    expect(out).toContain("'http://x'");
    expect(out).toContain('`// kept`');
    expect(out).not.toContain('gone');
    expect(out.split('\n')).toHaveLength(3);
    expect(out).toHaveLength(src.length);
  });
});
