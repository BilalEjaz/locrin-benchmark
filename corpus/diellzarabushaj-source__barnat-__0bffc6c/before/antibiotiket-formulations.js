(() => {
  'use strict';

  const config = window.DRX_ANTIBIOTIC_FORMULATIONS;
  const list = document.getElementById('recommendationList');
  if (!config || !list) return;

  const clean = value => String(value ?? '').replace(/\s+/g, ' ').trim();
  const number = value => Number(String(value ?? '').replace(',', '.'));
  const fmt = value => {
    const n = Number(value);
    if (!Number.isFinite(n)) return '—';
    const rounded = Math.round(n * 10) / 10;
    return String(rounded).replace('.', ',');
  };

  function currentIndication() {
    try { return new URL(location.href).searchParams.get('indication') || ''; }
    catch { return ''; }
  }

  function currentWeightKg() {
    const raw = clean(document.getElementById('weightInput')?.value).replace(',', '.');
    const value = Number(raw);
    return raw && Number.isFinite(value) && value > 0 ? value : null;
  }

  function drugConfig(drug) {
    return config.drugs?.[drug] || null;
  }

  function overrideFor(drug) {
    return config.indicationOverrides?.[`${currentIndication()}|${drug}`] || null;
  }

  function availableForms(drug) {
    const entry = drugConfig(drug);
    if (!entry) return [];
    const override = overrideFor(drug);
    if (override?.manualOnly) return [];
    const weight = currentWeightKg();
    let forms = Array.isArray(entry.forms) ? entry.forms : [];
    forms = forms.filter(form => !Number.isFinite(form.minWeightKg) || (Number.isFinite(weight) && weight >= form.minWeightKg));
    if (!Array.isArray(override?.allow)) return forms;
    const allow = new Set(override.allow);
    return forms.filter(form => allow.has(form.id));
  }

  // A 900 mg dose out of the weakest listed syrup is 36 mL — arithmetically
  // right and useless at the bedside. Of the strengths the source lists for
  // this drug (already filtered by any weight restriction), start on the one
  // that gives the smallest dose volume a syringe can still measure, and fall
  // back to the least concentrated when every option would be a fraction of a
  // millilitre. The clinician can pick any other listed strength; only the
  // starting point changes, never the dose in mg.
  const MEASURABLE_ML = 2.5;

  function preferredForm(forms, mg) {
    if (!forms.length) return null;
    if (!Number.isFinite(mg) || mg <= 0) return forms[0];
    const withVolume = forms
      .filter(form => Number.isFinite(form.mgPer5mL) && form.mgPer5mL > 0)
      .map(form => ({ form, ml:mg * 5 / form.mgPer5mL }));
    if (!withVolume.length) return forms[0];
    const measurable = withVolume.filter(item => item.ml >= MEASURABLE_ML);
    if (measurable.length) {
      return measurable.reduce((best, item) => (item.ml < best.ml ? item : best)).form;
    }
    return withVolume.reduce((best, item) => (item.ml > best.ml ? item : best)).form;
  }

  function frequencyRange(text) {
    const value = clean(text);
    let match = /(\d+)\s+ose\s+(\d+)\s+herë\/ditë/i.exec(value);
    if (match) return { min:Number(match[1]), max:Number(match[2]) };
    match = /(\d+)\s+herë\/ditë/i.exec(value);
    if (match) return { min:Number(match[1]), max:Number(match[1]) };
    return null;
  }

  function durationRange(text) {
    const first = clean(text).split('·')[0].trim();
    let match = /të paktën\s+(\d+)\s+ditë/i.exec(first);
    if (match) return { min:Number(match[1]), max:null, minimum:true };
    match = /(\d+)\s*[–-]\s*(\d+)\s+ditë/i.exec(first);
    if (match) return { min:Number(match[1]), max:Number(match[2]), minimum:false };
    match = /(\d+)\s+ditë/i.exec(first);
    if (match) return { min:Number(match[1]), max:Number(match[1]), minimum:false };
    return null;
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
      if (!match) return null;
      return { label:clean(match[1]), mg:Number(match[2]) };
    }).filter(Boolean);
  }

  function sequenceDays(label) {
    const range = /(\d+)\s*[–-]\s*(\d+)/.exec(label);
    if (range) return Math.max(0, Number(range[2]) - Number(range[1]) + 1);
    if (/Dita\s+\d+/i.test(label)) return 1;
    return null;
  }

  function volumeForMg(mg, mgPer5mL) {
    if (!Number.isFinite(mg) || !Number.isFinite(mgPer5mL) || mgPer5mL <= 0) return null;
    return mg * 5 / mgPer5mL;
  }

  function rangeVolume(dose, mgPer5mL) {
    if (!dose) return null;
    return {
      min:volumeForMg(dose.min, mgPer5mL),
      max:volumeForMg(dose.max, mgPer5mL),
    };
  }

  function rangeText(range, unit='mL') {
    if (!range || !Number.isFinite(range.min) || !Number.isFinite(range.max)) return '—';
    return range.min === range.max ? `${fmt(range.min)} ${unit}` : `${fmt(range.min)}–${fmt(range.max)} ${unit}`;
  }

  function multiplyRanges(a, b) {
    if (!a || !b) return null;
    return { min:a.min * b.min, max:a.max * b.max };
  }

  function make(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  // A bottle is "X mg in Y mL", and both halves vary by market. The listed
  // strengths are the common ones; the custom option lets either number be
  // typed, and everything downstream keeps working in mg per 5 mL.
  function customStrength(mgInput, mlInput) {
    const mg = number(mgInput.value);
    const ml = number(mlInput.value);
    if (!Number.isFinite(mg) || mg <= 0) return null;
    if (!Number.isFinite(ml) || ml <= 0) return null;
    return { id:'custom', label:`${fmt(mg)} mg / ${fmt(ml)} mL`, mgPer5mL:mg * 5 / ml, sourceUrl:null, custom:true };
  }

  function selectedStrength(select, mgInput, mlInput) {
    if (select.value === 'custom') return customStrength(mgInput, mlInput);
    const drug = select.dataset.drug;
    return availableForms(drug).find(form => form.id === select.value) || null;
  }

  // Returns the one line worth showing before the panel is opened: the volume
  // per dose and the strength it came from, or null when there is none.
  function renderResult(target, { drug, doseText, frequencyText, durationText, basisKind, sequence, strength }) {
    target.replaceChildren();
    if (!strength) {
      target.append(make('span', 'abx-formulation-empty', 'Shkruaj fuqinë reale të produktit për ta kthyer dozën në mL.'));
      return null;
    }

    const entry = drugConfig(drug);
    const orientational = basisKind === 'reference';
    const rows = make('div', 'abx-formulation-results');
    let headline = null;

    if (sequence.length) {
      let total = 0;
      let totalKnown = true;
      sequence.forEach(step => {
        const ml = volumeForMg(step.mg, strength.mgPer5mL);
        const days = sequenceDays(step.label);
        rows.append(resultRow(`${step.label}`, `${fmt(ml)} mL`));
        if (!Number.isFinite(days)) totalKnown = false;
        else total += ml * days;
      });
      if (totalKnown) rows.append(resultRow('Volumi i kursit', `${fmt(total)} mL`));
    } else {
      const dose = parseSimpleDose(doseText);
      const perDose = rangeVolume(dose, strength.mgPer5mL);
      if (!perDose) {
        target.append(make('span', 'abx-formulation-empty', 'Kjo skemë nuk ka dozë në mg që mund të kthehet automatikisht në mL.'));
        return null;
      }

      headline = rangeText(perDose);
      rows.append(resultRow('mL për dozë', rangeText(perDose)));
      const frequency = frequencyRange(frequencyText);
      const daily = frequency ? multiplyRanges(perDose, frequency) : null;
      if (daily) rows.append(resultRow('mL në 24 orë', rangeText(daily)));

      const duration = durationRange(durationText);
      if (daily && duration) {
        if (duration.max === null) {
          const minimum = { min:daily.min * duration.min, max:daily.max * duration.min };
          rows.append(resultRow('Minimumi i kursit', `≥ ${rangeText(minimum)}`));
        } else {
          const course = multiplyRanges(daily, { min:duration.min, max:duration.max });
          rows.append(resultRow('Volumi teorik i kursit', rangeText(course)));
        }
      }
    }

    target.append(rows);

    const notes = make('div', 'abx-formulation-notes');
    if (entry?.basis) notes.append(make('span', '', `Baza e llogaritjes: ${entry.basis}.`));
    if (orientational) notes.append(make('span', 'is-warning', 'Këto mL janë orientuese sepse doza është llogaritur nga pesha referuese, jo nga pesha reale.'));
    if (entry?.caution) notes.append(make('span', 'is-warning', entry.caution));
    if (strength.weightRestriction) notes.append(make('span', 'is-warning', strength.weightRestriction));
    const override = overrideFor(drug);
    if (override?.note) notes.append(make('span', 'is-warning', override.note));
    notes.append(make('span', '', 'Verifiko fuqinë e produktit në shishe para përshkrimit; disponueshmëria ndryshon sipas tregut.'));
    target.append(notes);

    if (strength.sourceUrl) {
      const source = make('a', 'abx-formulation-source', `${config.sourceLabel} · ${strength.label}`);
      source.href = strength.sourceUrl;
      source.target = '_blank';
      source.rel = 'noopener noreferrer';
      target.append(source);
    } else if (strength.custom) {
      target.append(make('span', 'abx-formulation-source', 'Fuqia u shkrua manualisht — kontrollo etiketën e produktit.'));
    }
    return headline ? { volume:headline, strength:strength.label } : null;
  }

  function resultRow(label, value) {
    const row = make('div', 'abx-formulation-row');
    row.append(make('span', '', label), make('strong', '', value));
    return row;
  }

  function doseTextForDrug(card, drug, comboHeading) {
    const raw = clean(card.querySelector('.abx-dose-row[data-role="single"] .abx-dose-row-value')?.textContent || '');
    if (!comboHeading) return raw;
    const escaped = drug.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = new RegExp(`${escaped}:\\s*([^+]+)`, 'i').exec(raw);
    return match ? clean(match[1]) : raw;
  }

  function buildConverter(card, drug, frequencyOverride, comboHeading=false) {
    const entry = drugConfig(drug);
    if (!entry) return null;

    const wrap = make('details', 'abx-formulation');
    wrap.dataset.drug = drug;

    const summary = make('summary', 'abx-formulation-summary');
    summary.append(make('span', 'abx-formulation-summary-label', comboHeading ? `Nga mg në mL · ${drug}` : 'Nga mg në mL'));
    const summaryValue = make('b', 'abx-formulation-summary-value', '');
    const summaryStrength = make('span', 'abx-formulation-summary-strength', '');
    summary.append(summaryValue, summaryStrength);
    wrap.append(summary);

    // The summary above already names the section (and the component, for a
    // combination), so the body only labels the control.
    const head = make('div', 'abx-formulation-head');
    head.append(make('span', 'abx-formulation-head-label', 'Fuqia e produktit'));

    const select = document.createElement('select');
    select.className = 'abx-formulation-select';
    select.dataset.drug = drug;
    select.setAttribute('aria-label', `Fuqia e ${drug}`);
    const forms = availableForms(drug);
    forms.forEach(form => {
      const option = document.createElement('option');
      option.value = form.id;
      option.textContent = form.label;
      select.append(option);
    });
    const custom = document.createElement('option');
    custom.value = 'custom';
    custom.textContent = forms.length ? 'Fuqia ime…' : 'Shkruaj fuqinë reale…';
    select.append(custom);
    if (!forms.length) select.value = 'custom';
    head.append(select);
    wrap.append(head);

    const customWrap = make('div', 'abx-formulation-custom');
    const numberField = (labelText, ariaText, placeholder) => {
      const field = make('label', 'abx-formulation-custom-field');
      field.append(make('span', '', labelText));
      const input = document.createElement('input');
      input.type = 'text';
      input.inputMode = 'decimal';
      input.placeholder = placeholder;
      input.setAttribute('aria-label', ariaText);
      field.append(input);
      customWrap.append(field);
      return input;
    };
    const basis = entry.basis || drug;
    const customMg = numberField(`mg ${basis}`, `mg ${basis} në shishe`, '125');
    const customMl = numberField('në mL', `mL të tretësirës për ${basis}`, '5');
    wrap.append(customWrap);

    const output = make('div', 'abx-formulation-output');
    wrap.append(output);

    const doseText = doseTextForDrug(card, drug, comboHeading);
    const metaSpans = card.querySelectorAll('.abx-option-meta > span');
    const frequencyText = frequencyOverride || clean(metaSpans[0]?.textContent || '');
    const durationText = clean(card.querySelector('.abx-duration')?.textContent || '');
    const basisKind = card.querySelector('.abx-dose-basis')?.dataset.basis || '';
    const sequence = comboHeading ? [] : parseSequence(doseText);

    // The largest dose the scheme asks for decides the starting strength: it is
    // the one whose volume would be hardest to give.
    const largestDoseMg = sequence.length
      ? Math.max(...sequence.map(step => step.mg))
      : parseSimpleDose(doseText)?.max;
    const preferred = preferredForm(forms, largestDoseMg);
    if (preferred) select.value = preferred.id;

    function refresh() {
      customWrap.hidden = select.value !== 'custom';
      const strength = selectedStrength(select, customMg, customMl);
      // One source of truth for the chosen strength: the prescription builder
      // reads it back from here instead of re-parsing the inputs.
      wrap.dataset.mgPer5ml = strength ? String(strength.mgPer5mL) : '';
      wrap.dataset.strengthLabel = strength ? strength.label : '';
      const headline = renderResult(output, { drug, doseText, frequencyText, durationText, basisKind, sequence, strength });
      summaryValue.textContent = headline ? `${headline.volume} për dozë` : '';
      summaryStrength.textContent = headline ? headline.strength : 'hap për ta kthyer dozën në mL';
    }

    // Switching to a custom strength starts from the listed one that was on
    // screen, so the common case is a two-character edit rather than retyping.
    let lastFormId = select.value;
    select.addEventListener('change', () => {
      if (select.value === 'custom' && !clean(customMg.value)) {
        const previous = availableForms(drug).find(form => form.id === lastFormId);
        customMg.value = previous ? String(previous.mgPer5mL).replace('.', ',') : '';
        customMl.value = previous ? '5' : '';
      }
      if (select.value !== 'custom') lastFormId = select.value;
      refresh();
    });
    customMg.addEventListener('input', refresh);
    customMl.addEventListener('input', refresh);
    refresh();
    return wrap;
  }

  function enhanceCard(card) {
    if (card.dataset.formulationsEnhanced === '1') return;
    card.dataset.formulationsEnhanced = '1';

    const heading = clean(card.querySelector('.abx-option-head h3')?.textContent || '');
    if (!heading || /Incizion|drenazh/i.test(heading)) return;

    const combo = config.comboAliases?.[heading];
    if (Array.isArray(combo) && combo.length) {
      const group = make('div', 'abx-formulation-group');
      combo.forEach(part => {
        const converter = buildConverter(card, part.drug, part.frequency, true);
        if (converter) group.append(converter);
      });
      if (group.childElementCount) card.append(group);
      return;
    }

    const converter = buildConverter(card, heading, null, false);
    if (converter) card.append(converter);
  }

  function scan() {
    list.querySelectorAll('.abx-option').forEach(enhanceCard);
  }

  const observer = new MutationObserver(() => scan());
  observer.observe(list, { childList:true, subtree:false });
  scan();
})();