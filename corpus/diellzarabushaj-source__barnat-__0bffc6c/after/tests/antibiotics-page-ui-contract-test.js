'use strict';

// The Antibiotikët page is used on a phone at the bedside. Twelve diagnoses and
// seven allergy states cannot all sit open on a 390px screen and still leave
// room for the dose, so below the phone breakpoint each collapses to a row that
// names the current choice. This gate pins that contract — the pickers exist,
// the script folds and reopens them at the breakpoint, the summary row is only
// rendered on a phone, the controls stay thumb-sized — and the strength control
// that turns those doses into mL, whose two numbers are both the clinician's to
// set because bottles differ by market.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(ROOT, file), 'utf8');

const html = read('antibiotiket.html');
const js = read('antibiotiket.js');
const css = read('antibiotiket.css');

const BREAKPOINT = 760;

// --- the markup ------------------------------------------------------------
// Shipped open, so a wide screen renders correctly before any script runs.
for (const id of ['indicationPicker', 'allergyPicker']) {
  const tag = new RegExp(`<details class="abx-picker" id="${id}" open>`);
  assert.match(html, tag, `${id} must ship as an open <details> so a wide screen needs no script`);
}
assert.match(html, /<summary class="abx-picker-summary">[\s\S]*?id="indicationCurrent"/, 'The infection picker needs a summary naming the current choice');
assert.match(html, /<summary class="abx-picker-summary">[\s\S]*?id="allergyCurrent"/, 'The allergy picker needs a summary naming the current choice');
assert.match(html, /id="indicationChoice"[^>]*role="radiogroup"/, 'The chips stay a radiogroup inside the picker');
assert.match(html, /id="allergyChoice"[^>]*role="radiogroup"/, 'The segments stay a radiogroup inside the picker');

// One hint line, and both inputs point at it.
const hintIds = [...html.matchAll(/aria-describedby="([^"]+)"/g)].map(m => m[1]);
assert.deepEqual(
  [...new Set(hintIds)],
  ['contextHint'],
  'The weight and the age share one hint line, so the card is not two paragraphs of grey prose',
);
assert.equal((html.match(/class="abx-hint"/g) || []).length, 1, 'Exactly one hint element in the input card');

// --- the script ------------------------------------------------------------
assert.match(js, new RegExp(`matchMedia\\('\\(max-width:${BREAKPOINT}px\\)'\\)`), `The fold must key off the ${BREAKPOINT}px breakpoint`);
assert.match(js, /function collapsePicker\(picker\)/, 'A picker must be foldable');
assert.match(js, /if \(picker && compact\.matches\) picker\.open = false;/, 'A picker only folds on a phone');
assert.match(js, /function syncPickers\(\)/, 'The summary must track the current choice');
assert.match(js, /if \(compact\.matches\) return;[\s\S]{0,200}indicationPicker\.open = true;/, 'A wide screen must force both pickers open');
assert.match(js, /compact\.addEventListener\('change', onBreakpoint\)/, 'Crossing the breakpoint must re-sync, so nothing is stranded shut');
assert.match(js, /collapsePicker\(el\.indicationPicker\); render\(\);/, 'Choosing a diagnosis folds the list back up');
assert.match(js, /collapsePicker\(el\.allergyPicker\);/, 'Choosing an allergy folds the strip back up');
assert.match(js, /syncPickers\(\);/, 'render() must refresh the summaries');

