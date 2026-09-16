// DetailPanel.jsx — Notion-style slide-in right panel for a client + period.
//
// Spec (2026-05-08, dev brief 3e passe) :
//   - Slide-in from the right (Framer x: 100% → 0, 250ms cubic-bezier)
//   - Width ~40% viewport (min 520px). Caller controls the main-area shrink.
//   - All values are EDITABLE inline (sauf calculés overdue_*) — réutilise
//     les mêmes EditableCell/EditableSelect/EditableNumber que la TableView.
//   - Every value gets a <CopyButton /> revealed at hover.
//   - Layout 2 cols Owner | Opti'lex pour toutes les paires (Attendu, Récupéré,
//     Retard cumul, Récupéré créances passées, Check PSP, Date paiement).
//   - Same PATCH endpoint as the table (/api/v1/finance-periods/{row_id}).
//
// Refonte phase 3 (2026-08-19, maquette dev + principe Ismahane « hyper
// synthétique, mais accès au détail via un dérouler ») :
//
// Sections (ordre vertical) :
//   1. Header barre            (existant : breadcrumb + icônes + X)
//   2. ClientHeader            (avatar initiales pastel + nom + « Client n°X ·
//                               Dossier ouvert le … » + badge statut paiement
//                               scope-aware + bouton Modifier → ouvre le
//                               détail. État board juste dessous : action
//                               fréquente, jamais dans l'accordéon)
//   3. KpiTiles                (Total contrat / Encaissé / Restant dû —
//                               dérivés de la timeline, scope-aware)
//   4. Informations contractuelles (liste compacte icône + libellé / valeur)
//   5. État de compte          (échéancier ligne par ligne : Encaissée /
//                               Partielle / En retard / À venir, 6 dernières
//                               + « Tout afficher »)
//   6. Timeline mensuelle      (EXISTANTE, telle quelle)
//   7. « Voir le détail complet » (accordéon fermé par défaut : TOUT le
//                               contenu historique du panneau — TitleBlock,
//                               MetaRow, Identité, Modalités, Owner|Opti'lex,
//                               Historique — déplacé tel quel, rien supprimé)
//
// Endpoints :
//   GET    /api/v1/finance-periods/client/{id}/timeline
//   GET    /api/v1/finance-periods/client/{id}/profile
//   GET    /api/v1/finance-periods/client/{id}/audit
//   GET    /api/v1/optilex/client-agenda?numero_client=…
//   PATCH  /api/v1/finance-periods/{row_id}  (via onPatchRow prop)
//   GET/POST/PATCH/DELETE  /api/v1/finance-periods/client/{id}/comments
//     (fil interne Owner — cf. ClientComments, 2026-08-25 ; remplace la
//      section « Timeline mensuelle » supprimée le même jour)

import React, { useEffect, useState, useMemo, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  X, ChevronRight, Maximize2, Minimize2, MoreHorizontal, ChevronsRight,
  Calendar, Briefcase, History, Lock, Landmark, PenLine, FileSignature,
  Hash, User, Box, CreditCard, Pencil, Download,
  Pin, Trash2, MessageSquarePlus,
  Scale, CalendarClock, CalendarCheck2, Handshake, TriangleAlert, LogOut,
  SlidersHorizontal, ChevronDown,
} from 'lucide-react';

import apiClient from '../../services/apiClient.js';
import {
  formatEUR, formatDateFR, formatMonthLabel, periodFromDate, splitSocieteRep,
  ETAT_COLORS, ETAT_FALLBACK, TERMINATED_BOARD_ETATS,
  PAYMENT_SPECIFICITIES, PAYMENT_SPECIFICITY_COLORS, PAYMENT_SPECIFICITY_FALLBACK,
  AUTO_DEBIT_OPTIONS, AUTO_DEBIT_COLORS, AUTO_DEBIT_FALLBACK,
  PSP_OPTIONS, PSP_COLORS, PSP_FALLBACK,
  EMPLOYEE_RANGES, normalizeEmployeeRange, employeeRangeLabel,
  AUDIT_FIELD_LABELS,
  PROFILE_CHANGE_LABELS,
  ALLOWED_ROLES,
  canEditAmounts,
  canEditContract,
  toNumber,
  currentPeriod,
  parseDateFR,

  paymentModeLabel,
  normalizePaymentMode,
  PAYMENT_MODES, PAYMENT_MODE_LABELS,
  shiftMonth,
  scopedOverdueCurrent,
  scopedCredit,
  entityCredit,
  scopedOverdueCum,
  scopedPeriodAmounts,
  isExitCandidate,
} from './constants.js';
import { describeAction } from './actionLabel.js';
import {
  EditableNumber, EditableDate, EditableSelect, EditableText, CopyButton,
} from './EditableCell.jsx';
import ContactList from './ContactList.jsx';
import ResponsibleSelect from './components/ResponsibleSelect.jsx';
// État board Owner/Opti'Lex : briques exportées par le board (source de
// vérité des états) + cellule picker partagée avec la TableView.
import { ETAT_STYLE, displayEtat } from '../OptilexBoard.jsx';
import BoardEtatCell from './components/BoardEtatCell.jsx';
import ExitClientDialog from './components/ExitClientDialog.jsx';
import StructureSplits from './components/StructureSplits.jsx';
import ExpectedManager from './components/ExpectedManager.jsx';
import PortalDropdown from './components/PortalDropdown.jsx';
import OnboardingFacturation from './components/OnboardingFacturation.jsx';

// Notion palette (sync with index.jsx N).
const N = {
  pageBg:    '#ffffff',
  sideBg:    '#f7f7f5',
  sideHover: '#efeeec',
  border:    '#e9e9e7',
  borderSft: '#f1f1ef',
  text:      '#37352f',
  textMuted: '#787774',
  textFaint: '#9b9a97',
  green:     '#0f7b6c',
  greenBg:   '#cfe9e3',
  red:       '#b74133',
  redBg:     '#ffe2dd',
};

const PANEL_MIN_WIDTH = 520;

