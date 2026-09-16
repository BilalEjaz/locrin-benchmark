// DocumentViewer.jsx — consulter un PDF du client sans quitter la fiche.
//
// Demande dev 2026-09-08 : « on doit pouvoir cliquer sur le contrat et ouvrir
// une pop-up permettant de consulter le document ». Le PDF est servi par
// l'API avec le jeton de session : on le télécharge en mémoire, puis on le
// confie au lecteur PDF du navigateur dans un cadre. Rien n'est écrit sur le
// disque du poste sauf si la personne choisit « Télécharger ».
//
// L'API dit si c'est la version signée ou la version envoyée à la signature
// (en-tête X-Document-Version) : dans le second cas, un bandeau le signale.

import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { X, ExternalLink, Download, FileSignature, TriangleAlert } from 'lucide-react';

import apiClient from '../../../services/apiClient.js';

const N = {
  text: '#37352f', textMuted: '#787774', textFaint: '#9b9a97',
  border: '#e3e2e0', borderSft: '#ededec', sideBg: '#f7f7f5',
  amber: '#b45309', amberBg: '#fff8ed', red: '#b42318',
};

const btn = {
  border: `1px solid ${N.border}`, background: '#fff', color: N.text,
  borderRadius: 7, padding: '7px 12px', fontSize: 12.5, fontWeight: 600,
  fontFamily: 'inherit', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6,
  whiteSpace: 'nowrap',
};

export default function DocumentViewer({ open, title, url, filename, onClose }) {
  const [blobUrl, setBlobUrl] = useState(null);
  const [version, setVersion] = useState(null);
  const [error, setError] = useState(null);

  // Chargement du PDF à l'ouverture ; l'URL objet est libérée à la fermeture.
  useEffect(() => {
    if (!open || !url) return undefined;
    let cancelled = false;
    let objectUrl = null;
    setBlobUrl(null); setVersion(null); setError(null);
    (async () => {
      try {
        const resp = await fetch(`${apiClient.baseUrl}${url}`, {
          headers: { Authorization: `Bearer ${apiClient.getToken()}` },
        });
        if (!resp.ok) {
          const body = await resp.json().catch(() => ({}));
          throw new Error(body?.detail || `Document indisponible (${resp.status})`);
        }
        const blob = await resp.blob();
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setBlobUrl(objectUrl);
        setVersion(resp.headers.get('X-Document-Version') || 'signed');
      } catch (e) {
        if (!cancelled) setError(e.message || 'Document indisponible');
      }
    })();
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [open, url]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return createPortal(
    <AnimatePresence>
      <motion.div
        key="doc-backdrop"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.16 }}
        onClick={onClose}
        style={{
          position: 'fixed', inset: 0, zIndex: 10070,
          background: 'rgba(23,23,26,0.5)',
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
            width: 'min(980px, 100%)', height: 'min(92vh, 1100px)',
            display: 'flex', flexDirection: 'column',
            background: '#fff', borderRadius: 14,
            boxShadow: '0 24px 64px rgba(17,24,39,0.28)',
            fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif",
            overflow: 'hidden',
          }}
        >
          <div style={{
            display: 'flex', alignItems: 'center', gap: 10,
            padding: '12px 16px', borderBottom: `1px solid ${N.borderSft}`,
          }}>
            <FileSignature size={16} style={{ color: N.textFaint, flexShrink: 0 }} />
            <div style={{ minWidth: 0, flex: 1, fontSize: 14, fontWeight: 700, color: N.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {title}
            </div>
            {version === 'original' && (
              <span title="La version signée n'a pas pu être récupérée chez Yousign : ceci est le document tel qu'il a été envoyé à la signature." style={{
                display: 'inline-flex', alignItems: 'center', gap: 5,
                padding: '3px 9px', borderRadius: 999, background: N.amberBg, color: N.amber,
                fontSize: 11, fontWeight: 700, whiteSpace: 'nowrap',
              }}>
                <TriangleAlert size={12} /> version envoyée, non signée
              </span>
            )}
            {blobUrl && (
              <>
                <a href={blobUrl} target="_blank" rel="noreferrer" style={{ ...btn, textDecoration: 'none' }}>
                  <ExternalLink size={13} /> Ouvrir dans un onglet
                </a>
                <a href={blobUrl} download={filename || 'document.pdf'} style={{ ...btn, textDecoration: 'none' }}>
                  <Download size={13} /> Télécharger
                </a>
              </>
            )}
            <button type="button" onClick={onClose} style={{ ...btn, border: 'none', padding: 6, color: N.textMuted }}>
              <X size={16} />
            </button>
          </div>

          <div style={{ flex: 1, minHeight: 0, background: N.sideBg, position: 'relative' }}>
            {error ? (
              <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: N.red, fontSize: 13, padding: 30, textAlign: 'center' }}>
                {error}
              </div>
            ) : !blobUrl ? (
              <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: N.textMuted, fontSize: 13 }}>
                Chargement du document…
              </div>
            ) : (
              <iframe
                title={title}
                src={`${blobUrl}#toolbar=1&navpanes=0`}
                style={{ width: '100%', height: '100%', border: 'none', display: 'block' }}
              />
            )}
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>,
    document.body,
  );
}
