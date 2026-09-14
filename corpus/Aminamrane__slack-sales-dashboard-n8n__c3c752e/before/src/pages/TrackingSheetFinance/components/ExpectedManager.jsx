// ExpectedManager.jsx — le poste de pilotage des attendus d'un client.
//
// Demande dev 2026-09-03 : « il ne faut pas seulement qu'elle puisse éditer
// l'attendu. Il faut qu'elle puisse le mettre en pause, poser des réductions,
// créer une réduction et l'appliquer à plusieurs clients, reporter un attendu,
// tout ce dont une directrice financière a besoin. »
// Puis 2026-09-04 : « il faut qu'elle puisse changer attendu, reçu, tout ! Et
// revenir en arrière si mauvaise manip, un report… »
//
// Un seul dialogue, cinq onglets sur le même tableau de mois :
//   · MODIFIER   — fixer l'attendu et/ou le reçu d'un mois à la main. La
//                  valeur fait foi : ni la grille ni le classeur ne la
//                  réécrivent (`expected_manual`, audit « l'interne prime »).
//   · RÉDUIRE    — appliquer une réduction du catalogue (un pourcentage nommé,
//                  réutilisable d'un client à l'autre) à des mois choisis. Le
//                  montant réduit est écrit, jamais recalculé à l'affichage.
//   · REPORTER   — décaler ce qui reste dû sur un mois suivant ; sans mois de
//                  destination, le montant est supprimé et part en perte.
//   · PAUSE      — suspendre l'exigibilité de mois : ils restent comptés dans
//                  le contrat, mais ne créent ni retard ni créance tant que la
//                  pause dure. Reprise à date, ou à la main.
//   · HISTORIQUE — chaque geste est une opération avec son avant/après ;
//                  tant que ses mois n'ont pas été retouchés depuis, on peut
//                  l'annuler et l'état d'avant revient au centime.
//
// Chaque geste laisse une trace (audit + fil du client) côté serveur ; ici on
// ne fait que présenter et envoyer. Direction financière seulement.

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  X, Check, Pencil, Percent, CornerDownRight, PauseCircle, Play, Plus, Trash2,
  History, Undo2,
} from 'lucide-react';

import apiClient from '../../../services/apiClient.js';
import { formatEUR, formatMonthLabel, formatDateFR, currentPeriod } from '../constants.js';

const N = {
  text: '#37352f',
  textMuted: '#787774',
  textFaint: '#9b9a97',
  border: '#e3e2e0',
  borderSft: '#ededec',
  sideBg: '#f7f7f5',
  sideHover: '#efeeec',
  red: '#b42318',
  redBg: '#fdecec',
  amber: '#b45309',
  amberBg: '#fff8ed',
  green: '#15794a',
  greenBg: '#e9f9f0',
  blue: '#1e40af',
  blueBg: '#e7f0fb',
  slate: '#5b6472',
  slateBg: '#eef1f6',
};

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

// Un horodatage serveur est un vrai instant : la conversion locale est juste.
const fmtWhen = (iso) => {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  return d.toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
};

const MODES = [
  { key: 'edit',     label: 'Modifier',   Icon: Pencil,          hint: 'Fixer l’attendu ou le reçu d’un mois. La valeur fait foi : ni la grille ni le classeur ne la réécriront.' },
  { key: 'discount', label: 'Réduire',    Icon: Percent,         hint: 'Appliquer une réduction du catalogue à des mois. Réutilisable d’un client à l’autre.' },
  { key: 'defer',    label: 'Reporter',   Icon: CornerDownRight, hint: 'Décaler ce qui reste dû sur un mois suivant. Sans destination, le montant part en perte.' },
  { key: 'pause',    label: 'Pause',      Icon: PauseCircle,     hint: 'Suspendre l’exigibilité : les mois restent comptés, sans retard ni créance tant que la pause dure.' },
  { key: 'history',  label: 'Historique', Icon: History,         hint: 'Chaque geste peut être annulé tant que ses mois n’ont pas été retouchés depuis : l’état d’avant revient au centime.' },
];

const STATUS = {
  paid:     { label: 'Encaissée', bg: N.greenBg, fg: N.green },
  partial:  { label: 'Partielle', bg: '#fff3e3', fg: N.amber },
  late:     { label: 'En retard', bg: N.redBg,   fg: N.red },
  upcoming: { label: 'À venir',   bg: '#faf3dd', fg: '#9f6b00' },
  paused:   { label: 'En pause',  bg: N.slateBg, fg: N.slate },
  none:     { label: '—',         bg: 'transparent', fg: N.textFaint },
};

const ENTITY_FIELDS = {
  owner:   { expected: 'expected_owner',       received: 'received_owner',       overdue: 'received_overdue_owner' },
  optilex: { expected: 'expected_optilex_ttc', received: 'received_optilex_ttc', overdue: 'received_overdue_optilex_ttc' },
};

const btn = (kind = 'solid') => ({
  border: kind === 'ghost' ? 'none' : `1px solid ${N.border}`,
  background: kind === 'primary' ? N.text : kind === 'ghost' ? 'transparent' : '#fff',
  color: kind === 'primary' ? '#fff' : kind === 'ghost' ? N.textMuted : N.text,
  borderRadius: 7,
  padding: kind === 'ghost' ? '7px 9px' : '8px 14px',
  fontSize: 12.5,
  fontWeight: 600,
  fontFamily: 'inherit',
  cursor: 'pointer',
  display: 'inline-flex', alignItems: 'center', gap: 6,
  whiteSpace: 'nowrap',
});