export default function DetailPanel({
  open,
  clientId,
  rowId,           // currently focused period row (the one user clicked)
  onClose,
  onSelectRow,     // (rowId) → caller updates rowId
  onPatchRow,      // (rowId, patch) → reuses table's optimistic patch flow
  boardMap,        // Map numero_client → row board Owner/Opti'Lex (états)
  onBoardEtatChange, // (numero_client, payload) → POST /optilex/etat-change
  onShowToast,     // (msg, type?) → reuses page-level toast
  onPromiseChanged, // () → le parent recharge la ligne (promesse de règlement)
  rows,            // current period rows (so we can find focused row immediately)
  scope = 'global', // vision active du tableau : 'owner' | 'optilex' | 'global'
}) {
  const [timeline, setTimeline] = useState(null);
  const [loadingTimeline, setLoadingTimeline] = useState(false);
  // 2026-08-21 : l'audit PAR ROW (states audit/loadingAudit + GET
  // /finance-periods/{row_id}/audit) est retiré — doublon strict de l'audit
  // client-level (`clientAudit`, toutes périodes avec badge période) qui
  // alimente désormais la ligne « Dernière action » ET l'historique de
  // l'accordéon. Une requête de moins par changement de row.
  const [error, setError] = useState(null);
  const [fullscreen, setFullscreen] = useState(false);
  // Fiche client (profil) : SIREN, contacts typés, effectif courant, état
  // hérité du board, fin de contrat, journal des changements de la fiche.
  const [profile, setProfile] = useState(null);
  // Édition en place des informations contractuelles (crayon de section).
  const [contractEditing, setContractEditing] = useState(false);
  // Historique des actions client (vue synthétique, demande Ismahane) —
  // endpoint en cours de déploiement côté backend : toute erreur (404…)
  // masque simplement la section, jamais de crash.
  const [clientAudit, setClientAudit] = useState(null);
  // Gestes de la direction (attendu, reçu, report, pause…) et leur annulation.
  const [clientOps, setClientOps] = useState(null);
  // Historique des états du board (résiliations, pauses…) : fondu dans la
  // frise des actions, pour qu'acter une résiliation se relise ici.
  const [etatHistory, setEtatHistory] = useState(null);
  const [exitOpen, setExitOpen] = useState(false);
  // État choisi depuis le badge (Résiliation, Liquidation…) : le dialogue de
  // sortie s'ouvre dessus au lieu de poser l'état à la volée.
  const [exitPreset, setExitPreset] = useState(null);
  // Remboursement d'un trop-perçu : null = fermé, sinon { entity, amount }.
  const [refund, setRefund] = useState(null);
  // Poste de pilotage des attendus (direction) : modifier, réduire, reporter,
  // mettre en pause. Distinct d'une perte — rien n'est abandonné ici.
  const [expectedOpen, setExpectedOpen] = useState(false);
  // Structures payantes et ventilation — servent l'état de compte par société.
  const [structures, setStructures] = useState([]);
  const [structureSplits, setStructureSplits] = useState([]);
  // Écriture réservée à l'équipe finance + admin (le CEO lit).
  // Deux niveaux de droits (dev 2026-08-27) : l'équipe finance entretient la
  // fiche (modalités, sociétés, associés, contacts) mais ne touche ni aux
  // encaissements, ni à la formule, ni au SIREN, ni à l'état board.
  const role = apiClient.getUser()?.role;
  const canEdit = canEditContract(role);
  const canEditMoney = canEditAmounts(role);

  // Reset on close
  useEffect(() => {
    if (!open) {
      setTimeline(null);
      setError(null);
      setFullscreen(false);
      setProfile(null);
      setClientAudit(null);
      setClientOps(null);
      setEtatHistory(null);
      setExitOpen(false);
      setExitPreset(null);
      setRefund(null);
      setStructures([]);
      setStructureSplits([]);
      setExpectedOpen(false);
    }
  }, [open]);

  // Historique des actions : l'audit (toutes périodes confondues) et les
  // opérations de la direction (annulables). Rechargé après chaque geste,
  // sinon la « Dernière action » resterait celle d'avant. Défensif sur la
  // forme de la réponse d'audit ({entries} ou tableau nu). Une réponse
  // arrivée après un changement de client est ignorée.
  const historyClientRef = useRef(null);
  const refreshHistory = useCallback(() => {
    if (!clientId) return;
    historyClientRef.current = clientId;
    apiClient.get(`/api/v1/finance-periods/client/${clientId}/audit`)
      .then((data) => {
        if (historyClientRef.current !== clientId) return;
        const entries = Array.isArray(data?.entries) ? data.entries
          : Array.isArray(data) ? data : [];
        setClientAudit(entries);
      })
      .catch(() => { if (historyClientRef.current === clientId) setClientAudit(null); });
    apiClient.get(`/api/v1/finance-periods/client/${clientId}/operations`)
      .then((d) => {
        if (historyClientRef.current !== clientId) return;
        setClientOps(Array.isArray(d?.items) ? d.items : []);
      })
      .catch(() => { if (historyClientRef.current === clientId) setClientOps(null); });
  }, [clientId]);

  useEffect(() => {
    if (!open || !clientId) return;
    setClientAudit(null);
    setClientOps(null);
    refreshHistory();
  }, [open, clientId, refreshHistory]);

  // Historique des états posés sur le board — même client, même fil d'actions.
  // Sans ça, acter une résiliation depuis la finance n'aurait laissé aucune
  // trace visible ici, alors que c'est l'action la plus engageante de la page.
  // La clé vient du PROFIL (chargé plus haut) et non de `client`, qui n'est
  // dérivé qu'après : lire une variable avant sa déclaration rend la page
  // blanche, sans que le build ni ESLint ne le voient.
  const refreshEtatHistory = useCallback(() => {
    const num = profile?.numero_client;
    if (!num) { setEtatHistory(null); return; }
    apiClient.get(`/api/v1/optilex/etat-history?numero_client=${encodeURIComponent(num)}`)
      .then((d) => setEtatHistory(d?.history || []))
      .catch(() => setEtatHistory(null));
  }, [profile?.numero_client]);

  useEffect(() => {
    if (!open) return;
    refreshEtatHistory();
  }, [open, refreshEtatHistory]);

  // Structures et ventilation : chargées avec la fiche pour que le bouton
  // « état de compte » puisse proposer une société sans attendre.
  useEffect(() => {
    if (!open || !clientId) return undefined;
    let cancelled = false;
    Promise.all([
      apiClient.get(`/api/v1/finance-periods/client/${clientId}/structures`).catch(() => null),
      apiClient.get(`/api/v1/finance-periods/client/${clientId}/splits`).catch(() => null),
    ]).then(([st, sp]) => {
      if (cancelled) return;
      setStructures(st?.items || []);
      setStructureSplits(sp?.items || []);
    });
    return () => { cancelled = true; };
  }, [open, clientId]);

  // Profil client — rechargeable après chaque édition (SIREN, contacts,
  // effectif) pour que la fiche et son journal restent d'accord.
  const refreshProfile = useCallback(() => {
    if (!clientId) return;
    apiClient.get(`/api/v1/finance-periods/client/${clientId}/profile`)
      .then(setProfile)
      .catch((e) => console.error('[DetailPanel profile]', e));
  }, [clientId]);

  useEffect(() => {
    if (!open || !clientId) return;
    setProfile(null);
    refreshProfile();
  }, [open, clientId, refreshProfile]);

  // Fetch timeline whenever clientId changes
  useEffect(() => {
    if (!open || !clientId) return;
    let cancelled = false;
    setLoadingTimeline(true);
    apiClient.get(`/api/v1/finance-periods/client/${clientId}/timeline`)
      .then((data) => { if (!cancelled) { setTimeline(data); setError(null); } })
      .catch((e) => { if (!cancelled) setError(e.message || 'Erreur de chargement'); })
      .finally(() => { if (!cancelled) setLoadingTimeline(false); });
    return () => { cancelled = true; };
  }, [open, clientId]);

  // ESC handler
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  // Focused row : prefer the row coming from the table's `rows` prop (fresh
  // optimistic state) before falling back to the timeline payload (less fresh).
  // This guarantees the panel reflects edits made elsewhere immediately.
  const focusedRow = useMemo(() => {
    if (rowId && Array.isArray(rows)) {
      const fromTable = rows.find((r) => r.id === rowId);
      if (fromTable) return fromTable;
    }
    return (timeline?.periods || []).find((p) => p.id === rowId) || null;
  }, [rowId, rows, timeline]);

  // Mémoïsé : référence stable pour les useMemo dérivés (kpis, échéancier).
  const periods = useMemo(() => timeline?.periods || [], [timeline]);

  // Mois de signature 'YYYY-MM' — MÊME source/parsing que le header
  // (« Dossier ouvert le … ») : profile.date_signature via parseDateFR,
  // qui gère les formats mixtes ISO et DD/MM/YYYY. Null si absente ou
  // illisible → aucun filtrage (comportement historique, pas de crash).
  const signatureMonth = useMemo(() => {
    const d = parseDateFR(profile?.date_signature);
    if (!d) return null;
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  }, [profile]);

  // Règle Ismahane 2026-08-19 : la timeline (et l'échéancier) COMMENCE au
  // mois de signature — les mois à 0,00 € antérieurs n'existent pas pour le
  // client. Signature antérieure au premier mois de données → le filtre ne
  // retire rien (comparaison lexicale 'YYYY-MM'). Les KPIs restent calculés
  // sur `periods` complet (les mois pré-signature sont à 0 de toute façon).
  const visiblePeriods = useMemo(() => {
    if (!signatureMonth) return periods;
    return periods.filter((p) => String(p.period).slice(0, 7) >= signatureMonth);
  }, [periods, signatureMonth]);

  // 2026-08-25 : le marqueur « Signature » vivait dans la timeline mensuelle,
  // supprimée depuis. L'information reste portée par le header du panneau
  // (« Dossier ouvert le {date longue} ») — rien de perdu.

  const client = focusedRow?.client || periods[0]?.client || null;
  // État du client = celui du board Owner/Opti'Lex (source de vérité depuis
  // 2026-08-18). Fallbacks conservés pour les clients hors board : état
  // hérité (résiliation/rétractation actée) puis `clients.etat` legacy.
  const boardRow = (client?.numero_client && boardMap?.get(client.numero_client)) || null;
  const boardEtat = boardRow ? displayEtat(boardRow) : null;

  // ── Agenda client (RDV + juriste de référence) — retour dev 2026-08-21 ──
  // Même endpoint que la modale agenda du board (GET /optilex/client-agenda,
  // accessible aux rôles finance). Fetch seulement si le client est au board
  // (numero_client résolu) ; toute erreur → section masquée, jamais de crash.
  const numeroClient = client?.numero_client || null;
  const [clientAgenda, setClientAgenda] = useState(null);
  useEffect(() => {
    if (!open || !numeroClient) { setClientAgenda(null); return undefined; }
    let alive = true;
    apiClient.get(`/api/v1/optilex/client-agenda?numero_client=${encodeURIComponent(numeroClient)}`)
      .then((r) => { if (alive) setClientAgenda(r); })
      .catch(() => { if (alive) setClientAgenda(null); });
    return () => { alive = false; };
  }, [open, numeroClient]);
  const inheritedEtat = profile?.etat_inherited || null;

  // ── Dérivés phase 3 (synthèse scope-aware) ─────────────────────────────

  // Client en fin de relation (liquidation, résiliation…) qui a encore des
  // créances antérieures dues : la sortie client est à acter, on le dit.
  const exitDue = !!focusedRow && isExitCandidate(focusedRow, boardEtat, scope);

  // KPIs contrat — dérivés de la timeline déjà chargée (aucun nouvel appel).
  //
  // Total contrat = engagement de 12 mois, décompté depuis le début de la
  // facturation, c'est-à-dire le RDV d'onboarding Owner (règle dev
  // 2026-08-26). Sommer les lignes présentes ne marchait pas : notre
  // historique s'arrête en janvier 2027, donc l'engagement d'un client
  // récent était tronqué (L'EMAN n°722 : 1 695 € sur cinq mois au lieu de
  // 4 068 €) et celui d'un ancien gonflé, cumulé sur seize mois.
  //
  // Encaissé et Restant dû portent sur la MÊME fenêtre : sinon un client
  // entré dans sa deuxième année afficherait un faux trop-perçu, son
  // encaissé cumulé dépassant l'engagement d'une seule année.
  const kpis = useMemo(() => {
    const byMonth = new Map();
    for (const p of periods) {
      const key = periodFromDate(p.period);
      if (key) byMonth.set(key, scopedPeriodAmounts(p, scope));
    }

    // Départ : mois de l'onboarding Owner, avec repli sur le premier mois
    // facturé — deux tiers des fiches n'ont pas de date d'onboarding.
    const onboarding = parseDateFR(client?.rdv_onboarding);
    const firstBilled = periods.find((p) => scopedPeriodAmounts(p, scope).expected > 0);
    let start = onboarding
      ? `${onboarding.getFullYear()}-${String(onboarding.getMonth() + 1).padStart(2, '0')}`
      : periodFromDate(firstBilled?.period || periods[0]?.period || '');
    if (!start) return { total: 0, encaisse: 0, restant: 0 };

    // Année d'engagement en cours : la fenêtre avance d'un an à chaque
    // anniversaire, sans quoi elle resterait figée sur la première année.
    const [sy, sm] = start.split('-').map(Number);
    const [cy, cm] = currentPeriod().split('-').map(Number);
    const elapsed = (cy - sy) * 12 + (cm - sm);
    if (elapsed >= 12) start = shiftMonth(start, Math.floor(elapsed / 12) * 12);

    const yearly = normalizePaymentMode(
      focusedRow?.payment_mode || client?.payment_mode,
    ) === 'YEARLY';

    let total = 0;
    let encaisse = 0;
    let monthly = 0;  // mensualité de référence pour les mois hors horizon
    for (let i = 0; i < 12; i += 1) {
      const a = byMonth.get(shiftMonth(start, i));
      if (a) {
        total += a.expected;
        encaisse += a.received + a.receivedOverdue;
        if (!yearly && a.expected > 0) monthly = a.expected;
      } else if (!yearly) {
        total += monthly;
      }
    }
    return { total, encaisse, restant: total - encaisse };
  }, [periods, scope, client, focusedRow]);

  // Échéancier « État de compte » — une entrée par période à montant
  // (attendu ou reçu), triée chronologiquement et numérotée. Statuts :
  //   reçu ≥ attendu            → Encaissée
  //   0 < reçu < attendu        → Partielle
  //   mois futur                → À venir
  //   mois courant              → En retard si retard courant calculé, sinon À venir
  //   mois passé sans paiement  → En retard
  const installments = useMemo(() => {
    const nowMonth = currentPeriod();
    // `visiblePeriods` : une échéance ne peut pas précéder la signature.
    const sorted = [...visiblePeriods].sort((a, b) => String(a.period).localeCompare(String(b.period)));
    const list = [];
    for (const p of sorted) {
      const a = scopedPeriodAmounts(p, scope);
      if (a.expected <= 0 && a.received <= 0 && !p.expected_pause_active) continue;
      const month = String(p.period).slice(0, 7);
      let status;
      if (a.received >= a.expected && a.received > 0) status = 'paid';
      else if (a.received > 0) status = 'partial';
      // Mois en pause : compté, pas exigible — ni « en retard » ni « à venir ».
      else if (p.expected_pause_active) status = 'paused';
      else if (month > nowMonth) status = 'upcoming';
      else if (month === nowMonth) status = scopedOverdueCurrent(p, scope) > 0 ? 'late' : 'upcoming';
      else status = 'late';
      list.push({
        id: p.id, n: list.length + 1, month, status, ...a,
        manual: !!p.expected_manual,
        pauseUntil: p.expected_paused_until || null,
      });
    }
    return list;
  }, [visiblePeriods, scope]);

  // (Le forfait mensuel dérivé des échéances a été retiré avec le « N × … »
  // de la modalité — 2026-08-25. La Formule affiche la tranche seule.)

  // ── État de compte PDF (phase 4) ───────────────────────────────────────
  // L'état de compte suit la VISION active (dev 2026-08-25) : Owner et
  // Opti'lex sont deux entités juridiques → deux documents distincts (jamais
  // de fusion). En vision Globale, les deux sont proposés séparément.
  // Le bouton est TOUJOURS actif : un client sans échéance facturée obtient
  // quand même son document (en-tête + bloc client + tableau vide).
  // Génération 100 % frontend depuis les données déjà chargées, module PDF
  // chargé en lazy (dynamic import → chunk séparé pour @react-pdf/renderer).

  // `entity` : 'owner' | 'optilex' — pilote émetteur ET champs de montants.
  const [pdfGenerating, setPdfGenerating] = useState(null); // null | 'owner' | 'optilex'
  // `structure` (optionnel) : n'inclut que ce qui a été ventilé sur cette
  // société, et le dit dans le document. Demande dev 2026-09-01 — un client
  // qui règle pour cinq structures a besoin d'un état de compte par société.
  const downloadStatement = useCallback(async (entity = 'owner', structure = null) => {
    if (pdfGenerating) return;
    setPdfGenerating(structure ? `st-${structure.id}` : entity);
    try {
      const { generateEtatDeCompte } = await import('./pdf/EtatDeComptePdf.jsx');

      // Société découpée + personne(s) (source unique splitSocieteRep) ;
      // numero_client arrive préfixé « n° » en base → strip (le PDF pose
      // son propre « n° »).
      const { societeName, representant: repFromSociete } = splitSocieteRep(client?.societe);
      const personne = client?.representative_name || repFromSociete;

      // Lignes de l'entité demandée. Périmètre comptable (retour dev ZILWA
      // n°637, 2026-08-21) : de la signature au mois de la date d'émission
      // INCLUS — les mois futurs ne sont pas facturés, ils sortent du
      // document ET du total. Les mois vides (ni facturé ni payé) sautés.
      const nowMonth = currentPeriod();
      const sorted = [...visiblePeriods]
        .sort((a, b) => String(a.period).localeCompare(String(b.period)));
      const entityRows = [];
      let latestExpected = null;
      for (const p of sorted) {
        const month = String(p.period).slice(0, 7);
        if (month > nowMonth) continue; // mois futur — hors périmètre
        const a = scopedPeriodAmounts(p, entity);
        if (a.expected <= 0 && a.received <= 0) continue;
        if (a.expected > 0) latestExpected = a.expected;
        // « Payé » inclut le récupéré sur créances passées du mois : le
        // solde cumulé (calculé dans le PDF) régularise ainsi les mois
        // précédents au fil des lignes.
        entityRows.push({
          month,
          billed: a.expected,
          paid: a.received + a.receivedOverdue,
        });
      }

      // Offre = libellé de la Formule : tranche, sinon forfait (tarif client
      // prioritaire côté Owner, sinon dernier attendu de l'entité).
      const range = profile?.employee_range || focusedRow?.employee_range || client?.employee_range;
      const tarif = entity === 'owner' ? toNumber(client?.tarif) : null;
      const price = (tarif && tarif > 0) ? tarif : latestExpected;
      const offre = range ? `${range} salariés` : (price ? formatEUR(price) : '—');

      // Ventilation par structure : si une société est demandée, le document
      // ne retient QUE ce qui lui a été attribué. On ne répartit rien au
      // prorata — un montant non ventilé n'appartient à personne, et
      // l'inventer donnerait un document faux.
      if (structure) {
        const parMois = new Map();
        for (const sp of (structureSplits || [])) {
          if (sp.structure_id !== structure.id || sp.entity !== entity) continue;
          const k = String(sp.period || '').slice(0, 7);
          parMois.set(k, (parMois.get(k) || 0) + Number(sp.amount || 0));
        }
        for (const r of entityRows) {
          r.paid = parMois.get(r.month) || 0;
          r.billed = 0;            // l'attendu n'est pas ventilé par société
        }
      }

      // Remboursements de trop-perçu de CETTE entité : ce sont des mouvements
      // d'argent, ils doivent figurer au document (demande dev 2026-08-28).
      // Un remboursement s'écrit en « payé » NÉGATIF : l'argent est ressorti.
      // Le solde cumulé du PDF (`solde += facturé − payé`) le régularise donc
      // tout seul — un crédit de 192,50 revient exactement à zéro.
      const refundRows = (profile?.refunds || [])
        .filter((r) => r.entity === entity && Number(r.amount) > 0)
        .map((r) => ({
          month: String(r.period || '').slice(0, 7),
          billed: 0,
          paid: -Number(r.amount),
          refund: true,
          reason: r.reason || '',
        }));

      // Fusion chronologique : un remboursement se lit APRÈS le mois qu'il
      // solde, comme sur un relevé bancaire.
      const rows = [...entityRows.map((r) => ({ ...r, refund: false })), ...refundRows]
        .sort((a, b) => (a.month === b.month
          ? Number(a.refund) - Number(b.refund)
          : String(a.month).localeCompare(String(b.month))))
        .map((r) => ({
          periodLabel: formatMonthLabel(r.month),
          offre: r.refund
            ? `Remboursement de trop-perçu${r.reason ? ` — ${r.reason}` : ''}`
            : offre,
          billed: r.billed,
          paid: r.paid,
        }));

      // Adresse client : exposée par le profil (backend 2026-08-25) —
      // code défensif, les champs peuvent ne pas encore être présents.
      const addressLine = [
        profile?.address_line1 || null,
        [profile?.postal_code, profile?.city].filter(Boolean).join(' ') || null,
      ].filter(Boolean).join(', ');

      const blob = await generateEtatDeCompte({
        entity,
        recipient: {
          company: structure ? `${societeName} — ${structure.name}` : societeName,
          person: personne || '',
          clientNumber: client?.numero_client
            ? String(client.numero_client).replace(/^n°\s*/i, '')
            : '',
          address: addressLine,
          email: client?.email || '',
          // Siret du modèle : `profile.siret` (14 chiffres, backend
          // 2026-08-25) → repli sur le SIREN connu → vide (libellé
          // conservé, comme le modèle).
          siret: profile?.siret || profile?.siren || '',
        },
        rows,
        // Date courte DD/MM/YY — format de la référence.
        issueDate: new Date().toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: '2-digit' }),
      });

      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const safeName = (societeName || 'Client').replace(/[\\/:*?"<>|]/g, '-').trim();
      const entityLabel = (entity === 'optilex' ? "Opti'lex" : 'Owner')
      + (structure ? ` - ${structure.name}` : '');
      a.href = url;
      a.download = `Etat de compte ${entityLabel} - ${safeName} - ${new Date().toISOString().slice(0, 10)}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      console.error('[DetailPanel pdf]', e);
      onShowToast?.('Erreur lors de la génération du PDF', 'error');
    } finally {
      setPdfGenerating(null);
    }
  }, [pdfGenerating, visiblePeriods, profile, focusedRow, client, structureSplits, onShowToast]);

  // Bouton Modifier : déplie le détail complet puis scrolle dessus (léger
  // délai pour laisser l'accordéon commencer son expansion).
  // Patch helper bound to current rowId — reuses table's onPatchRow flow.
  // Falls back to a direct PATCH if the parent didn't wire onPatchRow.
  // `extra` : champs accompagnant la saisie sans être eux-mêmes édités —
  // aujourd'hui `change_effective`, le mois d'effet d'un changement de
  // formule ou de modalité.
  const patch = useCallback((field, extra = null) => async (value) => {
    if (!rowId) return;
    const body = { [field]: value, ...(extra || {}) };
    if (onPatchRow) {
      await onPatchRow(rowId, body);
    } else {
      await apiClient.patch(`/api/v1/finance-periods/${rowId}`, body);
    }
  }, [rowId, onPatchRow]);

  // Promesse de règlement : bascule + rafraîchissement de la ligne et du fil
  // de commentaires, où l'action vient de s'écrire.
  const togglePromise = useCallback(async () => {
    if (!clientId) return;
    const on = !!focusedRow?.client?.payment_promise;
    const url = `/api/v1/finance-periods/client/${clientId}/payment-promise`;
    try {
      if (on) await apiClient.delete(url);
      else await apiClient.post(url, {});
      onShowToast?.(on ? 'Promesse retirée' : 'Promesse de règlement notée', 'success');
      onPromiseChanged?.();
    } catch (e) {
      onShowToast?.(e?.data?.detail || 'Action impossible', 'error');
    }
  }, [clientId, focusedRow, onShowToast, onPromiseChanged]);

  // ── Sortie client (état acté, perte) ────────────────────────────────────
  // Après une perte, tout bouge d'un coup : l'attendu de la fiche, les tuiles,
  // et la ligne du tableau derrière. On recharge les trois — la page n'a pas
  // à deviner ce qui a changé.
  const reloadAfterExit = useCallback(() => {
    refreshProfile();
    refreshEtatHistory();
    refreshHistory();
    if (clientId) {
      apiClient.get(`/api/v1/finance-periods/client/${clientId}/timeline`)
        .then(setTimeline)
        .catch(() => {});
    }
    onPromiseChanged?.();
  }, [clientId, refreshProfile, refreshEtatHistory, refreshHistory, onPromiseChanged]);

  // `payload` porte le motif ET le périmètre choisi (créances antérieures /
  // mois en cours / reste du contrat) — la finance décide de chaque bloc.
  // Le trop-perçu vit sur UNE entité : en vision Owner ou Opti'lex on la
  // connaît, en Globale on prend celle qui porte réellement le crédit.
  const openRefund = useCallback(() => {
    // Ce qu'on doit RÉELLEMENT au client, par entité : le solde du mois en
    // cours ET le cumul des mois antérieurs. `credit_*` seul ne reprend que
    // le cumul — sur un changement de formule rétroactif, il manquerait le
    // mois courant, et le montant proposé au remboursement serait faux.
    const co = focusedRow ? entityCredit(focusedRow, 'owner') : 0;
    const cp = focusedRow ? entityCredit(focusedRow, 'optilex') : 0;
    let entity = scope;
    if (scope === 'global') entity = co >= cp ? 'owner' : 'optilex';
    setRefund({
      entity,
      amount: Math.round((entity === 'owner' ? co : cp) * 100) / 100,
      reason: '',
    });
  }, [focusedRow, scope]);

  const submitRefund = useCallback(async ({ entity, amount, reason }) => {
    if (!clientId) return;
    try {
      await apiClient.post(`/api/v1/finance-periods/client/${clientId}/refund`, {
        entity, amount, reason,
      });
      onShowToast?.('Remboursement enregistré — trop-perçu soldé', 'success');
      setRefund(null);
      reloadAfterExit();
    } catch (e) {
      onShowToast?.(e?.data?.detail || "Enregistrement impossible", 'error');
    }
  }, [clientId, onShowToast, reloadAfterExit]);

  // Ouvrir la sortie client — depuis le bouton (sans état pré-choisi) ou
  // depuis le badge d'état (avec l'état acté à confirmer).
  const openExit = useCallback((etat = null) => {
    setExitPreset(etat);
    setExitOpen(true);
  }, []);

  // Responsable désigné : la fiche se rafraîchit, et la page recharge ses
  // lignes pour que le filtre « Responsable » suive.
  const onResponsibleChanged = useCallback(() => {
    refreshProfile();
    onPromiseChanged?.();
  }, [refreshProfile, onPromiseChanged]);

  const declareLoss = useCallback(async (payload) => {
    if (!clientId) return;
    try {
      await apiClient.post(`/api/v1/finance-periods/client/${clientId}/loss`, payload);
      onShowToast?.('Perte enregistrée', 'success');
      reloadAfterExit();
    } catch (e) {
      onShowToast?.(e?.data?.detail || 'Déclaration impossible', 'error');
    }
  }, [clientId, onShowToast, reloadAfterExit]);

  const revertLoss = useCallback(async () => {
    if (!clientId) return;
    try {
      await apiClient.delete(`/api/v1/finance-periods/client/${clientId}/loss`);
      onShowToast?.('Perte annulée — attendu restauré', 'success');
      reloadAfterExit();
    } catch (e) {
      onShowToast?.(e?.data?.detail || 'Annulation impossible', 'error');
    }
  }, [clientId, onShowToast, reloadAfterExit]);

  const onCopied = useCallback(() => {
    onShowToast?.('Copié dans le presse-papiers', 'info');
  }, [onShowToast]);

  return (
    <AnimatePresence>
      {open && (
        <motion.aside
          key="detail-panel"
          initial={{ x: '100%' }}
          animate={{ x: 0 }}
          exit={{ x: '100%' }}
          transition={{ duration: 0.25, ease: [0.4, 0, 0.2, 1] }}
          style={{
            position: 'fixed',
            top: 0,
            right: 0,
            height: '100vh',
            width: fullscreen ? '100vw' : `clamp(${PANEL_MIN_WIDTH}px, 40vw, 720px)`,
            background: N.pageBg,
            borderLeft: `1px solid ${N.border}`,
            boxShadow: '-12px 0 24px rgba(15,15,15,0.06)',
            zIndex: 50,
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
            fontFamily: 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif',
          }}
        >
          {/* HEADER */}
          <PanelHeader
            client={client}
            onClose={onClose}
            fullscreen={fullscreen}
            onToggleFullscreen={() => setFullscreen((v) => !v)}
          />

          {/* SCROLLABLE BODY */}
          <div className="tsf-scroll" style={{
            flex: 1, overflowY: 'auto',
            padding: '24px 32px 64px',
          }}>
            {/* Header client synthétique (phase 3) : avatar + nom + statut
                paiement + Modifier. L'État board reste ici — action
                fréquente, jamais dans l'accordéon. */}
            <ClientHeader client={client} />

            {/* Bandeau de situation, deux cases : l'état du client et qui le
                suit. Rien d'autre — le numéro, la date de signature et le
                retard à date vivent déjà plus bas (retour dev 2026-09-03 :
                « pas besoin de répéter »). */}
            <StatusStrip
              boardRow={boardRow}
              client={client}
              inheritedEtat={inheritedEtat}
              // L'état du client (Signé, résiliation…) est une décision
              // engageante : direction financière et direction seulement.
              canEditEtat={canEditMoney}
              onBoardEtatChange={onBoardEtatChange}
              onActedEtat={openExit}
              clientId={clientId}
              profile={profile}
              // Le responsable, lui, est une organisation de travail : toute
              // l'équipe finance peut se désigner ou reprendre un dossier.
              canEditTeam={canEdit}
              onResponsibleChanged={onResponsibleChanged}
              onShowToast={onShowToast}
            />

            {/* Error state */}
            {error && (
              <div style={{
                marginTop: 20, padding: 12, background: N.redBg,
                color: N.red, borderRadius: 6, fontSize: 13,
              }}>
                {error}
              </div>
            )}

            {/* Les faits : SIREN, échéance ou sortie de contrat, perte,
                promesse posée. Puis les actions, toutes au même endroit —
                plus de bouton isolé à l'autre bout de la fiche. */}
            <FactsRow
              profile={profile}
              boardRow={boardRow}
              loss={profile?.loss || null}
              promise={!!focusedRow?.client?.payment_promise}
            />
            <ActionsBar
              canManageMoney={canEditMoney}
              canEdit={canEdit}
              promise={!!focusedRow?.client?.payment_promise}
              onTogglePromise={togglePromise}
              onOpenExpected={() => setExpectedOpen(true)}
              exitDue={exitDue}
              onOpenExit={() => openExit(null)}
            />

            {/* 4 tuiles KPI contrat (scope-aware, dérivées de la timeline).
                « Restant dû » = tout ce que le contrat doit encore
                rapporter (mois à venir inclus) ; « Retard à date » = ce qui
                est réellement en retard aujourd'hui (mois courant + créances
                antérieures) — deux notions distinctes, à ne pas confondre. */}
            <KpiTiles
              kpis={kpis}
              overdueCurrent={focusedRow ? scopedOverdueCurrent(focusedRow, scope) : 0}
              overdueCum={focusedRow ? scopedOverdueCum(focusedRow, scope) : 0}
              credit={focusedRow ? scopedCredit(focusedRow, scope) : 0}
              loading={loadingTimeline}
              onRefund={canEditMoney ? openRefund : null}
            />

            {/* Remboursement d'un trop-perçu — l'encaissement reste intact,
                un ajustement daté vient l'éteindre. Direction seulement. */}
            {refund && (
              <RefundPrompt
                value={refund}
                onChange={setRefund}
                onCancel={() => setRefund(null)}
                onSubmit={submitRefund}
              />
            )}

            {/* Section : Informations contractuelles.
                Le crayon ouvre l'édition sur place (demande dev 2026-08-27) :
                c'est ici qu'on corrige la fiche, plus dans l'accordéon. */}
            <Section
              title="Informations contractuelles"
              delay={0.08}
              action={canEdit ? (
                <button
                  type="button"
                  onClick={() => setContractEditing((v) => !v)}
                  title={contractEditing ? 'Terminer l’édition' : 'Modifier la fiche'}
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: 5,
                    border: 'none', cursor: 'pointer',
                    background: contractEditing ? N.sideHover : 'transparent',
                    color: contractEditing ? N.text : N.textMuted,
                    borderRadius: 5, padding: '3px 7px',
                    fontSize: 11, fontWeight: 600,
                    transition: 'background 0.12s, color 0.12s',
                  }}
                >
                  <Pencil size={12} />
                  {contractEditing ? 'Terminer' : 'Modifier'}
                </button>
              ) : null}
            >
              <ContractInfoList
                client={client}
                profile={profile}
                focusedRow={focusedRow}
                boardRow={boardRow}
                periods={periods}

                patch={patch}
                canEdit={canEdit}
                canEditMoney={canEditMoney}
                editing={contractEditing}
                clientId={clientId}
                onProfileChanged={refreshProfile}
                onShowToast={onShowToast}
                onCopied={onCopied}
              />
            </Section>

            {/* Section : État de compte (échéancier) — bouton(s) PDF à côté
                du titre. Le document suit la vision active ; en Globale les
                deux entités sont proposées séparément (jamais fusionnées).
                Toujours actif, même sans échéance facturée. */}
            <Section
              title="État de compte"
              delay={0.11}
              action={(
                <StatementMenu
                  scope={scope}
                  structures={structures}
                  busy={pdfGenerating}
                  onDownload={downloadStatement}
                />
              )}
            >
              <InstallmentsList
                installments={installments}
                loading={loadingTimeline}
                focusedRowId={rowId}
                onSelectRow={onSelectRow}
              />
            </Section>

            {/* Ventilation par structure — n'apparaît que pour les clients
                qui règlent pour plusieurs sociétés (« Paye / N sct »).
                Demande dev 2026-09-01 : savoir QUELLE structure a payé. */}
            <Section title="Structures & ventilation" delay={0.12}>
              <StructureSplits
                clientId={clientId}
                periods={periods}
                scope={scope}
                canEdit={canEdit}
                canEditMoney={canEditMoney}
                onShowToast={onShowToast}
              />
            </Section>

            {/* Section : Commentaires — remplace la timeline mensuelle
                (2026-08-25) : celle-ci faisait doublon avec l'échéancier
                « État de compte » et ne servait pas le travail réel de la
                finance (recouvrement). Ici vit le contexte que seul un
                humain écrit : « promesse de règlement au 15 », « en attente
                retour cabinet ». Fil INTERNE Owner — le cabinet Opti'Lex
                n'y a pas accès (aucun lien vers le fil du board). */}
            {/* Historique des actions — SORTI de l'accordéon le 2026-08-28 :
                il y vivait, donc personne ne le voyait, et le dev a cru
                qu'un ajout d'email n'était pas tracé alors qu'il l'était.
                Toute modification de la fiche doit se lire ici, avec son
                auteur et sa date. La « Dernière action » est sa première
                ligne, en phrase : il n'y a plus deux endroits qui pouvaient
                désigner deux actions différentes (retour dev 2026-09-03). */}
            <ActionsTimeline
              audit={clientAudit}
              operations={clientOps}
              changes={profile?.changes}
              etatHistory={etatHistory}
            />

            <ClientComments clientId={clientId} onShowToast={onShowToast} />

            {/* Section : Rendez-vous & juriste référent — vue synthétique
                depuis le retour dev 2026-08-21 (sortie de l'accordéon).
                Masquée si client hors board / aucune donnée agenda. */}
            {boardRow && (clientAgenda?.reference_jurist || (clientAgenda?.rdv?.length || 0) > 0
              || boardRow.rdv_onboarding_date || boardRow.rdv_lancement_date
              || boardRow.rdv_fiscal_date || boardRow.rdv_social_date) && (
              <Section title="Rendez-vous & juriste référent" delay={0.16}>
                <RdvJuristeSection boardRow={boardRow} agenda={clientAgenda} onCopied={onCopied} />
                {/* Validation FACTURATION du RDV d'onboarding + recalage (finance).
                    Statut propre à la finance, indépendant de celui de Vincent ;
                    le recalage, lui, déplace le RDV partagé (agendas liés). */}
                <OnboardingFacturation numeroClient={numeroClient} boardRow={boardRow} />
              </Section>
            )}

          </div>

          {/* Sortie client — acter un état daté, ou déclarer une perte.
              Direction financière et direction seulement (demande dev
              2026-08-28). Le dialogue est portalisé : il passe au-dessus du
              panneau, pas dedans. */}
          <ExpectedManager
            open={expectedOpen && canEditMoney}
            onClose={() => setExpectedOpen(false)}
            clientId={clientId}
            client={client}
            periods={periods}
            scope={scope}
            onDone={reloadAfterExit}
            onShowToast={onShowToast}
          />

          <ExitClientDialog
            open={exitOpen && canEditMoney}
            onClose={() => setExitOpen(false)}
            client={client}
            boardRow={boardRow}
            // La timeline BRUTE, pas `installments` : celle-ci est déjà
            // agrégée selon la vision active (Owner / Opti'lex) et a perdu
            // les colonnes par entité. Or une perte porte sur les DEUX
            // entités, exactement comme le fait le serveur.
            periods={periods}
            loss={profile?.loss || null}
            initialEtat={exitPreset}
            onEtatChange={async (chg) => {
              // Signature du parent : (numero_client, payload) — la même que
              // celle du badge d'état de la fiche.
              await onBoardEtatChange?.(client?.numero_client, chg);
              reloadAfterExit();
            }}
            onDeclareLoss={declareLoss}
            onRevertLoss={revertLoss}
          />
        </motion.aside>
      )}
    </AnimatePresence>
  );
}

// ── Header ──────────────────────────────────────────────────────────────────
function PanelHeader({ client, onClose, fullscreen, onToggleFullscreen }) {
  const { societeName } = splitSocieteRep(client?.societe);
  return (
    <div style={{
      height: 44,
      flexShrink: 0,
      display: 'flex', alignItems: 'center',
      gap: 6, padding: '0 12px',
      borderBottom: `1px solid ${N.border}`,
      background: N.pageBg,
    }}>
      {/* Breadcrumb */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 6,
        fontSize: 13, color: N.textMuted, minWidth: 0, flex: 1,
      }}>
        <span>Tracking Finance</span>
        <ChevronRight size={12} style={{ color: N.textFaint, flexShrink: 0 }} />
        <span style={{
          color: N.text, fontWeight: 500,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {societeName || 'Client'}
        </span>
      </div>

      {/* Action icons */}
      <button
        onClick={onToggleFullscreen}
        title={fullscreen ? 'Réduire' : 'Étendre en plein écran'}
        style={iconBtnStyle}
        onMouseEnter={(e) => e.currentTarget.style.background = N.sideHover}
        onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
      >
        {fullscreen ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
      </button>
      <button
        onClick={onClose}
        title="Réduire le panneau"
        style={iconBtnStyle}
        onMouseEnter={(e) => e.currentTarget.style.background = N.sideHover}
        onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
      >
        <ChevronsRight size={14} />
      </button>
      <button
        title="Plus d'actions"
        style={iconBtnStyle}
        onMouseEnter={(e) => e.currentTarget.style.background = N.sideHover}
        onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
      >
        <MoreHorizontal size={14} />
      </button>
      <button
        onClick={onClose}
        title="Fermer (Esc)"
        style={iconBtnStyle}
        onMouseEnter={(e) => e.currentTarget.style.background = N.sideHover}
        onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
      >
        <X size={15} />
      </button>
    </div>
  );
}

const iconBtnStyle = {
  width: 28, height: 28,
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
  border: 'none', background: 'transparent', cursor: 'pointer',
  borderRadius: 4, color: N.textMuted,
  transition: 'background 0.12s',
};

// ════════════════════════════════════════════════════════════════════════════
// PHASE 3 — vue synthétique (maquette 2026-08-19)
// ════════════════════════════════════════════════════════════════════════════

// Avatar initiales : pastel déterministe dérivé du nom (mêmes familles de
// couleurs que ETAT_STYLE du board — finition homogène avec EtatBadge).
const AVATAR_PASTELS = [
  { bg: '#e9f9f0', fg: '#15794a' },
  { bg: '#eaf1fd', fg: '#1e40af' },
  { bg: '#fff3e3', fg: '#b45309' },
  { bg: '#f3e8ff', fg: '#6940a5' },
  { bg: '#e0f2fe', fg: '#0e7490' },
  { bg: '#fdf2f8', fg: '#ad1a72' },
];

function avatarMeta(name) {
  const str = String(name || '?').trim();
  const words = str.split(/\s+/).filter(Boolean);
  const initials = words.length >= 2
    ? (words[0][0] + words[1][0]).toUpperCase()
    : str.slice(0, 2).toUpperCase();
  let hash = 0;
  for (let i = 0; i < str.length; i++) hash = (hash * 31 + str.charCodeAt(i)) >>> 0;
  return { initials, ...AVATAR_PASTELS[hash % AVATAR_PASTELS.length] };
}

// « Dossier ouvert le 12 mars 2026 » — date de signature en format long FR.
function formatDateLongFR(iso) {
  const d = parseDateFR(iso);
  if (!d) return null;
  return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
}

// ── Header client synthétique ───────────────────────────────────────────────
function ClientHeader({ client }) {
  // Séparation nom du client / société (2026-08-21) : la ligne principale
  // porte la/les personne(s), la société passe en sous-ligne. Pas de
  // personne détectée (181 cas en base) → société seule, pas de ligne vide.
  // L'avatar reste sur la SOCIÉTÉ (identité visuelle stable). Le numéro et
  // la date de signature ne sont pas répétés ici : ils vivent dans
  // « Informations contractuelles » (retour dev 2026-09-03).
  const { societeName, representant: repFromSociete } = splitSocieteRep(client?.societe);
  const personne = client?.representative_name || repFromSociete;
  const av = avatarMeta(societeName);

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: [0.4, 0, 0.2, 1] }}
      style={{ display: 'flex', alignItems: 'center', gap: 14 }}
    >
      {/* Avatar initiales */}
      <div style={{
        width: 52, height: 52,
        borderRadius: '50%',
        background: av.bg, color: av.fg,
        flexShrink: 0,
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 18, fontWeight: 700, letterSpacing: '0.02em',
        userSelect: 'none',
      }}>
        {av.initials}
      </div>

      {/* Nom du client (personne) + société */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <h1 style={{
          fontSize: 22, fontWeight: 700, color: N.text,
          margin: 0, letterSpacing: '-0.02em', lineHeight: 1.25,
          overflow: 'hidden', textOverflow: 'ellipsis',
          display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
        }}>
          {personne || societeName || '—'}
        </h1>
        {personne && societeName && (
          <div style={{
            marginTop: 2, fontSize: 13.5, fontWeight: 500, color: N.textMuted,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>
            {societeName}
          </div>
        )}
      </div>
    </motion.div>
  );
}

// ── Bandeau de situation : État · Responsable ──────────────────────────────
// Deux cases de même facture, une ligne. L'état est celui du board (source de
// vérité), le responsable est la personne de l'équipe finance qui suit le
// client. Le retard à date a sa tuile plus bas, il n'est pas répété ici.
function StatusStrip({
  boardRow, client, inheritedEtat, canEditEtat, onBoardEtatChange, onActedEtat,
  clientId, profile, canEditTeam, onResponsibleChanged, onShowToast,
}) {
  const etatFallback = inheritedEtat || client?.etat || null;
  const etatMeta = etatFallback ? (ETAT_COLORS[etatFallback] || ETAT_FALLBACK) : null;
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, delay: 0.04, ease: [0.4, 0, 0.2, 1] }}
      style={{
        marginTop: 16,
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
        gap: 1,
        background: N.borderSft,
        border: `1px solid ${N.borderSft}`,
        borderRadius: 10,
        overflow: 'hidden',
      }}
    >
      <StripCell label="État">
        {boardRow ? (
          <BoardEtatCell
            boardRow={boardRow}
            disabled={!canEditEtat}
            onEtatChange={(payload) => onBoardEtatChange?.(client?.numero_client, payload)}
            onActedEtat={onActedEtat}
          />
        ) : etatMeta ? (
          <span style={{
            display: 'inline-flex', alignItems: 'center', gap: 6,
            padding: '2px 10px', borderRadius: 4,
            background: etatMeta.bg, color: etatMeta.fg,
            fontSize: 12.5, fontWeight: 600,
          }}>
            {inheritedEtat && <Lock size={11} />}
            {etatMeta.label || etatFallback}
          </span>
        ) : (
          <span style={{ color: '#c8cdd7', fontSize: 13 }}>—</span>
        )}
      </StripCell>

      <StripCell label="Responsable">
        <ResponsibleSelect
          clientId={clientId}
          value={profile}
          canEdit={canEditTeam}
          onChanged={onResponsibleChanged}
          onShowToast={onShowToast}
          label={false}
        />
      </StripCell>
    </motion.div>
  );
}

function StripCell({ label, children }) {
  return (
    <div style={{ background: '#fff', padding: '10px 14px', minWidth: 0 }}>
      <div style={{
        fontSize: 10.5, fontWeight: 600, color: N.textFaint,
        textTransform: 'uppercase', letterSpacing: '0.04em',
      }}>
        {label}
      </div>
      <div style={{
        marginTop: 6, minHeight: 26,
        display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
      }}>
        {children}
      </div>
    </div>
  );
}

// ── Bouton de téléchargement d'un état de compte ────────────────────────────
// Un bouton par entité juridique (Owner / Opti'lex). Toujours cliquable :
// un client sans échéance facturée obtient un document au tableau vide.
function StatementMenu({ scope, structures = [], busy = null, onDownload }) {
  const anchorRef = useRef(null);
  const [open, setOpen] = useState(false);

  // Un document par entité (jamais fusionnées), et un par société pour les
  // clients multi-structures (demande dev 2026-09-01). Tout dans UN menu :
  // aligner cinq boutons sur la ligne du titre débordait et cachait les
  // structures (retour dev 2026-09-03).
  const entities = scope === 'global' ? ['owner', 'optilex'] : [scope];
  const items = [
    ...entities.map((entity) => ({
      key: entity,
      label: entity === 'optilex' ? "État de compte Opti'lex" : 'État de compte Owner',
      run: () => onDownload(entity),
    })),
    ...(scope !== 'global' && structures.length > 1
      ? structures.map((st) => ({
        key: `st-${st.id}`,
        label: `${st.name} seulement`,
        hint: 'ventilation de cette société',
        run: () => onDownload(scope, st),
      }))
      : []),
  ];
  const single = items.length === 1;
  const generating = !!busy;

  const trigger = (
    <button
      ref={anchorRef}
      type="button"
      onClick={() => (single ? items[0].run() : setOpen((v) => !v))}
      disabled={generating}
      title={single ? `Télécharger l'${items[0].label.toLowerCase()} (PDF)` : "Télécharger un état de compte (PDF)"}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 5,
        height: 26, padding: '0 10px',
        background: '#fff', color: N.text,
        border: `1px solid ${N.border}`, borderRadius: 6,
        fontSize: 12, fontWeight: 600,
        cursor: generating ? 'wait' : 'pointer',
        fontFamily: 'inherit', whiteSpace: 'nowrap',
        boxShadow: '0 1px 2px rgba(15,15,15,0.04)',
        opacity: generating ? 0.6 : 1,
        transition: 'background 0.12s, opacity 0.15s',
      }}
      onMouseEnter={(e) => { if (!generating) e.currentTarget.style.background = N.sideBg; }}
      onMouseLeave={(e) => { e.currentTarget.style.background = '#fff'; }}
    >
      <motion.span
        animate={generating ? { y: [0, 2, 0] } : { y: 0 }}
        transition={generating ? { duration: 0.7, repeat: Infinity, ease: 'easeInOut' } : { duration: 0 }}
        style={{ display: 'inline-flex' }}
      >
        <Download size={12} strokeWidth={2} />
      </motion.span>
      {generating ? 'Génération…' : (single ? "Télécharger l'état de compte" : 'Télécharger')}
      {!single && !generating && <ChevronDown size={12} style={{ color: N.textFaint }} />}
    </button>
  );

  if (single) return trigger;
  return (
    <>
      {trigger}
      <PortalDropdown open={open} anchorRef={anchorRef} onClose={() => setOpen(false)} align="right" minWidth={240}>
        <div style={{ padding: 4 }}>
          {items.map((it) => (
            <button
              key={it.key}
              type="button"
              onClick={() => { setOpen(false); it.run(); }}
              style={{
                display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 1,
                width: '100%', textAlign: 'left', border: 'none', background: 'transparent',
                borderRadius: 6, padding: '7px 10px', cursor: 'pointer', fontFamily: 'inherit',
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = N.sideBg; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
            >
              <span style={{ fontSize: 12.5, fontWeight: 600, color: N.text }}>{it.label}</span>
              {it.hint && <span style={{ fontSize: 11, color: N.textFaint }}>{it.hint}</span>}
            </button>
          ))}
        </div>
      </PortalDropdown>
    </>
  );
}

// ── 4 tuiles KPI (Total contrat / Encaissé / Restant dû / Retard à date) ────
// Distinction métier à respecter (dev 2026-08-25) :
//   « Restant dû »   = tout ce que le contrat doit encore rapporter, mois à
//                      VENIR inclus (total − encaissé).
//   « Retard à date » = ce qui est en retard AUJOURD'HUI, soit le retard du
//                      mois courant + les créances antérieures.
// `overdueCurrent` / `overdueCum` arrivent scope-aware du parent.
function KpiTiles({ kpis, overdueCurrent = 0, overdueCum = 0, credit = 0, loading, onRefund }) {
  const surplus = kpis.restant < 0 ? -kpis.restant : 0;
  const overdueToDate = overdueCurrent + overdueCum;
  // Trop-perçu reporté (backend `credit_*`) : un solde créditeur n'est pas
  // un retard. Sans retard, il PREND LA PLACE de la valeur de la tuile (en
  // vert) pour rendre l'action visible ; avec un retard (possible entre
  // entités en vision Globale), le retard reste la valeur principale et le
  // crédit passe en sous-ligne.
  // Le trop-perçu du MOIS EN COURS ne passe pas par `credit_*`, qui ne
  // reprend que le cumul des mois antérieurs. Sur un changement de formule
  // rétroactif, la différence du mois courant s'ajoute pourtant à ce qu'on
  // doit au client : la tuile affichait « retard −610,20 » d'un côté et
  // « +406,80 de trop-perçu » de l'autre, deux chiffres pour une seule
  // réalité (vérifié 2026-08-28). On retient le solde réellement dû.
  // `credit` vient du helper partagé (`scopedCredit`) : il porte DÉJÀ le mois
  // en cours et les créances antérieures. La tuile ne refait aucun calcul —
  // c'est la duplication de cette règle qui avait fait diverger le tableau et
  // la fiche (incident n°454, 2026-08-29).
  const creditShown = credit;
  const creditOnly = creditShown > 0 && overdueToDate <= 0;
  const tiles = [
    { label: 'Total contrat', value: kpis.total, color: N.text },
    { label: 'Encaissé', value: kpis.encaisse, color: N.green },
    {
      label: 'Restant dû',
      value: Math.max(0, kpis.restant), // plancher 0 — le trop-perçu est restitué en sous-note
      color: kpis.restant > 0 ? '#b42318' : N.green,
      notes: [
        surplus > 0 ? { text: `+${formatEUR(surplus)} trop-perçu`, color: N.green } : null,
      ].filter(Boolean),
    },
    {
      label: 'Retard à date',
      value: overdueToDate,
      display: creditOnly ? `Trop-perçu · ${formatEUR(creditShown)}` : null,
      color: creditOnly ? N.green : (overdueToDate > 0 ? '#b42318' : N.text),
      notes: [
        creditOnly
          ? { text: 'à déduire ou à rembourser', color: N.green, action: onRefund }
          : null,
        // La ventilation des créances antérieures a davantage de sens ici
        // que sous « Restant dû » (déplacée le 2026-08-25).
        !creditOnly && overdueCum > 0
          ? { text: `dont ${formatEUR(overdueCum)} de créances antérieures`, color: '#b42318' }
          : null,
        // Retard ET crédit coexistent (entités différentes en Globale).
        !creditOnly && creditShown > 0
          ? { text: `+${formatEUR(creditShown)} de trop-perçu`, color: N.green, action: onRefund }
          : null,
      ].filter(Boolean),
    },
  ];
  return (
    <div style={{
      display: 'grid',
      // 4 tuiles : `auto-fit` + minmax(160px) → 4 colonnes sur panneau large
      // ou plein écran, bascule automatiquement en 2×2 sur panneau étroit
      // (520 px) plutôt que d'écraser les montants.
      gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
      gap: 10,
      marginTop: 22,
    }}>
      {tiles.map((t, i) => (
        <motion.div
          key={t.label}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.28, delay: 0.04 + i * 0.05, ease: [0.4, 0, 0.2, 1] }}
          style={{
            border: `1px solid ${N.borderSft}`,
            borderRadius: 10,
            // padding resserré depuis la 4e tuile : garde ~130px utiles pour
            // les montants à 6 chiffres sans troncature.
            padding: '12px 12px',
            background: '#fff',
            display: 'flex', flexDirection: 'column', gap: 4,
            minWidth: 0,
          }}
        >
          <span style={{
            fontSize: 10.5, fontWeight: 600, color: N.textMuted,
            textTransform: 'uppercase', letterSpacing: '0.04em',
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          }}>
            {t.label}
          </span>
          {loading ? (
            <div style={{
              height: 20, width: '70%', background: '#f3f4f6', borderRadius: 4,
              animation: 'tsfPulse 1.4s ease-in-out infinite',
            }} />
          ) : (
            <>
              <span style={{
                // 19 → 17 px avec la 4e tuile : un montant à 6 chiffres
                // (« 264 770,18 € ») tient sans ellipse en colonne étroite.
                // `display` (libellé + montant, ex. trop-perçu) est plus long
                // qu'un montant seul : légèrement réduit et autorisé à passer
                // sur 2 lignes plutôt que d'être tronqué.
                fontSize: t.display ? 13.5 : 17,
                fontWeight: 700, color: t.color,
                fontVariantNumeric: 'tabular-nums', letterSpacing: '-0.01em',
                lineHeight: t.display ? 1.25 : undefined,
                whiteSpace: t.display ? 'normal' : 'nowrap',
                overflow: 'hidden', textOverflow: 'ellipsis',
              }}>
                {t.display || formatEUR(t.value)}
              </span>
              {(t.notes || []).map((note, j) => (note.action ? (
                // Le trop-perçu appelle un geste : une fois l'argent rendu, il
                // faut pouvoir l'éteindre. La note devient donc le bouton
                // (retour Ismahane 2026-08-28 : « je n'ai pas la possibilité
                // d'annuler le trop-perçu une fois remboursé »).
                <button
                  key={j}
                  type="button"
                  onClick={note.action}
                  title="Enregistrer le remboursement et solder le trop-perçu"
                  style={{
                    alignSelf: 'flex-start', border: 'none', background: 'transparent',
                    padding: 0, cursor: 'pointer', fontFamily: 'inherit',
                    fontSize: 10.5, fontWeight: 600, color: note.color,
                    textDecoration: 'underline', textUnderlineOffset: 2,
                    whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                    maxWidth: '100%',
                  }}
                >
                  {note.text}
                </button>
              ) : (
                <span key={j} style={{
                  fontSize: 10.5, fontWeight: 600, color: note.color,
                  fontVariantNumeric: 'tabular-nums',
                  whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                }}>
                  {note.text}
                </span>
              )))}
            </>
          )}
        </motion.div>
      ))}
    </div>
  );
}

