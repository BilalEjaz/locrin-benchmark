// Static check that the public API is documented: every runtime export of a package has a Docs page
// (or an explicit section of one), every public Docs page is reachable from its Introduction, and
// every Docs link of an Introduction points to a page that exists. Reads sources only, no build.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import ts from 'typescript';

/**
 * Runtime exports with no `component`/`subcomponents` entry in a stories file: export name -> titles of
 * the Docs pages (or sections of a page) that document it. Each listed page must exist and its source
 * must mention the export name, so the claim cannot rot silently.
 */
export const DOCUMENTED_IN = {
  // Foundations
  Title: ['Foundations/Typography'],
  cn: ['Foundations/Utilities'],
  composeRefs: ['Foundations/Utilities'],
  // Forms
  useFieldControl: ['Forms/Field'],
  ValidationProvider: ['Floorplans/Object Page/Validation'],
  useCombobox: ['Forms/Combobox'],
  defaultComboboxFilter: ['Forms/Combobox'],
  // Overlays
  TooltipProvider: ['Overlays/Tooltip'],
  useConfirmDialog: ['Overlays/ConfirmDialog'],
  useToast: ['Overlays/Toast'],
  // Data and floorplans
  DescriptionList: ['Data/DescriptionList'],
  DescriptionListItem: ['Data/DescriptionList'],
  DescriptionListStatus: ['Data/DescriptionList'],
  useListReport: ['Floorplans/List Report'],
  useListReportScrollRestoration: ['Floorplans/List Report'],
  useListReportUrlState: ['Floorplans/List Report'],
  useObjectPageForm: ['Floorplans/Object Page/Validation'],
  getErrorSummary: ['Floorplans/Object Page/Footer'],
  useFocusFirstInvalidField: ['Floorplans/Object Page/Validation'],
  useDirtyGuard: ['Patterns/DirtyGuard'],
  // Pro
  ChangeSummary: ['Pro/ChangeSummary'],
  computeChangeSummary: ['Pro/ChangeSummary'],
  useChangeSummary: ['Pro/ChangeSummary'],
  inferSegmentLabel: ['Pro/ChangeSummary'],
  formatChangeValue: ['Pro/ChangeSummary'],
  computeRebase: ['Pro/Patterns/Form rebase'],
  useFormRebase: ['Pro/Patterns/Form rebase'],
  VirtualListReport: ['Pro/Floorplans/Virtual List Report'],
  VirtualListReportTable: ['Pro/Floorplans/Virtual List Report'],
};

/** Storybook's id sanitizer for titles. */
export function sanitize(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** Docs page id Storybook generates for a title. */
export const docsId = (title) => `${sanitize(title)}--docs`;

function walk(dir, accept, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'dist') continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, accept, out);
    else if (accept(name)) out.push(path);
  }
  return out;
}

/** Names of the runtime (non type-only) exports of an `index.ts` source. */
export function runtimeExports(source) {
  const file = ts.createSourceFile('index.ts', source, ts.ScriptTarget.Latest, true);
  const names = [];
  for (const node of file.statements) {
    if (!ts.isExportDeclaration(node) || node.isTypeOnly || !node.exportClause) continue;
    if (!ts.isNamedExports(node.exportClause)) continue;
    for (const spec of node.exportClause.elements) if (!spec.isTypeOnly) names.push(spec.name.text);
  }
  return names;
}

const stripWrappers = (node) => {
  let current = node;
  while (current && (ts.isAsExpression(current) || ts.isSatisfiesExpression(current) || ts.isParenthesizedExpression(current))) {
    current = current.expression;
  }
  return current;
};

const propName = (prop) => (prop.name && (ts.isIdentifier(prop.name) || ts.isStringLiteral(prop.name)) ? prop.name.text : null);

function metaObject(file) {
  let target;
  for (const node of file.statements) {
    if (ts.isExportAssignment(node)) target = stripWrappers(node.expression);
  }
  if (target && ts.isIdentifier(target)) {
    const wanted = target.text;
    for (const node of file.statements) {
      if (!ts.isVariableStatement(node)) continue;
      for (const decl of node.declarationList.declarations) {
        if (ts.isIdentifier(decl.name) && decl.name.text === wanted && decl.initializer) target = stripWrappers(decl.initializer);
      }
    }
  }
  return target && ts.isObjectLiteralExpression(target) ? target : null;
}

