// actionLabel.test.js — les phrases de l'historique, verrouillées.
//
// Retour dev 2026-09-03 : « les dernières actions, on ne comprend pas trop ce
// qui se passe ». Chaque test fixe la phrase attendue pour un cas réel de la
// page ; changer une formulation se fait ici, en connaissance de cause.
//
// Lancement : `npm test` (cité dans le script `test` de package.json).

import test from 'node:test';
import assert from 'node:assert/strict';

import { describeAction } from './actionLabel.js';

test('encaissement saisi : montant, entité, mois', () => {
  assert.equal(
    describeAction({ field: 'received_owner', from: '0.00', to: '450.00', period: '2026-08-01' }),
    'a saisi 450,00 € reçus Owner pour août 2026',
  );
});

test('encaissement complété : on lit l’avant et l’après', () => {
  assert.equal(
    describeAction({ field: 'received_optilex_ttc', from: '300', to: '450', period: '2026-08' }),
    "a porté le reçu Opti'lex d'août 2026 de 300,00 € à 450,00 €",
  );
});

test('encaissement corrigé à la baisse : ce n’est pas un encaissement', () => {
  assert.equal(
    describeAction({ field: 'received_owner', from: '450', to: '300', period: '2026-08' }),
    "a ramené le reçu Owner d'août 2026 de 450,00 € à 300,00 €",
  );
});

test('créance antérieure récupérée', () => {
  assert.equal(
    describeAction({ field: 'received_overdue_owner', from: null, to: '200', period: '2026-08' }),
    'a saisi 200,00 € récupérés sur les créances antérieures Owner pour août 2026',
  );
});

test('attendu fixé à la main : la valeur précédente reste visible', () => {
  assert.equal(
    describeAction({ field: 'expected_owner', from: '450.00', to: '300.00', period: '2026-09' }),
    "a fixé l'attendu Owner de septembre 2026 à 300,00 € (au lieu de 450,00 €)",
  );
});

test('date de paiement posée, puis retirée', () => {
  assert.equal(
    describeAction({ field: 'payment_date_owner', from: null, to: '2026-08-12', period: '2026-08' }),
    "a daté le paiement Owner d'août 2026 au 12/08/2026",
  );
  assert.equal(
    describeAction({ field: 'payment_date_owner', from: '2026-08-12', to: 'None', period: '2026-08' }),
    "a retiré la date de paiement Owner d'août 2026",
  );
});

test('PSP coché', () => {
  assert.equal(
    describeAction({ field: 'psp_optilex', from: null, to: 'Quonto', period: '2026-08' }),
    "a coché Quonto comme PSP Opti'lex d'août 2026",
  );
});

test('état détail', () => {
  assert.equal(
    describeAction({ field: 'finance_status_detail', from: 'Non traité', to: 'Promesse de règlement', period: '2026-08' }),
    "a passé l'état détail à « Promesse de règlement » pour août 2026",
  );
});

test('état du board, avec sa date d’effet', () => {
  assert.equal(
    describeAction({ field: 'etat', from: null, to: 'Résiliation', effectiveOn: '2026-09-30' }),
    "a posé l'état Résiliation, effet le 30/09/2026",
  );
  assert.equal(
    describeAction({ field: 'etat', from: 'Pause', to: null }),
    "a retiré l'état posé (retour à l'état automatique)",
  );
});

test('perte, promesse, responsable', () => {
  assert.equal(describeAction({ field: 'loss', from: '', to: 'Perte déclarée' }), 'a déclaré le client en perte');
  assert.equal(describeAction({ field: 'loss', from: 'Perte déclarée', to: '' }), "a annulé la perte et restauré l'attendu");
  assert.equal(describeAction({ field: 'payment_promise', from: null, to: 'Oui' }), 'a noté une promesse de règlement');
  assert.equal(
    describeAction({ field: 'payment_promise', from: 'Oui', to: 'levée automatiquement' }),
    'a levé la promesse de règlement (levée automatiquement)',
  );
  assert.equal(describeAction({ field: 'responsible', from: null, to: 'Ismahane' }), 'a désigné Ismahane comme responsable');
  assert.equal(describeAction({ field: 'responsible', from: 'Ismahane', to: null }), 'a retiré le responsable (Ismahane)');
});

test('champ de la fiche : libellé connu, vide dit « vide »', () => {
  assert.equal(
    describeAction({ field: 'employee_range', from: '1-2', to: '6-10' }),
    'a modifié Tranche salariés : 1-2 → 6-10',
  );
  assert.equal(
    describeAction({ field: 'siren', from: null, to: '941876021' }),
    'a renseigné SIREN : 941876021',
  );
  assert.equal(
    describeAction({ field: 'contact_email', from: 'a@b.fr', to: '' }),
    'a retiré Email (était a@b.fr)',
  );
});

test('champ inconnu : on garde le nom brut plutôt que de se taire', () => {
  assert.equal(
    describeAction({ field: 'champ_mystere', from: '1', to: '2' }),
    'a modifié champ_mystere : 1 → 2',
  );
});