// ── Remboursement d'un trop-perçu ───────────────────────────────────────────
// Un trop-perçu est de l'argent réellement encaissé. Le rendre ne s'écrit donc
// pas en diminuant l'encaissement — ce serait effacer un mouvement qui a eu
// lieu — mais en enregistrant un ajustement daté qui ramène le solde à zéro.
// L'historique des encaissements reste intact, et le geste est traçable.
function RefundPrompt({ value, onChange, onCancel, onSubmit }) {
  const [busy, setBusy] = useState(false);
  const ok = Number(value.amount) > 0;
  const label = value.entity === 'optilex' ? "Opti'lex" : 'Owner';
  return (
    <motion.div
      initial={{ opacity: 0, y: -6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
      style={{
        marginTop: 12, padding: '12px 14px', borderRadius: 10,
        border: `1px solid ${N.borderSft}`, background: '#f6fbf8',
        display: 'flex', flexDirection: 'column', gap: 10,
      }}
    >
      <div style={{ fontSize: 12.5, fontWeight: 700, color: N.text }}>
        Enregistrer un remboursement {label}
      </div>
      <div style={{ fontSize: 11.5, color: N.textMuted, lineHeight: 1.5 }}>
        Le solde repart à zéro. Les encaissements déjà saisis ne bougent pas :
        l’argent a bien été reçu, puis rendu — ce sont deux mouvements.
      </div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <input
          type="number"
          min={0}
          step="0.01"
          value={value.amount}
          onChange={(e) => onChange({ ...value, amount: Number(e.target.value) || 0 })}
          style={{
            width: 110, border: `1px solid ${N.border}`, borderRadius: 6,
            padding: '6px 8px', fontSize: 12.5, fontFamily: 'inherit',
            fontWeight: 600, textAlign: 'right', outline: 'none', color: N.text,
          }}
        />
        <span style={{ color: N.textMuted, fontSize: 12 }}>€</span>
        <input
          value={value.reason}
          onChange={(e) => onChange({ ...value, reason: e.target.value })}
          placeholder="Motif (virement du 28/08, geste commercial…)"
          style={{
            flex: '1 1 180px', border: `1px solid ${N.border}`, borderRadius: 6,
            padding: '6px 8px', fontSize: 12.5, fontFamily: 'inherit',
            outline: 'none', color: N.text, minWidth: 0,
          }}
        />
      </div>
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button
          type="button"
          onClick={onCancel}
          style={{
            border: 'none', background: 'transparent', cursor: 'pointer',
            color: N.textMuted, fontSize: 12.5, fontFamily: 'inherit', padding: '6px 8px',
          }}
        >
          Annuler
        </button>
        <button
          type="button"
          disabled={!ok || busy}
          onClick={async () => {
            setBusy(true);
            try { await onSubmit(value); } finally { setBusy(false); }
          }}
          style={{
            border: 'none', borderRadius: 6, padding: '6px 12px',
            fontSize: 12.5, fontWeight: 600, fontFamily: 'inherit',
            cursor: ok && !busy ? 'pointer' : 'default',
            background: ok && !busy ? N.green : N.sideBg,
            color: ok && !busy ? '#fff' : N.textFaint,
          }}
        >
          {busy ? 'Enregistrement…' : 'Solder le trop-perçu'}
        </button>
      </div>
    </motion.div>
  );
}

// ── Informations contractuelles (liste compacte icône + libellé / valeur) ───
function ContractInfoList({
  client, profile, focusedRow, boardRow, patch, canEdit, canEditMoney, onCopied,
  editing = false, clientId, onProfileChanged, onShowToast, periods = [],
}) {
  // Séparation nom du client / société (2026-08-21) : « Nom du client » =
  // la/les personne(s), la société a sa propre ligne. Pas de personne
  // détectée → « Nom du client » = société, pas de ligne Société en doublon.
  const { societeName, representant: repFromSociete } = splitSocieteRep(client?.societe);
  const personne = client?.representative_name || repFromSociete;
  // numero_client contient déjà le préfixe « n° » en base (ex. « n°691 »).
  const numeroValue = client?.numero_client
    ? String(client.numero_client).replace(/^n°\s*/i, '')
    : null;

  // Formule = TRANCHE SEULE, éditable (retour dev 2026-08-21) — plus de
  // montant accolé (le prix vit dans les tuiles KPI et le PDF). Snapshot de
  // la period focus prioritaire : l'édition PATCHe `employee_range` sur la
  // period (champ accepté par le backend, historisé automatiquement dans
  // l'audit → visible dans l'historique des actions).
  const range = normalizeEmployeeRange(
    focusedRow?.employee_range || profile?.employee_range || client?.employee_range,
  );
  const rangeLabels = EMPLOYEE_RANGES.reduce((acc, v) => {
    acc[v] = employeeRangeLabel(v); return acc;
  }, {});
  // Une tranche hors grille (saisie ancienne : « 3-4 », « 20+ ») garde son
  // libellé, sinon elle s'affichait nue à côté des autres.
  if (range && !rangeLabels[range]) rangeLabels[range] = employeeRangeLabel(range);

  // Modalité : le rythme de paiement, rien d'autre — Mensuel / Annuel /
  // Trimestriel. Le « N × {montant} » dérivé de `payment_specificity` a été
  // retiré (demande dev 2026-08-25) : cette colonne du classeur est souvent
  // périmée et annonçait des échéanciers que le client n'a jamais eus.
  let modalite = null;
  {
    // Chaîne de fallback (2026-08-21) : mode de la period → mode normalisé
    // du client (backend, MONTHLY/YEARLY/QUARTERLY) → `periodicite` du board
    // (libellés FR, ~27 % des clients — ex. client n°1 Shake'N OUT :
    // « Annuel »). paymentModeLabel canonicalise les deux formats.
    modalite = paymentModeLabel(focusedRow?.payment_mode)
      || paymentModeLabel(client?.payment_mode)
      || paymentModeLabel(boardRow?.periodicite);
  }

  // Formule et modalité commandent toutes deux l'attendu : on demande à
  // quel mois le changement s'applique avant d'écrire (demande dev
  // 2026-08-27). `pending` porte la saisie en attente de ce choix.
  const [pending, setPending] = useState(null);
  const askEffective = useCallback((field, value, label) => {
    setPending({ field, value, label });
  }, []);
  const applyPending = useCallback(async (effective) => {
    if (!pending) return;
    const { field, value } = pending;
    setPending(null);
    await patch(field, { change_effective: effective })(value);
  }, [pending, patch]);

  const rows = [
    { Icon: Hash,       label: 'Client n°',            value: numeroValue, mono: true },
    ...(personne ? [
      {
        Icon: Briefcase,
        label: 'Société',
        copyValue: societeName,
        node: (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'flex-end' }}>
            <span>{societeName}</span>
            <RelatedEntityList
              items={profile?.companies || []}
              kind="societe"
              clientId={clientId}
              editing={editing}
              onChanged={onProfileChanged}
              onShowToast={onShowToast}
            />
          </div>
        ),
      },
    ] : []),
    {
      Icon: User,
      label: 'Nom du client',
      copyValue: personne || societeName,
      node: (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'flex-end' }}>
          <span>{personne || societeName}</span>
          <RelatedEntityList
            items={profile?.partners || []}
            kind="associe"
            clientId={clientId}
            editing={editing}
            onChanged={onProfileChanged}
            onShowToast={onShowToast}
          />
        </div>
      ),
    },
    { Icon: PenLine,    label: 'Date de signature',    value: formatDateLongFR(profile?.date_signature) },
    // SIREN : le backfill est une donnée sourcée (lecture) ; sans lui, la
    // saisie alimente l'override du board (siren_ovr) et le journal. Vivait
    // dans l'accordéon « détail complet », retiré le 2026-09-03.
    {
      Icon: Landmark,
      label: 'SIREN',
      copyValue: profile?.siren,
      node: (editing && canEditMoney && profile && profile.siren_source !== 'backfill') ? (
        <EditableText
          value={profile?.siren}
          placeholder="9 chiffres"
          onCommit={async (value) => {
            await apiClient.patch(`/api/v1/finance-periods/client/${clientId}/profile`, { siren: value || '' });
            onProfileChanged?.();
          }}
          width="auto"
        />
      ) : (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          {profile?.siren ? (
            <span style={{ fontSize: 13, fontWeight: 500, color: N.text, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}>
              {profile.siren}
            </span>
          ) : (
            <span style={{ color: '#c7c7c2', fontStyle: 'italic', fontSize: 12.5 }}>Vide</span>
          )}
          {profile?.siren_source === 'backfill' && (
            <span style={{ fontSize: 10.5, color: N.textFaint }}>source interne</span>
          )}
        </span>
      ),
    },
    // RDV d'onboarding : c'est lui qui déclenche la facturation — premier
    // mois facturé, départ de l'engagement 12 mois, et bascule en retard
    // (demande dev 2026-08-26). Servi par /profile, qui prend la date du
    // classeur puis celle de la fiche CRM ; le payload de liste ne la porte
    // pas, d'où la lecture sur `profile` uniquement.
    {
      Icon: CalendarCheck2,
      label: "RDV d'onboarding",
      // LECTURE SEULE, volontairement (arbitrage dev 2026-08-27) : la date
      // vient de la déclaration de vente. La finance la consulte, elle ne
      // la saisit pas — sinon deux vérités pour la date qui déclenche la
      // facturation.
      value: formatDateLongFR(profile?.rdv_onboarding),
    },
    // Formule = tranche seule, éditable (PATCH employee_range sur la period
    // focus — optimiste + rollback + toast via le flow onPatchRow standard).
    {
      Icon: Box,
      label: 'Formule',
      copyValue: employeeRangeLabel(range),
      node: (
        <EditableSelect
          value={range}
          options={EMPLOYEE_RANGES}
          optionLabels={rangeLabels}
          onCommit={(v) => askEffective('employee_range', v, employeeRangeLabel(v))}
          // La formule commande le montant facturé : direction financière
          // seulement. La modalité, elle, reste ouverte à l'équipe.
          disabled={!canEditMoney}
          placeholderItalic
          width="auto"
        />
      ),
    },
    // Modalité éditable (demande dev 2026-08-27) : passer d'annuel à mensuel
    // change le rythme de facturation, donc l'attendu — même traitement que
    // la formule, mois d'effet demandé avant écriture.
    {
      Icon: CreditCard,
      label: 'Modalité de paiement',
      copyValue: modalite,
      node: (
        <EditableSelect
          value={normalizePaymentMode(focusedRow?.payment_mode || client?.payment_mode)}
          options={PAYMENT_MODES}
          optionLabels={PAYMENT_MODE_LABELS}
          onCommit={(v) => askEffective('payment_mode', v, paymentModeLabel(v))}
          disabled={!canEdit}
          placeholderItalic
          width="auto"
        />
      ),
    },
  ];

  return (
    <div style={{
      border: `1px solid ${N.borderSft}`,
      borderRadius: 10,
      overflow: 'hidden',
      position: 'relative',
    }}>
      {pending && (
        <EffectiveMonthPrompt
          label={pending.label}
          onPick={applyPending}
          onCancel={() => setPending(null)}
          periods={periods}
        />
      )}
      {rows.map((r, i) => (
        <motion.div
          key={r.label}
          initial={{ opacity: 0, x: -6 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.22, delay: i * 0.03, ease: [0.4, 0, 0.2, 1] }}
          className="tsf-copy-wrap"
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            gap: 12,
            padding: '9px 14px',
            borderTop: i === 0 ? 'none' : `1px solid ${N.borderSft}`,
            fontSize: 13,
            minWidth: 0,
          }}
        >
          <span style={{
            display: 'inline-flex', alignItems: 'center', gap: 8,
            color: N.textMuted, fontSize: 12.5,
            whiteSpace: 'nowrap', flexShrink: 0,
          }}>
            <r.Icon size={13} strokeWidth={1.9} style={{ color: N.textFaint }} />
            {r.label}
          </span>
          <span style={{
            display: 'inline-flex', alignItems: 'center', gap: 4,
            minWidth: 0, justifyContent: 'flex-end',
          }}>
            {r.node ? (
              r.node
            ) : r.value ? (
              <span style={{
                fontSize: 13, fontWeight: 500, color: N.text,
                fontFamily: r.mono ? 'ui-monospace, SFMono-Regular, Menlo, monospace' : 'inherit',
                fontVariantNumeric: 'tabular-nums',
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}>
                {r.value}
              </span>
            ) : (
              <span style={{ color: '#c7c7c2', fontStyle: 'italic', fontSize: 12.5 }}>Vide</span>
            )}
            {(r.value || r.copyValue) && (
              <CopyButton value={r.copyValue || r.value} onCopied={onCopied} size={12} />
            )}
          </span>
        </motion.div>
      ))}

      {/* Emails et téléphones, en bas de la fiche (demande dev 2026-08-27) :
          copiables en un clic à tout moment, typés (pro, perso, comptable…)
          et enrichissables — le bouton d'ajout n'apparaît qu'en mode
          édition. Composant partagé avec le board, donc une seule vérité. */}
      {clientId && (
        <div style={{
          padding: '4px 14px 8px',
          borderTop: `1px solid ${N.borderSft}`,
        }}>
          <ContactList
            clientId={clientId}
            kind="email"
            contacts={profile?.contacts}
            inheritedValue={client?.email}
            canEdit={canEdit && editing}
            onChanged={onProfileChanged}
            onShowToast={onShowToast}
            onCopied={onCopied}
          />
          <ContactList
            clientId={clientId}
            kind="phone"
            contacts={profile?.contacts}
            inheritedValue={client?.phone}
            canEdit={canEdit && editing}
            onChanged={onProfileChanged}
            onShowToast={onShowToast}
            onCopied={onCopied}
          />
        </div>
      )}
    </div>
  );
}

