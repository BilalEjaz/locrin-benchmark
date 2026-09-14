// actionLabel.js — dire une action de l'historique en une phrase.
//
// Retour dev 2026-09-03 : « les dernières actions, on ne comprend pas trop ce
// qui se passe, ce n'est pas bien expliqué quelle était vraiment la dernière
// action ». Un « Reçu Owner : 0,00 remplacé par 450,00 » oblige à reconstruire
// le sens ; « a saisi 450,00 € reçus Owner pour août 2026 » se lit comme on le
// dirait à l'oral.
//
// Ce module ne connaît que des données, pas d'écran : l'appelant met l'auteur
// devant (« Ismahane ») et le moment derrière (« il y a 2 h »). Chaque phrase
// commence par un verbe conjugué à la troisième personne, sans sujet.
//
// Testé dans actionLabel.test.js.

import {
  formatEUR, formatMonthLabel, formatDateFR, toNumber,
  AUDIT_FIELD_LABELS, PROFILE_CHANGE_LABELS,
} from './constants.js';

const ENTITY_LABEL = { owner: 'Owner', optilex: "Opti'lex" };

const ENTITY_OF_FIELD = {
  received_owner:               'owner',
  received_optilex_ttc:         'optilex',
  received_overdue_owner:       'owner',
  received_overdue_optilex_ttc: 'optilex',
  payment_date_owner:           'owner',
  payment_date_optilex:         'optilex',
  psp_owner:                    'owner',
  psp_optilex:                  'optilex',
  expected_owner:               'owner',
  expected_optilex_ttc:         'optilex',
};

// L'audit stocke du texte : un champ vidé arrive en null, '' ou 'None'.
const isBlank = (v) => v === null || v === undefined || v === '' || v === 'None';

// `period` arrive en 'YYYY-MM' ou en date ISO 'YYYY-MM-DD' selon la source.
// Le libellé de mois de la page est capitalisé (« Août 2026 », en tête de
// colonne) ; au milieu d'une phrase, le français l'écrit en minuscule.
const monthOf = (period) => {
  if (!period) return null;
  const label = formatMonthLabel(String(period).slice(0, 7));
  return label.charAt(0).toLowerCase() + label.slice(1);
};
const forMonth = (period) => { const m = monthOf(period); return m ? ` pour ${m}` : ''; };
// « d'août », « d'avril », « d'octobre » — mais « de mars ».
const ofMonth = (period) => {
  const m = monthOf(period);
  if (!m) return '';
  return /^[aeiouyàâéèêëîïôöùûü]/i.test(m) ? ` d'${m}` : ` de ${m}`;
};

/**
 * @param {object} a
 * @param {string} a.field       nom du champ (audit, fiche, ou 'etat')
 * @param {*}      a.from        valeur avant
 * @param {*}      a.to          valeur après
 * @param {string} [a.period]    mois concerné ('YYYY-MM' ou date ISO)
 * @param {string} [a.effectiveOn]  date d'effet (états du board)
 * @returns {string} phrase sans sujet, ex. « a saisi 450,00 € reçus Owner pour août 2026 »
 */
export function describeAction({ field, from, to, period = null, effectiveOn = null }) {
  const entity = ENTITY_LABEL[ENTITY_OF_FIELD[field]];
  const before = toNumber(from);
  const after = toNumber(to);

  switch (field) {
    case 'received_owner':
    case 'received_optilex_ttc': {
      if (after === null) break;
      if (before !== null && before > 0 && after < before) {
        return `a ramené le reçu ${entity}${ofMonth(period)} de ${formatEUR(before)} à ${formatEUR(after)}`;
      }
      if (before !== null && before > 0) {
        return `a porté le reçu ${entity}${ofMonth(period)} de ${formatEUR(before)} à ${formatEUR(after)}`;
      }
      return `a saisi ${formatEUR(after)} reçus ${entity}${forMonth(period)}`;
    }
    case 'received_overdue_owner':
    case 'received_overdue_optilex_ttc': {
      if (after === null) break;
      if (before !== null && before > 0) {
        return `a passé le récupéré sur créances antérieures ${entity}${ofMonth(period)} de ${formatEUR(before)} à ${formatEUR(after)}`;
      }
      return `a saisi ${formatEUR(after)} récupérés sur les créances antérieures ${entity}${forMonth(period)}`;
    }
    case 'expected_owner':
    case 'expected_optilex_ttc': {
      if (after === null) break;
      const was = before !== null ? ` (au lieu de ${formatEUR(before)})` : '';
      return `a fixé l'attendu ${entity}${ofMonth(period)} à ${formatEUR(after)}${was}`;
    }
    case 'payment_date_owner':
    case 'payment_date_optilex':
      if (isBlank(to)) return `a retiré la date de paiement ${entity}${ofMonth(period)}`;
      return `a daté le paiement ${entity}${ofMonth(period)} au ${formatDateFR(to)}`;
    case 'psp_owner':
    case 'psp_optilex':
      if (isBlank(to)) return `a décoché le PSP ${entity}${ofMonth(period)}`;
      return `a coché ${to} comme PSP ${entity}${ofMonth(period)}`;
    case 'finance_status_detail':
      if (isBlank(to)) return `a retiré l'état détail${ofMonth(period)}`;
      return `a passé l'état détail à « ${to} »${forMonth(period)}`;
    case 'etat':
      // Historique des états posés sur le board.
      if (isBlank(to)) return "a retiré l'état posé (retour à l'état automatique)";
      return `a posé l'état ${to}${effectiveOn ? `, effet le ${formatDateFR(effectiveOn)}` : ''}`;
    case 'loss':
      if (isBlank(to)) return "a annulé la perte et restauré l'attendu";
      return 'a déclaré le client en perte';
    case 'payment_promise':
      if (to === 'Oui') return 'a noté une promesse de règlement';
      if (isBlank(to)) return 'a retiré la promesse de règlement';
      return `a levé la promesse de règlement (${to})`;
    case 'responsible':
      if (isBlank(to)) return `a retiré le responsable${isBlank(from) ? '' : ` (${from})`}`;
      return `a désigné ${to} comme responsable`;
    default:
      break;
  }

  // Cas générique : libellé connu (audit, fiche) ou champ brut.
  const label = AUDIT_FIELD_LABELS[field] || PROFILE_CHANGE_LABELS[field] || field;
  if (isBlank(from) && !isBlank(to)) return `a renseigné ${label} : ${to}`;
  if (!isBlank(from) && isBlank(to)) return `a retiré ${label} (était ${from})`;
  return `a modifié ${label} : ${from} → ${to}`;
}