/** The title, documented components and Docs eligibility declared by a stories file; `null` without a meta title. */
export function parseStoriesFile(source) {
  const file = ts.createSourceFile('x.stories.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const meta = metaObject(file);
  if (!meta) return null;
  let title = null;
  const components = [];
  let autodocs = true;
  for (const prop of meta.properties) {
    if (!ts.isPropertyAssignment(prop)) continue;
    const name = propName(prop);
    const value = stripWrappers(prop.initializer);
    if (name === 'title' && ts.isStringLiteralLike(value)) title = value.text;
    if (name === 'component' && ts.isIdentifier(value)) components.push(value.text);
    if (name === 'subcomponents' && ts.isObjectLiteralExpression(value)) {
      for (const sub of value.properties) {
        const subName = ts.isShorthandPropertyAssignment(sub) ? sub.name.text : ts.isPropertyAssignment(sub) ? propName(sub) : null;
        if (subName) components.push(subName);
      }
    }
    if (name === 'tags' && ts.isArrayLiteralExpression(value)) {
      if (value.elements.some((el) => ts.isStringLiteralLike(el) && el.text === '!autodocs')) autodocs = false;
    }
  }
  return title === null ? null : { title, components, autodocs };
}

const MDX_TITLE = /<Meta\s+title=["']([^"']+)["']/;

/** Docs pages of a package: `{ title, id, components, source, file }`. */
export function collectPages(root, packageDir, mdxFiles = []) {
  const pages = [];
  for (const path of walk(join(root, packageDir, 'src'), (n) => n.endsWith('.stories.tsx'))) {
    const source = readFileSync(path, 'utf8');
    const parsed = parseStoriesFile(source);
    if (!parsed || !parsed.autodocs) continue;
    const id = docsId(parsed.title);
    const existing = pages.find((p) => p.id === id);
    if (existing) {
      // Several stories files can share one title: one Docs page.
      existing.components.push(...parsed.components);
      existing.source += `\n${source}`;
    } else {
      pages.push({ title: parsed.title, id, components: [...parsed.components], source, file: relative(root, path) });
    }
  }
  for (const mdx of mdxFiles) {
    const source = readFileSync(join(root, mdx), 'utf8');
    const title = MDX_TITLE.exec(source)?.[1];
    if (title) pages.push({ title, id: docsId(title), components: [], source, file: mdx, mdx: true });
  }
  return pages;
}

/** Ids of the `?path=/docs/<id>` links of an MDX source. */
export function docsLinks(mdxSource) {
  return [...mdxSource.matchAll(/\?path=\/docs\/([a-z0-9-]+)/g)].map((m) => m[1]);
}

const mentions = (source, name) => new RegExp(`(^|[^\\w$])${name.replace(/\$/g, '\\$')}([^\\w$]|$)`).test(source);

/**
 * (a) Runtime exports with no Docs page: not a `component`/`subcomponents` of a page and not listed
 * in `documentedIn` (or listed with a page that does not exist or never mentions the export).
 */
export function undocumentedExports(exportNames, pages, documentedIn = DOCUMENTED_IN) {
  const problems = [];
  const covered = new Set(pages.flatMap((p) => p.components));
  const byTitle = new Map(pages.map((p) => [p.title, p]));
  for (const name of exportNames) {
    if (covered.has(name)) continue;
    // A part of a documented compound component (`DialogTitle` of `Dialog`): its page shows it by name.
    if (pages.some((p) => p.components.some((c) => name.startsWith(c) && mentions(p.source, name)))) continue;
    const titles = documentedIn[name];
    if (!titles) {
      problems.push(`${name}: exported but not documented (no Docs page with it as component/subcomponent, no entry in DOCUMENTED_IN)`);
      continue;
    }
    for (const title of titles) {
      const page = byTitle.get(title);
      if (!page) problems.push(`${name}: DOCUMENTED_IN points to "${title}", which is not a Docs page`);
      else if (!mentions(page.source, name)) problems.push(`${name}: DOCUMENTED_IN points to "${title}", whose source never mentions it`);
    }
  }
  return problems;
}

/** (b) Docs pages the Introduction does not link to. */
export function unlinkedPages(pages, introSource, introTitle) {
  const linked = new Set(docsLinks(introSource));
  return pages.filter((p) => p.title !== introTitle && !linked.has(p.id)).map((p) => `${p.id}: Docs page not linked from "${introTitle}"`);
}

/** (c) Docs links of the Introduction that point to no page. */
export function brokenLinks(pages, introSource, introTitle) {
  const ids = new Set(pages.map((p) => p.id));
  return docsLinks(introSource)
    .filter((id) => !ids.has(id))
    .map((id) => `${id}: link in "${introTitle}" points to a Docs page that does not exist`);
}