// ── État de compte (échéancier) ─────────────────────────────────────────────
const INSTALLMENT_BADGES = {
  paid:     { label: 'Encaissée', bg: '#e9f9f0', fg: '#15794a' },
  partial:  { label: 'Partielle', bg: '#fff3e3', fg: '#b45309' },
  late:     { label: 'En retard', bg: '#fdecec', fg: '#b42318' },
  upcoming: { label: 'À venir',   bg: '#faf3dd', fg: '#9f6b00' },
  paused:   { label: 'En pause',  bg: '#eef1f6', fg: '#5b6472' },
};

// Échéancier : TOUT l'historique visible d'emblée (retour dev 2026-09-03 —
// « elle n'a pas accès à toute l'antériorité des clients »). Une directrice
// financière qui ouvre une fiche veut la voir en entier, pas six mois et un
// bouton. Le repli ne s'active qu'au-delà de deux ans, là où la liste devient
// réellement encombrante.
// Hauteur du volet d'échéances. Toute l'antériorité reste présente — un
// directeur financier veut pouvoir remonter au premier mois — mais elle défile
// au lieu de pousser le reste de la fiche vers le bas (retour dev 2026-09-03 :
// « pas besoin d'en afficher autant, tu peux faire un scroll »). Environ six
// lignes visibles, la liste s'ouvre sur les mois récents.
const INSTALLMENTS_VIEWPORT = 268;

