// constants.js — single source of truth for the Tracking Finance page.
//
// All enum values mirror the backend Pydantic validators. Sending any value
// outside these lists triggers a 422 from `PATCH /api/v1/finance-periods/{id}`.
// Keep in sync with backend `app/schemas/client_finance.py`.

// ── Roles allowed on this page ───────────────────────────────────────────
export const ALLOWED_ROLES = ['admin', 'finance_director', 'finance_team'];

// ── Qui peut écrire quoi (décision dev 2026-08-27) ───────────────────────
//
// L'équipe finance (Aurélie B, Lény Perron) consulte tout, filtre, télécharge
// les états de compte et commente — mais ne SAISIT PAS les encaissements.
// Elle peut en revanche entretenir la fiche : modalités, sociétés, associés,
// emails et téléphones.
//
// Ces listes ne font que refléter l'écran : le serveur refuse de son côté
// (`_FINANCE_TEAM_WRITABLE` dans client_finance.py). Une cellule grisée n'est
// pas une permission.
const AMOUNT_EDIT_ROLES = ['admin', 'finance_director'];

// Encaissements, dates de paiement, PSP, formule, état board.
export const canEditAmounts = (role) => AMOUNT_EDIT_ROLES.includes(role);

// Modalités, sociétés, associés, contacts.
export const canEditContract = (role) => ALLOWED_ROLES.includes(role);

// ── Commentable cells ────────────────────────────────────────────────────
//
// Maps `colKey` (frontend column key from `COLS_FULL` in TableView.jsx) to
// `field_name` (backend value accepted by `/api/v1/finance-periods/{row_id}/comments`).
//
// Adding a new commentable cell : add the colKey here AND make sure the
// backend accepts the corresponding `field_name` enum value. Both sides
// must agree (the backend rejects unknown field_name with 422).
export const COMMENTABLE_FIELDS = {
  etat:              'etat',
  overdueCurrent:    'overdue_current',
  overdueOwnerCum:   'overdue_owner_cumulative',
  overdueOptilexCum: 'overdue_optilex_cumulative',
};

// Depuis la refonte "vision" (2026-08-18), les colonnes de retard cumulé sont
// scope-dépendantes : la colonne `overdueCum` pointe vers le champ Owner OU
// Opti'lex selon la vision active. En vision Globale la colonne est une somme
// → pas de fil de commentaires (le backend n'a pas de field_name "somme").
export const SCOPED_COMMENT_FIELDS = {
  owner:   { etat: 'etat', overdueCum: 'overdue_owner_cumulative' },
  optilex: { etat: 'etat', overdueCum: 'overdue_optilex_cumulative' },
  global:  { etat: 'etat' },
};

// ── Column labels (SACRED — finance team vocabulary, verbatim) ───────────
//
// CES LABELS SONT FIGÉS PAR LE DEV. Aucune reformulation autorisée.
// Toute modification = casse le workflow de l'équipe finance.
// Source : brief 3e passe Tracking Finance (2026-05-08).
export const COLUMN_LABELS = {
  numero:               'Numéro client',
  societe:              'Nom client + entreprise',
  etat:                 'État',
  rdvLancement:         'RDV lancement',
  rdvOnboarding:        'RDV onboarding',
  paymentMode:          'Mode de paiement (Annuel / Mensuel)',
  paymentSpec:          'Modalité de paiement',
  autoDebit:            'Prélèvement automatisé',
  expectedOwner:        'Montant Attendu Owner',
  expectedOptilex:      'Montant Attendu Opti\'lex',
  receivedOwner:        'Montant Récupéré Owner',
  receivedOptilex:      'Montant Récupéré Opti\'lex',
  overdueCurrent:       'Retard de paiement',
  overdueOwnerCum:      'Retard de paiement sur les mois précédents Owner',
  overdueOptilexCum:    'Retard de paiement sur les mois précédents Opti\'lex',
  receivedOverdueOwner: 'Montant récupéré sur les créances des mois précédents Owner',
  receivedOverdueOpti:  'Montant récupéré sur les créances des mois précédents Opti\'lex',
  pspOwner:             'Check Owner',
  pspOptilex:           'Check Opti\'lex',
  payDateOwner:         'Date paiement Owner',
  payDateOptilex:       'Date paiement Opti\'lex',
  // 2026-08-18 (phase 2 condensation) : colonne compacte fusionnant
  // Mode + Modalité + Prélèvement. Nouveau libellé validé par le brief
  // finance — les libellés historiques ci-dessus restent intacts.
  modalites:            'Modalités',
};

