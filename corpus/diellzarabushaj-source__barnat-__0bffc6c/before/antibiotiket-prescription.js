(() => {
  'use strict';

  const liquidConfig = window.DRX_ANTIBIOTIC_FORMULATIONS;
  const solidConfig = window.DRX_ANTIBIOTIC_SOLIDS;
  const list = document.getElementById('recommendationList');
  if (!liquidConfig || !solidConfig || !list) return;

  const clean = value => String(value ?? '').replace(/\s+/g, ' ').trim();
  const num = value => Number(String(value ?? '').replace(',', '.'));
  const fmt = value => {
    const n = Number(value);
    if (!Number.isFinite(n)) return '—';
    const rounded = Math.round(n * 100) / 100;
    return String(rounded).replace('.', ',');
  };
  const sameDose = (a, b) => Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) < 0.05;

  function currentIndication() {
    try { return new URL(location.href).searchParams.get('indication') || ''; }
    catch { return ''; }
  }

  function make(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function escapeRegex(value) {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function doseTextForDrug(card, drug, combo=false) {
    const raw = clean(card.querySelector('.abx-dose-row[data-role="single"] .abx-dose-row-value')?.textContent || '');
    if (!combo) return raw;
    const match = new RegExp(`${escapeRegex(drug)}:\\s*([^+]+)`, 'i').exec(raw);
    return match ? clean(match[1].replace(/·\s*\d+\s+herë\/ditë.*$/i, '')) : raw;
  }

  function parseSimpleDose(text) {
    const value = clean(text).replace(/,/g, '.');
    let match = /(\d+(?:\.\d+)?)\s*[–-]\s*(\d+(?:\.\d+)?)\s*mg(?:\s+[\p{L}-]+)?\/dozë/iu.exec(value);
    if (match) return { min:Number(match[1]), max:Number(match[2]) };
    match = /(\d+(?:\.\d+)?)\s*mg(?:\s+[\p{L}-]+)?\/dozë/iu.exec(value);
    if (match) return { min:Number(match[1]), max:Number(match[1]) };
    return null;
  }

  function parseSequence(text) {
    const value = clean(text).replace(/,/g, '.');
    if (!/Dita|Ditët/i.test(value)) return [];
    return value.split('·').map(part => {
      const match = /^([^:]+):\s*(\d+(?:\.\d+)?)\s*mg/i.exec(clean(part));
      return match ? { label:clean(match[1]), mg:Number(match[2]) } : null;
    }).filter(Boolean);
  }

  function sequenceDays(label) {
    const range = /(\d+)\s*[–-]\s*(\d+)/.exec(label);
    if (range) return Math.max(0, Number(range[2]) - Number(range[1]) + 1);
    if (/Dita\s+\d+/i.test(label)) return 1;
    return null;
  }

  function frequencyFromCard(card) {
    const first = clean(card.querySelector('.abx-option-meta > span')?.textContent || '');
    const parts = first.split('·').map(clean).filter(Boolean);
    return parts.length > 1 ? parts.slice(1).join(' · ') : first;
  }

  function frequencyChoices(text) {
    const value = clean(text);
    let match = /^(\d+)\s+ose\s+(\d+)\s+herë\/ditë$/i.exec(value);
    if (match) return [Number(match[1]), Number(match[2])];
    match = /^(\d+)\s+herë\/ditë$/i.exec(value);
    if (match) return [Number(match[1])];
    return [];
  }

  function durationSpec(text) {
    const value = clean(text);
    const minimum = /të paktën\s+(\d+)\s+ditë/i.exec(value);
    if (minimum) return { kind:'minimum', min:Number(minimum[1]), values:[Number(minimum[1])] };

    const range = /(\d+)\s*[–-]\s*(\d+)\s+ditë/i.exec(value);
    if (range) {
      const start = Number(range[1]);
      const end = Number(range[2]);
      const values = [];
      for (let day = start; day <= end; day += 1) values.push(day);
      const extra = [...value.matchAll(/(?:^|[^–-])(\d+)\s+ditë/gi)].map(match => Number(match[1]));
      extra.forEach(day => { if (!values.includes(day)) values.push(day); });
      return { kind:'choice', values:values.sort((a, b) => a - b) };
    }

    const exact = /(\d+)\s+ditë/i.exec(value);
    if (exact) return { kind:'fixed', values:[Number(exact[1])] };
    return null;
  }

  function isWeightBased(card) {
    return /mg\/kg/i.test(clean(card.querySelector('.abx-dose-formula')?.textContent || ''));
  }

  function hasRealWeight(card) {
    const basis = card.querySelector('.abx-dose-basis')?.dataset.basis || '';
    return basis === 'real';
  }

  function liquidConverter(card, drug) {
    return [...card.querySelectorAll('.abx-formulation')].find(node => node.dataset.drug === drug) || null;
  }

  function selectedLiquid(card, drug) {
    const converter = liquidConverter(card, drug);
    if (!converter) return null;
    const select = converter.querySelector('.abx-formulation-select');
    if (!select) return null;
    if (select.value === 'custom') {
      const mgPer5mL = num(converter.dataset.mgPer5ml);
      if (!Number.isFinite(mgPer5mL) || mgPer5mL <= 0) return null;
      const label = clean(converter.dataset.strengthLabel) || `${fmt(mgPer5mL)} mg / 5 mL`;
      return { id:'custom', label, mgPer5mL, custom:true };
    }
    const entry = liquidConfig.drugs?.[drug];
    const forms = Array.isArray(entry?.forms) ? entry.forms : [];
    return forms.find(form => form.id === select.value) || null;
  }

  function volumeForMg(mg, mgPer5mL) {
    if (!Number.isFinite(mg) || !Number.isFinite(mgPer5mL) || mgPer5mL <= 0) return null;
    return mg * 5 / mgPer5mL;
  }

  function solidForms(drug) {
    const entry = solidConfig.drugs?.[drug];
    if (!entry) return [];
    const override = solidConfig.indicationOverrides?.[`${currentIndication()}|${drug}`];
    if (override?.disabled) return [];
    const forms = Array.isArray(entry.forms) ? entry.forms : [];
    if (!Array.isArray(override?.allow)) return forms;
    const allowed = new Set(override.allow);
    return forms.filter(form => allowed.has(form.id));
  }

  function solidMatches(drug, mg) {
    if (!Number.isFinite(mg) || mg <= 0) return [];
    return solidForms(drug).map(form => {
      const unitMg = Number(form.componentMg);
      if (!Number.isFinite(unitMg) || unitMg <= 0) return null;
      const exactUnits = mg / unitMg;
      const rounded = Math.round(exactUnits);
      if (Math.abs(exactUnits - rounded) > 1e-9 || rounded < 1 || rounded > 4) return null;
      if (form.singleUnitOnly && rounded !== 1) return null;
      return { form, units:rounded };
    }).filter(Boolean).sort((a, b) => a.units - b.units || b.form.componentMg - a.form.componentMg);
  }

  function formUnit(form, count) {
    const base = form.form || 'njësi';
    if (count === 1) return base;
    if (base === 'tabletë') return 'tableta';
    if (base === 'kapsulë') return 'kapsula';
    if (base === 'tabletë përtypëse') return 'tableta përtypëse';
    return `${base} × ${count}`;
  }

  function practicalDoseCandidates(state) {
    const simple = state.simple;
    if (!simple || sameDose(simple.min, simple.max)) return [];
    const values = new Map();
    const add = (mg, kind='source', match=null) => {
      const n = Math.round(Number(mg) * 100) / 100;
      if (!Number.isFinite(n) || n < simple.min - 0.05 || n > simple.max + 0.05) return;
      const key = n.toFixed(2);
      const current = values.get(key);
      const candidate = { mg:n, kind, match };
      if (!current || (kind === 'exact-solid' && current.kind !== 'exact-solid')) values.set(key, candidate);
    };
    add(simple.min, 'source');
    add(simple.max, 'source');
    solidForms(state.drug).forEach(form => {
      const unitMg = Number(form.componentMg);
      if (!Number.isFinite(unitMg) || unitMg <= 0) return;
      for (let units = 1; units <= 4; units += 1) {
        if (form.singleUnitOnly && units !== 1) continue;
        const mg = unitMg * units;
        if (mg < simple.min - 0.05 || mg > simple.max + 0.05) continue;
        add(mg, 'exact-solid', { form, units });
      }
    });
    return [...values.values()].sort((a, b) => a.mg - b.mg);
  }

  function candidateLabel(candidate) {
    const base = `${fmt(candidate.mg)} mg`;
    if (!candidate.match) return base;
    const { form, units } = candidate.match;
    return `${base} · ${units} ${formUnit(form, units)}`;
  }

  function copyText(text, button) {
    const finish = ok => {
      const old = button.textContent;
      button.textContent = ok ? 'U kopjua' : 'Nuk u kopjua';
      window.setTimeout(() => { button.textContent = old; }, 1200);
    };
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(text).then(() => finish(true)).catch(() => finish(false));
      return;
    }
    try {
      const area = document.createElement('textarea');
      area.value = text;
      area.style.position = 'fixed';
      area.style.opacity = '0';
      document.body.append(area);
      area.select();
      const ok = document.execCommand('copy');
      area.remove();
      finish(ok);
    } catch { finish(false); }
  }

  function componentState(card, part, combo) {
    const drug = part.drug;
    const doseText = doseTextForDrug(card, drug, combo);
    const sequence = parseSequence(doseText);
    const simple = sequence.length ? null : parseSimpleDose(doseText);
    const frequencyText = part.frequency || frequencyFromCard(card);
    const frequencyValues = frequencyChoices(frequencyText);
    return {
      drug,
      doseText,
      sequence,
      simple,
      frequencyText,
      frequencyValues,
      doseFinal:simple && sameDose(simple.min, simple.max) ? simple.min : null,
      doseChoice:'',
      frequencyFinal:frequencyValues.length === 1 ? frequencyValues[0] : null,
      mode:liquidConverter(card, drug) ? 'liquid' : 'solid',
      solidId:'',
    };
  }

  function buildDoseResolver(state, refresh) {
    if (!state.simple || sameDose(state.simple.min, state.simple.max)) return null;

    const wrap = make('div', 'abx-rx-field');
    wrap.append(make('span', '', `Doza praktike · burimi ${fmt(state.simple.min)}–${fmt(state.simple.max)} mg`));
    wrap.append(make('small', '', 'Zgjidhe vetëm një herë. Shurupi, tableta/kapsula dhe receta përditësohen automatikisht.'));

    const choices = make('div', 'abx-rx-mode');
    const manualButton = make('button', '', 'Tjetër');
    manualButton.type = 'button';
    manualButton.dataset.doseManual = '1';

    const manual = document.createElement('input');
    manual.type = 'number';
    manual.min = String(state.simple.min);
    manual.max = String(state.simple.max);
    manual.step = '0.1';
    manual.inputMode = 'decimal';
    manual.placeholder = `${fmt(state.simple.min)}–${fmt(state.simple.max)} mg`;
    manual.hidden = true;

    const renderActive = () => {
      choices.querySelectorAll('button[data-dose]').forEach(button => {
        button.classList.toggle('is-active', sameDose(Number(button.dataset.dose), state.doseFinal));
      });
      manualButton.classList.toggle('is-active', state.doseChoice === 'manual');
    };

    practicalDoseCandidates(state).forEach(candidate => {
      const button = make('button', '', candidateLabel(candidate));
      button.type = 'button';
      button.dataset.dose = String(candidate.mg);
      if (candidate.kind === 'exact-solid') button.title = 'Përputhje e saktë me formulim solid të verifikuar';
      button.addEventListener('click', () => {
        state.doseFinal = candidate.mg;
        state.doseChoice = 'quick';
        manual.hidden = true;
        manual.value = '';
        renderActive();
        refresh();
      });
      choices.append(button);
    });

    manualButton.addEventListener('click', () => {
      state.doseChoice = 'manual';
      state.doseFinal = null;
      manual.hidden = false;
      manual.focus();
      renderActive();
      refresh();
    });
    choices.append(manualButton);

    manual.addEventListener('input', () => {
      const value = num(manual.value);
      state.doseFinal = Number.isFinite(value) && value >= state.simple.min && value <= state.simple.max ? value : null;
      state.doseChoice = 'manual';
      renderActive();
      refresh();
    });

    wrap.append(choices, manual);
    return wrap;
  }

  function buildFrequencyResolver(state, refresh) {
    if (state.frequencyValues.length <= 1) return null;
    const label = make('label', 'abx-rx-field');
    label.append(make('span', '', 'Frekuenca finale'));
    const select = document.createElement('select');
    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = 'Zgjidh';
    select.append(placeholder);
    state.frequencyValues.forEach(value => {
      const option = document.createElement('option');
      option.value = String(value);
      option.textContent = `${value} herë/ditë`;
      select.append(option);
    });
    select.addEventListener('change', () => {
      const value = Number(select.value);
      state.frequencyFinal = Number.isFinite(value) && value > 0 ? value : null;
      refresh();
    });
    label.append(select);
    return label;
  }

  function buildDurationResolver(duration, shared, refresh) {
    if (!duration) return null;
    if (duration.kind === 'fixed') {
      shared.days = duration.values[0];
      return null;
    }
    const label = make('label', 'abx-rx-field');
    label.append(make('span', '', duration.kind === 'minimum' ? `Kohëzgjatja finale · ≥${duration.min} ditë` : 'Kohëzgjatja finale'));
    if (duration.kind === 'choice') {
      const select = document.createElement('select');
      const placeholder = document.createElement('option');
      placeholder.value = '';
      placeholder.textContent = 'Zgjidh';
      select.append(placeholder);
      duration.values.forEach(day => {
        const option = document.createElement('option');
        option.value = String(day);
        option.textContent = `${day} ditë`;
        select.append(option);
      });
      select.addEventListener('change', () => {
        const value = Number(select.value);
        shared.days = Number.isFinite(value) ? value : null;
        refresh();
      });
      label.append(select);
    } else {
      const input = document.createElement('input');
      input.type = 'number';
      input.min = String(duration.min);
      input.step = '1';
      input.inputMode = 'numeric';
      input.value = String(duration.min);
      shared.days = duration.min;
      input.addEventListener('input', () => {
        const value = Number(input.value);
        shared.days = Number.isInteger(value) && value >= duration.min ? value : null;
        refresh();
      });
      label.append(input);
    }
    return label;
  }

  function buildModeResolver(card, state, refresh) {
    const hasLiquid = Boolean(liquidConverter(card, state.drug));
    const hasSolid = solidForms(state.drug).length > 0;
    if (!hasLiquid && !hasSolid) return null;
    if (!hasLiquid) state.mode = 'solid';
    if (!hasSolid) state.mode = 'liquid';

    const group = make('div', 'abx-rx-mode');
    if (hasLiquid) {
      const button = make('button', state.mode === 'liquid' ? 'is-active' : '', 'Shurup');
      button.type = 'button';
      button.addEventListener('click', () => { state.mode = 'liquid'; refresh(); });
      button.dataset.mode = 'liquid';
      group.append(button);
    }
    if (hasSolid) {
      const button = make('button', state.mode === 'solid' ? 'is-active' : '', 'Tabletë / kapsulë');
      button.type = 'button';
      button.addEventListener('click', () => { state.mode = 'solid'; refresh(); });
      button.dataset.mode = 'solid';
      group.append(button);
    }
    state.modeGroup = group;
    return group;
  }

  function refreshModeButtons(state) {
    if (!state.modeGroup) return;
    state.modeGroup.querySelectorAll('button').forEach(button => button.classList.toggle('is-active', button.dataset.mode === state.mode));
  }

  function solidChoice(state, mg, select) {
    const matches = solidMatches(state.drug, mg);
    if (!matches.length) return { matches, selected:null };
    const existing = matches.find(item => item.form.id === state.solidId);
    const selected = existing || matches[0];
    state.solidId = selected.form.id;
    if (select) {
      select.replaceChildren();
      matches.forEach(match => {
        const option = document.createElement('option');
        option.value = match.form.id;
        option.textContent = `${match.units} × ${match.form.label}`;
        option.selected = match.form.id === selected.form.id;
        select.append(option);
      });
    }
    return { matches, selected };
  }

  function simplePreview(card, state, shared, preview, solidSelect) {
    preview.replaceChildren();
    refreshModeButtons(state);

    if (isWeightBased(card) && !hasRealWeight(card)) {
      preview.append(make('p', 'abx-rx-blocked', 'Shkruaj peshën reale para se të krijohet teksti final i recetës. Pesha referuese mbetet vetëm orientuese.'));
      return null;
    }
    if (!state.simple || !Number.isFinite(state.doseFinal)) {
      preview.append(make('p', 'abx-rx-blocked', state.simple ? 'Zgjidh dozën praktike një herë nga opsionet sipër.' : 'Kjo skemë nuk ka një dozë orale të finalizueshme automatikisht.'));
      return null;
    }
    if (!Number.isFinite(state.frequencyFinal)) {
      preview.append(make('p', 'abx-rx-blocked', state.frequencyValues.length ? 'Zgjidh frekuencën finale.' : 'Frekuenca nuk mund të finalizohet automatikisht për këtë skemë.'));
      return null;
    }
    if (!Number.isFinite(shared.days)) {
      preview.append(make('p', 'abx-rx-blocked', 'Zgjidh kohëzgjatjen finale.'));
      return null;
    }

    const mg = state.doseFinal;
    const freq = state.frequencyFinal;
    const days = shared.days;
    let line = '';
    let quantity = '';
    let sourceUrl = '';
    let caution = '';

    if (state.mode === 'liquid') {
      if (solidSelect) solidSelect.hidden = true;
      const strength = selectedLiquid(card, state.drug);
      if (!strength) {
        preview.append(make('p', 'abx-rx-blocked', 'Zgjidh fuqinë reale të shurupit te seksioni i shurupit më lart.'));
        return null;
      }
      const ml = volumeForMg(mg, strength.mgPer5mL);
      const total = ml * freq * days;
      line = `${state.drug} ${strength.label} — ${fmt(ml)} mL PO ${freq} herë/ditë × ${days} ditë`;
      quantity = `Sasia matematike e kursit: ${fmt(total)} mL`;
      sourceUrl = strength.sourceUrl || '';
    } else {
      const { selected } = solidChoice(state, mg, solidSelect);
      if (solidSelect) solidSelect.hidden = false;
      if (!selected) {
        preview.append(make('p', 'abx-rx-blocked', 'Nuk ka përputhje të saktë me njësi të plota. Zgjidh një dozë tjetër brenda intervalit ose përdor shurupin.'));
        return null;
      }
      const units = selected.units;
      const form = selected.form;
      const total = units * freq * days;
      line = `${state.drug} ${form.label} — ${units} ${formUnit(form, units)} PO ${freq} herë/ditë × ${days} ditë`;
      quantity = `Sasia matematike e kursit: ${total} ${formUnit(form, total)}`;
      sourceUrl = form.sourceUrl || '';
      caution = form.caution || form.note || solidConfig.drugs?.[state.drug]?.caution || '';
    }

    preview.append(make('strong', 'abx-rx-line', line));
    preview.append(make('span', 'abx-rx-dose', `Doza e zgjedhur: ${fmt(mg)} mg/dozë.`));
    preview.append(make('span', 'abx-rx-quantity', quantity));
    if (caution) preview.append(make('span', 'abx-rx-caution', caution));
    preview.append(make('span', 'abx-rx-note', 'Sasia është llogaritje matematike, jo zgjedhje automatike e paketimit. Verifiko produktin dhe matshmërinë para nënshkrimit.'));

    return {
      text:`${state.drug}\nD.S.: ${line.replace(`${state.drug} `, '')}.\nDoza e zgjedhur: ${fmt(mg)} mg/dozë.\n${quantity}.`,
      sourceUrl,
    };
  }

  function sequencePreview(card, state, shared, preview) {
    preview.replaceChildren();
    refreshModeButtons(state);

    if (isWeightBased(card) && !hasRealWeight(card)) {
      preview.append(make('p', 'abx-rx-blocked', 'Shkruaj peshën reale para se të krijohet teksti final i recetës.'));
      return null;
    }
    if (!state.sequence.length) return null;
    if (!Number.isFinite(shared.days)) {
      preview.append(make('p', 'abx-rx-blocked', 'Zgjidh kohëzgjatjen finale.'));
      return null;
    }

    const lines = [];
    let total = 0;
    let allMatched = true;
    if (state.mode === 'liquid') {
      const strength = selectedLiquid(card, state.drug);
      if (!strength) {
        preview.append(make('p', 'abx-rx-blocked', 'Zgjidh fuqinë reale të shurupit më lart.'));
        return null;
      }
      state.sequence.forEach(step => {
        const days = sequenceDays(step.label);
        const ml = volumeForMg(step.mg, strength.mgPer5mL);
        if (!Number.isFinite(days) || !Number.isFinite(ml)) allMatched = false;
        else total += ml * days;
        lines.push(`${step.label}: ${fmt(ml)} mL PO 1 herë/ditë (${fmt(step.mg)} mg)`);
      });
      if (!allMatched) return null;
      preview.append(make('strong', 'abx-rx-line', `${state.drug} ${strength.label}`));
      lines.forEach(line => preview.append(make('span', 'abx-rx-dose', line)));
      preview.append(make('span', 'abx-rx-quantity', `Sasia matematike e kursit: ${fmt(total)} mL`));
      preview.append(make('span', 'abx-rx-note', 'Sasia është llogaritje matematike; verifiko fuqinë dhe paketimin real.'));
      return { text:`${state.drug} ${strength.label}\n${lines.join('\n')}\nSasia matematike e kursit: ${fmt(total)} mL.` };
    }

    const solidLines = [];
    state.sequence.forEach(step => {
      const days = sequenceDays(step.label);
      const matches = solidMatches(state.drug, step.mg);
      const selected = matches[0];
      if (!selected || !Number.isFinite(days)) {
        allMatched = false;
        return;
      }
      total += selected.units * days;
      solidLines.push(`${step.label}: ${selected.units} ${formUnit(selected.form, selected.units)} ${selected.form.label} PO 1 herë/ditë (${fmt(step.mg)} mg)`);
    });
    if (!allMatched) {
      preview.append(make('p', 'abx-rx-blocked', 'Dozat ditore të kësaj sekuence nuk përputhen saktë me formulimet solide të verifikuara. Përdor shurupin ose verifiko manualisht produktin.'));
      return null;
    }
    preview.append(make('strong', 'abx-rx-line', state.drug));
    solidLines.forEach(line => preview.append(make('span', 'abx-rx-dose', line)));
    preview.append(make('span', 'abx-rx-quantity', `Gjithsej: ${total} njësi solide`));
    preview.append(make('span', 'abx-rx-note', 'Nuk ndahet asnjë tabletë automatikisht; përdoren vetëm njësi të plota me përputhje të saktë.'));
    return { text:`${state.drug}\n${solidLines.join('\n')}\nGjithsej: ${total} njësi solide.` };
  }

  function buildComponent(card, part, combo, shared, onResult) {
    const state = componentState(card, part, combo);
    const section = make('div', 'abx-rx-component');
    if (combo) section.append(make('strong', 'abx-rx-component-title', state.drug));

    const controls = make('div', 'abx-rx-controls');
    const preview = make('div', 'abx-rx-preview');
    const solidSelect = document.createElement('select');
    solidSelect.className = 'abx-rx-solid-select';
    solidSelect.hidden = true;
    solidSelect.setAttribute('aria-label', `Formulimi solid i ${state.drug}`);
    solidSelect.addEventListener('change', () => { state.solidId = solidSelect.value; refresh(); });

    const refresh = () => {
      refreshModeButtons(state);
      let result = null;
      if (state.sequence.length) {
        solidSelect.hidden = true;
        result = sequencePreview(card, state, shared, preview);
      } else {
        result = simplePreview(card, state, shared, preview, solidSelect);
      }
      onResult(state.drug, result);
    };

    const doseResolver = buildDoseResolver(state, refresh);
    const frequencyResolver = buildFrequencyResolver(state, refresh);
    const modeResolver = buildModeResolver(card, state, refresh);
    if (doseResolver) controls.append(doseResolver);
    if (frequencyResolver) controls.append(frequencyResolver);
    if (modeResolver) controls.append(modeResolver);
    controls.append(solidSelect);
    section.append(controls, preview);

    card.addEventListener('change', event => {
      if (event.target.closest('.abx-formulation')) refresh();
    });
    card.addEventListener('input', event => {
      if (event.target.closest('.abx-formulation')) refresh();
    });
    window.setTimeout(refresh, 0);
    return { section, refresh };
  }

  function enhanceCard(card) {
    if (card.dataset.prescriptionEnhanced === '1') return;
    const heading = clean(card.querySelector('.abx-option-head h3')?.textContent || '');
    if (!heading || /Incizion|drenazh/i.test(heading)) return;

    const comboParts = liquidConfig.comboAliases?.[heading];
    const parts = Array.isArray(comboParts) && comboParts.length ? comboParts : [{ drug:heading }];
    const hasAnyForm = parts.some(part => liquidConverter(card, part.drug) || solidForms(part.drug).length);
    if (!hasAnyForm) return;
    card.dataset.prescriptionEnhanced = '1';

    const details = make('details', 'abx-rx');
    const summary = make('summary', '', 'Zgjedhja praktike / Receta');
    details.append(summary);

    const body = make('div', 'abx-rx-body');
    const durationText = clean(card.querySelector('.abx-duration')?.textContent || '');
    const duration = durationSpec(durationText);
    const shared = { days:duration?.kind === 'fixed' ? duration.values[0] : null };
    const results = new Map();
    const copyButton = make('button', 'abx-rx-copy', 'Kopjo recetën');
    copyButton.type = 'button';
    copyButton.disabled = true;

    const updateCopy = () => {
      const complete = parts.every(part => results.get(part.drug)?.text);
      copyButton.disabled = !complete;
    };

    const sharedControls = make('div', 'abx-rx-shared');
    const componentRefreshers = [];
    const durationResolver = buildDurationResolver(duration, shared, () => componentRefreshers.forEach(fn => fn()));
    if (durationResolver) sharedControls.append(durationResolver);
    if (sharedControls.childElementCount) body.append(sharedControls);

    parts.forEach(part => {
      const built = buildComponent(card, part, parts.length > 1, shared, (drug, result) => {
        results.set(drug, result);
        updateCopy();
      });
      componentRefreshers.push(built.refresh);
      body.append(built.section);
    });

    const footer = make('div', 'abx-rx-footer');
    footer.append(copyButton, make('span', '', 'Një zgjedhje e dozës mjafton; forma, mL/njësitë dhe teksti final përditësohen automatikisht.'));
    copyButton.addEventListener('click', () => {
      const text = parts.map(part => results.get(part.drug)?.text).filter(Boolean).join('\n\n');
      if (text) copyText(text, copyButton);
    });
    body.append(footer);
    details.append(body);
    card.append(details);
  }

  function scan() {
    list.querySelectorAll('.abx-option').forEach(enhanceCard);
  }

  const observer = new MutationObserver(scan);
  observer.observe(list, { childList:true, subtree:false });
  scan();
})();