function installmentSubline(inst) {
  // Format long FR (« 12 mars 2026 ») — demande dev 2026-08-19.
  const date = inst.payDate ? formatDateLongFR(inst.payDate) : null;
  const monthLabel = formatMonthLabel(inst.month);
  // Un attendu fixé à la main se signale : la grille ne le réécrira plus.
  const manuel = inst.manual ? ' · fixé à la main' : '';
  switch (inst.status) {
    case 'paused':
      return `${monthLabel} · en pause${inst.pauseUntil ? ` jusqu'au ${formatDateFR(inst.pauseUntil)}` : ', reprise à décider'}${manuel}`;
    case 'paid':
      return (date ? `Prélevée le ${date}` : monthLabel) + manuel;
    case 'partial':
      return `${formatEUR(inst.received)} / ${formatEUR(inst.expected)}${date ? ` · Prélevée le ${date}` : ` · ${monthLabel}`}`;
    case 'upcoming':
      return (date ? `Prévue le ${date}` : `Prévue · ${monthLabel}`) + manuel;
    default: // late
      return (date ? `Prévue le ${date}` : monthLabel) + manuel;
  }
}

function InstallmentsList({ installments, loading, focusedRowId, onSelectRow }) {
  const scrollRef = React.useRef(null);
  const total = installments.length;

  // Ouvrir sur le MOIS COURANT, en haut du volet : on lit d'abord l'échéance
  // du mois, puis ce qui vient ; l'antériorité encaissée se remonte à la
  // molette (retour dev 2026-09-03). Sans mois courant, sur la première
  // échéance non encaissée ; sinon en bas.
  React.useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const anchor = el.querySelector('[data-anchor="1"]');
    el.scrollTop = anchor ? Math.max(anchor.offsetTop - el.offsetTop, 0) : el.scrollHeight;
  }, [total]);

  const nowMonth = currentPeriod();
  let anchorIdx = installments.findIndex((inst) => inst.month >= nowMonth);
  if (anchorIdx < 0) anchorIdx = installments.findIndex((inst) => inst.status !== 'paid');

  if (loading) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} style={{
            height: 40, background: '#f3f4f6', borderRadius: 6,
            animation: 'tsfPulse 1.4s ease-in-out infinite', opacity: 1 - i * 0.12,
          }} />
        ))}
      </div>
    );
  }
  if (!installments.length) return <Empty text="Aucune échéance sur la période." />;

  const renderRow = (inst, i, first = false) => {
    const badge = INSTALLMENT_BADGES[inst.status];
    const isActive = focusedRowId === inst.id;
    return (
      <motion.button
        key={inst.id}
        type="button"
        data-anchor={i === anchorIdx ? '1' : undefined}
        onClick={() => onSelectRow?.(inst.id)}
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.22, delay: Math.min(i, 6) * 0.025, ease: [0.4, 0, 0.2, 1] }}
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          gap: 12, width: '100%',
          padding: '9px 14px',
          border: 'none',
          borderTop: first ? 'none' : `1px solid ${N.borderSft}`,
          background: isActive ? N.sideHover : 'transparent',
          cursor: 'pointer',
          fontFamily: 'inherit', textAlign: 'left',
          transition: 'background 0.12s',
          minWidth: 0,
        }}
        onMouseEnter={(e) => { if (!isActive) e.currentTarget.style.background = N.sideBg; }}
        onMouseLeave={(e) => { if (!isActive) e.currentTarget.style.background = 'transparent'; }}
      >
        <span style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
          <span style={{
            fontSize: 13, fontWeight: 600, color: N.text,
            fontVariantNumeric: 'tabular-nums',
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          }}>
            Échéance {inst.n} · {formatEUR(inst.expected > 0 ? inst.expected : inst.received)}
          </span>
          <span style={{
            fontSize: 11.5, color: N.textMuted,
            fontVariantNumeric: 'tabular-nums',
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          }}>
            {installmentSubline(inst)}
          </span>
        </span>
        <span style={{
          padding: '2px 9px', borderRadius: 999,
          background: badge.bg, color: badge.fg,
          fontSize: 11.5, fontWeight: 700, whiteSpace: 'nowrap', flexShrink: 0,
        }}>
          {badge.label}
        </span>
      </motion.button>
    );
  };

  return (
    <div style={{
      border: `1px solid ${N.borderSft}`,
      borderRadius: 10,
      overflow: 'hidden',
    }}>
      <div
        ref={scrollRef}
        style={{ maxHeight: INSTALLMENTS_VIEWPORT, overflowY: 'auto' }}
      >
        {installments.map((inst, i) => renderRow(inst, i, i === 0))}
      </div>
      {total > 6 && (
        <div style={{
          padding: '6px 14px', borderTop: `1px solid ${N.borderSft}`,
          background: N.sideBg, fontSize: 11.5, color: N.textMuted,
          textAlign: 'center',
        }}>
          {total} échéances depuis {formatMonthLabel(installments[0].month)}
        </div>
      )}
    </div>
  );
}

