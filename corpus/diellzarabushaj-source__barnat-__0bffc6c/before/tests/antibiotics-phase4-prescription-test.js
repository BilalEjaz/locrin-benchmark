'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(ROOT, file), 'utf8');

const sandbox = { window:{} };
// eslint-disable-next-line no-new-func
new Function('window', read('antibiotiket-solids-data.js'))(sandbox.window);
const solids = sandbox.window.DRX_ANTIBIOTIC_SOLIDS;
assert.ok(solids, 'Phase 4 solid formulation dataset must load');
assert.match(solids.version, /phase4-solids/, 'Phase 4 solids version must be explicit');

for (const [drug, entry] of Object.entries(solids.drugs)) {
  assert.ok(Array.isArray(entry.forms) && entry.forms.length > 0, `${drug}: solid forms missing`);
  for (const form of entry.forms) {
    assert.ok(Number.isFinite(form.componentMg) && form.componentMg > 0, `${drug}/${form.id}: componentMg must be positive`);
    assert.match(form.sourceUrl || '', /^https:\/\//, `${drug}/${form.id}: official label URL required`);
    assert.ok(!/half|1\/2/i.test(form.autoUnits || ''), `${drug}/${form.id}: automatic splitting is forbidden`);
  }
}

assert.ok(solids.drugs['Penicillin V'].forms.some(form => form.componentMg === 250));
assert.ok(solids.drugs.Amoxicillin.forms.some(form => form.componentMg === 500));
assert.ok(solids.drugs.Cephalexin.forms.some(form => form.componentMg === 250));
assert.ok(solids.drugs.Cefixime.forms.some(form => form.componentMg === 400));
assert.ok(solids.drugs['Trimethoprim / sulfamethoxazole'].forms.some(form => form.componentMg === 160));
assert.equal(solids.drugs['Amoxicillin / clavulanate'].forms.length, 1, 'Amox/clav auto solid matching is intentionally restricted');
assert.equal(solids.drugs['Amoxicillin / clavulanate'].forms[0].singleUnitOnly, true, 'Amox/clav must not multiply tablets automatically');

for (const indication of ['aom','sinusitis','uti-cystitis','uti-pyelo']) {
  assert.equal(solids.indicationOverrides[`${indication}|Amoxicillin / clavulanate`]?.disabled, true, `${indication}: amox/clav solid auto-match must be disabled`);
}
for (const indication of ['cellulitis','preseptal','bite','lymphadenitis']) {
  assert.deepEqual(solids.indicationOverrides[`${indication}|Amoxicillin / clavulanate`]?.allow, ['amoxclav-tab-875-125']);
}

const runtime = read('antibiotiket-prescription.js');
assert.match(runtime, /Shkruaj peshën reale/, 'Weight-based prescription finalization must require real weight');
assert.match(runtime, /Zgjidh dozën finale brenda intervalit/, 'Range regimens must require clinician-selected final dose');
assert.match(runtime, /Nuk ka përputhje të saktë me njësi të plota/, 'Solid forms must hard-stop when no exact whole-unit match exists');
assert.match(runtime, /singleUnitOnly/, 'Combination product solid matching must respect single-unit safety');
assert.match(runtime, /Sasia matematike e kursit/, 'Course quantity must be labelled as mathematical, not automatic package selection');
assert.match(runtime, /Kopjo tekstin/, 'Prescription copy action must be present');
assert.match(runtime, /navigator\.clipboard/, 'Clipboard copy implementation must exist');
assert.doesNotMatch(runtime, /Math\.round\([^\n]+componentMg[^\n]+\)\s*\/\s*2/, 'Runtime must not invent half-tablet rounding');

const shell = read('antibiotiket-shell.js');
assert.match(shell, /antibiotiket-solids-data\.js\?v=antibiotiket-phase4-v1/);
assert.match(shell, /antibiotiket-prescription\.js\?v=antibiotiket-phase4-v2/);
// v2: the fold-out summary was restyled to match the other two folds on a card.
assert.match(shell, /antibiotiket-prescription\.css\?v=antibiotiket-phase4-v2/);

const css = read('antibiotiket-prescription.css');
assert.match(css, /\.abx-rx\{/);
assert.match(css, /\.abx-rx-copy/);
assert.match(css, /@media\(max-width:560px\)/, 'Phase 4 finalizer must remain mobile-friendly');

console.log(`Antibiotics Phase 4 gate passed: ${Object.keys(solids.drugs).length} drugs with exact-match solid forms and prescription safety rules.`);
