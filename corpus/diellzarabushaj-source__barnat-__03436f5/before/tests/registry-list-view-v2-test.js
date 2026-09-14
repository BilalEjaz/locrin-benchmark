'use strict';

// Barnat can be read as a table or as a list. The list is not a second copy of
// the registry: it is the same rows, the same filters, the same actions, drawn
// in another shape. This gate pins the parts of that which are easy to break.
//
// The legacy list runtime (registry-list-view.js, an ATC browse tree) was
// retired and is on the build's deny-list; this view lives inside registry-v2.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(ROOT, file), 'utf8');

const html = read('index.html');
const js = read('registry-v2.js');
const css = read('registry-v2.css');

// --- the control and the container -----------------------------------------
assert.match(html, /<div class="view-toggle" id="viewToggle" role="group"/, 'The page needs a view toggle');
assert.match(html, /<button type="button" data-view="table"/, 'The toggle must offer the table');
assert.match(html, /<button type="button" data-view="list"/, 'The toggle must offer the list');
assert.match(html, /<div class="registry-list" id="registryList" hidden><\/div>/, 'The list needs its own container');

// --- the shape is its own state, not the workspace -------------------------
// state.view already selects the workspace (registry / favorites / notes).
// Reusing it for the row shape silently broke the list; keep them apart.
assert.match(js, /rowView: storedRowView\(\)/, 'The row shape needs its own state field');
assert.match(js, /const ROW_VIEW_STORAGE_KEY = 'drx_registry_v2_row_view';/, 'The row shape needs its own storage key');
assert.doesNotMatch(js, /state\.view = 'list'|state\.view === 'list'/, 'The row shape must never be stored on state.view');
assert.match(js, /state\.view === 'registry'/, 'state.view must still mean the workspace');
assert.match(js, /document\.documentElement\.dataset\.registryRowView = state\.rowView;/, 'The shape on screen must be readable from the document');

// --- one view holds rows at a time -----------------------------------------
// Every per-row lookup in this file addresses a single element, so two copies
// of a row would leave one of them stale.
assert.match(js, /function renderListCards\(\)/, 'The list must have a renderer');
assert.match(
  js,
  /if \(state\.rowView === 'list'\) \{\s*\n\s*el\.registryRows\.innerHTML = '';/,
  'Rendering the list must empty the table body',
);
assert.match(js, /el\.registryList\.innerHTML = '';\s*\n\s*el\.registryRows\.innerHTML = state\.rows\.map/, 'Rendering the table must empty the list');
assert.match(js, /const node = document\.querySelector\(`\[data-row-id="\$\{CSS\.escape\(key\)\}"\]`\);/, 'Selection must address a row in either shape');

// --- the list keeps every action the table row has -------------------------
const cards = js.slice(js.indexOf('function renderListCards()'), js.indexOf('function renderRows()'));
for (const hook of ['data-select-row', 'data-open-row', 'data-row-favorite', 'data-row-note', 'data-dose-calculator-open', 'data-dose-adult', 'data-dose-pediatric']) {
  assert.ok(cards.includes(hook), `A list card must keep ${hook}, so the existing handlers reach it`);
}
assert.match(js, /el\.registryList\.addEventListener\('click', event => rowContainerClick\(event\)\);/, 'The list must share the row click handler');
assert.match(js, /el\.registryRows\.addEventListener\('click', event => rowContainerClick\(event\)\);/, 'The table must share the same handler');
assert.match(js, /el\.registryList\.addEventListener\('keydown'/, 'A card must open on Enter or Space');

// --- the column picker governs both shapes ---------------------------------
assert.match(js, /function listField\(colId, label, valueHtml\)/, 'List fields must be built with their column id');
assert.match(js, /data-col="\$\{escapeHtml\(colId\)\}"/, 'A list field must carry data-col so column visibility applies');
for (const col of ['substance', 'strength', 'population', 'status', 'atc', 'registry', 'price', 'adultDose', 'pediatricDose']) {
  assert.ok(cards.includes(`data-col="${col}"`), `The list must tag ${col} so hiding that column hides it here too`);
}

// --- a phone opens on the list ---------------------------------------------
assert.match(js, /matchMedia\('\(max-width:760px\)'\)\.matches\) return 'list';/, 'A narrow screen should open on the list');

// --- styling, including the phone ------------------------------------------
assert.match(css, /\.registry-list-card\{/, 'The cards need styling');
assert.match(css, /\.view-toggle button\.is-active\{/, 'The active view must be visible on the toggle');
const mobile = css.slice(css.lastIndexOf('@media(max-width:760px)'));
assert.match(mobile, /\.registry-list-grid\{grid-template-columns:minmax\(0,1fr\)/, 'The card grid must collapse to one column on a phone');
assert.match(mobile, /\.view-toggle button\{flex:1;min-height:40px\}/, 'The toggle must be thumb-sized on a phone');

// --- the retired runtime stays retired -------------------------------------
assert.doesNotMatch(html, /registry-list-view\.(js|css)/, 'The legacy list runtime is on the build deny-list and must not come back');
const audit = read('scripts/audit-registry-v2.js');
assert.ok(audit.includes("'registry-list-view.css'"), 'The build must keep denying the legacy list stylesheet');

// --- the assets are cache-busted together ----------------------------------
const cssVersion = /registry-v2\.css\?v=([\w-]+)/.exec(html)?.[1];
const jsVersion = /registry-v2\.js\?v=([\w-]+)/.exec(html)?.[1];
assert.ok(cssVersion && jsVersion, 'Both registry assets must carry a cache-busting version');
assert.equal(cssVersion, jsVersion, 'The registry CSS and JS change together, so they share one version');

console.log(`Registry list view gate passed: table and list share rows, actions and columns; row shape kept off state.view; assets pinned at ${cssVersion}.`);