// --- the stylesheet --------------------------------------------------------
// On a wide screen the summary is the group's label and nothing more: no
// current-value, no chevron, and not clickable.
assert.match(css, /\.abx-picker>summary\{display:block;list-style:none;pointer-events:none\}/, 'The summary is an inert label on a wide screen');
assert.match(css, /\.abx-picker-current\{display:none\}/, 'The current-choice value only shows on a phone');
assert.match(js, /function pinPickerOpen\(picker\)/, 'A wide-screen picker must not be closable');
const mobile = css.slice(css.indexOf(`@media(max-width:${BREAKPOINT}px)`));
assert.ok(mobile.length > 0, `The stylesheet needs a ${BREAKPOINT}px block`);
assert.match(mobile, /\.abx-picker>summary\{\s*display:flex/, 'The summary row appears on a phone');
assert.match(mobile, /\.abx-picker>summary\{[\s\S]*?min-height:48px/, 'The folded row must be thumb-sized');

// Every control the finger lands on clears 44px on a phone.
for (const [selector, rule] of [['.abx-chip', /\.abx-chip\{min-height:44px/], ['.abx-segment', /\.abx-segment\{min-height:44px/], ['.abx-toggle', /\.abx-toggle\{width:100%;min-height:44px\}/]]) {
  assert.match(mobile, rule, `${selector} must clear a 44px tap target on a phone`);
}

// The card's own folds must not reintroduce a wall of text on a phone.
assert.match(js, /make\('details', 'abx-working'\)/, 'The arithmetic stays folded under the answer');
assert.match(read('antibiotiket-formulations.js'), /make\('details', 'abx-formulation'\)/, 'The mg→mL panel stays folded');
assert.match(read('antibiotiket-formulations.js'), /abx-formulation-summary-value/, 'The folded mL panel still shows the volume per dose');

// --- the syrup strength: listed examples, both numbers editable ------------
const formulations = read('antibiotiket-formulations.js');
const formulationsCss = read('antibiotiket-formulations.css');
const prescription = read('antibiotiket-prescription.js');

const sandbox = { window:{} };
// eslint-disable-next-line no-new-func
new Function('window', read('antibiotiket-formulations-data.js'))(sandbox.window);
const strengths = sandbox.window.DRX_ANTIBIOTIC_FORMULATIONS?.drugs || {};
assert.ok(Object.keys(strengths).length >= 10, 'The common market strengths must ship with the page');
for (const [drug, entry] of Object.entries(strengths)) {
  const forms = Array.isArray(entry.forms) ? entry.forms : [];
  assert.ok(forms.length >= 1, `${drug} needs at least one listed strength to start from`);
  for (const form of forms) {
    assert.ok(Number.isFinite(form.mgPer5mL) && form.mgPer5mL > 0, `${drug}/${form.id} needs a numeric mg per 5 mL`);
    assert.match(form.label, /mg \/ (5 )?mL/, `${drug}/${form.id} must read as a bottle strength`);
  }
}

// A bottle is "X mg in Y mL". Both halves are typed; nothing assumes 5 mL.
assert.match(formulations, /function customStrength\(mgInput, mlInput\)/, 'The custom strength must take both numbers');
assert.match(formulations, /mgPer5mL:mg \* 5 \/ ml/, 'A custom strength must be normalised from the typed volume, not assumed to be per 5 mL');
assert.match(formulations, /if \(!Number\.isFinite\(ml\) \|\| ml <= 0\) return null;/, 'A nonsense volume must yield no strength rather than a wrong one');
assert.match(formulations, /customMg\.value = previous \? String\(previous\.mgPer5mL\)/, 'Switching to custom must start from the listed strength on screen');
assert.match(formulationsCss, /\.abx-formulation-custom-field\{/, 'Each half of the strength needs its own field');
assert.match(formulationsCss, /\.abx-formulation-custom input\{width:100%;height:44px\}/, 'The strength fields must be thumb-sized on a phone');

// The starting bottle must be one a syringe can measure. This mirrors
// preferredForm() in the runtime and checks it against the shipped strengths:
// for every drug, the chosen bottle must be the smallest measurable dose
// volume, and never a volume no one would pour.
assert.match(formulations, /function preferredForm\(forms, mg\)/, 'The starting strength must be chosen, not taken as listed first');
assert.match(formulations, /const MEASURABLE_ML = 2\.5;/, 'The measurable floor must be explicit');
assert.match(formulations, /if \(preferred\) select\.value = preferred\.id;/, 'The chosen strength must actually be selected');

const MEASURABLE_ML = 2.5;
const chooseForm = (forms, mg) => {
  const withVolume = forms.map(form => ({ form, ml:mg * 5 / form.mgPer5mL }));
  const measurable = withVolume.filter(item => item.ml >= MEASURABLE_ML);
  return (measurable.length
    ? measurable.reduce((best, item) => (item.ml < best.ml ? item : best))
    : withVolume.reduce((best, item) => (item.ml > best.ml ? item : best)));
};

for (const [drug, entry] of Object.entries(strengths)) {
  const forms = (entry.forms || []).filter(form => !Number.isFinite(form.minWeightKg));
  if (forms.length < 2) continue;
  // A dose sweep wide enough to cover a newborn through an adolescent.
  for (const mg of [25, 50, 125, 250, 500, 900, 1000]) {
    const picked = chooseForm(forms, mg);
    const others = forms.map(form => mg * 5 / form.mgPer5mL);
    const smallestMeasurable = Math.min(...others.filter(ml => ml >= MEASURABLE_ML));
    if (Number.isFinite(smallestMeasurable)) {
      assert.equal(
        Math.round(picked.ml * 100) / 100,
        Math.round(smallestMeasurable * 100) / 100,
        `${drug} at ${mg} mg should start on the smallest measurable volume`,
      );
    } else {
      assert.equal(picked.ml, Math.max(...others), `${drug} at ${mg} mg should fall back to the least concentrated bottle`);
    }
  }
}

// One source of truth: the prescription builder reads the resolved strength
// rather than re-deriving it from the inputs.
assert.match(formulations, /wrap\.dataset\.mgPer5ml = strength \? String\(strength\.mgPer5mL\) : '';/, 'The converter must publish the resolved strength');
assert.match(prescription, /num\(converter\.dataset\.mgPer5ml\)/, 'The prescription builder must read the published strength');
assert.doesNotMatch(
  prescription,
  /abx-formulation-custom input/,
  'The prescription builder must not re-parse the strength inputs behind the converter',
);

// --- every drug: a template for each form, and one you can create ----------
// The clinician needs two numbers per drug: how many mg a tablet holds, and how
// many mg per how many mL the syrup holds. Market templates ship for both, and
// where a template is missing — or the bottle on the shelf differs — the unit
// is typed in once, remembered for that drug, and used everywhere after.
const prescriptionCss = read('antibiotiket-prescription.css');
const solidsSandbox = { window:{} };
// eslint-disable-next-line no-new-func
new Function('window', read('antibiotiket-solids-data.js'))(solidsSandbox.window);
const solids = solidsSandbox.window.DRX_ANTIBIOTIC_SOLIDS?.drugs || {};
assert.ok(Object.keys(solids).length >= 10, 'Tablet templates must ship with the page');
for (const [drug, entry] of Object.entries(solids)) {
  for (const form of entry.forms || []) {
    assert.ok(Number.isFinite(form.componentMg) && form.componentMg > 0, `${drug}/${form.id} needs mg per unit`);
    assert.ok(form.label, `${drug}/${form.id} needs a label a prescriber can read`);
  }
}

// Both routes reach every ORAL regimen; a topical one keeps neither.
assert.match(prescription, /const isOralCard = card => routeFromCard\(card\) === 'PO';/, 'The product picker must key off the route');
assert.match(prescription, /const hasSolid = isOralCard\(card\);/, 'An oral regimen always offers the tablet route');
assert.match(prescription, /if \(!isOralCard\(card\)\) return;/, 'A non-oral regimen gets no oral product picker');
assert.match(formulations, /const entry = drugConfig\(drug\) \|\| \{\};/, 'A drug with no listed suspension must still get a mg→mL converter');

// The picker is never an empty control, and a unit that cannot divide the dose
// is shown as such rather than hidden.
assert.match(prescription, /mine\.textContent = options\.length \? 'Njësia ime…' : 'Shkruaj njësinë reale…';/, 'The tablet picker always offers a custom unit');
assert.match(prescription, /nuk pjesëtohet në njësi të plota/, 'A unit that does not divide the dose must say so');
assert.doesNotMatch(
  prescription,
  /if \(!matches\.length\) return \{ matches, selected:null \};/,
  'The tablet picker must not bail out before rendering its options',
);

// A typed unit is remembered per drug, so the same numbers are never re-entered.
assert.match(prescription, /const PRODUCTS_KEY = 'drx\.antibiotics\.products\.v1';/, 'Typed products must have a storage key');
assert.match(prescription, /function saveSolid\(drug, mg, form\)/, 'A typed unit must be stored against its drug');
assert.match(prescription, /all\[drug\] = \{ \.\.\.\(all\[drug\] \|\| \{\}\), solid:\{ mg, form \} \};/, 'Storage must be keyed per drug, never shared between drugs');
assert.match(prescription, /const mine = customSolidForm\(saved\.mg, saved\.form\);\s*\n\s*return mine \? \[mine, \.\.\.listed\] : listed;/, 'A remembered unit must lead the list');
assert.match(prescriptionCss, /\.abx-rx-solid-custom\{/, 'The custom unit fields need styling');
assert.match(prescriptionCss, /\.abx-rx-solid-custom input,\.abx-rx-solid-custom select\{height:44px\}/, 'The custom unit fields must be thumb-sized on a phone');

// Templates that are market-typical rather than label-verified must say so.
const typical = Object.entries(strengths).flatMap(([drug, entry]) =>
  (entry.forms || []).filter(form => form.marketTypical).map(form => `${drug}/${form.id}`));
assert.ok(typical.length > 0, 'The gap-filling suspension templates must be present');
for (const [drug, entry] of Object.entries(strengths)) {
  for (const form of entry.forms || []) {
    assert.ok(
      form.sourceUrl || form.marketTypical,
      `${drug}/${form.id} must either cite a label or be marked market-typical`,
    );
  }
}
assert.match(formulations, /Fuqi tipike e tregut, pa etiketë të verifikuar/, 'A market-typical template must never read as a sourced claim');

// --- the assets are cache-busted together ----------------------------------
const cssVersion = /antibiotiket\.css\?v=([\w-]+)/.exec(html)?.[1];
const jsVersion = /antibiotiket\.js\?v=([\w-]+)/.exec(html)?.[1];
assert.ok(cssVersion && jsVersion, 'Both page assets must carry a cache-busting version');
assert.equal(cssVersion, jsVersion, 'The page CSS and JS change together, so they share one version');

console.log(`Antibiotics page UI gate passed: both pickers fold below ${BREAKPOINT}px, one hint line, 44px tap targets, ${Object.keys(strengths).length} drugs with syrup templates and ${Object.keys(solids).length} with tablet templates, a creatable unit remembered per drug, assets pinned at ${cssVersion}.`);
