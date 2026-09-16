"use client";

import { useEffect, useState } from "react";
import { apiPost } from "@/lib/client";

type Seed = { id: string; title: string; visibility: "public" | "private"; bloomed: boolean };
type Garden = {
  id: string;
  name: string;
  emoji: string;
  visibility: "public" | "private";
  seeds: Seed[];
};

// A destination picker for forwarding a message. Lists your decisions grouped by
// garden (relationship group), searchable; tap one to drop the message's text +
// media into it. Bloomed (closed) seeds and the current seed are excluded.
export function ForwardPicker({
  contributionId,
  excludeSeedId,
  onClose,
}: {
  contributionId: string;
  excludeSeedId: string;
  onClose: () => void;
}) {
  const [gardens, setGardens] = useState<Garden[] | null>(null);
  const [q, setQ] = useState("");
  const [sending, setSending] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/me/tree", { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => setGardens(j?.gardens ?? j?.data?.gardens ?? []))
      .catch(() => setGardens([]));
  }, []);

  async function forward(seedId: string, title: string) {
    if (sending) return;
    setSending(seedId);
    setError(null);
    try {
      await apiPost(`/api/seeds/${seedId}/forward`, { contributionId });
      setDone(title);
      setTimeout(onClose, 1200);
    } catch {
      setSending(null);
      setError("Couldn't forward it just now — try again.");
    }
  }

  const ql = q.trim().toLowerCase();
  const filtered = (gardens ?? [])
    .map((g) => ({
      ...g,
      seeds: g.seeds.filter(
        (s) =>
          s.id !== excludeSeedId &&
          !s.bloomed &&
          (!ql || s.title.toLowerCase().includes(ql) || g.name.toLowerCase().includes(ql)),
      ),
    }))
    .filter((g) => g.seeds.length > 0);

  return (
    <div className="fixed inset-0 z-[140] flex items-end justify-center sm:items-center">
      <button
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        aria-label="Close"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-label="Forward to"
        className="relative z-10 max-h-[85dvh] w-full max-w-md overflow-auto rounded-t-2xl border border-[rgba(76,175,80,0.2)] bg-[#0B120B] p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] shadow-2xl sm:rounded-2xl sm:pb-4"
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-ink">↪ Forward to…</h2>
          <button onClick={onClose} aria-label="Close" className="text-ink-soft transition hover:text-ink">
            ✕
          </button>
        </div>

        {done ? (
          <p className="py-8 text-center text-sm text-accent">✓ Forwarded to {done}</p>
        ) : (
          <>
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search your decisions…"
              className="input mb-3 w-full text-sm"
            />
            {error && <p className="mb-2 text-xs text-[#e57373]">{error}</p>}
            {gardens === null && <p className="py-4 text-sm text-ink-soft">Loading…</p>}
            {gardens && filtered.length === 0 && (
              <p className="py-4 text-center text-xs text-ink-soft">
                No other decisions to forward to yet — start one first 🌱
              </p>
            )}
            <div className="space-y-4">
              {filtered.map((g) => (
                <div key={g.id}>
                  <p className="mb-1 flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-ink-soft">
                    <span aria-hidden>{g.emoji}</span>
                    <span className="truncate">{g.name}</span>
                  </p>
                  <div className="space-y-1">
                    {g.seeds.map((s) => (
                      <button
                        key={s.id}
                        onClick={() => forward(s.id, s.title)}
                        disabled={!!sending}
                        className="flex w-full items-center gap-2 rounded-xl border border-[rgba(255,255,255,0.06)] bg-[rgba(7,13,7,0.35)] p-3 text-left transition hover:border-accent disabled:opacity-50"
                      >
                        <span className="shrink-0 text-xs" aria-hidden>
                          {s.visibility === "private" ? "🔒" : "🌱"}
                        </span>
                        <span className="min-w-0 flex-1 truncate text-sm text-ink">{s.title}</span>
                        <span className="shrink-0 text-xs text-accent">
                          {sending === s.id ? "Sending…" : "Forward →"}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
