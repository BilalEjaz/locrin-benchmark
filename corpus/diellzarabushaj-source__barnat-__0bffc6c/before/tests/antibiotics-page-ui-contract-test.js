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

// --- the assets are cache-busted together ----------------------------------
const cssVersion = /antibiotiket\.css\?v=([\w-]+)/.exec(html)?.[1];
const jsVersion = /antibiotiket\.js\?v=([\w-]+)/.exec(html)?.[1];
assert.ok(cssVersion && jsVersion, 'Both page assets must carry a cache-busting version');
assert.equal(cssVersion, jsVersion, 'The page CSS and JS change together, so they share one version');

console.log(`Antibiotics page UI gate passed: both pickers fold below ${BREAKPOINT}px, one hint line, 44px tap targets, ${Object.keys(strengths).length} drugs with listed strengths plus a two-field custom bottle, assets pinned at ${cssVersion}.`);