// ── Dernière action + historique des actions (vue synthétique) ──────────────
// Demande Ismahane 2026-08-19 : la traçabilité (ex. effectif modifié → les
// attendus changent) doit être visible SANS ouvrir l'accordéon détail.
// Source : GET /finance-periods/client/{id}/audit (toutes périodes). La
// section est absente si l'endpoint ne répond pas ou n'a rien.

// « il y a 2 h », « hier », « il y a 3 j », sinon date longue FR.
function formatRelativeFR(iso) {
  const d = parseDateFR(iso) || (iso ? new Date(iso) : null);
  if (!d || Number.isNaN(d.getTime())) return '—';
  const diffMin = Math.floor((Date.now() - d.getTime()) / 60000);
  if (diffMin < 1) return 'à l\'instant';
  if (diffMin < 60) return `il y a ${diffMin} min`;
  const h = Math.floor(diffMin / 60);
  if (h < 24) return `il y a ${h} h`;
  const days = Math.floor(h / 24);
  if (days === 1) return 'hier';
  if (days < 7) return `il y a ${days} j`;
  return formatDateLongFR(iso) || '—';
}

const auditEntryDate = (e) => e.changed_at || e.created_at || null;

// Ligne « Dernière action » SEULE dans la vue synthétique (demande Ismahane) ;
// la liste complète vit dans l'accordéon Détails (ClientAuditList) depuis le
// retour dev 2026-08-21.
// Historique des actions : la plus récente est TOUJOURS visible — c'est celle
// qu'on vient chercher — et les précédentes se déplient d'un bouton (retour
// dev 2026-08-28). Les trois sources (audit des lignes, journal de la fiche,
// états posés au board) sont fondues en une seule frise : pour l'utilisateur
// il n'y a qu'une histoire, pas trois tables.
//
// Chaque action est dite en une phrase (« Ismahane a saisi 450,00 € reçus
// Owner pour août 2026 ») plutôt qu'en « champ : avant → après » — retour dev
// 2026-09-03 : « on ne comprend pas trop quelle était vraiment la dernière
// action ». Les phrases vivent dans actionLabel.js, testées.
function ActionsTimeline({ audit, operations, changes, etatHistory }) {
  const [open, setOpen] = useState(false);

  const entries = useMemo(() => {
    // Une opération de la direction résume ses lignes d'audit : on montre la
    // phrase de l'opération, pas chaque champ qu'elle a touché. Annulée, elle
    // reste visible mais barrée, et son annulation est une action à part.
    const fromOps = (operations || []).flatMap((o) => {
      const items = [{ when: o.created_at, who: o.author_name || null, sentence: o.label, reverted: !!o.reverted_at }];
      if (o.reverted_at) {
        items.push({
          when: o.reverted_at, who: o.reverted_by || null,
          sentence: `a annulé l'opération « ${String(o.label || '').replace(/^a /, '')} »`,
        });
      }
      return items;
    });
    const fromAudit = (audit || []).filter((e) => !e.operation_id).map((e) => ({
      when: auditEntryDate(e),
      who: e.changed_by_name || null,
      sentence: describeAction({
        field: e.field_name, from: e.old_value, to: e.new_value, period: e.period || null,
      }),
    }));
    // Le report d'attendu est déjà raconté par son opération.
    const fromChanges = (changes || []).filter((c) => c.field !== 'expected_correction').map((c) => ({
      when: c.changed_at,
      who: c.changed_by || null,
      sentence: describeAction({ field: c.field, from: c.old_value, to: c.new_value }),
    }));
    // États posés au board (résiliation, rétractation, pause…). La date
    // d'effet est portée par la valeur, pas par l'horodatage : « posé le 12,
    // effectif le 30 » sont deux dates différentes, et c'est la seconde qui
    // fait basculer le client.
    const fromEtats = (etatHistory || []).map((h) => ({
      when: h.created_at,
      who: h.created_by_name || h.created_by || null,
      sentence: describeAction({
        field: 'etat', from: null, to: h.etat, effectiveOn: h.etat_date || null,
      }),
    }));
    return [...fromOps, ...fromAudit, ...fromChanges, ...fromEtats].sort((a, b) =>
      String(b.when || '').localeCompare(String(a.when || '')));
  }, [audit, operations, changes, etatHistory]);

  const [last, ...previous] = entries;
  const shown = open ? previous.slice(0, 40) : [];

  return (
    <Section title="Historique des actions" delay={0.14}>
      {entries.length === 0 ? (
        <Empty text="Aucune action enregistrée pour ce client." />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {/* La dernière action, en clair : qui, quoi, quand. */}
          <div style={{
            display: 'flex', alignItems: 'flex-start', gap: 10,
            padding: '11px 14px', borderRadius: 10,
            border: `1px solid ${N.borderSft}`, background: N.sideBg,
          }}>
            <History size={14} style={{ color: N.textFaint, flexShrink: 0, marginTop: 2 }} />
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{
                fontSize: 10.5, fontWeight: 700, color: N.textFaint,
                textTransform: 'uppercase', letterSpacing: '0.04em',
              }}>
                Dernière action · {formatRelativeFR(last.when)}
              </div>
              <div style={{
                fontSize: 13, color: last.reverted ? N.textFaint : N.text, marginTop: 3, lineHeight: 1.5,
                textDecoration: last.reverted ? 'line-through' : 'none',
              }}>
                <strong>{last.who || 'Quelqu’un'}</strong> {last.sentence}.
              </div>
              <div style={{ fontSize: 11, color: N.textFaint, marginTop: 2 }}>
                {formatAuditDate(last.when)}
              </div>
            </div>
          </div>

          {shown.length > 0 && (
            <div style={{
              border: `1px solid ${N.borderSft}`, borderRadius: 10, overflow: 'hidden',
            }}>
              {shown.map((e, i) => (
                <div key={i} style={{
                  display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between',
                  gap: 12, padding: '9px 14px', fontSize: 12, minWidth: 0,
                  borderTop: i === 0 ? 'none' : `1px solid ${N.borderSft}`,
                }}>
                  <span style={{
                    minWidth: 0, color: e.reverted ? N.textFaint : N.text, lineHeight: 1.45,
                    textDecoration: e.reverted ? 'line-through' : 'none',
                  }}>
                    <strong>{e.who || 'Quelqu’un'}</strong> {e.sentence}.
                  </span>
                  <span style={{
                    color: N.textFaint, fontSize: 11, whiteSpace: 'nowrap', flexShrink: 0,
                    marginTop: 1,
                  }}>
                    {formatAuditDate(e.when)}
                  </span>
                </div>
              ))}
            </div>
          )}

          {previous.length > 0 && (
            <button
              type="button"
              onClick={() => setOpen((v) => !v)}
              style={{
                alignSelf: 'flex-start', border: 'none', background: 'transparent',
                cursor: 'pointer', padding: '2px 0', fontFamily: 'inherit',
                fontSize: 12, fontWeight: 600, color: N.textMuted,
              }}
            >
              {open ? 'Réduire' : `Voir les ${previous.length} action${previous.length > 1 ? 's' : ''} précédente${previous.length > 1 ? 's' : ''}`}
            </button>
          )}
        </div>
      )}
    </Section>
  );
}


// ── Rendez-vous & juriste référent (vue synthétique) ────────────────────────
// Réplique inline de la modale « Agenda du client » du board Owner/Opti'Lex
// (OptilexBoard.jsx → ClientAgendaModal — non réutilisable telle quelle :
// c'est une modale portalisée plein écran). Mêmes données : RDV standards de
// la row board + RDV juristes et juriste de référence de client-agenda.
// Styles repris du board (carte juriste verte, rows label|date|badge).
// Retouches dev 2026-08-21 : icône balance (Scale) dans la carte juriste,
// email du juriste cliquable (mailto + copy), icône calendrier teintée
// passé/à venir sur chaque ligne RDV.
const AGENDA_GREEN = '#15794a';
const AGENDA_NAVY = '#1e2330';
const AGENDA_MUTED = '#8a93a4';
const AGENDA_BORDER = '#e9ebf0';
const AGENDA_AMBER = '#b45309';

function RdvJuristeSection({ boardRow, agenda, onCopied }) {
  // Consolidation identique à ClientAgendaModal (board) : 4 RDV standards de
  // la fiche + RDV juristes, triés du plus récent au plus ancien.
  const items = useMemo(() => {
    if (!boardRow) return [];
    const std = [
      { key: 'onb', label: 'Onboarding Owner', type: 'Owner', date: boardRow.rdv_onboarding_date_manual || boardRow.rdv_onboarding_date, done: boardRow.rdv_onboarding_done },
      { key: 'int', label: "Intégration Opti'Lex", type: "Opti'Lex", date: boardRow.rdv_lancement_date, done: boardRow.rdv_lancement_done },
      { key: 'fis', label: 'Lancement fiscal', type: "Opti'Lex", date: boardRow.rdv_fiscal_date_manual || boardRow.rdv_fiscal_date, done: boardRow.rdv_fiscal_done },
      { key: 'soc', label: 'Lancement social', type: "Opti'Lex", date: boardRow.rdv_social_date_manual || boardRow.rdv_social_date, done: boardRow.rdv_social_done },
    ].filter((x) => x.date).map((x) => ({ ...x, kind: 'standard', when: String(x.date) }));
    const jur = ((agenda && agenda.rdv) || []).map((b, i) => ({
      key: `jur-${b.juriste_email || ''}-${b.slot_start || i}`,
      label: b.summary || `RDV juriste ${b.team || ''}`.trim(),
      juriste: `${b.juriste_name || 'Juriste'}${b.team ? ' · ' + b.team : ''}`,
      cancelled: b.status === 'cancelled',
      kind: 'jurist',
      when: String(b.slot_start),
    }));
    return [...std, ...jur].sort((a, b) => (b.when || '').localeCompare(a.when || ''));
  }, [boardRow, agenda]);
  // Un client suivi depuis un an cumule les RDV juristes : la liste entière
  // n'apprend rien à la finance (retour dev 2026-09-03). On montre ce qui
  // vient et les trois derniers passés ; le reste se déplie.
  const [showAllRdv, setShowAllRdv] = useState(false);

  const ref = agenda?.reference_jurist || null;
  // Email du juriste de référence — nom de champ défensif : la réponse
  // client-agenda expose `juriste_email` sur les RDV ; sur reference_jurist
  // on tolère les deux variantes plausibles.
  const refEmail = ref ? (ref.juriste_email || ref.email || null) : null;

  // Client absent du board ET rien à montrer → section masquée proprement.
  if (!boardRow || (!ref && items.length === 0)) return null;

  // Date + heure Paris ; date seule pour les RDV standards sans heure.
  const whenLabel = (iso) => {
    const s = String(iso || '');
    try {
      const d = new Date(iso);
      const day = d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Paris' });
      if (!/T\d\d:\d\d/.test(s)) return day;
      const time = d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Paris' });
      return `${day} · ${time}`;
    } catch {
      return s.slice(0, 10);
    }
  };

  // RDV « à venir » : non annulé, non effectué, jour (Paris) >= aujourd'hui.
  const todayParis = new Date().toLocaleDateString('fr-CA', { timeZone: 'Europe/Paris' });
  const isUpcoming = (it) => {
    if (it.cancelled) return false;
    if (it.kind === 'standard' && it.done) return false;
    try {
      return new Date(it.when).toLocaleDateString('fr-CA', { timeZone: 'Europe/Paris' }) >= todayParis;
    } catch {
      return String(it.when).slice(0, 10) >= todayParis;
    }
  };

  // Les RDV à venir en entier (ils sont rares et c'est l'agenda), puis les
  // derniers passés — `items` est trié du plus récent au plus ancien.
  const RECENT_PAST = 3;
  const upcomingItems = items.filter(isUpcoming);
  const pastItems = items.filter((it) => !isUpcoming(it));
  const visibleItems = showAllRdv
    ? items
    : [...upcomingItems, ...pastItems.slice(0, RECENT_PAST)];
  const hiddenRdv = items.length - visibleItems.length;
  const canToggleRdv = pastItems.length > RECENT_PAST;

  return (
    <div>
      {/* Juriste de référence — carte du board, badge balance (Scale) +
          email cliquable avec copy au hover */}
      <div style={{
        padding: '11px 14px', borderRadius: 10,
        border: `1px solid ${ref ? AGENDA_GREEN + '55' : AGENDA_BORDER}`,
        background: ref ? '#f0f7f3' : '#fafbfc',
        display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12,
      }}>
        <span style={{
          width: 34, height: 34, borderRadius: '50%', flexShrink: 0,
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          background: ref ? AGENDA_GREEN : '#e5e8ee', color: '#fff',
        }}>
          <Scale size={16} strokeWidth={2} />
        </span>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: 10.5, color: AGENDA_MUTED, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
            Juriste de référence
          </div>
          <div style={{ fontSize: 13.5, fontWeight: 700, color: ref ? AGENDA_NAVY : AGENDA_MUTED }}>
            {ref ? `${ref.name}${ref.team ? ' · ' + ref.team : ''}` : "Aucun RDV juriste pour l'instant"}
          </div>
          {refEmail && (
            <span className="tsf-copy-wrap" style={{
              display: 'inline-flex', alignItems: 'center', gap: 4,
              marginTop: 2, minWidth: 0, maxWidth: '100%',
            }}>
              <a
                href={`mailto:${refEmail}`}
                style={{
                  fontSize: 11.5, color: AGENDA_GREEN, textDecoration: 'none',
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}
                onMouseEnter={(e) => { e.currentTarget.style.textDecoration = 'underline'; }}
                onMouseLeave={(e) => { e.currentTarget.style.textDecoration = 'none'; }}
              >
                {refEmail}
              </a>
              <CopyButton value={refEmail} onCopied={onCopied} size={11} />
            </span>
          )}
        </div>
      </div>

      {/* Liste des RDV — icône calendrier teintée (ambre = à venir,
          gris = passé/effectué), puis titre + date · heure · juriste/pôle */}
      {visibleItems.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {visibleItems.map((it, i) => {
            const upcoming = isUpcoming(it);
            return (
              <motion.div
                key={it.key}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.22, delay: i * 0.03, ease: [0.4, 0, 0.2, 1] }}
                style={{
                  display: 'flex', alignItems: 'center', gap: 12,
                  padding: '9px 12px', borderRadius: 10,
                  border: `1px solid ${AGENDA_BORDER}`, background: '#fff',
                  opacity: it.cancelled ? 0.5 : 1,
                }}
              >
                <span style={{
                  width: 28, height: 28, borderRadius: 8, flexShrink: 0,
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                  background: upcoming ? '#fff3e3' : '#eef1f6',
                  color: upcoming ? AGENDA_AMBER : '#5b6472',
                }}>
                  {upcoming
                    ? <CalendarClock size={14} strokeWidth={2} />
                    : <CalendarCheck2 size={14} strokeWidth={2} />}
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{
                    fontSize: 13, fontWeight: 600, color: AGENDA_NAVY,
                    textDecoration: it.cancelled ? 'line-through' : 'none',
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  }}>
                    {it.label}
                  </div>
                  <div style={{
                    fontSize: 11.5, color: AGENDA_MUTED,
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  }}>
                    {whenLabel(it.when)}
                    {' · '}
                    {it.kind === 'jurist' ? (it.juriste || 'Juriste') + (it.cancelled ? ' · annulé' : '') : it.type}
                  </div>
                </div>
                {it.kind === 'standard' && (
                  <span style={{
                    flexShrink: 0, fontSize: 11, fontWeight: 700,
                    padding: '3px 9px', borderRadius: 20,
                    color: it.done ? AGENDA_GREEN : AGENDA_MUTED,
                    background: it.done ? '#e7f3ec' : '#eef1f6',
                  }}>
                    {it.done ? 'Effectué' : 'À venir'}
                  </span>
                )}
              </motion.div>
            );
          })}
        </div>
      )}
      {canToggleRdv && (
        <button
          type="button"
          onClick={() => setShowAllRdv((v) => !v)}
          style={{
            marginTop: 8, border: 'none', background: 'transparent',
            cursor: 'pointer', padding: '2px 0', fontFamily: 'inherit',
            fontSize: 12, fontWeight: 600, color: AGENDA_MUTED,
          }}
        >
          {showAllRdv
            ? 'Réduire'
            : `Voir les ${hiddenRdv} rendez-vous plus ancien${hiddenRdv > 1 ? 's' : ''}`}
        </button>
      )}
    </div>
  );
}



