'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ROOT = path.resolve(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');

const sandbox = { window:{ addEventListener(){} } };
const load = f => { new Function('window', read(f))(sandbox.window); }; // eslint-disable-line no-new-func
load('antibiotiket-data.js');
load('antibiotiket-formulations-data.js');
load('antibiotiket-solids-data.js');
load('antibiotiket-hospital-data.js');
load('antibiotiket-parenteral-prep-data.js');
new Function('window','document','MutationObserver', read('antibiotiket-parenteral-prep.js'))( // eslint-disable-line no-new-func
  sandbox.window,
  { getElementById(){return null;}, querySelectorAll(){return [];}, createElement(){return {};} },
  function(){}
);

const guide = sandbox.window.DRX_ANTIBIOTIC_GUIDE;
const liquids = sandbox.window.DRX_ANTIBIOTIC_FORMULATIONS;
const solids = sandbox.window.DRX_ANTIBIOTIC_SOLIDS;
const hospital = sandbox.window.DRX_ANTIBIOTIC_HOSPITAL;
const prepData = sandbox.window.DRX_ANTIBIOTIC_PARENTERAL_PREP;
const prepEngine = sandbox.window.DRX_ANTIBIOTIC_PREP_ENGINE;
const dx = id => guide.indications.find(x => x.id === id);
const hosp = id => hospital.regimens.find(x => x.id === id);
const prep = id => prepData.preparations.find(x => x.id === id);
const form = (drug,id) => liquids.drugs[drug].forms.find(x => x.id === id);
const ml = (mg,f) => mg * 5 / f.mgPer5mL;
const cap = (kg,mgKg,max) => Math.min(kg*mgKg,max);
let passed = 0;
const tc = (id,fn) => { fn(); passed += 1; console.log(`${id}: PASS`); };

tc('T001',()=>{ const mg=cap(12,50,1000); assert.equal(mg,600); assert.equal(ml(mg,form('Amoxicillin','amox-250-5')),12); });
tc('T002',()=>{ const mg=cap(55,50,1000); assert.equal(mg,1000); assert.equal(ml(mg,form('Amoxicillin','amox-400-5')),12.5); });
tc('T003',()=>{ assert.equal(liquids.drugs['Trimethoprim / sulfamethoxazole'].basis,'trimethoprim'); assert.equal(ml(80,form('Trimethoprim / sulfamethoxazole','tmpsmx-40-200-5')),10); });
tc('T004',()=>{ const pen=dx('gas').options.find(x=>x.id==='penicillin-gas'); assert.equal(pen.dose.type,'fixed'); assert.equal(pen.dose.text,'250 mg/dozë'); assert.equal(ml(250,form('Penicillin V','penv-250-5')),5); });
tc('T005',()=>{ const d=prepEngine.doseForRegimen(hosp('H005'),20,'Ceftriaxone',12); const r=prepEngine.calculatePreparation({prep:prep('IV001'),regimenRoute:'IV',dose:d,exactProductConfirmed:true}); assert.equal(d.value,1000); assert.equal(r.rawStockMl,10); assert.equal(r.gate,'ALLOW'); });
tc('T006',()=>{ const r=prepEngine.calculatePreparation({prep:prep('IV002'),regimenRoute:'IV',dose:{kind:'mg',value:1000},exactProductConfirmed:true,stockChoiceMgPerMl:250}); assert.equal(r.gate,'HARD_BLOCK_ROUTE'); assert.match(prep('IV002').safety,/NEVER IV/i); });
tc('T007',()=>{ const r=prepEngine.calculatePreparation({prep:prep('IV019'),regimenRoute:'IV',dose:{kind:'units',value:600000},exactProductConfirmed:true}); assert.equal(r.gate,'HARD_BLOCK_ROUTE'); assert.match(prep('IV019').routeLabel,/IM ONLY/); });
tc('T008',()=>{ assert.equal(solids.drugs.Cefuroxime,undefined); assert.match(read('antibiotiket-prescription.js'),/përputhje të saktë|njësi të plota/i); });
tc('T009',()=>{ const beta=new Set(['Amoxicillin','Amoxicillin / clavulanate','Cephalexin','Cefpodoxime','Cefdinir','Cefixime','Cefuroxime','Penicillin V','Cefadroxil','Ceftriaxone','Cefazolin','Ampicillin','Ampicillin/sulbactam']); const bad=[]; guide.indications.forEach(i=>(i.options||[]).forEach(o=>{if((o.allergy||[]).includes('a3')&&beta.has(o.drug))bad.push(`${i.id}:${o.drug}`);})); assert.deepEqual(bad,[]); });
tc('T010',()=>{ assert.equal(dx('uti-pyelo').options.some(x=>x.drug==='Nitrofurantoin'),false); assert.ok(form('Nitrofurantoin','nitro-25-5')); });
tc('T011',()=>{ assert.equal(dx('aom').minAgeMonths,6); const js=read('antibiotiket.js');
  // The AOM age threshold must reach the UI in both directions: an unknown age
  // states the limit and still shows the table, a known age below it withholds
  // the regimen entirely.
  assert.match(js,/blocks:false[\s\S]{0,120}Kjo skemë vlen për moshën ≥\$\{threshold\}/);
  assert.match(js,/blocks:true[\s\S]{0,200}kërkon moshën ≥\$\{threshold\}/);
  assert.match(js,/if \(limit\?\.blocks\) return;/); });
tc('T012',()=>{ const capsule=solids.drugs.Amoxicillin.forms.find(x=>x.id==='amox-cap-500'); assert.ok(capsule); assert.equal(capsule.componentMg,500); assert.match(capsule.form,/kapsul/i); assert.equal(500/capsule.componentMg,1); });
tc('T013',()=>{ assert.equal(solids.drugs.Amoxicillin.forms.some(x=>x.componentMg===600),false); const rx=read('antibiotiket-prescription.js');
  // No whole-unit match must still hard-stop, and must never round to a fraction
  // of a tablet — the wording of the message is free to change, the stop is not.
  assert.match(rx,/if \(!selected\) \{[\s\S]{0,900}?return null;/);
  assert.match(rx,/nuk pjesëtohet në njësi të plota/);
  assert.doesNotMatch(rx,/Math\.round\([^\n]+componentMg[^\n]+\)\s*\/\s*2/); });
tc('T014',()=>{ assert.equal(hosp('H016').autoVisible,false); assert.equal(hosp('H016').dose.type,'tdm'); const r=prepEngine.calculatePreparation({prep:prep('IV014'),regimenRoute:'IV',dose:{kind:'mg',value:500},exactProductConfirmed:true}); assert.equal(r.gate,'HARD_BLOCK_PREP'); });
tc('T015',()=>{ const f=form('Ciprofloxacin','cipro-500-5'); assert.equal(f.minWeightKg,13); assert.ok(12<f.minWeightKg); assert.match(read('antibiotiket-formulations.js'),/minWeightKg/); });

assert.equal(passed,15);
assert.match(read('antibiotiket-hospital.css'),/@media\(max-width:520px\)/);
assert.match(read('antibiotiket-parenteral-prep.css'),/@media\(max-width:520px\)/);
assert.match(read('antibiotiket-prescription.css'),/@media\(max-width:560px\)/);
console.log('Antibiotics Phase 7 master gate passed: 15/15 CALCULATOR_TEST_CASES + mobile CSS contracts.');