const input = {
  border: `1px solid ${N.border}`, borderRadius: 7, padding: '7px 9px',
  fontSize: 12.5, fontFamily: 'inherit', background: '#fff', color: N.text,
  outline: 'none',
};

export default function ExpectedManager({
  open, onClose, clientId, client, periods, scope, onDone, onShowToast,
}) {
  const [entity, setEntity] = useState(scope === 'optilex' ? 'optilex' : 'owner');
  const [mode, setMode] = useState('edit');
  const [selected, setSelected] = useState(() => new Set());
  const [drafts, setDrafts] = useState({});        // period_id -> attendu saisi (Modifier / Reporter)
  const [recDrafts, setRecDrafts] = useState({});  // period_id -> reçu saisi (Modifier)
  const [deferTo, setDeferTo] = useState('');
  const [pauseUntil, setPauseUntil] = useState('');
  // Ce que le client doit sur les mois en pause : 'later' (à rattraper) ou
  // 'never' (rien dû, part en perte). Ça dépend de la situation de la société.
  const [pauseOwed, setPauseOwed] = useState('later');
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);

  // Catalogue des réductions.
  const [discounts, setDiscounts] = useState(null);
  const [discountId, setDiscountId] = useState('');
  const [creating, setCreating] = useState(false);
  const [newDiscount, setNewDiscount] = useState({ label: '', percent: '', reason: '' });

  // Opérations (historique annulable). `lastOps` : celles qu'on vient de
  // faire, pour offrir un « Annuler » immédiat en cas de mauvaise manip.
  const [ops, setOps] = useState(null);
  const [confirmId, setConfirmId] = useState(null);
  const [reverting, setReverting] = useState(null);
  const [lastOps, setLastOps] = useState([]);

  const base = `/api/v1/finance-periods/client/${clientId}`;

  // Ouverture : repartir propre, sur la vision active.
  useEffect(() => {
    if (!open) return;
    setEntity(scope === 'optilex' ? 'optilex' : 'owner');
    setMode('edit');
    setSelected(new Set());
    setDrafts({});
    setRecDrafts({});
    setDeferTo('');
    setPauseUntil('');
    setPauseOwed('later');
    setReason('');
    setCreating(false);
    setOps(null);
    setConfirmId(null);
    setLastOps([]);
  }, [open, scope]);

  const loadDiscounts = useCallback(() => {
    apiClient.get('/api/v1/finance-periods/client/discounts')
      .then((d) => setDiscounts(Array.isArray(d) ? d : []))
      .catch(() => setDiscounts([]));
  }, []);
  useEffect(() => { if (open && mode === 'discount' && discounts === null) loadDiscounts(); }, [open, mode, discounts, loadDiscounts]);

  const loadOps = useCallback(() => {
    if (!clientId) return;
    apiClient.get(`${base}/operations`)
      .then((d) => setOps(Array.isArray(d?.items) ? d.items : []))
      .catch(() => setOps([]));
  }, [base, clientId]);
  useEffect(() => { if (open && mode === 'history') { setConfirmId(null); loadOps(); } }, [open, mode, loadOps]);

  // ── Les mois, dans l'entité choisie ──────────────────────────────────
  const f = ENTITY_FIELDS[entity];
  const nowKey = currentPeriod();
  const rows = useMemo(() => (periods || [])
    .map((p) => {
      const key = String(p.period).slice(0, 7);
      const attendu = round2(p[f.expected]);
      const recuMois = round2(p[f.received] || 0);
      const recuCreances = round2(p[f.overdue] || 0);
      const recu = round2(recuMois + recuCreances);
      const reste = round2(Math.max(attendu - recu, 0));
      const pauseActive = !!p.expected_pause_active;
      let status = 'none';
      if (attendu > 0 || recu > 0) {
        if (recu >= attendu && recu > 0) status = 'paid';
        else if (recu > 0) status = 'partial';
        else if (pauseActive) status = 'paused';
        else if (key > nowKey) status = 'upcoming';
        else status = 'late';
      } else if (pauseActive) {
        status = 'paused';
      }
      return {
        id: p.id, key, label: formatMonthLabel(key),
        attendu, recu, recuMois, recuCreances, reste, status,
        manual: !!p.expected_manual,
        paused: !!p.expected_paused,
        pauseActive,
        pauseUntil: p.expected_paused_until || null,
        passe: key < nowKey, courant: key === nowKey, futur: key > nowKey,
      };
    })
    .sort((a, b) => a.key.localeCompare(b.key)), [periods, f, nowKey]);

  const byId = useMemo(() => new Map(rows.map((r) => [r.id, r])), [rows]);

  // Quels mois sont sélectionnables selon le geste.
  const selectable = useCallback((r) => {
    switch (mode) {
      case 'discount': return r.status !== 'paid' && r.attendu > 0;
      case 'defer':    return !r.futur && r.reste > 0;
      case 'pause':    return r.status !== 'paid' && r.attendu > 0 && !r.pauseActive;
      default:         return false;
    }
  }, [mode]);

  // Sélection par défaut : ce sur quoi le geste s'applique le plus souvent.
  useEffect(() => {
    if (!open) return;
    const next = new Set();
    if (mode === 'discount') for (const r of rows) if (selectable(r) && !r.passe) next.add(r.id);
    if (mode === 'defer')    for (const r of rows) if (selectable(r) && r.passe) next.add(r.id);
    setSelected(next);
    setDrafts({});
    setRecDrafts({});
    if (mode === 'defer') {
      const prochain = rows.find((r) => r.futur);
      setDeferTo(prochain ? prochain.id : '');
    }
  }, [open, mode, entity]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggle = (id) => setSelected((s) => {
    const next = new Set(s);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  // ── Réduction choisie ────────────────────────────────────────────────
  const discount = useMemo(
    () => (discounts || []).find((d) => d.id === discountId) || null,
    [discounts, discountId],
  );
  const reduced = (r) => (discount ? round2(r.attendu * (1 - discount.percent / 100)) : null);

  const createDiscount = useCallback(async () => {
    const label = newDiscount.label.trim();
    const percent = Number(String(newDiscount.percent).replace(',', '.'));
    if (!label || !(percent > 0 && percent <= 100)) {
      onShowToast?.('Nom et pourcentage (1 à 100) sont nécessaires', 'error');
      return;
    }
    try {
      const d = await apiClient.post('/api/v1/finance-periods/client/discounts', {
        label, percent, reason: newDiscount.reason.trim() || null,
      });
      setDiscounts((list) => [d, ...(list || [])]);
      setDiscountId(d.id);
      setCreating(false);
      setNewDiscount({ label: '', percent: '', reason: '' });
      onShowToast?.(`Réduction « ${d.label} » créée`, 'success');
    } catch (e) {
      onShowToast?.(e?.data?.detail || 'Création impossible', 'error');
    }
  }, [newDiscount, onShowToast]);

  const archiveDiscount = useCallback(async (id) => {
    try {
      await apiClient.delete(`/api/v1/finance-periods/client/discounts/${id}`);
      setDiscounts((list) => (list || []).filter((d) => d.id !== id));
      if (discountId === id) setDiscountId('');
    } catch (e) {
      onShowToast?.(e?.data?.detail || 'Retrait impossible', 'error');
    }
  }, [discountId, onShowToast]);

  // ── Ce que le bouton principal va faire ──────────────────────────────
  const edits = useMemo(() => Object.entries(drafts)
    .map(([id, v]) => ({ row: byId.get(id), value: v }))
    .filter(({ row, value }) => row && value !== '' && round2(value) !== row.attendu),
  [drafts, byId]);
  const recEdits = useMemo(() => Object.entries(recDrafts)
    .map(([id, v]) => ({ row: byId.get(id), value: v }))
    .filter(({ row, value }) => row && value !== '' && round2(value) !== row.recuMois),
  [recDrafts, byId]);
  const picked = useMemo(() => rows.filter((r) => selected.has(r.id)), [rows, selected]);
  const deferTotal = round2(picked.reduce((s, r) => s + round2(drafts[r.id] ?? r.reste), 0));
  const pausedRows = rows.filter((r) => r.pauseActive);
  const editCount = edits.length + recEdits.length;

  const ready = (() => {
    if (mode === 'edit') return editCount > 0;
    if (mode === 'discount') return !!discount && picked.length > 0;
    if (mode === 'defer') return deferTotal > 0;
    if (mode === 'pause') return picked.length > 0;
    return false;
  })();

  const primaryLabel = (() => {
    if (mode === 'edit') return editCount ? `Enregistrer ${editCount} modification${editCount > 1 ? 's' : ''}` : 'Modifier un montant';
    if (mode === 'discount') return discount && picked.length
      ? `Appliquer −${discount.percent} % sur ${picked.length} mois` : 'Choisir une réduction';
    if (mode === 'defer') return deferTotal
      ? (deferTo ? `Reporter ${formatEUR(deferTotal)}` : `Supprimer ${formatEUR(deferTotal)} (perte)`) : 'Choisir des mois';
    if (mode === 'pause') return picked.length
      ? (pauseOwed === 'never' ? `Mettre en pause ${picked.length} mois, rien dû` : `Mettre en pause ${picked.length} mois`)
      : 'Choisir des mois';
    return '';
  })();

  const afterSuccess = (msg, opIds = []) => {
    onShowToast?.(msg, 'success');
    setDrafts({});
    setRecDrafts({});
    setSelected(new Set());
    setReason('');
    setLastOps(opIds.filter(Boolean));
    setOps(null);
    onDone?.();
  };

  const submit = useCallback(async () => {
    if (!ready || saving) return;
    setSaving(true);
    const note = reason.trim() || null;
    try {
      if (mode === 'edit') {
        const ids = [];
        if (edits.length) {
          const r = await apiClient.post(`${base}/expected`, {
            entries: edits.map(({ row, value }) => ({ period: row.key, [entity]: round2(value) })),
            reason: note,
          });
          ids.push(r?.operation_id);
        }
        if (recEdits.length) {
          const r = await apiClient.post(`${base}/received`, {
            entries: recEdits.map(({ row, value }) => ({ period: row.key, [entity]: round2(value) })),
            reason: note,
          });
          ids.push(r?.operation_id);
        }
        const parts = [];
        if (edits.length) parts.push(`${edits.length} attendu${edits.length > 1 ? 's' : ''}`);
        if (recEdits.length) parts.push(`${recEdits.length} reçu${recEdits.length > 1 ? 's' : ''}`);
        afterSuccess(`${parts.join(' et ')} fixé${editCount > 1 ? 's' : ''} à la main`, ids);
      } else if (mode === 'discount') {
        const r = await apiClient.post(`${base}/expected`, {
          entries: picked.map((row) => ({ period: row.key, [entity]: reduced(row) })),
          reason: `Réduction « ${discount.label} » (−${discount.percent} %)${note ? ` — ${note}` : ''}`,
          kind: 'discount',
          discount_label: discount.label,
          discount_percent: discount.percent,
        });
        afterSuccess(`Réduction « ${discount.label} » appliquée sur ${picked.length} mois`, [r?.operation_id]);
      } else if (mode === 'defer') {
        const r = await apiClient.post(`${base}/expected-correction`, {
          entity,
          removals: picked
            .map((row) => ({ period_id: row.id, amount: round2(drafts[row.id] ?? row.reste) }))
            .filter((x) => x.amount > 0),
          defer_to: deferTo || null,
          reason: note,
        });
        afterSuccess(deferTo ? `${formatEUR(r?.retire ?? deferTotal)} reporté` : `${formatEUR(r?.retire ?? deferTotal)} supprimé (perte)`, [r?.operation_id]);
      } else if (mode === 'pause') {
        const r = await apiClient.post(`${base}/expected/pause`, {
          periods: picked.map((row) => row.key), until: pauseUntil || null, reason: note, owed: pauseOwed,
        });
        afterSuccess(`${picked.length} mois en pause${pauseUntil ? ` jusqu'au ${formatDateFR(pauseUntil)}` : ''}${pauseOwed === 'never' ? ' · rien dû, passé en perte' : ' · à rattraper'}`, [r?.operation_id]);
      }
    } catch (e) {
      onShowToast?.(e?.data?.detail || 'Enregistrement impossible', 'error');
    } finally {
      setSaving(false);
    }
  }, [ready, saving, base, reason, mode, edits, recEdits, editCount, entity, picked, discount, deferTo, drafts, deferTotal, pauseUntil, pauseOwed, onShowToast]); // eslint-disable-line react-hooks/exhaustive-deps

  const resume = useCallback(async (keys) => {
    try {
      const r = await apiClient.post(`${base}/expected/resume`, { periods: keys });
      onShowToast?.(`Pause levée sur ${r?.count ?? keys?.length ?? ''} mois`, 'success');
      setLastOps(r?.operation_id ? [r.operation_id] : []);
      setOps(null);
      onDone?.();
    } catch (e) {
      onShowToast?.(e?.data?.detail || 'Reprise impossible', 'error');
    }
  }, [base, onDone, onShowToast]);

  // Annuler une ou plusieurs opérations (les plus récentes d'abord : un
  // « Annuler » après un enregistrement qui a produit deux gestes défait
  // les deux). Le serveur refuse si un mois a bougé depuis.
  const revert = useCallback(async (ids) => {
    const list = (Array.isArray(ids) ? ids : [ids]).filter(Boolean);
    if (!list.length || reverting) return;
    setReverting(list[0]);
    let done = 0;
    try {
      for (const id of list) {
        await apiClient.post(`${base}/operations/${id}/revert`, {});
        done += 1;
      }
      onShowToast?.(done > 1 ? `${done} opérations annulées` : 'Opération annulée : l’état d’avant est rétabli', 'success');
    } catch (e) {
      onShowToast?.(e?.data?.detail || 'Annulation impossible', 'error');
    } finally {
      setReverting(null);
      setConfirmId(null);
      setLastOps((l) => l.filter((id) => !list.slice(0, done).includes(id)));
      loadOps();
      if (done) onDone?.();
    }
  }, [base, reverting, loadOps, onDone, onShowToast]);

  if (!open) return null;

  const entityLabel = entity === 'owner' ? 'Owner' : "Opti'lex";
  const showCheck = mode !== 'edit' && mode !== 'history';
  const gridCols = mode === 'edit'
    ? 'minmax(110px, 1.1fr) 96px 100px 88px 96px 118px 118px'
    : `${showCheck ? '28px ' : ''}minmax(120px, 1.2fr) 110px 100px 100px 110px minmax(120px, 1fr)`;

  return createPortal(
    <AnimatePresence>
      <motion.div
        key="expected-backdrop"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.16 }}
        onClick={onClose}
        style={{
          position: 'fixed', inset: 0, zIndex: 10060,
          background: 'rgba(23,23,26,0.34)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
        }}
      >
        <motion.div
          initial={{ opacity: 0, y: 10, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 6, scale: 0.99 }}
          transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
          onClick={(e) => e.stopPropagation()}
          style={{
            width: 'min(860px, 100%)', maxHeight: '90vh',
            display: 'flex', flexDirection: 'column',
            background: '#fff', borderRadius: 14,
            boxShadow: '0 24px 64px rgba(17,24,39,0.22)',
            fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif",
            overflow: 'hidden',
          }}
        >
          {/* En-tête : quoi, pour qui, quelle entité */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: 12,
            padding: '16px 20px 12px', borderBottom: `1px solid ${N.borderSft}`,
          }}>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ fontSize: 15, fontWeight: 700, color: N.text }}>Attendus</div>
              <div style={{
                fontSize: 12, color: N.textMuted, marginTop: 2,
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}>
                {client?.societe || '—'}{client?.numero_client ? ` · ${client.numero_client}` : ''}
              </div>
            </div>
            {mode !== 'history' && (
              <Segmented
                value={entity}
                onChange={setEntity}
                options={[{ key: 'owner', label: 'Owner' }, { key: 'optilex', label: "Opti'lex" }]}
              />
            )}
            <button type="button" onClick={onClose} style={{ ...btn('ghost'), padding: 4 }}>
              <X size={16} />
            </button>
          </div>

          {/* Les cinq onglets */}
          <div style={{ padding: '12px 20px 0', borderBottom: `1px solid ${N.borderSft}` }}>
            <div style={{ display: 'flex', gap: 4 }}>
              {MODES.map((m) => {
                const active = mode === m.key;
                return (
                  <button
                    key={m.key}
                    type="button"
                    onClick={() => setMode(m.key)}
                    style={{
                      position: 'relative', display: 'inline-flex', alignItems: 'center', gap: 6,
                      padding: '8px 12px 10px', border: 'none', background: 'transparent',
                      cursor: 'pointer', fontFamily: 'inherit', fontSize: 13,
                      fontWeight: active ? 700 : 500, color: active ? N.text : N.textMuted,
                      transition: 'color 0.15s',
                      marginLeft: m.key === 'history' ? 'auto' : 0,
                    }}
                  >
                    <m.Icon size={14} strokeWidth={1.9} style={{ color: active ? N.text : N.textFaint }} />
                    {m.label}
                    {active && (
                      <motion.span
                        layoutId="tsf-expected-mode"
                        transition={{ type: 'spring', stiffness: 520, damping: 40 }}
                        style={{ position: 'absolute', left: 8, right: 8, bottom: -1, height: 2, background: N.text, borderRadius: 2 }}
                      />
                    )}
                  </button>
                );
              })}
            </div>
            <div style={{ fontSize: 11.5, color: N.textMuted, padding: '8px 0 12px', lineHeight: 1.5 }}>
              {MODES.find((m) => m.key === mode)?.hint}
            </div>

            {/* Panneau propre au geste */}
            {mode === 'discount' && (
              <DiscountPicker
                discounts={discounts}
                discountId={discountId}
                onPick={setDiscountId}
                creating={creating}
                onCreating={setCreating}
                draft={newDiscount}
                onDraft={setNewDiscount}
                onCreate={createDiscount}
                onArchive={archiveDiscount}
              />
            )}
            {mode === 'defer' && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', paddingBottom: 12 }}>
                <span style={{ fontSize: 12, color: N.textMuted }}>Reporter vers</span>
                <select value={deferTo} onChange={(e) => setDeferTo(e.target.value)} style={{ ...input, minWidth: 220 }}>
                  <option value="">— ne pas reporter : supprimer (part en perte) —</option>
                  {rows.filter((r) => r.futur).map((r) => (
                    <option key={r.id} value={r.id}>{r.label}</option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => setSelected(new Set(rows.filter((r) => selectable(r) && r.passe).map((r) => r.id)))}
                  style={btn('solid')}
                >
                  Les créances antérieures
                </button>
              </div>
            )}
            {mode === 'pause' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, paddingBottom: 12 }}>
                {/* Ce que le client devra sur la pause : ça dépend de la
                    situation de la société, c'est la direction qui tranche. */}
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {[
                    { key: 'later', label: 'Il réglera ces mois plus tard', hint: 'l’attendu reste et redevient dû à la reprise' },
                    { key: 'never', label: 'Il ne devra rien sur la pause', hint: 'l’attendu de ces mois est retiré et part en perte' },
                  ].map((o) => {
                    const on = pauseOwed === o.key;
                    return (
                      <button
                        key={o.key}
                        type="button"
                        onClick={() => setPauseOwed(o.key)}
                        style={{
                          flex: '1 1 240px', textAlign: 'left', cursor: 'pointer', fontFamily: 'inherit',
                          padding: '9px 12px', borderRadius: 9,
                          border: `1px solid ${on ? (o.key === 'never' ? N.red : N.text) : N.borderSft}`,
                          background: on ? (o.key === 'never' ? '#fffafa' : N.sideBg) : '#fff',
                          transition: 'background 0.12s, border-color 0.12s',
                        }}
                      >
                        <span style={{ display: 'block', fontSize: 12.5, fontWeight: 700, color: on && o.key === 'never' ? N.red : N.text }}>
                          {o.label}
                        </span>
                        <span style={{ display: 'block', fontSize: 11, color: N.textMuted, marginTop: 2 }}>{o.hint}</span>
                      </button>
                    );
                  })}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 12, color: N.textMuted }}>Reprise le</span>
                  <input type="date" value={pauseUntil} onChange={(e) => setPauseUntil(e.target.value)} style={{ ...input, width: 150 }} />
                  <span style={{ fontSize: 11.5, color: N.textFaint }}>
                    Sans date, la pause dure jusqu’à ce que vous la leviez.
                  </span>
                  <button
                    type="button"
                    onClick={() => setSelected(new Set(rows.filter((r) => selectable(r) && !r.passe).map((r) => r.id)))}
                    style={{ ...btn('solid'), marginLeft: 'auto' }}
                  >
                    Ce mois et les suivants
                  </button>
                </div>
                {pausedRows.length > 0 && (
                  <div style={{
                    display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
                    padding: '8px 11px', borderRadius: 9, background: N.slateBg, color: N.slate, fontSize: 12,
                  }}>
                    <PauseCircle size={14} />
                    <span style={{ flex: '1 1 200px' }}>
                      <strong>{pausedRows.length} mois en pause</strong>
                      {' '}({pausedRows.map((r) => r.label).slice(0, 4).join(', ')}{pausedRows.length > 4 ? '…' : ''})
                    </span>
                    <button type="button" onClick={() => resume(null)} style={btn('solid')}>
                      <Play size={12} /> Tout reprendre
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Le corps : le tableau des mois, ou l'historique des opérations */}
          <div style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
            {mode === 'history' ? (
              <OperationsList
                ops={ops}
                confirmId={confirmId}
                onConfirm={setConfirmId}
                reverting={reverting}
                onRevert={(id) => revert([id])}
              />
            ) : (
              <>
                <div style={{
                  display: 'grid', gridTemplateColumns: gridCols, gap: 10,
                  padding: '8px 20px', background: N.sideBg, position: 'sticky', top: 0, zIndex: 1,
                  fontSize: 10.5, fontWeight: 600, color: N.textMuted, textTransform: 'uppercase', letterSpacing: '0.04em',
                }}>
                  {showCheck && <span />}
                  <span>Mois</span>
                  <span style={{ textAlign: 'right' }}>Attendu {entityLabel}</span>
                  <span style={{ textAlign: 'right' }}>Reçu</span>
                  <span style={{ textAlign: 'right' }}>Reste dû</span>
                  <span>Statut</span>
                  {mode === 'edit' ? (
                    <>
                      <span style={{ textAlign: 'right' }}>Nouvel attendu</span>
                      <span style={{ textAlign: 'right' }}>Nouveau reçu</span>
                    </>
                  ) : (
                    <span style={{ textAlign: 'right' }}>
                      {mode === 'discount' ? 'Après réduction' : mode === 'defer' ? 'Montant reporté' : 'Pause'}
                    </span>
                  )}
                </div>

                {rows.length === 0 && (
                  <div style={{ padding: 30, textAlign: 'center', color: N.textMuted, fontSize: 13 }}>Aucun mois sur ce client.</div>
                )}

                {rows.map((r) => {
                  const st = STATUS[r.status];
                  const canPick = selectable(r);
                  const isPicked = selected.has(r.id);
                  const dim = r.attendu === 0 && r.recu === 0 && !r.pauseActive;
                  return (
                    <div
                      key={r.id}
                      onClick={showCheck && canPick ? () => toggle(r.id) : undefined}
                      style={{
                        display: 'grid', gridTemplateColumns: gridCols, gap: 10, alignItems: 'center',
                        padding: '8px 20px', fontSize: 12.5,
                        borderTop: `1px solid ${N.borderSft}`,
                        background: isPicked ? '#f4f7fb' : 'transparent',
                        opacity: dim && mode !== 'edit' ? 0.5 : 1,
                        cursor: showCheck && canPick ? 'pointer' : 'default',
                        transition: 'background 0.12s',
                      }}
                    >
                      {showCheck && (
                        <input
                          type="checkbox"
                          checked={isPicked}
                          disabled={!canPick}
                          onChange={() => toggle(r.id)}
                          onClick={(e) => e.stopPropagation()}
                          style={{ accentColor: N.text, cursor: canPick ? 'pointer' : 'default' }}
                        />
                      )}
                      <span style={{ minWidth: 0 }}>
                        <span style={{ fontWeight: r.courant ? 700 : 500, color: N.text }}>{r.label}</span>
                        {r.manual && (
                          <span title="Montant fixé à la main : la grille ne le réécrit plus" style={{
                            marginLeft: 6, fontSize: 10, fontWeight: 700, color: N.blue, background: N.blueBg,
                            borderRadius: 3, padding: '1px 5px', verticalAlign: 'middle',
                          }}>
                            manuel
                          </span>
                        )}
                      </span>
                      <span style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: N.text, fontWeight: 600 }}>
                        {formatEUR(r.attendu)}
                      </span>
                      <span style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: N.textMuted }}>
                        {formatEUR(r.recu)}
                        {r.recuCreances > 0 && (
                          <span
                            title="Récupéré sur des créances antérieures, en plus du reçu du mois"
                            style={{ display: 'block', fontSize: 10.5, color: N.textFaint, whiteSpace: 'nowrap' }}
                          >
                            dont {formatEUR(r.recuCreances)} sur créances
                          </span>
                        )}
                      </span>
                      <span style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: r.reste > 0 ? N.red : N.textFaint }}>
                        {formatEUR(r.reste)}
                      </span>
                      <span>
                        <span style={{
                          display: 'inline-block', padding: '2px 8px', borderRadius: 999,
                          background: st.bg, color: st.fg, fontSize: 11, fontWeight: 700, whiteSpace: 'nowrap',
                        }}>
                          {st.label}
                        </span>
                        {r.pauseActive && r.pauseUntil && (
                          <span style={{ display: 'block', fontSize: 10.5, color: N.textFaint, marginTop: 2 }}>
                            reprise le {formatDateFR(r.pauseUntil)}
                          </span>
                        )}
                      </span>
                      {mode === 'edit' ? (
                        <>
                          <span style={{ textAlign: 'right' }}>
                            <AmountInput
                              value={drafts[r.id] ?? ''}
                              placeholder={formatEUR(r.attendu, { withSymbol: false })}
                              onChange={(v) => setDrafts((d) => ({ ...d, [r.id]: v }))}
                            />
                          </span>
                          <span style={{ textAlign: 'right' }}>
                            <AmountInput
                              value={recDrafts[r.id] ?? ''}
                              placeholder={formatEUR(r.recuMois, { withSymbol: false })}
                              onChange={(v) => setRecDrafts((d) => ({ ...d, [r.id]: v }))}
                            />
                          </span>
                        </>
                      ) : (
                        <span style={{ textAlign: 'right' }} onClick={(e) => e.stopPropagation()}>
                          {mode === 'discount' && isPicked && discount && (
                            <span style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 700, color: N.green }}>
                              {formatEUR(reduced(r))}
                            </span>
                          )}
                          {mode === 'defer' && isPicked && (
                            <AmountInput
                              value={drafts[r.id] ?? r.reste}
                              max={r.reste}
                              onChange={(v) => setDrafts((d) => ({ ...d, [r.id]: v }))}
                            />
                          )}
                          {mode === 'pause' && r.pauseActive && (
                            <button type="button" onClick={() => resume([r.key])} style={{ ...btn('solid'), padding: '4px 9px', fontSize: 11.5 }}>
                              <Play size={11} /> Reprendre
                            </button>
                          )}
                        </span>
                      )}
                    </div>
                  );
                })}
              </>
            )}
          </div>

          {/* Pied : motif + action — ou, après un geste, l'annulation immédiate */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
            padding: '12px 20px', borderTop: `1px solid ${N.borderSft}`, background: '#fff',
          }}>
            {lastOps.length > 0 && (
              <span style={{
                display: 'inline-flex', alignItems: 'center', gap: 8,
                padding: '6px 10px', borderRadius: 8, background: N.greenBg, color: N.green,
                fontSize: 12, fontWeight: 600,
              }}>
                <Check size={13} /> Enregistré
                <button
                  type="button"
                  onClick={() => revert(lastOps)}
                  disabled={!!reverting}
                  title="Remettre l’état d’avant, au centime"
                  style={{
                    ...btn('ghost'), padding: '2px 6px', color: N.text, fontSize: 12,
                    textDecoration: 'underline', textUnderlineOffset: 2,
                  }}
                >
                  <Undo2 size={12} /> {reverting ? 'Annulation…' : 'Annuler'}
                </button>
              </span>
            )}
            {mode !== 'history' && (
              <input
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Motif (visible dans l’historique et le fil du client)"
                style={{ ...input, flex: '1 1 220px' }}
              />
            )}
            <button type="button" onClick={onClose} style={{ ...btn('ghost'), marginLeft: mode === 'history' ? 'auto' : 0 }}>Fermer</button>
            {mode !== 'history' && (
              <button
                type="button"
                onClick={submit}
                disabled={!ready || saving}
                style={{
                  ...btn('primary'),
                  background: ready ? ((mode === 'defer' && !deferTo) || (mode === 'pause' && pauseOwed === 'never') ? N.red : N.text) : N.sideBg,
                  color: ready ? '#fff' : N.textFaint,
                  border: 'none',
                  cursor: ready && !saving ? 'pointer' : 'default',
                }}
              >
                <Check size={13} />
                {saving ? 'Enregistrement…' : primaryLabel}
              </button>
            )}
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>,
    document.body,
  );
}