// Libellé scope-dépendant : reprend le libellé sacré et retire UNIQUEMENT le
// suffixe d'entité (« Montant Récupéré Owner » → « Montant Récupéré »).
// Aucune autre reformulation — l'entité active est portée par le sélecteur de
// vision + le header de groupe (brief phase 2, 2026-08-18).
export const stripEntitySuffix = (label) =>
  String(label || '').replace(/\s+(Owner|Opti'lex)$/i, '');

// ── Editable enums (backend Pydantic strict) ─────────────────────────────
export const PSP_OPTIONS = ['Learnypay', 'IFX', 'whop', 'Quonto'];

// 2026-08-18 : `ETAT_OPTIONS` (enum snake_case `clients.etat`) et
// `FINANCE_STATUS_DETAILS` (colonne « État détail ») supprimés. La colonne
// État du tableau affiche/pose désormais l'état du board Owner/Opti'Lex
// (cf. components/BoardEtatCell.jsx) — le PATCH `etat` sur finance-periods
// est mort côté backend, et « État détail » a été retirée du tableau.
// `ETAT_COLORS` / `STATUS_DETAIL_COLORS` plus bas restent : encore importés
// par ClientDetailModal.jsx (legacy conservé), EditableCell.jsx et les
// fallbacks lecture seule du DetailPanel.

export const PAYMENT_SPECIFICITIES = [
  'Paye / 2 sct',
  'Paye / 3 sct',
  'Paye / 4 sct',
  'Paye / 5 sct',
];

export const AUTO_DEBIT_OPTIONS = [
  'OUI',
  'NON',
  'Partiellement Owner',
  'Partiellement Optilex',
  'En attend',
  'Non souhaitais',
  'Partiellement Optilex Non souhaité Owner',
];

export const PAYMENT_MODES = ['MONTHLY', 'YEARLY'];

// Libellés FR du mode de paiement. QUARTERLY : exposé par le backend via
// `client.payment_mode` normalisé (fallback quand la period n'a rien).
export const PAYMENT_MODE_LABELS = {
  MONTHLY:   'Mensuel',
  YEARLY:    'Annuel',
  QUARTERLY: 'Trimestriel',
};

// Canonicalise un mode de paiement vers l'enum MONTHLY/YEARLY/QUARTERLY.
// Accepte l'enum backend ET les libellés FR du board (`periodicite` :
// « Mensuel » / « Annuel » / « Trimestriel », casse variable) — source du
// 4e fallback de la chaîne modalité (2026-08-21). Null si inconnu/absent.
const PAYMENT_MODE_CANON = {
  MONTHLY: 'MONTHLY', YEARLY: 'YEARLY', QUARTERLY: 'QUARTERLY',
  MENSUEL: 'MONTHLY', ANNUEL: 'YEARLY', TRIMESTRIEL: 'QUARTERLY',
};
export const normalizePaymentMode = (m) =>
  PAYMENT_MODE_CANON[String(m || '').trim().toUpperCase()] || null;

export const paymentModeLabel = (m) =>
  PAYMENT_MODE_LABELS[normalizePaymentMode(m)] || null;

// ── Modalités compactes (colonne fusionnée, phase 2 2026-08-18) ──────────

// « Paye / N sct » → N (chip « N× »). Null si le format ne matche pas.
export const parsePaymentSpecCount = (spec) => {
  const m = String(spec || '').match(/Paye\s*\/\s*(\d+)\s*sct/i);
  return m ? parseInt(m[1], 10) : null;
};

// Dérive l'état des deux pastilles prélèvement O (Owner) / X (Opti'lex)
// depuis l'enum `auto_debit`. States : 'green' | 'red' | 'wait' | 'none'.
// Match case-insensitive : la DB contient des variantes de casse ('Non').
// Source unique — utilisée par la cellule Modalités ET le filtre
// « Non automatisé » (index.jsx). Ne pas dupliquer cette table.
export const autoDebitPastilles = (value) => {
  if (value === null || value === undefined || String(value).trim() === '') {
    return { owner: 'none', optilex: 'none' };
  }
  const canon = AUTO_DEBIT_OPTIONS.find(
    (o) => o.toUpperCase() === String(value).trim().toUpperCase()
  ) || null;
  switch (canon) {
    case 'OUI':                                      return { owner: 'green', optilex: 'green' };
    case 'NON':
    case 'Non souhaitais':                           return { owner: 'red',   optilex: 'red' };
    case 'Partiellement Owner':                      return { owner: 'green', optilex: 'red' };
    case 'Partiellement Optilex':
    case 'Partiellement Optilex Non souhaité Owner': return { owner: 'red',   optilex: 'green' };
    case 'En attend':                                return { owner: 'wait',  optilex: 'wait' };
    default:                                         return { owner: 'none',  optilex: 'none' };
  }
};

// ── Vision Owner / Opti'lex / Global (phase 2-3) ─────────────────────────
//
// Champs backend par entité — source UNIQUE du mapping vision → colonnes.
// Consommée par TableView (rendu + PATCH), index.jsx (filtres) et
// DetailPanel (KPIs / état de compte). Ne pas dupliquer cette table.
export const SCOPE_FIELDS = {
  owner: {
    expected:        'expected_owner',
    received:        'received_owner',
    overdueCum:      'overdue_owner_cumulative',
    receivedOverdue: 'received_overdue_owner',
    psp:             'psp_owner',
    payDate:         'payment_date_owner',
  },
  optilex: {
    expected:        'expected_optilex_ttc',
    received:        'received_optilex_ttc',
    overdueCum:      'overdue_optilex_cumulative',
    receivedOverdue: 'received_overdue_optilex_ttc',
    psp:             'psp_optilex',
    payDate:         'payment_date_optilex',
  },
};

// Retard courant / cumulé d'une row selon la vision active ('global' = somme).
export const scopedOverdueCurrent = (r, scope) =>
  (scope === 'optilex' ? 0 : (toNumber(r.overdue_owner_current_month) || 0)) +
  (scope === 'owner' ? 0 : (toNumber(r.overdue_optilex_current_month) || 0));

export const scopedOverdueCum = (r, scope) =>
  (scope === 'optilex' ? 0 : (toNumber(r.overdue_owner_cumulative) || 0)) +
  (scope === 'owner' ? 0 : (toNumber(r.overdue_optilex_cumulative) || 0));

// Trop-perçu reporté des mois antérieurs (backend 2026-08-25 : `credit_owner`
// / `credit_optilex_ttc`, toujours >= 0). Un solde créditeur N'EST PAS un
// retard : quand il existe, la créance de l'entité reste à 0. Deux suites
// possibles côté finance — déduire de la prochaine échéance ou rembourser —
// d'où sa mise en visibilité dans la page.
// Défensif : champs absents tant que le backend n'est pas déployé → 0.
// Trop-perçu = ce qu'on DOIT au client, entité par entité.
//
// Correction 2026-08-29 (signalée par Ismahane sur n°454) : on lisait
// `credit_*`, qui ne reprend que le cumul des mois ANTÉRIEURS. Un client qui
// solde tout son arriéré ET paie trop sur le mois en cours restait donc
// invisible — n°454 avait versé 4 235 € pour 1 155 € dus, soit 770 € de
// trop-perçu, et le filtre affichait « Trop-perçu 0 ».
//
// On raisonne désormais sur le SOLDE COMPLET du mois affiché : mois en cours
// + créances antérieures. Négatif = trop-perçu. Par entité, pour que les
// visions Owner / Opti'lex / Globale restent justes (un crédit d'un côté ne
// doit pas être masqué par une dette de l'autre).
const entityBalance = (r, entity) =>
  (toNumber(r[`overdue_${entity}_current_month`]) || 0)
  + (toNumber(r[`overdue_${entity}_cumulative`]) || 0);

// Ce qu'on doit au client sur UNE entité (0 s'il nous doit).
// Exporté : le formulaire de remboursement en a besoin par entité, et il ne
// doit surtout pas refaire le calcul dans son coin.
export const entityCredit = (r, entity) => Math.max(-entityBalance(r, entity), 0);

export const scopedCredit = (r, scope) =>
  (scope === 'optilex' ? 0 : entityCredit(r, 'owner')) +
  (scope === 'owner' ? 0 : entityCredit(r, 'optilex'));

// Ancienneté de la créance, en mois, dans la vision active.
//
// Le serveur donne le premier mois d'une dette JAMAIS soldée depuis
// (`overdue_*_since`) : un mois remis à zéro repart de zéro. On en déduit le
// nombre de mois écoulés. `null` = pas de dette datée (ou entité sans dette).
//
// En vision Globale, on retient la dette la PLUS ANCIENNE des deux entités :
// c'est celle qui commande la relance.
export const creanceAgeMonths = (r, scope) => {
  const dates = [];
  if (scope !== 'optilex' && r.overdue_owner_since) dates.push(r.overdue_owner_since);
  if (scope !== 'owner' && r.overdue_optilex_since) dates.push(r.overdue_optilex_since);
  if (!dates.length) return null;
  const plusAncienne = dates.sort()[0];
  const [y, m] = String(plusAncienne).slice(0, 7).split('-').map(Number);
  const now = new Date();
  return (now.getFullYear() - y) * 12 + (now.getMonth() + 1 - m);
};

// Totaux du bandeau, calculés sur les lignes RÉELLEMENT AFFICHÉES.
//
// Demande dev 2026-09-01 : « il faut que les totaux changent selon le filtre
// sélectionné, même un filtre qu'ils créent eux-mêmes. » L'appelant passe donc
// les lignes après filtrage ; ici on ne fait que sommer.
//
// Vit dans ce fichier, avec les autres règles, pour être testable et ne pas
// pouvoir diverger de ce que le tableau affiche.
export const computeKpis = (visibleRows, scope, allCount = null) => {
  let expected = 0;
  let received = 0;
  let overdue = 0;
  let overdueCum = 0;
  let receivedOverdue = 0;

  (visibleRows || []).forEach((r) => {
    const a = scopedPeriodAmounts(r, scope);
    expected += a.expected;
    received += a.received;
    overdue += scopedOverdueCurrent(r, scope);
    overdueCum += scopedOverdueCum(r, scope);
    receivedOverdue += a.receivedOverdue;
  });

  const total = (visibleRows || []).length;
  return {
    total,
    totalAll: allCount === null ? total : allCount,
    filtered: allCount !== null && allCount !== total,
    expectedGlobal: expected,
    receivedTotal: received,
    overdueTotal: overdue,
    // « Retard de paiement » du classeur = dette totale à date : retard du
    // mois + créances antérieures. C'est ce montant que la finance compare.
    overdueTotalWithCum: overdue + overdueCum,
    overdueCumTotal: overdueCum,
    // Taux du classeur finance (null si dénominateur 0 → rien affiché).
    receivedPct: formatPercent(received, expected),
    overdueRecoveredPct: formatPercent(receivedOverdue, overdueCum),
  };
};

// « Retard à date » = mois en cours + créances antérieures. Négatif = crédit.
// Une seule définition, pour que la tuile de la fiche, la colonne du tableau
// et les filtres ne puissent pas diverger (incident n°454, 2026-08-29).
export const scopedOverdueToDate = (r, scope) =>
  scopedOverdueCurrent(r, scope) + scopedOverdueCum(r, scope);

// Total encaissé par le client DEPUIS LE DÉBUT (échéances + arriérés),
// servi par le backend sur chaque ligne. Un total nul = aucune échéance
// jamais réglée, ce que la ligne mensuelle seule ne peut pas dire.
export const scopedReceivedTotal = (r, scope) =>
  (scope === 'optilex' ? 0 : (toNumber(r.received_total_owner) || 0)) +
  (scope === 'owner' ? 0 : (toNumber(r.received_total_optilex_ttc) || 0));

// Montants d'une period (row timeline) dans la vision active. `payDate` :
// par entité en vision entité ; en Globale, Owner en priorité (une somme de
// dates n'existe pas, on montre la première date connue).
export const scopedPeriodAmounts = (p, scope) => {
  if (scope === 'global') {
    return {
      expected:        (toNumber(p.expected_owner) || 0) + (toNumber(p.expected_optilex_ttc) || 0),
      received:        (toNumber(p.received_owner) || 0) + (toNumber(p.received_optilex_ttc) || 0),
      receivedOverdue: (toNumber(p.received_overdue_owner) || 0) + (toNumber(p.received_overdue_optilex_ttc) || 0),
      payDate:         p.payment_date_owner || p.payment_date_optilex || null,
    };
  }
  const f = SCOPE_FIELDS[scope];
  return {
    expected:        toNumber(p[f.expected]) || 0,
    received:        toNumber(p[f.received]) || 0,
    receivedOverdue: toNumber(p[f.receivedOverdue]) || 0,
    payDate:         p[f.payDate] || null,
  };
};

// ── Recherche client (2026-08-21) ────────────────────────────────────────

// Normalisation insensible casse/accents (NFD + strip diacritiques).
export const normalizeSearch = (s) => String(s || '')
  .toLowerCase()
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '');

// Prédicat de recherche d'une row finance-period — source UNIQUE partagée
// entre le filtre de TableView et le compteur de résultats d'index.jsx.
// Champs : numéro client, société (contient aussi le représentant),
// representative_name et email quand le backend les expose.
export const matchesClientSearch = (r, normalizedQuery) => {
  if (!normalizedQuery) return true;
  const c = r.client || {};
  return [c.numero_client, c.societe, c.representative_name, c.email]
    .some((v) => v && normalizeSearch(v).includes(normalizedQuery));
};

// ── Vues-filtres (chips, phase 2 2026-08-18) ─────────────────────────────

// États board de la vue « Résiliés / Rétractés ».
// Comparés à `displayEtat(boardRow)` (OptilexBoard.jsx — source de vérité).
//
// Uniquement les états ACTÉS. Un « En cours de résiliation » n'est pas un
// client résilié : la procédure est ouverte, il reste facturé, et la finance
// doit continuer à le suivre. Les compter ici faisait annoncer 132 clients
// sortis là où le board en montre 99 (correction 2026-08-25).
export const TERMINATED_BOARD_ETATS = new Set([
  'Résiliation',
  'Self-Résiliation',
  'Rétractation',
]);

// États qu'on ACTE depuis la finance, et qui engagent une sortie client. Les
// choisir ouvre le dialogue de sortie (date d'effet, sort des créances) au
// lieu de poser l'état à la volée — demande dev 2026-09-03 : « quand elle acte
// une résiliation, ça doit ouvrir le pop-up sortie client ».
export const ACTED_EXIT_ETATS = new Set([
  'Résiliation',
  'Rétractation',
  'Self-Résiliation',
  'Liquidation',
]);

// États de FIN DE RELATION, actés ou en cours : la relation s'arrête (ou va
// s'arrêter) et la finance doit trancher ce qu'il advient des créances —
// récupérées, ou passées en perte. Les « en cours de » comptent : la
// procédure est ouverte, la question se pose déjà.
export const EXIT_ETATS = new Set([
  'Liquidation',
  'En cours de liquidation',
  'Résiliation',
  'En cours de résiliation',
  'Rétractation',
  'En cours de rétractation',
  'Self-Résiliation',
]);

// Un client « à sortir » : dans un état de fin de relation, avec des créances
// antérieures encore dues dans la vision active, et sans perte actée. Il ne
// doit surtout pas disparaître du filtre « Créances antérieures » : tant que
// la sortie n'est pas actée, on ne sait pas ce qu'il reste à récupérer
// (règle dev 2026-09-03). C'est la sortie client qui le fait sortir, rien
// d'autre.
export const isExitCandidate = (r, boardEtat, scope) =>
  !!boardEtat && EXIT_ETATS.has(boardEtat)
  && !r?.client?.is_loss
  && scopedOverdueCum(r, scope) > 0;

// Tranches de la GRILLE TARIFAIRE (table `tarifs` du backend), et rien
// d'autre : c'est sur elles que le prix est calculé. La liste précédente
// (11-20, 21-50, 51-100, 101-200, 201-300, 301-400, +400) datait d'avant la
// grille actuelle — elle n'affichait aucun libellé au-delà de 6-10 et, plus
// grave, proposait à l'édition des tranches sans tarif : les choisir mettait
// l'attendu du client à zéro (corrigé 2026-08-26).
export const EMPLOYEE_RANGES = [
  '1-2',
  '3-5',
  '6-10',
  '11-19',
  '20-29',
  '30-39',
  '40-49',
  '50-74',
  '75-99',
  '100-149',
  '150-199',
  '200-249',
  '250-299',
  '300-349',
  '350-400',
];

// Les valeurs en base sont sales : « 6_-_10 », « 3-5salariés », « 11 - 19 »
// cohabitent avec la forme canonique. On nettoie le bruit de saisie sans
// jamais réinterpréter la tranche elle-même (un « 3-4 » reste « 3-4 »).
export const normalizeEmployeeRange = (v) => {
  if (!v) return null;
  const cleaned = String(v)
    .replace(/salari[ée]s?/gi, '')
    .replace(/[\s_]+/g, '')
    .trim();
  return cleaned || null;
};

// Libellé affiché : la tranche suivie de « salariés ». Vaut pour toutes les
// valeurs, y compris celles hors grille, sinon la fiche affichait « 11-19 »
// nu à côté d'un « 3-5 salariés » (retour dev 2026-08-26).
export const employeeRangeLabel = (v) => {
  const r = normalizeEmployeeRange(v);
  return r ? `${r} salariés` : null;
};


// ── Contacts typés (fiche client) ────────────────────────────────────────
//
// Miroir exact de CONTACT_LABELS côté backend (finance_client_profile.py).
// `value` est ce qui part au POST/PATCH ; `label` est l'affichage FR.
export const CONTACT_LABEL_OPTIONS = [
  { value: 'perso',       label: 'Perso' },
  { value: 'pro',         label: 'Pro' },
  { value: 'associe',     label: 'Associé' },
  { value: 'comptable',   label: 'Comptable' },
  { value: 'facturation', label: 'Facturation' },
];

// Libellés FR du journal de la fiche client (finance_sheet_change).
export const PROFILE_CHANGE_LABELS = {
  employee_range: 'Effectif',
  siren:          'SIREN',
  contact_email:  'Email',
  contact_phone:  'Téléphone',
  etat:           'État',
  nom:            'Nom client',
  sales:          'Sales',
  modalite:       'Modalité',
  prelevement_automatise: 'Prélèvement automatisé',
  date_signature: 'Date de signature',
  payment_promise: 'Promesse de règlement',
  loss:           'Perte client',
  societe_couverte: 'Société couverte',
  associe: 'Associé',
  rdv_onboarding: "RDV d'onboarding",
  responsible: 'Responsable',
};

// ── Visual hints for cells ───────────────────────────────────────────────

// Color palette for finance_status_detail pills. Maps to text + bg colors.
// Falls back to neutral grey if the detail is unknown.
export const STATUS_DETAIL_COLORS = {
  'Traité':                                          { fg: '#065f46', bg: '#d1fae5' },
  'Non traité':                                      { fg: '#6b7280', bg: '#f3f4f6' },
  'Relancer Owner':                                  { fg: '#92400e', bg: '#fef3c7' },
  'Relancer Optilex':                                { fg: '#92400e', bg: '#fef3c7' },
  'A partiellement validé sur certaine structure':   { fg: '#3730a3', bg: '#e0e7ff' },
  'En attente de retour':                            { fg: '#3730a3', bg: '#e0e7ff' },
  'À rembourser':                                    { fg: '#991b1b', bg: '#fee2e2' },
  'Relancé à voir si pas payé':                      { fg: '#92400e', bg: '#fef3c7' },
  'Promesse de règlement':                           { fg: '#1e40af', bg: '#dbeafe' },
  'Attente retour cabinet':                          { fg: '#3730a3', bg: '#e0e7ff' },
  'Prélèvement en cours':                            { fg: '#0e7490', bg: '#cffafe' },
  'Pas de réponse':                                  { fg: '#991b1b', bg: '#fee2e2' },
  'Promesse de règlement partiel':                   { fg: '#1e40af', bg: '#dbeafe' },
  'RDV lancement reprogrammé':                       { fg: '#3730a3', bg: '#e0e7ff' },
  'VIP':                                             { fg: '#7c2d12', bg: '#fed7aa' },
  'Mandataire':                                      { fg: '#581c87', bg: '#f3e8ff' },
};

export const STATUS_DETAIL_FALLBACK = { fg: '#6b7280', bg: '#f3f4f6' };

// Etat client (top-level pill)
export const ETAT_COLORS = {
  a_signe:           { fg: '#065f46', bg: '#d1fae5', label: 'À signer' },
  en_attente:        { fg: '#92400e', bg: '#fef3c7', label: 'En attente' },
  resilie:           { fg: '#991b1b', bg: '#fee2e2', label: 'Résilié' },
  sans_suite:        { fg: '#6b7280', bg: '#f3f4f6', label: 'Sans suite' },
  liquidation:       { fg: '#991b1b', bg: '#fee2e2', label: 'Liquidation' },
  pause:             { fg: '#3730a3', bg: '#e0e7ff', label: 'Pause' },
  self_resiliation:  { fg: '#991b1b', bg: '#fee2e2', label: 'Self résil.' },
  retractation:      { fg: '#7c2d12', bg: '#fed7aa', label: 'Rétractation' },
};

export const ETAT_FALLBACK = { fg: '#6b7280', bg: '#f3f4f6', label: '—' };

// PSP pills (Notion solid green family — "validation" semantic).
export const PSP_COLORS = {
  Learnypay: { fg: '#0f7b6c', bg: '#cfe9e3' },
  IFX:       { fg: '#0f7b6c', bg: '#cfe9e3' },
  whop:      { fg: '#0f7b6c', bg: '#cfe9e3' },
  Quonto:    { fg: '#0f7b6c', bg: '#cfe9e3' },
};
export const PSP_FALLBACK = { fg: '#6b7280', bg: '#f3f4f6' };

// Auto-debit pills (semantic colors per case).
export const AUTO_DEBIT_COLORS = {
  'OUI':                                       { fg: '#065f46', bg: '#d1fae5' },
  'NON':                                       { fg: '#991b1b', bg: '#fee2e2' },
  'Partiellement Owner':                       { fg: '#3730a3', bg: '#e0e7ff' },
  'Partiellement Optilex':                     { fg: '#3730a3', bg: '#e0e7ff' },
  'En attend':                                 { fg: '#92400e', bg: '#fef3c7' },
  'Non souhaitais':                            { fg: '#6b7280', bg: '#f3f4f6' },
  'Partiellement Optilex Non souhaité Owner':  { fg: '#7c2d12', bg: '#fed7aa' },
};
export const AUTO_DEBIT_FALLBACK = { fg: '#6b7280', bg: '#f3f4f6' };

// Payment specificity pills (Notion blue family).
export const PAYMENT_SPECIFICITY_COLORS = {
  'Paye / 2 sct': { fg: '#1e40af', bg: '#dbeafe' },
  'Paye / 3 sct': { fg: '#1e40af', bg: '#dbeafe' },
  'Paye / 4 sct': { fg: '#1e40af', bg: '#dbeafe' },
  'Paye / 5 sct': { fg: '#1e40af', bg: '#dbeafe' },
};
export const PAYMENT_SPECIFICITY_FALLBACK = { fg: '#6b7280', bg: '#f3f4f6' };

// Lookup label par valeur enum (pour les dropdowns et display).
export const etatLabel = (etat) => (ETAT_COLORS[etat]?.label) || etat || '—';

// ── Numeric helpers ──────────────────────────────────────────────────────

// Backend stores Decimal as string (preserves precision). Frontend parses
// to number for display and arithmetic, then re-serializes as string in
// PATCH bodies. NULL stays NULL.
export const toNumber = (v) => {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(',', '.'));
  return Number.isFinite(n) ? n : null;
};

