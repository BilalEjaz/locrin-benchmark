(() => {
  'use strict';

  const $ = selector => document.querySelector(selector);

  // CORE4 source pack requested for the four original infections. The shell is
  // loaded before antibiotiket-data.js, so these setters apply the source-pinned
  // regimen/formulation overlay synchronously as the static datasets are assigned.
  // No layout/CSS/UI structure is changed here.
  const core4Source = Object.freeze({
    id:'cps-core4-2022',
    short:'CPS CORE4 2022',
    title:'Managing critical drug shortages in clinical practice — Table 1',
    date:'2022-12',
    url:'https://www.cps.ca',
    note:'Burimi kryesor i zgjedhur për katër infeksionet bazë të DRx: CAP, AOM, GAS dhe UTI. Regjimet ruhen siç janë në tabelën e dhjetorit 2022; data e burimit mbetet e dukshme kur udhëzimet më të reja ndryshojnë.'
  });

  const core4 = Object.freeze({
    aom:{
      source:'cps-core4-2022',
      minAgeMonths:6,
      options:[
        { id:'core4-amox-aom', tier:'first', allergy:['none','a0','a4'], drug:'Amoxicillin', route:'PO', frequency:'2 herë/ditë', dose:{type:'range',min:37.5,max:45,unit:'mg/kg/dozë',maxDose:500}, duration:{type:'age-bands',bands:[{maxMonths:24,text:'10 ditë'}],defaultText:'5 ditë'}, source:'cps-core4-2022', note:'CORE4: kapsula 250 mg ose 500 mg. Burimi lejon konsiderimin e rrumbullakimit te madhësia e kapsulës; DRx nuk e automatizon rrumbullakimin.' },
        { id:'core4-amoxclav-aom', tier:'second', allergy:['none','a0','a4'], drug:'Amoxicillin / clavulanate', route:'PO', frequency:'2 herë/ditë', dose:{type:'range',min:37.5,max:45,unit:'mg/kg/dozë',maxDose:875,component:'amoxicillin'}, duration:{type:'age-bands',bands:[{maxMonths:24,text:'10 ditë'}],defaultText:'5 ditë'}, source:'cps-core4-2022', note:'CORE4: tableta 500/125 mg ose 875/125 mg. Doza bazohet në komponentin amoxicillin; raporti i produktit nuk ndërrohet automatikisht.' },
        { id:'core4-cefprozil-aom', tier:'allergy-low', allergy:['a1'], drug:'Cefprozil', route:'PO', frequency:'2 herë/ditë', dose:{type:'single',value:15,unit:'mg/kg/dozë',maxDose:500}, duration:{type:'age-bands',bands:[{maxMonths:24,text:'10 ditë'}],defaultText:'5 ditë'}, source:'cps-core4-2022', note:'CORE4: alternativë për alergji ndaj penicilinës jo kërcënuese për jetën; tableta 250 mg ose 500 mg.' },
        { id:'core4-cefuroxime-aom', tier:'allergy-low', allergy:['a1'], drug:'Cefuroxime', route:'PO', frequency:'2 herë/ditë', dose:{type:'single',value:15,unit:'mg/kg/dozë',maxDose:500}, duration:{type:'age-bands',bands:[{maxMonths:24,text:'10 ditë'}],defaultText:'5 ditë'}, source:'cps-core4-2022', note:'CORE4: alternativë për alergji ndaj penicilinës jo kërcënuese për jetën; tableta 250 mg ose 500 mg.' },
        { id:'core4-clarithro-aom', tier:'allergy-severe', allergy:['a2','a3'], drug:'Clarithromycin', route:'PO', frequency:'2 herë/ditë', dose:{type:'single',value:7.5,unit:'mg/kg/dozë',maxDose:500}, duration:{type:'age-bands',bands:[{maxMonths:24,text:'10 ditë'}],defaultText:'5 ditë'}, source:'cps-core4-2022', note:'CORE4: opsioni #1 në alergji ndaj penicilinës kërcënuese për jetën; tableta 250 mg ose 500 mg.' },
        { id:'core4-azithro-aom', tier:'allergy-severe', allergy:['a2','a3'], drug:'Azithromycin', route:'PO', frequency:'1 herë/ditë', dose:{type:'sequence',steps:[{label:'Dita 1',value:10,maxDose:500},{label:'Ditët 2–5',value:5,maxDose:250}],unit:'mg/kg/ditë'}, duration:{type:'fixed',text:'5 ditë'}, source:'cps-core4-2022', note:'CORE4: opsioni #2 në alergji ndaj penicilinës kërcënuese për jetën.' }
      ]
    },
    gas:{
      source:'cps-core4-2022',
      options:[
        { id:'core4-penicillin-gas', tier:'first', allergy:['none','a0','a4'], drug:'Penicillin V', route:'PO', frequency:'2 ose 3 herë/ditë', dose:{type:'fixed',text:'<27 kg: 300 mg · ≥27 kg: 600 mg'}, duration:{type:'fixed',text:'10 ditë'}, source:'cps-core4-2022', note:'CORE4: tabletë 300 mg. Regjim me prag peshe; teksti mbahet i plotë që konvertuesi të mos supozojë gabimisht një dozë të vetme.' },
        { id:'core4-amoxicillin-gas', tier:'first', allergy:['none','a0','a4'], drug:'Amoxicillin', route:'PO', frequency:'1 herë/ditë', dose:{type:'single',value:50,unit:'mg/kg/dozë',maxDose:1000,maxLabel:'maks. 1000 mg/ditë'}, duration:{type:'fixed',text:'Sipas protokollit GAS të cituar nga CPS'}, source:'cps-core4-2022', note:'CORE4: mund të ndahet edhe në 2 doza/ditë. Tabela e upload-uar nuk shtyp kohëzgjatje numerike në këtë rresht, prandaj DRx nuk e shpik.' },
        { id:'core4-cephalexin-gas', tier:'allergy-low', allergy:['a1'], drug:'Cephalexin', route:'PO', frequency:'2 herë/ditë', dose:{type:'single',value:20,unit:'mg/kg/dozë',maxDose:500}, duration:{type:'fixed',text:'Sipas protokollit GAS të cituar nga CPS'}, source:'cps-core4-2022', note:'CORE4: alergji ndaj penicilinës jo kërcënuese për jetën; tableta 250 mg ose 500 mg.' },
        { id:'core4-clarithro-gas', tier:'allergy-severe', allergy:['a2','a3'], drug:'Clarithromycin', route:'PO', frequency:'2 herë/ditë', dose:{type:'single',value:7.5,unit:'mg/kg/dozë',maxDose:250}, duration:{type:'fixed',text:'Sipas protokollit GAS të cituar nga CPS'}, source:'cps-core4-2022', note:'CORE4: alergji ndaj penicilinës kërcënuese për jetën; tabletë 250 mg.' },
        { id:'core4-azithro-gas', tier:'allergy-severe', allergy:['a2','a3'], drug:'Azithromycin', route:'PO', frequency:'1 herë/ditë', dose:{type:'single',value:12,unit:'mg/kg/dozë',maxDose:500}, duration:{type:'fixed',text:'5 ditë'}, source:'cps-core4-2022', note:'CORE4 12/2022: ky regjim është source-pinned; udhëzimet më të reja për GAS mund të japin sekuencë tjetër dhe nuk përzihen në heshtje me këtë kartë.' }
      ]
    },
    pneumonia:{
      source:'cps-core4-2022',
      minAgeMonths:3,
      options:[
        { id:'core4-amox-pna', tier:'first', allergy:['none','a0','a4'], drug:'Amoxicillin', route:'PO', frequency:'3 herë/ditë', dose:{type:'range',min:20,max:30,unit:'mg/kg/dozë',maxDose:500}, duration:{type:'fixed',text:'5 ditë'}, source:'cps-core4-2022', note:'CORE4: kapsula 250 mg ose 500 mg.' },
        { id:'core4-amoxclav-pna', tier:'second', allergy:['none','a0','a4'], drug:'Amoxicillin / clavulanate', route:'PO', frequency:'3 herë/ditë', dose:{type:'range',min:20,max:30,unit:'mg/kg/dozë',maxDose:500,component:'amoxicillin'}, duration:{type:'fixed',text:'5 ditë'}, source:'cps-core4-2022', note:'CORE4: tableta 500/125 mg ose 875/125 mg; doza bazohet në komponentin amoxicillin.' },
        { id:'core4-cefprozil-pna', tier:'allergy-low', allergy:['a1'], drug:'Cefprozil', route:'PO', frequency:'2 herë/ditë', dose:{type:'single',value:15,unit:'mg/kg/dozë',maxDose:500}, duration:{type:'fixed',text:'5 ditë'}, source:'cps-core4-2022', note:'CORE4: alergji ndaj penicilinës jo kërcënuese për jetën; tableta 250 mg ose 500 mg.' },
        { id:'core4-cefuroxime-pna', tier:'allergy-low', allergy:['a1'], drug:'Cefuroxime', route:'PO', frequency:'2 herë/ditë', dose:{type:'single',value:15,unit:'mg/kg/dozë',maxDose:500}, duration:{type:'fixed',text:'5 ditë'}, source:'cps-core4-2022', note:'CORE4: alergji ndaj penicilinës jo kërcënuese për jetën; tableta 250 mg ose 500 mg.' },
        { id:'core4-clarithro-pna-allergy', tier:'allergy-severe', allergy:['a2','a3'], drug:'Clarithromycin', route:'PO', frequency:'2 herë/ditë', dose:{type:'single',value:7.5,unit:'mg/kg/dozë',maxDose:500}, duration:{type:'fixed',text:'5 ditë'}, source:'cps-core4-2022', note:'CORE4: alergji ndaj penicilinës kërcënuese për jetën.' },
        { id:'core4-azithro-pna-allergy', tier:'allergy-severe', allergy:['a2','a3'], drug:'Azithromycin', route:'PO', frequency:'1 herë/ditë', dose:{type:'sequence',steps:[{label:'Dita 1',value:10,maxDose:500},{label:'Ditët 2–5',value:5,maxDose:250}],unit:'mg/kg/ditë'}, duration:{type:'fixed',text:'5 ditë'}, source:'cps-core4-2022', note:'CORE4: alergji ndaj penicilinës kërcënuese për jetën.' },
        { id:'core4-clarithro-pna-atypical', tier:'atypical', allergy:['none','a0','a1','a2','a3','a4'], atypical:true, drug:'Clarithromycin', route:'PO', frequency:'2 herë/ditë', dose:{type:'single',value:7.5,unit:'mg/kg/dozë',maxDose:500}, duration:{type:'fixed',text:'5 ditë'}, source:'cps-core4-2022', note:'CORE4: opsion kur dyshohet pneumoni atipike.' },
        { id:'core4-azithro-pna-atypical', tier:'atypical', allergy:['none','a0','a1','a2','a3','a4'], atypical:true, drug:'Azithromycin', route:'PO', frequency:'1 herë/ditë', dose:{type:'sequence',steps:[{label:'Dita 1',value:10,maxDose:500},{label:'Ditët 2–5',value:5,maxDose:250}],unit:'mg/kg/ditë'}, duration:{type:'fixed',text:'5 ditë'}, source:'cps-core4-2022', note:'CORE4: opsion kur dyshohet pneumoni atipike.' }
      ]
    },
    'uti-cystitis':{
      source:'cps-core4-2022',
      minAgeMonths:3,
      options:[
        { id:'core4-cephalexin-cystitis', tier:'first', allergy:['none','a0','a1'], drug:'Cephalexin', route:'PO', frequency:'3 herë/ditë', dose:{type:'range',min:15,max:20,unit:'mg/kg/dozë',maxDose:500}, duration:{type:'fixed',text:'7 ditë'}, source:'cps-core4-2022', note:'CORE4: UTI ≥3 muaj, terapi empirike duke pritur urinokulturën. Tableta 250 mg ose 500 mg.' },
        { id:'core4-tmpsmx-cystitis', tier:'option', allergy:['none','a0','a1','a2','a3','a4'], drug:'Trimethoprim / sulfamethoxazole', route:'PO', frequency:'2 herë/ditë', dose:{type:'range',min:4,max:6,unit:'mg/kg/dozë',maxDose:160,component:'trimethoprim'}, duration:{type:'fixed',text:'3 ditë'}, source:'cps-core4-2022', note:'CORE4: doza bazohet në komponentin trimethoprim; tableta 80/400 mg ose 160/800 mg.' },
        { id:'core4-cefixime-cystitis', tier:'option', allergy:['none','a0','a1','a2'], drug:'Cefixime', route:'PO', frequency:'1 herë/ditë', dose:{type:'single',value:8,unit:'mg/kg/dozë',maxDose:400}, duration:{type:'fixed',text:'3 ditë'}, source:'cps-core4-2022', note:'CORE4: tabletë 400 mg.' },
        { id:'core4-amoxclav-cystitis', tier:'option', allergy:['none','a0','a4'], drug:'Amoxicillin / clavulanate', route:'PO', frequency:'sipas pragut të peshës', dose:{type:'fixed',text:'<35 kg: 15–20 mg/kg/dozë amoxicillin TID (maks. 500 mg) · ≥35 kg: 500/125 mg TID OSE 875/125 mg BID'}, duration:{type:'fixed',text:'3 ditë'}, source:'cps-core4-2022', frequencyNotComputable:true, note:'CORE4: mbaji degët <35 kg dhe ≥35 kg të ndara; mos konverto automatikisht raportin e amoxicillin/clavulanate.' },
        { id:'core4-cipro-cystitis', tier:'reserve', allergy:['none','a0','a1','a2','a3','a4'], drug:'Ciprofloxacin', route:'PO', frequency:'2 herë/ditë', dose:{type:'single',value:15,unit:'mg/kg/dozë',maxDose:750}, duration:{type:'fixed',text:'3 ditë'}, source:'cps-core4-2022', stewardship:'Kultura/ndjeshmëria dhe konteksti klinik mbeten gate; mos e kthe në zgjedhje rutinë vetëm sepse doza është në tabelë.' }
      ]
    },
    'uti-pyelo':{
      source:'cps-core4-2022',
      minAgeMonths:3,
      options:[
        { id:'core4-cephalexin-pyelo', tier:'first', allergy:['none','a0','a1'], drug:'Cephalexin', route:'PO', frequency:'3 herë/ditë', dose:{type:'range',min:15,max:20,unit:'mg/kg/dozë',maxDose:500}, duration:{type:'fixed',text:'7 ditë'}, source:'cps-core4-2022', note:'CORE4: UTI ≥3 muaj, terapi empirike duke pritur urinokulturën.' },
        { id:'core4-tmpsmx-pyelo', tier:'option', allergy:['none','a0','a1','a2','a3','a4'], drug:'Trimethoprim / sulfamethoxazole', route:'PO', frequency:'2 herë/ditë', dose:{type:'range',min:4,max:6,unit:'mg/kg/dozë',maxDose:160,component:'trimethoprim'}, duration:{type:'fixed',text:'7–10 ditë'}, source:'cps-core4-2022', note:'CORE4: doza bazohet në komponentin trimethoprim.' },
        { id:'core4-cefixime-pyelo', tier:'option', allergy:['none','a0','a1','a2'], drug:'Cefixime', route:'PO', frequency:'1 herë/ditë', dose:{type:'single',value:8,unit:'mg/kg/dozë',maxDose:400}, duration:{type:'fixed',text:'7–10 ditë'}, source:'cps-core4-2022', note:'CORE4: tabletë 400 mg.' },
        { id:'core4-amoxclav-pyelo', tier:'option', allergy:['none','a0','a4'], drug:'Amoxicillin / clavulanate', route:'PO', frequency:'sipas pragut të peshës', dose:{type:'fixed',text:'<35 kg: 15–20 mg/kg/dozë amoxicillin TID (maks. 500 mg) · ≥35 kg: 500/125 mg TID OSE 875/125 mg BID'}, duration:{type:'fixed',text:'7–10 ditë'}, source:'cps-core4-2022', frequencyNotComputable:true, note:'CORE4: mbaji degët <35 kg dhe ≥35 kg të ndara; raporti i produktit është pjesë e dozës.' },
        { id:'core4-cipro-pyelo', tier:'reserve', allergy:['none','a0','a1','a2','a3','a4'], drug:'Ciprofloxacin', route:'PO', frequency:'2 herë/ditë', dose:{type:'single',value:15,unit:'mg/kg/dozë',maxDose:750}, duration:{type:'fixed',text:'7–10 ditë'}, source:'cps-core4-2022', stewardship:'Kultura/ndjeshmëria dhe konteksti klinik mbeten gate; pacienti i sëmurë/komplikuar kërkon eskalim.' }
      ]
    }
  });

  function applyCore4Primary(guide) {
    if (!guide || !Array.isArray(guide.sources) || !Array.isArray(guide.indications)) return;
    if (!guide.sources.some(item => item?.id === core4Source.id)) guide.sources.unshift(core4Source);
    Object.entries(core4).forEach(([id, patch]) => {
      const indication = guide.indications.find(item => item?.id === id);
      if (!indication) return;
      indication.source = patch.source;
      if (Number.isFinite(patch.minAgeMonths)) indication.minAgeMonths = patch.minAgeMonths;
      indication.options = patch.options;
    });
  }

  function installGuideHook() {
    let value;
    Object.defineProperty(window, 'DRX_ANTIBIOTIC_GUIDE', {
      configurable:true,
      enumerable:true,
      get() { return value; },
      set(next) {
        value = next;
        applyCore4Primary(value);
      },
    });
  }

  function addSolid(drugs, drug, form) {
    if (!drugs[drug]) drugs[drug] = { forms:[] };
    if (!Array.isArray(drugs[drug].forms)) drugs[drug].forms = [];
    if (!drugs[drug].forms.some(item => item.id === form.id)) drugs[drug].forms.unshift(form);
  }

  function applyCore4Solids(solids) {
    const drugs = solids?.drugs;
    if (!drugs) return;
    addSolid(drugs, 'Penicillin V', { id:'core4-penv-tab-300', label:'Tabletë 300 mg · CORE4', form:'tabletë', componentMg:300, sourceUrl:'https://www.cps.ca', note:'Formë e listuar në CPS CORE4 12/2022.' });
    addSolid(drugs, 'Amoxicillin / clavulanate', { id:'core4-amoxclav-tab-500-125', label:'Tabletë 500/125 mg · CORE4', form:'tabletë', componentMg:500, composition:'500 mg amoxicillin + 125 mg clavulanate', singleUnitOnly:true, sourceUrl:'https://www.cps.ca', note:'Raporti i produktit është pjesë e regjimit CORE4.' });
    addSolid(drugs, 'Cefprozil', { id:'core4-cefprozil-tab-250', label:'Tabletë 250 mg · CORE4', form:'tabletë', componentMg:250, sourceUrl:'https://www.cps.ca' });
    addSolid(drugs, 'Cefprozil', { id:'core4-cefprozil-tab-500', label:'Tabletë 500 mg · CORE4', form:'tabletë', componentMg:500, sourceUrl:'https://www.cps.ca' });
    addSolid(drugs, 'Cefuroxime', { id:'core4-cefuroxime-tab-250', label:'Tabletë 250 mg · CORE4', form:'tabletë', componentMg:250, sourceUrl:'https://www.cps.ca' });
    addSolid(drugs, 'Cefuroxime', { id:'core4-cefuroxime-tab-500', label:'Tabletë 500 mg · CORE4', form:'tabletë', componentMg:500, sourceUrl:'https://www.cps.ca' });
  }

  function installSolidsHook() {
    let value;
    Object.defineProperty(window, 'DRX_ANTIBIOTIC_SOLIDS', {
      configurable:true,
      enumerable:true,
      get() { return value; },
      set(next) {
        value = next;
        applyCore4Solids(value);
      },
    });
  }

  installGuideHook();
  installSolidsHook();

  async function authJson(url = '/api/auth', options = {}, timeoutMs = 5000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, {
        credentials:'same-origin',
        cache:'no-store',
        ...options,
        signal:controller.signal,
        headers:{ Accept:'application/json', ...(options.headers || {}) },
      });
      const payload = await response.json().catch(() => ({}));
      return { response, payload };
    } finally {
      clearTimeout(timer);
    }
  }

  function redirectToLogin() {
    const target = new URL('/landing.html', location.origin);
    target.searchParams.set('return', location.pathname + location.search + location.hash);
    location.replace(target.pathname + target.search);
  }

  async function ensureAuth() {
    const { response, payload } = await authJson();
    if (response.status === 401 || response.status === 403 || (response.ok && payload.authenticated === false)) {
      redirectToLogin();
      throw new Error('Sesioni nuk është aktiv.');
    }
    if (!response.ok || payload.authenticated !== true) throw new Error('Sesioni nuk mund të verifikohet.');
    return payload;
  }

  function loadRuntime(src, marker) {
    const existing = document.querySelector(`script[${marker}]`);
    if (existing) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = src;
      script.defer = true;
      script.setAttribute(marker, '1');
      script.addEventListener('load', resolve, { once:true });
      script.addEventListener('error', reject, { once:true });
      document.head.appendChild(script);
    });
  }

  function loadStylesheet(href, marker) {
    const existing = document.querySelector(`link[${marker}]`);
    if (existing) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = href;
      link.setAttribute(marker, '1');
      link.addEventListener('load', resolve, { once:true });
      link.addEventListener('error', reject, { once:true });
      document.head.appendChild(link);
    });
  }

  async function syncProfile(payload) {
    await loadRuntime('/medindex-brand-runtime.js?v=drx-brand-v7', 'data-drx-profile-runtime').catch(() => null);
    window.MedIndexProfile?.adoptAccount?.(payload);
    window.dispatchEvent(new CustomEvent('medindex:auth-ready', { detail:payload }));
  }

  async function loadAntibioticFormulations() {
    await Promise.all([
      loadStylesheet('/antibiotiket-formulations.css?v=antibiotiket-formulations-v6', 'data-drx-abx-formulations-css'),
      loadRuntime('/antibiotiket-formulations-data.js?v=antibiotiket-formulations-v6', 'data-drx-abx-formulations-data'),
    ]);
    await loadRuntime('/antibiotiket-formulations.js?v=antibiotiket-formulations-v6', 'data-drx-abx-formulations-runtime');
  }

  async function loadAntibioticPrescription() {
    await Promise.all([
      loadStylesheet('/antibiotiket-prescription.css?v=antibiotiket-phase4-v3', 'data-drx-abx-prescription-css'),
      loadRuntime('/antibiotiket-solids-data.js?v=antibiotiket-phase4-v1', 'data-drx-abx-solids-data'),
    ]);
    await loadRuntime('/antibiotiket-prescription.js?v=antibiotiket-phase4-v3', 'data-drx-abx-prescription-runtime');
  }

  async function loadAntibioticHospital() {
    await Promise.all([
      loadStylesheet('/antibiotiket-hospital.css?v=antibiotiket-phase5-v1', 'data-drx-abx-hospital-css'),
      loadRuntime('/antibiotiket-hospital-data.js?v=antibiotiket-phase5-v1', 'data-drx-abx-hospital-data'),
    ]);
    await loadRuntime('/antibiotiket-hospital.js?v=antibiotiket-phase5-v1', 'data-drx-abx-hospital-runtime');
  }

  async function loadAntibioticParenteralPreparation() {
    await Promise.all([
      loadStylesheet('/antibiotiket-parenteral-prep.css?v=antibiotiket-phase6-v2', 'data-drx-abx-prep-css'),
      loadRuntime('/antibiotiket-parenteral-prep-data.js?v=antibiotiket-phase6-v2', 'data-drx-abx-prep-data'),
    ]);
    await loadRuntime('/antibiotiket-parenteral-bridge.js?v=antibiotiket-phase6-v2', 'data-drx-abx-prep-bridge');
    await loadRuntime('/antibiotiket-parenteral-prep.js?v=antibiotiket-phase6-v2', 'data-drx-abx-prep-runtime');
  }

  function openSidebar() {
    $('#sidebar')?.classList.add('is-open');
    const backdrop = $('#sidebarBackdrop');
    if (backdrop) backdrop.hidden = false;
  }

  function closeSidebar() {
    $('#sidebar')?.classList.remove('is-open');
    const backdrop = $('#sidebarBackdrop');
    if (backdrop) backdrop.hidden = true;
  }

  async function logout() {
    const button = $('#logoutButton');
    if (button) button.disabled = true;
    try {
      const { response } = await authJson('/api/auth', { method:'DELETE' });
      if (!response.ok) throw new Error('Dalja nuk u krye.');
      location.replace('/landing.html');
    } catch {
      if (button) button.disabled = false;
    }
  }

  function bindShell() {
    $('#menuButton')?.addEventListener('click', openSidebar);
    $('#sidebarClose')?.addEventListener('click', closeSidebar);
    $('#sidebarBackdrop')?.addEventListener('click', closeSidebar);
    $('#logoutButton')?.addEventListener('click', logout);
    window.addEventListener('keydown', event => {
      if (event.key === 'Escape') closeSidebar();
    });
  }

  async function boot() {
    bindShell();
    try {
      const auth = await ensureAuth();
      await syncProfile(auth);
      await loadAntibioticFormulations().catch(() => null);
      await loadAntibioticPrescription().catch(() => null);
      await loadAntibioticHospital().catch(() => null);
      await loadAntibioticParenteralPreparation().catch(() => null);
      document.documentElement.dataset.theme = 'light';
      if ($('#allergyLabel')) $('#allergyLabel').textContent = 'Alergjia ndaj beta-laktameve';
      if ($('#sourceStatus')) $('#sourceStatus').textContent = 'Antibiotikët · CORE4 CPS 2022 + PO + Hospital IV/IM + preparation produkt-specifik';
    } catch {
      return;
    } finally {
      $('#appShell')?.setAttribute('aria-busy', 'false');
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once:true });
  else void boot();
})();