// ── Pièces ──────────────────────────────────────────────────────────────────

// L'historique des gestes, du plus récent au plus ancien. Annuler se fait en
// deux temps sur la ligne (pas de boîte de dialogue du navigateur) : la
// directrice voit ce qu'elle annule, et confirme au même endroit.
function OperationsList({ ops, confirmId, onConfirm, reverting, onRevert }) {
  if (ops === null) {
    return <div style={{ padding: 30, textAlign: 'center', color: N.textMuted, fontSize: 13 }}>Chargement…</div>;
  }
  if (ops.length === 0) {
    return <div style={{ padding: 30, textAlign: 'center', color: N.textMuted, fontSize: 13 }}>Aucune opération sur ce client.</div>;
  }
  return (
    <div style={{ padding: '2px 20px 10px' }}>
      {ops.map((o, i) => {
        const done = !!o.reverted_at;
        const asking = confirmId === o.id;
        const busy = reverting === o.id;
        return (
          <div
            key={o.id}
            style={{
              display: 'flex', alignItems: 'flex-start', gap: 14,
              padding: '11px 0', borderTop: i === 0 ? 'none' : `1px solid ${N.borderSft}`,
            }}
          >
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{
                fontSize: 12.5, lineHeight: 1.45,
                color: done ? N.textFaint : N.text,
                textDecoration: done ? 'line-through' : 'none',
              }}>
                <strong>{o.author_name || 'Quelqu’un'}</strong> {o.label}.
              </div>
              {o.reason && (
                <div style={{ fontSize: 11.5, color: N.textMuted, fontStyle: 'italic', marginTop: 2 }}>
                  « {o.reason} »
                </div>
              )}
              <div style={{ fontSize: 11, color: N.textFaint, marginTop: 3 }}>
                {fmtWhen(o.created_at)}
                {done && ` · annulée le ${fmtWhen(o.reverted_at)}${o.reverted_by ? ` par ${o.reverted_by}` : ''}`}
                {!done && !o.revertible && o.blocked_reason && ` · ${o.blocked_reason} : à corriger à la main`}
              </div>
            </div>
            <div style={{ flexShrink: 0, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              {done ? (
                <Tag>Annulée</Tag>
              ) : !o.revertible ? (
                <Tag title={o.blocked_reason || ''}>Non annulable</Tag>
              ) : asking ? (
                <>
                  <button
                    type="button"
                    onClick={() => onRevert(o.id)}
                    disabled={busy}
                    style={{ ...btn('primary'), background: N.red, border: 'none', padding: '6px 11px', fontSize: 12 }}
                  >
                    <Undo2 size={12} /> {busy ? 'Annulation…' : 'Confirmer l’annulation'}
                  </button>
                  <button type="button" onClick={() => onConfirm(null)} disabled={busy} style={{ ...btn('ghost'), padding: '6px 8px', fontSize: 12 }}>
                    Garder
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  onClick={() => onConfirm(o.id)}
                  title="Remettre l’état d’avant, au centime"
                  style={{ ...btn('solid'), padding: '6px 11px', fontSize: 12 }}
                >
                  <Undo2 size={12} /> Annuler
                </button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function Tag({ children, title }) {
  return (
    <span title={title} style={{
      display: 'inline-block', padding: '3px 8px', borderRadius: 999,
      background: N.sideBg, color: N.textMuted, fontSize: 11, fontWeight: 700, whiteSpace: 'nowrap',
    }}>
      {children}
    </span>
  );
}

function Segmented({ value, onChange, options }) {
  return (
    <div style={{
      display: 'inline-flex', alignItems: 'center', background: '#f1f1ef',
      border: `1px solid ${N.border}`, borderRadius: 8, padding: 2, gap: 2,
    }}>
      {options.map((o) => {
        const active = value === o.key;
        return (
          <button
            key={o.key}
            type="button"
            onClick={() => onChange(o.key)}
            style={{
              position: 'relative', height: 24, padding: '0 12px', border: 'none', borderRadius: 6,
              background: 'transparent', cursor: 'pointer', fontFamily: 'inherit', fontSize: 12.5,
              fontWeight: active ? 600 : 500, color: active ? N.text : N.textMuted, whiteSpace: 'nowrap',
            }}
          >
            {active && (
              <motion.span
                layoutId="tsf-expected-entity"
                transition={{ type: 'spring', stiffness: 520, damping: 40 }}
                style={{
                  position: 'absolute', inset: 0, background: '#fff', borderRadius: 6,
                  boxShadow: '0 1px 3px rgba(15,15,15,0.12), 0 0 0 1px rgba(15,15,15,0.04)',
                }}
              />
            )}
            <span style={{ position: 'relative', zIndex: 1 }}>{o.label}</span>
          </button>
        );
      })}
    </div>
  );
}

function AmountInput({ value, onChange, max, placeholder }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
      <input
        type="number"
        min={0}
        max={max}
        step="0.01"
        value={value}
        placeholder={placeholder}
        onChange={(e) => {
          const raw = e.target.value;
          if (raw === '') { onChange(''); return; }
          let v = Number(raw);
          if (!Number.isFinite(v)) return;
          if (v < 0) v = 0;
          if (max !== undefined && v > max) v = max;
          onChange(v);
        }}
        style={{
          ...input, width: 96, padding: '5px 8px', textAlign: 'right',
          fontWeight: 600, fontVariantNumeric: 'tabular-nums',
        }}
      />
      <span style={{ color: N.textFaint, fontSize: 12 }}>€</span>
    </span>
  );
}

function DiscountPicker({
  discounts, discountId, onPick, creating, onCreating, draft, onDraft, onCreate, onArchive,
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, paddingBottom: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 12, color: N.textMuted }}>Réduction</span>
        <select
          value={discountId}
          onChange={(e) => onPick(e.target.value)}
          style={{ ...input, minWidth: 260 }}
          disabled={discounts === null}
        >
          <option value="">{discounts === null ? 'Chargement…' : discounts.length ? 'Choisir dans le catalogue…' : 'Aucune réduction : créez-en une'}</option>
          {(discounts || []).map((d) => (
            <option key={d.id} value={d.id}>{d.label} · −{d.percent} %</option>
          ))}
        </select>
        {discountId && (
          <button
            type="button"
            title="Retirer du catalogue (les montants déjà appliqués restent)"
            onClick={() => onArchive(discountId)}
            style={{ ...btn('ghost'), color: N.textFaint }}
          >
            <Trash2 size={13} />
          </button>
        )}
        <button type="button" onClick={() => onCreating(!creating)} style={{ ...btn('solid'), marginLeft: 'auto' }}>
          <Plus size={13} /> Nouvelle réduction
        </button>
      </div>
      <AnimatePresence initial={false}>
        {creating && (
          <motion.div
            key="new-discount"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.2, ease: [0.4, 0, 0.2, 1] }}
            style={{ overflow: 'hidden' }}
          >
            <div style={{
              display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
              padding: '10px 12px', borderRadius: 9, background: N.sideBg,
            }}>
              <input
                value={draft.label}
                onChange={(e) => onDraft({ ...draft, label: e.target.value })}
                placeholder="Nom (ex. Fidélité, Multi-structures…)"
                style={{ ...input, flex: '1 1 180px' }}
              />
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                <input
                  type="number" min={1} max={100} step="0.5"
                  value={draft.percent}
                  onChange={(e) => onDraft({ ...draft, percent: e.target.value })}
                  placeholder="10"
                  style={{ ...input, width: 74, textAlign: 'right' }}
                />
                <span style={{ fontSize: 12, color: N.textMuted }}>%</span>
              </span>
              <input
                value={draft.reason}
                onChange={(e) => onDraft({ ...draft, reason: e.target.value })}
                placeholder="Pourquoi (optionnel)"
                style={{ ...input, flex: '1 1 160px' }}
              />
              <button type="button" onClick={onCreate} style={btn('primary')}>
                <Check size={13} /> Créer
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      <div style={{ fontSize: 11, color: N.textFaint, lineHeight: 1.5 }}>
        La réduction écrit le montant réduit dans l’attendu des mois cochés (visible
        dans l’historique avec son nom). Elle ne recalcule rien après coup : un état de
        compte reste opposable.
      </div>
    </div>
  );
}
