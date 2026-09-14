(() => {
  'use strict';

  const dailymed = 'DailyMed / official U.S. label';

  window.DRX_ANTIBIOTIC_FORMULATIONS = Object.freeze({
    version:'2026-09-12-v2-phase7-formulations',
    scope:'oral-liquid-conversion',
    note:'Këto janë fuqi të verifikuara nga etiketa zyrtare të produkteve, jo garanci që i njëjti formulim gjendet në Kosovë. Gjithmonë verifiko fuqinë në shishe. Për kombinimet, mL llogaritet vetëm nga komponenti mbi të cilin është bazuar doza klinike.',
    sourceLabel:dailymed,
    drugs:{
      'Penicillin V':{
        basis:'penicillin V',
        forms:[
          { id:'penv-250-5', label:'250 mg / 5 mL', mgPer5mL:250, sourceUrl:'https://dailymed.nlm.nih.gov/dailymed/lookup.cfm?setid=465b1fbe-7a9a-4e81-a44e-0ecb3d8472bd' },
          { id:'penv-125-5', label:'125 mg / 5 mL', mgPer5mL:125, sourceUrl:'https://dailymed.nlm.nih.gov/dailymed/lookup.cfm?setid=465b1fbe-7a9a-4e81-a44e-0ecb3d8472bd' }
        ]
      },
      'Amoxicillin':{
        basis:'amoxicillin',
        forms:[
          { id:'amox-125-5', label:'125 mg / 5 mL', mgPer5mL:125, sourceUrl:'https://dailymed.nlm.nih.gov/dailymed/fda/fdaDrugXsl.cfm?setid=234d0dfc-cb24-413f-b798-129c73eb848e&type=display' },
          { id:'amox-250-5', label:'250 mg / 5 mL', mgPer5mL:250, sourceUrl:'https://dailymed.nlm.nih.gov/dailymed/fda/fdaDrugXsl.cfm?setid=234d0dfc-cb24-413f-b798-129c73eb848e&type=display' },
          { id:'amox-400-5', label:'400 mg / 5 mL', mgPer5mL:400, sourceUrl:'https://www.dailymed.nlm.nih.gov/dailymed/drugInfo.cfm?setid=c84082fc-ea07-4e73-99c5-8356b957a1c5' },
          { id:'amox-200-5', label:'200 mg / 5 mL', mgPer5mL:200, sourceUrl:'https://www.dailymed.nlm.nih.gov/dailymed/drugInfo.cfm?setid=c84082fc-ea07-4e73-99c5-8356b957a1c5' }
        ]
      },
      'Amoxicillin / clavulanate':{
        basis:'amoxicillin',
        combination:true,
        forms:[
          { id:'amoxclav-600-42.9-5', label:'600 / 42,9 mg / 5 mL', mgPer5mL:600, composition:'600 mg amoxicillin + 42,9 mg clavulanate / 5 mL', sourceUrl:'https://www.dailymed.nlm.nih.gov/dailymed/drugInfo.cfm?setid=df4136c0-9efd-42c3-a487-e728e8b91275' },
          { id:'amoxclav-400-57-5', label:'400 / 57 mg / 5 mL', mgPer5mL:400, composition:'400 mg amoxicillin + 57 mg clavulanate / 5 mL', sourceUrl:'https://dailymed.nlm.nih.gov/dailymed/lookup.cfm?setid=36fb1fec-f0f5-6d2f-e054-00144ff88e88' },
          { id:'amoxclav-200-28.5-5', label:'200 / 28,5 mg / 5 mL', mgPer5mL:200, composition:'200 mg amoxicillin + 28,5 mg clavulanate / 5 mL', sourceUrl:'https://dailymed.nlm.nih.gov/dailymed/lookup.cfm?setid=36fb1fec-f0f5-6d2f-e054-00144ff88e88' }
        ],
        caution:'Formulimet amoxicillin/clavulanate me raporte të ndryshme nuk janë të këmbyeshme automatikisht. mL llogaritet nga komponenti amoxicillin; verifiko edhe sasinë e clavulanate në produktin real.'
      },
      'Cephalexin':{
        basis:'cephalexin',
        forms:[
          { id:'cephalexin-250-5', label:'250 mg / 5 mL', mgPer5mL:250, sourceUrl:'https://dailymed.nlm.nih.gov/dailymed/lookup.cfm?setid=553485f8-890d-4929-a6bb-905221cf411d' },
          { id:'cephalexin-125-5', label:'125 mg / 5 mL', mgPer5mL:125, sourceUrl:'https://dailymed.nlm.nih.gov/dailymed/lookup.cfm?setid=553485f8-890d-4929-a6bb-905221cf411d' }
        ]
      },
      'Cefpodoxime':{
        basis:'cefpodoxime',
        forms:[
          { id:'cefpodoxime-100-5', label:'100 mg / 5 mL', mgPer5mL:100, sourceUrl:'https://dailymed.nlm.nih.gov/dailymed/drugInfo.cfm?setid=edf589b2-f796-4522-a5e6-2bd0a833922f' },
          { id:'cefpodoxime-50-5', label:'50 mg / 5 mL', mgPer5mL:50, sourceUrl:'https://dailymed.nlm.nih.gov/dailymed/drugInfo.cfm?setid=edf589b2-f796-4522-a5e6-2bd0a833922f' }
        ]
      },
      'Cefdinir':{
        basis:'cefdinir',
        forms:[
          { id:'cefdinir-250-5', label:'250 mg / 5 mL', mgPer5mL:250, sourceUrl:'https://www.dailymed.nlm.nih.gov/dailymed/drugInfo.cfm?setid=a1f49fe1-b511-4f6b-a912-8ae8662d95a5' },
          { id:'cefdinir-125-5', label:'125 mg / 5 mL', mgPer5mL:125, sourceUrl:'https://www.dailymed.nlm.nih.gov/dailymed/drugInfo.cfm?setid=a1f49fe1-b511-4f6b-a912-8ae8662d95a5' }
        ]
      },
      'Clindamycin':{
        basis:'clindamycin',
        forms:[
          { id:'clinda-75-5', label:'75 mg / 5 mL', mgPer5mL:75, sourceUrl:'https://dailymed.nlm.nih.gov/dailymed/fda/fdaDrugXsl.cfm?setid=a85e28ea-03be-471f-ad7f-f5c55c67ac97' }
        ]
      },
      'Azithromycin':{
        basis:'azithromycin',
        forms:[
          { id:'azithro-200-5', label:'200 mg / 5 mL', mgPer5mL:200, sourceUrl:'https://dailymed.nlm.nih.gov/dailymed/drugInfo.cfm?setid=2c9de2e9-c20c-4660-a272-a22019f9fb02' },
          { id:'azithro-100-5', label:'100 mg / 5 mL', mgPer5mL:100, sourceUrl:'https://dailymed.nlm.nih.gov/dailymed/drugInfo.cfm?setid=2c9de2e9-c20c-4660-a272-a22019f9fb02' }
        ]
      },
      'Clarithromycin':{
        basis:'clarithromycin',
        forms:[
          { id:'clarithro-250-5', label:'250 mg / 5 mL', mgPer5mL:250, sourceUrl:'https://dailymed.nlm.nih.gov/dailymed/drugInfo.cfm?audience=professional&setid=22457862-0f88-4be8-b507-1c8f264269f2' },
          { id:'clarithro-125-5', label:'125 mg / 5 mL', mgPer5mL:125, sourceUrl:'https://dailymed.nlm.nih.gov/dailymed/drugInfo.cfm?audience=professional&setid=22457862-0f88-4be8-b507-1c8f264269f2' }
        ]
      },
      'Cefixime':{
        basis:'cefixime',
        forms:[
          { id:'cefixime-200-5', label:'200 mg / 5 mL', mgPer5mL:200, sourceUrl:'https://dailymed.nlm.nih.gov/dailymed/drugInfo.cfm?setid=068e6edd-a5fe-40d8-8dcf-ac82b78dced4' },
          { id:'cefixime-100-5', label:'100 mg / 5 mL', mgPer5mL:100, sourceUrl:'https://dailymed.nlm.nih.gov/dailymed/drugInfo.cfm?setid=068e6edd-a5fe-40d8-8dcf-ac82b78dced4' }
        ]
      },
      'Nitrofurantoin':{
        basis:'nitrofurantoin',
        forms:[
          { id:'nitro-25-5', label:'25 mg / 5 mL', mgPer5mL:25, sourceUrl:'https://dailymed.nlm.nih.gov/dailymed/drugInfo.cfm?setid=dd99ba40-edff-47c3-9ee4-7e5b7774e5b5' }
        ]
      },
      'Trimethoprim / sulfamethoxazole':{
        basis:'trimethoprim',
        combination:true,
        forms:[
          { id:'tmpsmx-40-200-5', label:'40 / 200 mg / 5 mL (TMP/SMX)', mgPer5mL:40, composition:'40 mg trimethoprim + 200 mg sulfamethoxazole / 5 mL', sourceUrl:'https://dailymed.nlm.nih.gov/dailymed/drugInfo.cfm?setid=acc3df02-1e99-46e6-8a31-9b26261c6daa' }
        ],
        caution:'mL llogaritet nga komponenti trimethoprim, sepse doza klinike në DRx është e bazuar në trimethoprim.'
      },
      'Ciprofloxacin':{
        basis:'ciprofloxacin',
        forms:[
          { id:'cipro-250-5', label:'250 mg / 5 mL', mgPer5mL:250, sourceUrl:'https://dailymed.nlm.nih.gov/dailymed/drugInfo.cfm?setid=888dc7f9-ad9c-4c00-8d50-8ddfd9bd27c0' },
          { id:'cipro-500-5', label:'500 mg / 5 mL', mgPer5mL:500, minWeightKg:13, weightRestriction:'10% suspension: do not offer below 13 kg.', sourceUrl:'https://dailymed.nlm.nih.gov/dailymed/drugInfo.cfm?setid=888dc7f9-ad9c-4c00-8d50-8ddfd9bd27c0' }
        ]
      },
      'Levofloxacin':{
        basis:'levofloxacin',
        forms:[
          { id:'levo-25-ml', label:'25 mg / mL (=125 mg / 5 mL)', mgPer5mL:125, sourceUrl:'https://dailymed.nlm.nih.gov/dailymed/drugInfo.cfm?setid=a894e40b-77e4-439b-b0f8-9a5cc7a1dd90' }
        ]
      },
      // The two CORE4 alternatives ship tablets but no suspension, which left
      // them with no paediatric liquid at all. These are the strengths the
      // suspensions are usually sold in — templates to start from, not label
      // claims, so they carry no source URL and the page says so.
      'Cefprozil':{
        basis:'cefprozil',
        forms:[
          { id:'cefprozil-125-5', label:'125 mg / 5 mL', mgPer5mL:125, marketTypical:true },
          { id:'cefprozil-250-5', label:'250 mg / 5 mL', mgPer5mL:250, marketTypical:true }
        ]
      },
      'Cefuroxime':{
        basis:'cefuroxime axetil',
        forms:[
          { id:'cefuroxime-125-5', label:'125 mg / 5 mL', mgPer5mL:125, marketTypical:true },
          { id:'cefuroxime-250-5', label:'250 mg / 5 mL', mgPer5mL:250, marketTypical:true }
        ],
        caution:'Suspensioni i cefuroxime axetil nuk është bioekuivalent me tabletën; merret me ushqim.'
      }
    },
    indicationOverrides:{
      'aom|Amoxicillin / clavulanate':{ allow:['amoxclav-600-42.9-5'], note:'Për konvertimin e skemës me dozë të lartë të amoxicillin shfaqet vetëm raporti 600/42,9 mg/5 mL. Mos e zëvendëso automatikisht me raport tjetër.' },
      'sinusitis|Amoxicillin / clavulanate':{ allow:['amoxclav-600-42.9-5'], note:'Për konvertimin e skemës me dozë të lartë të amoxicillin shfaqet vetëm raporti 600/42,9 mg/5 mL. Mos e zëvendëso automatikisht me raport tjetër.' },
      'cellulitis|Amoxicillin / clavulanate':{ allow:['amoxclav-400-57-5'] },
      'preseptal|Amoxicillin / clavulanate':{ allow:['amoxclav-400-57-5'] },
      'bite|Amoxicillin / clavulanate':{ allow:['amoxclav-400-57-5'] },
      'lymphadenitis|Amoxicillin / clavulanate':{ allow:['amoxclav-400-57-5'] },
      'uti-cystitis|Amoxicillin / clavulanate':{ manualOnly:true, note:'CPS 2026 jep dozën sipas komponentit amoxicillin, por nuk specifikon raportin e formulimit. Shkruaj fuqinë reale të produktit që ke në dorë; mos supozo raportin.' },
      'uti-pyelo|Amoxicillin / clavulanate':{ manualOnly:true, note:'CPS 2026 jep dozën sipas komponentit amoxicillin, por nuk specifikon raportin e formulimit. Shkruaj fuqinë reale të produktit që ke në dorë; mos supozo raportin.' }
    },
    comboAliases:{
      'TMP-SMX + Clindamycin':[
        { drug:'Trimethoprim / sulfamethoxazole', frequency:'2 herë/ditë' },
        { drug:'Clindamycin', frequency:'3 herë/ditë' }
      ]
    }
  });
})();