export const formatEUR = (v, { withSymbol = true } = {}) => {
  const n = toNumber(v);
  if (n === null) return '—';
  const formatted = n.toLocaleString('fr-FR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return withSymbol ? `${formatted} €` : formatted;
};

/**
 * Ratio → « 57,38 % ». Retourne null si le dénominateur est nul/absent :
 * l'appelant n'affiche alors RIEN (pas de « 0 % » ni de NaN trompeur).
 * Utilisé par les KPI du bandeau (taux de récupération, taux de
 * récupération sur créances antérieures) — vocabulaire du classeur finance.
 */
export const formatPercent = (numerator, denominator) => {
  const d = toNumber(denominator);
  const n = toNumber(numerator);
  if (!d || d === 0) return null;
  const pct = ((n || 0) / d) * 100;
  if (!Number.isFinite(pct)) return null;
  return `${pct.toLocaleString('fr-FR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} %`;
};

/**
 * Parse une date dans un des formats émis par le backend / la DB :
 *   - ISO 8601 : "2026-05-18", "2026-05-18T07:00:00.000Z", "2026-05-18T07:00:00+02:00"
 *   - Français : "18/05/2026", "18/05/26" (year < 100 → +2000)
 * Retourne un objet Date ou null si parse impossible.
 *
 * Pourquoi ce helper : `new Date("18/05/2026")` est interprété en US
 * (MM/DD/YYYY → 5 août 2026 sur Chrome, Invalid Date sur Safari récent),
 * et provoque des bugs en cascade dans la page Tracking Finance.
 * Source de vérité unique — utilisé par formatDateFR, getOverdueStatus,
 * filtres "RDV à venir", etc.
 */
export const parseDateFR = (s) => {
  if (!s) return null;
  const str = String(s).trim();
  // ISO : contient un T ou commence par YYYY-MM-DD
  if (str.includes('T') || /^\d{4}-\d{2}-\d{2}/.test(str)) {
    const d = new Date(str);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  // Français DD/MM/YYYY ou DD/MM/YY (suffixe libre tolérant : "18/05/2026 14:30")
  const m = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
  if (m) {
    let y = parseInt(m[3], 10);
    if (y < 100) y += 2000;
    const d = new Date(y, parseInt(m[2], 10) - 1, parseInt(m[1], 10));
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
};

export const formatDateFR = (iso) => {
  const d = parseDateFR(iso);
  if (!d) return '—';
  return d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' });
};

/**
 * Pattern observé sur 89% des clients (539/604) : `clients.societe` contient
 * "Nom Société - Prénom Nom du dirigeant" (parfois avec plusieurs tirets si le
 * nom de société contient lui-même un " - "). Convention : la part après le
 * DERNIER " - " est le représentant, le reste est le nom de société.
 *
 * Exemples :
 *   "LA FONTAINE SANCERROISE - Julien Niez"
 *      → { societeName: "LA FONTAINE SANCERROISE", representant: "Julien Niez" }
 *   "SASU CVR SERVICES - CVR SERVICES - PINON Mathieu"
 *      → { societeName: "SASU CVR SERVICES - CVR SERVICES", representant: "PINON Mathieu" }
 *   "2CL DENTAIRE"
 *      → { societeName: "2CL DENTAIRE", representant: null }
 *
 * Hors-bande : `representative_name` exposé par le backend reste toujours
 * `null` (pas de jointure fiable `clients` ↔ `client_data`). Ce helper est
 * donc la source pratique pour le représentant sur Tracking Finance.
 */
export const splitSocieteRep = (societe) => {
  if (!societe) return { societeName: null, representant: null };
  const str = String(societe).trim();

  // Normalise le représentant : multi-personnes séparées par « / » avec
  // espacement irrégulier en base (« Gaetan CEROUTER /Patrice FERRET ») →
  // « A / B » homogène. 41 cas en base (2026-08-21).
  const cleanRep = (s) => {
    const r = s.trim().replace(/\s*\/\s*/g, ' / ');
    return r || null;
  };

  // 1. Séparateur canonique « - » entouré d'espaces (539/722 cas). Le
  //    DERNIER l'emporte : les noms de société contenant eux-mêmes « - »
  //    ou « + » restent entiers (« SM Technologies + E.Solutions - X »).
  const idx = str.lastIndexOf(' - ');
  if (idx !== -1) {
    return {
      societeName: str.slice(0, idx).trim() || str,
      representant: cleanRep(str.slice(idx + 3)),
    };
  }

  // 2. Tiret collé d'UN côté (« …Ambulance- Hamou AMRANE », « X -Y ») :
  //    dernier tiret avec un espace d'au moins un côté. Les tirets collés
  //    des deux côtés (« Jean-Claude », « E-commerce ») ne matchent pas.
  const looseSep = /(\s-|-\s)/g;
  let m;
  let lastLoose = -1;
  let lastLen = 0;
  while ((m = looseSep.exec(str)) !== null) {
    lastLoose = m.index;
    lastLen = m[0].length;
  }
  if (lastLoose > 0) {
    const left = str.slice(0, lastLoose).trim();
    const right = cleanRep(str.slice(lastLoose + lastLen));
    if (left && right) return { societeName: left, representant: right };
  }

  // 3. Société seule (181 cas), aucune personne détectée.
  return { societeName: str, representant: null };
};

// ── Month nav helpers ────────────────────────────────────────────────────

const MONTH_LABELS = [
  'Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin',
  'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre',
];

// 'YYYY-MM' helpers
export const formatMonthLabel = (period) => {
  if (!period) return '—';
  const [y, m] = period.split('-').map(Number);
  if (!y || !m) return period;
  return `${MONTH_LABELS[m - 1]} ${y}`;
};

export const shiftMonth = (period, delta) => {
  const [y, m] = period.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  const yy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  return `${yy}-${mm}`;
};

export const currentPeriod = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};

// 'YYYY-MM-DD' (returned by backend) → 'YYYY-MM' for the period selector
export const periodFromDate = (dateStr) => {
  if (!dateStr) return null;
  return String(dateStr).slice(0, 7);
};

// ── Friendly labels for audit field names ────────────────────────────────
export const AUDIT_FIELD_LABELS = {
  expected_owner:                'Attendu Owner',
  expected_optilex_ttc:          'Attendu Opti\'Lex',
  received_owner:                'Reçu Owner',
  received_optilex_ttc:          'Reçu Opti\'Lex TTC',
  received_overdue_owner:        'Reçu créance Owner',
  received_overdue_optilex_ttc:  'Reçu créance Opti\'Lex',
  payment_date_owner:            'Date paiement Owner',
  payment_date_optilex:          'Date paiement Opti\'Lex',
  psp_owner:                     'PSP Owner',
  psp_optilex:                   'PSP Opti\'Lex',
  finance_status_detail:         'Détail état finance',
  payment_specificity:           'Particularité',
  auto_debit:                    'Prélèv. auto',
  employee_range:                'Tranche salariés',
  payment_mode:                  'Mode paiement',
};