// ── Meta row (pills) ────────────────────────────────────────────────────────
// ── Sociétés couvertes / associés ──────────────────────────────────────────
// Un client couvre parfois plusieurs sociétés, et son dossier porte plusieurs
// associés (demande dev 2026-08-27). Rien ne pouvait les stocker : la table
// des sociétés de convention est rattachée au lead, celle des contacts ne
// gère que des emails. Backend : `client_related_entity`, archivage logique.
function RelatedEntityList({ items, kind, clientId, editing, onChanged, onShowToast }) {
  const [name, setName] = useState('');
  const [extra, setExtra] = useState('');
  const [busy, setBusy] = useState(false);
  const societe = kind === 'societe';

  const add = useCallback(async () => {
    const trimmed = name.trim();
    if (trimmed.length < 2 || busy) return;
    setBusy(true);
    try {
      await apiClient.post(`/api/v1/finance-periods/client/${clientId}/entities`, {
        kind,
        name: trimmed,
        ...(societe ? { siren: extra.trim() || null } : { role: extra.trim() || null }),
      });
      setName(''); setExtra('');
      onChanged?.();
    } catch (e) {
      onShowToast?.(e?.data?.detail || "Ajout impossible", 'error');
    } finally {
      setBusy(false);
    }
  }, [name, extra, busy, clientId, kind, societe, onChanged, onShowToast]);

  const remove = useCallback(async (id) => {
    try {
      await apiClient.delete(`/api/v1/finance-periods/client/${clientId}/entities/${id}`);
      onChanged?.();
    } catch (e) {
      onShowToast?.(e?.data?.detail || 'Retrait impossible', 'error');
    }
  }, [clientId, onChanged, onShowToast]);

  if (!items.length && !editing) return null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'flex-end' }}>
      {items.map((it) => (
        <span key={it.id} style={{
          display: 'inline-flex', alignItems: 'center', gap: 6,
          background: N.sideBg, borderRadius: 5, padding: '2px 6px 2px 8px',
          fontSize: 12.5, color: N.text,
        }}>
          {it.name}
          {(it.siren || it.role) && (
            <span style={{ color: N.textFaint }}>· {it.siren || it.role}</span>
          )}
          {editing && (
            <button
              type="button"
              onClick={() => remove(it.id)}
              title="Retirer"
              style={{
                border: 'none', background: 'transparent', cursor: 'pointer',
                color: N.textFaint, display: 'inline-flex', padding: 0,
              }}
            >
              <X size={12} />
            </button>
          )}
        </span>
      ))}
      {editing && (
        <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') add(); }}
            placeholder={societe ? 'Autre société' : 'Nom de l’associé'}
            style={{
              border: `1px solid ${N.border}`, borderRadius: 5,
              padding: '3px 7px', fontSize: 12.5, width: 140,
              fontFamily: 'inherit', outline: 'none',
            }}
          />
          <input
            value={extra}
            onChange={(e) => setExtra(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') add(); }}
            placeholder={societe ? 'SIREN' : 'Rôle'}
            style={{
              border: `1px solid ${N.border}`, borderRadius: 5,
              padding: '3px 7px', fontSize: 12.5, width: 90,
              fontFamily: 'inherit', outline: 'none',
            }}
          />
          <button
            type="button"
            onClick={add}
            disabled={busy || name.trim().length < 2}
            style={{
              border: 'none', borderRadius: 5, padding: '3px 9px',
              fontSize: 12.5, fontWeight: 600,
              cursor: name.trim().length < 2 ? 'default' : 'pointer',
              background: name.trim().length < 2 ? N.sideBg : N.text,
              color: name.trim().length < 2 ? N.textFaint : '#fff',
            }}
          >
            Ajouter
          </button>
        </div>
      )}
    </div>
  );
}

// ── Mois d'effet d'un changement de formule ou de modalité ─────────────────
// Les deux commandent l'attendu : appliqués au mois en cours, ils réécrivent
// la ligne que la finance est peut-être en train de rapprocher ; appliqués au
// mois suivant, l'historique reste intact. Personne ne peut trancher à notre
// place — d'où la question, posée une fois, au moment de la saisie.
// Choix du mois d'effet d'un changement de formule ou de modalité.
//
// Demande dev 2026-08-28 : « si on change la formule au rabais d'un client il
// faut que ça fasse un trop-perçu par rapport à la date, donc qu'elle puisse
// sélectionner le mois où ça avait pris effet. »
//
// Un effet RÉTROACTIF recalcule l'attendu depuis ce mois-là. Les
// encaissements, eux, ne bougent pas : si le client payait l'ancien tarif, la
// différence devient mécaniquement un trop-perçu, mois par mois. C'est le
// résultat voulu, pas un effet de bord.
function EffectiveMonthPrompt({ label, onPick, onCancel, periods = [] }) {
  const [retro, setRetro] = useState('');
  const moisProchain = formatMonthLabel(shiftMonth(currentPeriod(), 1));
  const moisCourant = formatMonthLabel(currentPeriod());
  // Mois réellement facturés au client, du plus récent au plus ancien, et
  // strictement antérieurs au mois courant : on ne propose pas un mois qui
  // n'existe pas sur sa fiche.
  const pastMonths = useMemo(() => {
    const cur = currentPeriod();
    return [...new Set((periods || [])
      .map((p) => String(p.period || '').slice(0, 7))
      .filter((m) => m && m < cur))]
      .sort()
      .reverse();
  }, [periods]);
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.15 }}
      style={{
        position: 'absolute', inset: 0, zIndex: 30,
        background: 'rgba(255,255,255,0.96)',
        display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center', gap: 12,
        padding: 20, textAlign: 'center',
      }}
    >
      <div style={{ fontSize: 13, color: N.text, fontWeight: 600 }}>
        Passer à « {label} » à partir de quand ?
      </div>
      <div style={{ fontSize: 12, color: N.textMuted, maxWidth: 320, lineHeight: 1.5 }}>
        Le montant attendu est recalculé à partir du mois choisi, jusqu’au
        dernier mois de la fiche.
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'center' }}>
        <button
          type="button"
          onClick={() => onPick('current')}
          style={{
            border: 'none', cursor: 'pointer', borderRadius: 6,
            padding: '7px 14px', fontSize: 12.5, fontWeight: 600,
            background: N.text, color: '#fff',
          }}
        >
          Dès {moisCourant}
        </button>
        <button
          type="button"
          onClick={() => onPick('next')}
          style={{
            border: `1px solid ${N.border}`, cursor: 'pointer', borderRadius: 6,
            padding: '7px 14px', fontSize: 12.5, fontWeight: 600,
            background: '#fff', color: N.text,
          }}
        >
          À partir de {moisProchain}
        </button>
        <button
          type="button"
          onClick={onCancel}
          style={{
            border: 'none', cursor: 'pointer', borderRadius: 6,
            padding: '7px 10px', fontSize: 12.5,
            background: 'transparent', color: N.textMuted,
          }}
        >
          Annuler
        </button>
      </div>

      {/* Effet rétroactif — le cas d'une formule revue à la baisse dont on
          s'aperçoit après coup. L'attendu des mois concernés est recalculé ;
          ce que le client a payé en trop devient un trop-perçu. */}
      {pastMonths.length > 0 && (
        <div style={{
          display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 7,
          marginTop: 4, paddingTop: 12, borderTop: `1px solid ${N.borderSft}`,
          width: '100%', maxWidth: 360,
        }}>
          <div style={{ fontSize: 11.5, color: N.textMuted, lineHeight: 1.5 }}>
            Effet rétroactif : l’attendu est recalculé depuis le mois choisi.
            Ce que le client a payé en trop devient un trop-perçu.
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', justifyContent: 'center' }}>
            <select
              value={retro}
              onChange={(e) => setRetro(e.target.value)}
              style={{
                border: `1px solid ${N.border}`, borderRadius: 6,
                padding: '6px 8px', fontSize: 12.5, fontFamily: 'inherit',
                background: '#fff', color: N.text, outline: 'none',
              }}
            >
              <option value="">Choisir un mois passé…</option>
              {pastMonths.map((m) => (
                <option key={m} value={m}>{formatMonthLabel(m)}</option>
              ))}
            </select>
            <button
              type="button"
              disabled={!retro}
              onClick={() => onPick(retro)}
              style={{
                border: 'none', borderRadius: 6, padding: '7px 12px',
                fontSize: 12.5, fontWeight: 600, fontFamily: 'inherit',
                cursor: retro ? 'pointer' : 'default',
                background: retro ? '#b45309' : N.sideBg,
                color: retro ? '#fff' : N.textFaint,
              }}
            >
              Appliquer rétroactivement
            </button>
          </div>
        </div>
      )}
    </motion.div>
  );
}

// Bandeau réduit à ce qui n'est écrit nulle part ailleurs (arbitrage dev
// 2026-08-27) : le SIREN, et l'échéance du contrat. L'État était en double
// avec l'en-tête juste au-dessus, l'Effectif avec la Formule des
// informations contractuelles, et la Période est déjà celle du tableau.
function FactsRow({ profile, boardRow, loss = null, promise = false }) {
  const items = [];
  if (profile?.siren) {
    items.push({ icon: <Landmark size={12} />, label: 'SIREN', value: profile.siren });
  }
  // Sortie de contrat posée au board : elle prime sur le renouvellement —
  // un contrat qui s'arrête ne se renouvelle pas. La date vient de l'état
  // daté du board (`etat_date`), seul endroit où la résiliation est datée.
  const exitEtat = TERMINATED_BOARD_ETATS.has(boardRow?.etat_manuel)
    ? boardRow.etat_manuel
    : null;
  const exitDate = exitEtat ? parseDateFR(boardRow?.etat_date) : null;
  if (exitEtat && exitDate) {
    const meta = ETAT_STYLE[exitEtat] || ETAT_FALLBACK;
    const aVenir = exitDate > new Date();
    items.push({
      icon: <FileSignature size={12} />,
      label: exitEtat,
      value: `${aVenir ? 'le' : 'depuis le'} ${formatDateLongFR(boardRow.etat_date)}`,
      pillBg: meta.bg, pillFg: meta.fg,
    });
  } else if (!exitEtat && profile?.contract_end) {
    // Renouvellement annuel à la date anniversaire : le compte à rebours
    // seul, la date exacte en survol ; la couleur ne s'allume qu'à
    // l'approche (90 j orange, 30 j rouge — seuils du board).
    const d = profile.contract_days_left;
    const proche = d != null && d <= 90;
    const urgent = d != null && d <= 30;
    items.push({
      icon: <FileSignature size={12} />,
      label: 'Renouvellement',
      value: d != null ? `J-${d}` : formatDateLongFR(profile.contract_end),
      title: formatDateLongFR(profile.contract_end),
      pillBg: urgent ? N.redBg : (proche ? '#fdecc8' : undefined),
      pillFg: urgent ? N.red : (proche ? '#9f6b00' : undefined),
    });
  }
  // Perte : le client est là, mais il n'attend plus rien. Visible de TOUS —
  // sans elle, un attendu à zéro passerait pour une donnée manquante.
  if (loss) {
    items.push({
      icon: <TriangleAlert size={12} />,
      label: 'Perte',
      value: formatEUR(loss.amount_owner + loss.amount_optilex_ttc),
      title: [
        (loss.future_owner + loss.future_optilex_ttc) > 0
          ? `attendu futur annulé ${formatEUR(loss.future_owner + loss.future_optilex_ttc)}`
          : null,
        loss.declared_by_name ? `déclarée par ${loss.declared_by_name}` : null,
        loss.reason || null,
      ].filter(Boolean).join(' · '),
      pillBg: N.redBg, pillFg: N.red,
    });
  }
  // Promesse de règlement posée : le client s'est engagé à payer.
  if (promise) {
    items.push({
      icon: <Handshake size={12} />,
      label: 'Promesse',
      value: 'de règlement',
      pillBg: '#fff3e3', pillFg: '#b45309',
    });
  }
  if (!items.length) return null;

  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center', marginTop: 10 }}>
      {items.map((it, idx) => (
        <div key={idx} title={it.title || undefined} style={{
          display: 'inline-flex', alignItems: 'center', gap: 6,
          padding: '4px 10px',
          borderRadius: 4,
          background: it.pillBg || 'transparent',
          color: it.pillFg || N.textMuted,
          fontSize: 12.5,
          border: it.pillBg ? 'none' : `1px solid ${N.borderSft}`,
          fontWeight: 500,
        }}>
          <span style={{ display: 'inline-flex', color: it.pillFg || N.textFaint }}>
            {it.icon}
          </span>
          <span style={{ color: it.pillFg || N.textMuted }}>{it.label}</span>
          <span style={{
            color: it.pillFg || N.text, fontWeight: 600,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            maxWidth: 180,
          }}>
            {it.value}
          </span>
        </div>
      ))}
    </div>
  );
}

// ── Les actions de la fiche, au même endroit ────────────────────────────────
// Gérer les attendus (direction), noter/retirer une promesse (équipe),
// sortie client (direction). Le bouton de sortie passe en avant quand elle
// est DUE : fin de relation avec des créances antérieures non soldées.
function ActionsBar({
  canManageMoney, canEdit, promise, onTogglePromise, onOpenExpected, exitDue, onOpenExit,
}) {
  const items = [];
  if (canManageMoney) {
    items.push({
      key: 'expected', Icon: SlidersHorizontal, label: 'Gérer les attendus', onClick: onOpenExpected,
      title: 'Modifier, réduire, reporter ou mettre en pause les attendus',
    });
  }
  if (canEdit) {
    items.push({
      key: 'promise', Icon: Handshake,
      label: promise ? 'Retirer la promesse' : 'Noter une promesse',
      onClick: onTogglePromise,
      title: promise ? 'Retirer la promesse de règlement' : 'Le client s’est engagé à régler',
    });
  }
  if (canManageMoney) {
    items.push({
      key: 'exit', Icon: exitDue ? TriangleAlert : LogOut,
      label: exitDue ? 'Sortie client à acter' : 'Sortie client',
      onClick: onOpenExit, warn: exitDue,
      title: exitDue
        ? 'Fin de relation avec des créances antérieures non soldées : à récupérer, ou à passer en perte'
        : 'Acter une résiliation ou une rétractation, ou déclarer une perte',
    });
  }
  if (!items.length) return null;

  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center', marginTop: 12, marginBottom: 28 }}>
      {items.map((it) => (
        <button
          key={it.key}
          type="button"
          onClick={it.onClick}
          title={it.title}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 6,
            height: 30, padding: '0 12px', borderRadius: 7,
            border: `1px solid ${it.warn ? '#f5dcb5' : N.border}`,
            background: it.warn ? '#fff8ed' : '#fff',
            color: it.warn ? '#b45309' : N.text,
            fontSize: 12.5, fontWeight: it.warn ? 700 : 600,
            fontFamily: 'inherit', cursor: 'pointer',
            boxShadow: '0 1px 2px rgba(15,15,15,0.04)',
            transition: 'background 0.12s, color 0.14s, border-color 0.14s',
          }}
          onMouseEnter={(e) => { e.currentTarget.style.background = it.warn ? '#fdefd6' : N.sideBg; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = it.warn ? '#fff8ed' : '#fff'; }}
        >
          <it.Icon size={13} strokeWidth={2} style={{ color: it.warn ? '#b45309' : N.textMuted }} />
          {it.label}
        </button>
      ))}
    </div>
  );
}

