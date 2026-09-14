// SignedContracts.jsx — les deux contrats du client, signés sur Yousign.
//
// Demande dev 2026-09-08 : « voir proprement dans la fiche Finance le contrat
// envoyé par le sales, celui qui a été signé sur Yousign ; les deux (Owner et
// Opti'lex) accessibles, cliquables, consultables dans une pop-up ».
//
// Toujours deux lignes, pour que l'absence se voie : un client d'avant le flux
// contrats n'a pas de document dans le CRM, et la fiche le dit plutôt que de
// cacher la section.

import React, { useCallback, useEffect, useState } from 'react';
import { FileSignature, Eye } from 'lucide-react';

import apiClient from '../../../services/apiClient.js';
import { formatDateFR } from '../constants.js';
import DocumentViewer from './DocumentViewer.jsx';

const N = {
  text: '#37352f', textMuted: '#787774', textFaint: '#9b9a97',
  border: '#e3e2e0', borderSft: '#ededec', sideBg: '#f7f7f5',
  green: '#15794a', greenBg: '#e9f9f0', red: '#b42318',
};

export default function SignedContracts({ clientId, societe, numeroClient }) {
  const [items, setItems] = useState(null);
  const [error, setError] = useState(null);
  const [viewing, setViewing] = useState(null);   // { kind, label }

  const load = useCallback(() => {
    if (!clientId) return;
    apiClient.get(`/api/v1/finance-periods/client/${clientId}/documents`)
      .then((d) => setItems(Array.isArray(d?.items) ? d.items : []))
      .catch((e) => { setItems([]); setError(e?.data?.detail || e?.message || 'Contrats indisponibles'); });
  }, [clientId]);

  useEffect(() => { setItems(null); setError(null); setViewing(null); load(); }, [load]);

  const numero = String(numeroClient || '').replace(/\D/g, '') || clientId;

  return (
    <div style={{ border: `1px solid ${N.borderSft}`, borderRadius: 10, overflow: 'hidden' }}>
      {items === null && (
        <div style={{ padding: '12px 14px', fontSize: 12.5, color: N.textMuted }}>Chargement…</div>
      )}
      {/* Une section vide doit dire pourquoi : API injoignable, ou client sans contrat. */}
      {items !== null && items.length === 0 && (
        <div style={{ padding: '12px 14px', fontSize: 12.5, color: error ? N.red : N.textFaint, fontStyle: error ? 'normal' : 'italic' }}>
          {error ? `Impossible de charger les contrats : ${error}` : 'Aucun contrat dans le CRM pour ce client.'}
        </div>
      )}
      {(items || []).map((it, i) => (
        <div
          key={it.kind}
          style={{
            display: 'flex', alignItems: 'center', gap: 12,
            padding: '11px 14px', borderTop: i === 0 ? 'none' : `1px solid ${N.borderSft}`,
            opacity: it.available ? 1 : 0.75,
          }}
        >
          <FileSignature size={15} style={{ color: it.available ? N.green : N.textFaint, flexShrink: 0 }} />
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: N.text }}>{it.label}</div>
            <div style={{ fontSize: 11.5, color: it.available ? N.textMuted : N.textFaint, marginTop: 2 }}>
              {it.available
                ? `Signé sur Yousign${it.signed_at ? ` le ${formatDateFR(it.signed_at)}` : ''}`
                : 'Aucune signature dans le CRM'}
            </div>
          </div>
          {it.available ? (
            <button
              type="button"
              onClick={() => setViewing({ kind: it.kind, label: it.label })}
              style={{
                border: `1px solid ${N.border}`, background: '#fff', color: N.text,
                borderRadius: 7, padding: '6px 11px', fontSize: 12.5, fontWeight: 600,
                fontFamily: 'inherit', cursor: 'pointer',
                display: 'inline-flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap',
              }}
            >
              <Eye size={13} /> Consulter
            </button>
          ) : (
            <span style={{
              display: 'inline-block', padding: '3px 8px', borderRadius: 999,
              background: N.sideBg, color: N.textFaint, fontSize: 11, fontWeight: 700, whiteSpace: 'nowrap',
            }}>
              Indisponible
            </span>
          )}
        </div>
      ))}

      <DocumentViewer
        open={!!viewing}
        title={viewing ? `${viewing.label} · ${societe || ''}` : ''}
        url={viewing ? `/api/v1/finance-periods/client/${clientId}/documents/${viewing.kind}` : null}
        filename={viewing ? `${viewing.kind === 'owner' ? 'contrat-owner' : 'convention-optilex'}-${numero}.pdf` : null}
        onClose={() => setViewing(null)}
      />
    </div>
  );
}