// ── Section wrapper ─────────────────────────────────────────────────────────
// `action` (optionnel, phase 4) : nœud rendu à droite du titre — ex. le
// bouton de téléchargement de l'état de compte. Rétro-compatible.
function Section({ title, children, delay = 0, action = null }) {
  return (
    <motion.section
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, delay, ease: [0.4, 0, 0.2, 1] }}
      style={{ marginTop: 28 }}
    >
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        gap: 10, margin: '0 0 12px',
      }}>
        <h2 style={{
          fontSize: 11, fontWeight: 600, color: N.textMuted,
          margin: 0,
          textTransform: 'uppercase', letterSpacing: '0.04em',
        }}>
          {title}
        </h2>
        {action}
      </div>
      {children}
    </motion.section>
  );
}














function formatAuditDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('fr-FR', {
    day: '2-digit', month: '2-digit',
    hour: '2-digit', minute: '2-digit',
  });
}

// ── Section : Commentaires (fil interne Owner) ──────────────────────────────
// Remplace la timeline mensuelle (2026-08-25). Porte le contexte humain du
// recouvrement — « promesse de règlement au 15 », « en attente retour
// cabinet » — que ni l'échéancier ni l'audit ne capturent.
//
// Endpoints (backend en cours de déploiement → code défensif) :
//   GET    /finance-periods/client/{id}/comments        (trié serveur)
//   POST   /finance-periods/client/{id}/comments        {body}
//   PATCH  /finance-periods/client/{id}/comments/{cid}  {pinned}
//   DELETE /finance-periods/client/{id}/comments/{cid}
//
// Toutes les mutations sont optimistes + rollback + toast, comme le reste de
// la page. Les actions (épingler / supprimer) ne s'affichent que si le
// backend a calculé `can_moderate` sur l'entrée.
//
// Fil INTERNE Owner : aucun lien vers le fil du board (le cabinet Opti'Lex
// ne doit pas le voir).

// Tri local appliqué après chaque mutation optimiste — même ordre que le
// serveur : épinglés d'abord, puis du plus récent au plus ancien.
const sortComments = (list) => [...list].sort((a, b) => {
  if (!!b.pinned !== !!a.pinned) return b.pinned ? 1 : -1;
  return String(b.created_at || '').localeCompare(String(a.created_at || ''));
});

function ClientComments({ clientId, onShowToast }) {
  const [comments, setComments] = useState(null);   // null = en cours / indispo
  // Au-delà de quatre commentaires le fil noyait le reste de la fiche : on
  // n'affiche que les plus récents, le reste se déplie (demande dev
  // 2026-08-28). Les épinglés remontent déjà en tête côté backend, ils
  // restent donc visibles.
  const [allCommentsShown, setAllCommentsShown] = useState(false);
  // Un seul commentaire visible, le plus récent, et les autres se déplient —
  // exactement comme l'historique des actions (demande dev 2026-08-28). On
  // voit d'un coup d'œil la dernière action ET le dernier commentaire, qui
  // sont les deux choses qu'on vient chercher sur une fiche.
  //
  // Un commentaire épinglé prime : le backend le remonte en tête, et c'est
  // volontairement lui qu'on garde à l'écran s'il existe.
  const COMMENTS_PREVIEW = 1;
  const visibleComments = (comments && !allCommentsShown)
    ? comments.slice(0, COMMENTS_PREVIEW)
    : (comments || []);
  const [available, setAvailable] = useState(true); // false = endpoint absent
  const [draft, setDraft] = useState('');
  const [posting, setPosting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(null); // id en attente
  const taRef = useRef(null);

  const base = clientId ? `/api/v1/finance-periods/client/${clientId}/comments` : null;

  useEffect(() => {
    if (!clientId) return undefined;
    let cancelled = false;
    setComments(null);
    setAvailable(true);
    setDraft('');
    setConfirmDelete(null);
    apiClient.get(base)
      .then((data) => {
        if (cancelled) return;
        const list = Array.isArray(data?.comments) ? data.comments
          : Array.isArray(data) ? data : [];
        setComments(sortComments(list));
      })
      .catch(() => {
        // Endpoint pas encore déployé / erreur : section masquée, pas de
        // composer inutilisable ni de crash.
        if (!cancelled) { setAvailable(false); setComments([]); }
      });
    return () => { cancelled = true; };
  }, [clientId, base]);

  // Textarea auto-grow (pas de scrollbar interne, la fiche scrolle déjà).
  const autoGrow = useCallback(() => {
    const el = taRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 220)}px`;
  }, []);

  const submit = useCallback(async () => {
    const body = draft.trim();
    if (!body || posting || !base) return;
    setPosting(true);
    // Optimiste : entrée temporaire en tête, remplacée par la réponse.
    const tempId = `temp-${Date.now()}`;
    const optimistic = {
      id: tempId,
      body,
      // Même convention que CommentPopup.jsx : full_name > name > email.
      author_name: (() => {
        const u = apiClient.getUser();
        return u?.full_name || u?.name || u?.email || 'Moi';
      })(),
      pinned: false,
      created_at: new Date().toISOString(),
      can_moderate: true,
      _pending: true,
    };
    setComments((prev) => sortComments([...(prev || []), optimistic]));
    setDraft('');
    if (taRef.current) taRef.current.style.height = 'auto';
    try {
      const created = await apiClient.post(base, { body });
      setComments((prev) => sortComments(
        (prev || []).map((c) => (c.id === tempId ? { ...optimistic, ...created, _pending: false } : c))
      ));
    } catch (e) {
      setComments((prev) => (prev || []).filter((c) => c.id !== tempId));
      setDraft(body); // le texte n'est pas perdu
      onShowToast?.(e?.data?.detail || 'Erreur lors de la publication du commentaire', 'error');
    } finally {
      setPosting(false);
    }
  }, [draft, posting, base, onShowToast]);

  const togglePin = useCallback(async (comment) => {
    if (!base) return;
    const next = !comment.pinned;
    const snapshot = comments;
    setComments((prev) => sortComments(
      (prev || []).map((c) => (c.id === comment.id ? { ...c, pinned: next } : c))
    ));
    try {
      await apiClient.patch(`${base}/${comment.id}`, { pinned: next });
    } catch (e) {
      setComments(snapshot);
      onShowToast?.(e?.data?.detail || "Erreur lors de l'épinglage", 'error');
    }
  }, [base, comments, onShowToast]);

  const remove = useCallback(async (comment) => {
    if (!base) return;
    const snapshot = comments;
    setConfirmDelete(null);
    setComments((prev) => (prev || []).filter((c) => c.id !== comment.id));
    try {
      await apiClient.delete(`${base}/${comment.id}`);
    } catch (e) {
      setComments(snapshot);
      onShowToast?.(e?.data?.detail || 'Erreur lors de la suppression', 'error');
    }
  }, [base, comments, onShowToast]);

  if (!available) return null;

  return (
    <Section title="Commentaires" delay={0.14}>
      {/* Composer */}
      <div style={{
        border: `1px solid ${N.borderSft}`,
        borderRadius: 10,
        padding: '10px 12px',
        marginBottom: comments?.length ? 10 : 0,
      }}>
        <textarea
          ref={taRef}
          value={draft}
          onChange={(e) => { setDraft(e.currentTarget.value); autoGrow(); }}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); submit(); }
          }}
          rows={2}
          placeholder="Ajouter un commentaire… (promesse de règlement, retour cabinet…)"
          style={{
            width: '100%', border: 'none', outline: 'none', resize: 'none',
            background: 'transparent',
            fontSize: 13, lineHeight: 1.5, fontFamily: 'inherit', color: N.text,
            minHeight: 38, maxHeight: 220, boxSizing: 'border-box',
          }}
        />
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          gap: 10, marginTop: 4,
        }}>
          <span style={{ fontSize: 10.5, color: N.textFaint }}>
            ⌘ + Entrée pour publier
          </span>
          <button
            type="button"
            onClick={submit}
            disabled={!draft.trim() || posting}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 5,
              height: 26, padding: '0 12px',
              border: 'none', borderRadius: 6,
              background: draft.trim() ? '#2383e2' : '#e9e9e7',
              color: draft.trim() ? '#fff' : N.textFaint,
              fontSize: 12, fontWeight: 600, fontFamily: 'inherit',
              cursor: draft.trim() && !posting ? 'pointer' : 'default',
              transition: 'background 0.15s, color 0.15s',
            }}
          >
            <MessageSquarePlus size={12} strokeWidth={2} />
            {posting ? 'Envoi…' : 'Commenter'}
          </button>
        </div>
      </div>

      {/* Fil */}
      {comments === null ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {Array.from({ length: 2 }).map((_, i) => (
            <div key={i} style={{
              height: 52, background: '#f3f4f6', borderRadius: 10,
              animation: 'tsfPulse 1.4s ease-in-out infinite', opacity: 1 - i * 0.15,
            }} />
          ))}
        </div>
      ) : comments.length === 0 ? (
        <div style={{
          padding: '10px 12px', fontSize: 12.5, color: N.textFaint,
          fontStyle: 'italic',
        }}>
          Aucun commentaire pour ce client.
        </div>
      ) : (
        // Même parti pris que l'échéancier et l'agenda : rien n'est retiré,
        // mais un fil de vingt commentaires ne pousse pas le reste hors écran.
        <div style={{
          display: 'flex', flexDirection: 'column', gap: 6,
          maxHeight: visibleComments.length > 4 ? 300 : undefined,
          overflowY: visibleComments.length > 4 ? 'auto' : undefined,
          paddingRight: visibleComments.length > 4 ? 4 : undefined,
        }}>
          <AnimatePresence initial={false}>
            {visibleComments.map((c, i) => (
              <CommentRow
                key={c.id}
                comment={c}
                index={i}
                confirming={confirmDelete === c.id}
                onAskDelete={() => setConfirmDelete(c.id)}
                onCancelDelete={() => setConfirmDelete(null)}
                onConfirmDelete={() => remove(c)}
                onTogglePin={() => togglePin(c)}
              />
            ))}
          </AnimatePresence>
          {comments.length > COMMENTS_PREVIEW && (
            <button
              type="button"
              onClick={() => setAllCommentsShown((v) => !v)}
              style={{
                alignSelf: 'flex-start',
                border: 'none', background: 'transparent', cursor: 'pointer',
                padding: '4px 2px', fontFamily: 'inherit',
                fontSize: 12, fontWeight: 600, color: N.textMuted,
              }}
            >
              {allCommentsShown
                ? 'Réduire'
                : (comments.length - COMMENTS_PREVIEW === 1
                  ? 'Voir le commentaire précédent'
                  : `Voir les ${comments.length - COMMENTS_PREVIEW} commentaires précédents`)}
            </button>
          )}
        </div>
      )}
    </Section>
  );
}

const COMMENT_AMBER = '#b45309';

function CommentRow({
  comment, index, confirming,
  onAskDelete, onCancelDelete, onConfirmDelete, onTogglePin,
}) {
  const [hover, setHover] = useState(false);
  const av = avatarMeta(comment.author_name || comment.author_email || '?');
  const edited = comment.updated_at && comment.updated_at !== comment.created_at;
  const showActions = comment.can_moderate && (hover || confirming);

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: comment._pending ? 0.6 : 1, y: 0 }}
      exit={{ opacity: 0, height: 0, marginTop: 0 }}
      transition={{ duration: 0.22, delay: Math.min(index, 6) * 0.025, ease: [0.4, 0, 0.2, 1] }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        position: 'relative',
        display: 'flex', alignItems: 'flex-start', gap: 10,
        padding: '10px 12px',
        border: `1px solid ${N.borderSft}`,
        borderLeft: comment.pinned ? `2px solid ${COMMENT_AMBER}` : `1px solid ${N.borderSft}`,
        borderRadius: 10,
        background: comment.pinned ? '#fffdf8' : '#fff',
        overflow: 'hidden',
        transition: 'background 0.2s ease',
      }}
    >
      {/* Avatar initiales de l'auteur */}
      <span style={{
        width: 26, height: 26, borderRadius: '50%', flexShrink: 0,
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        background: av.bg, color: av.fg,
        fontSize: 10.5, fontWeight: 700, userSelect: 'none',
      }}>
        {av.initials}
      </span>

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 6,
          flexWrap: 'wrap', minWidth: 0,
        }}>
          <span style={{ fontSize: 12.5, fontWeight: 700, color: N.text }}>
            {comment.author_name || comment.author_email || 'Inconnu'}
          </span>
          <span style={{ fontSize: 11, color: N.textFaint, whiteSpace: 'nowrap' }}>
            {formatRelativeFR(comment.created_at)}
          </span>
          {edited && (
            <span style={{ fontSize: 10.5, color: N.textFaint, fontStyle: 'italic' }}>
              modifié
            </span>
          )}
          {comment.pinned && (
            <span style={{
              display: 'inline-flex', alignItems: 'center', gap: 3,
              padding: '1px 7px', borderRadius: 999,
              background: '#fff3e3', color: COMMENT_AMBER,
              fontSize: 10, fontWeight: 700,
              textTransform: 'uppercase', letterSpacing: '0.03em',
            }}>
              <Pin size={9} strokeWidth={2.4} />
              Épinglé
            </span>
          )}
        </div>
        {/* Texte : les retours à la ligne saisis sont préservés */}
        <div style={{
          marginTop: 3,
          fontSize: 13, lineHeight: 1.5, color: N.text,
          whiteSpace: 'pre-wrap', wordBreak: 'break-word',
        }}>
          {comment.body}
        </div>
      </div>

      {/* Actions — réservées à `can_moderate` (direction financière ou
          auteur du message), révélées au survol. Suppression confirmée
          INLINE : un window.confirm bloquerait l'UI. */}
      {showActions && (
        <span style={{
          display: 'inline-flex', alignItems: 'center', gap: 4,
          flexShrink: 0, alignSelf: 'flex-start',
        }}>
          {confirming ? (
            <>
              <span style={{ fontSize: 11, color: N.textMuted, whiteSpace: 'nowrap' }}>
                Supprimer ?
              </span>
              <button
                type="button"
                onClick={onConfirmDelete}
                style={{ ...commentActionStyle, color: '#b42318', fontWeight: 700, width: 'auto', padding: '0 7px' }}
              >
                Oui
              </button>
              <button
                type="button"
                onClick={onCancelDelete}
                style={{ ...commentActionStyle, color: N.textMuted, width: 'auto', padding: '0 7px' }}
              >
                Annuler
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                title={comment.pinned ? 'Désépingler' : 'Épingler en tête'}
                onClick={onTogglePin}
                style={{ ...commentActionStyle, color: comment.pinned ? COMMENT_AMBER : N.textFaint }}
                onMouseEnter={(e) => { e.currentTarget.style.background = N.sideBg; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
              >
                <Pin size={12} strokeWidth={2} />
              </button>
              <button
                type="button"
                title="Supprimer"
                onClick={onAskDelete}
                style={{ ...commentActionStyle, color: N.textFaint }}
                onMouseEnter={(e) => { e.currentTarget.style.background = '#fdecec'; e.currentTarget.style.color = '#b42318'; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = N.textFaint; }}
              >
                <Trash2 size={12} strokeWidth={2} />
              </button>
            </>
          )}
        </span>
      )}
    </motion.div>
  );
}

const commentActionStyle = {
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
  height: 22, width: 22, padding: 0,
  border: 'none', background: 'transparent',
  borderRadius: 5, cursor: 'pointer',
  fontFamily: 'inherit', fontSize: 11,
  transition: 'background 0.12s, color 0.12s',
};

// ── Empty state ─────────────────────────────────────────────────────────────
function Empty({ text = 'Aucune donnée disponible.' }) {
  return (
    <div style={{
      padding: '20px 14px',
      background: N.sideBg,
      borderRadius: 6,
      color: N.textMuted,
      fontSize: 13,
      textAlign: 'center',
    }}>
      {text}
    </div>
  );
}
