// Script sync planning (pure, tested): which side wins for every script, deletions included.

export interface LocalScript { name: string; code: string; /** unix seconds */ modified: number; public: boolean }
export interface RemoteScript { name: string; code: string; public: boolean; /** unix milliseconds */ updatedAt: number }
/** What both sides looked like after the last successful sync of this script. */
export interface Seen { hash: string; public: boolean }
export type ScriptAction =
  | { op: 'pull'; name: string; code: string; public: boolean }
  | { op: 'push'; name: string; code: string; public: boolean }
  | { op: 'delLocal'; name: string }
  | { op: 'delRemote'; name: string }
  | { op: 'mark'; name: string; hash: string; public: boolean };

/** Change detection only (not security): a fast string hash. */
export function hashCode(s: string): string {
  let h1 = 5381, h2 = 52711;
  for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); h1 = (h1 * 33) ^ c; h2 = (h2 * 33) ^ c; }
  return `${s.length}.${(h1 >>> 0).toString(36)}.${(h2 >>> 0).toString(36)}`;
}

/**
 * Three-way plan per script name: unchanged-on-one-side takes the other side, a script that disappeared on one side is deleted on the other
 * unless it was edited there since, and when both sides changed the newer edit wins.
 */
export function planScripts(local: LocalScript[], remote: RemoteScript[], seen: Record<string, Seen>): ScriptAction[] {
  const L = new Map(local.map((s) => [s.name, s])), R = new Map(remote.map((s) => [s.name, s]));
  const out: ScriptAction[] = [];
  for (const name of new Set([...L.keys(), ...R.keys()])) {
    const l = L.get(name), r = R.get(name), s = seen[name];
    const lh = l ? hashCode(l.code) : '', rh = r ? hashCode(r.code) : '';
    const changedL = !!l && (!s || lh !== s.hash || l.public !== s.public);
    const changedR = !!r && (!s || rh !== s.hash || r.public !== s.public);
    if (l && r) {
      if (lh === rh && l.public === r.public) { if (!s || s.hash !== lh || s.public !== l.public) out.push({ op: 'mark', name, hash: lh, public: l.public }); }
      else if (!changedL && changedR) out.push({ op: 'pull', name, code: r.code, public: r.public });
      else if (changedL && !changedR) out.push({ op: 'push', name, code: l.code, public: l.public });
      else out.push(l.modified * 1000 >= r.updatedAt ? { op: 'push', name, code: l.code, public: l.public } : { op: 'pull', name, code: r.code, public: r.public });
    } else if (l) out.push(s && !changedL ? { op: 'delLocal', name } : { op: 'push', name, code: l.code, public: l.public });
    else if (r) out.push(s && !changedR ? { op: 'delRemote', name } : { op: 'pull', name, code: r!.code, public: r!.public });
  }
  return out;
}

/** Pick a name that is free in the library (community scripts are imported next to your own). */
export function freeName(name: string, taken: string[], author?: string): string {
  if (!taken.includes(name)) return name;
  const base = author ? `${name} (${author})` : name;
  if (!taken.includes(base)) return base;
  for (let i = 2; ; i++) if (!taken.includes(`${base} ${i}`)) return `${base} ${i}`;
}

/** Which side holds the newer settings? Timestamps are unix milliseconds. */
export const stateDirection = (localAt: number, remoteAt: number | null): 'push' | 'pull' | 'none' =>
  remoteAt === null ? 'push' : remoteAt > localAt ? 'pull' : localAt > remoteAt ? 'push' : 'none';

export interface SecretPlan { push: string[]; delRemote: string[]; setLocal: string[]; delLocal: string[]; seen: Record<string, string> }

/**
 * Three-way plan for the API keys (name -> value): a key that exists on one side only is copied, a key removed on one side is removed on the other
 * unless it was changed there, and when both sides changed the value of this device wins.
 * `seen` holds the hash of every key at the last sync.
 */
export function planSecrets(local: Record<string, string>, remote: Record<string, string>, seen: Record<string, string>): SecretPlan {
  const plan: SecretPlan = { push: [], delRemote: [], setLocal: [], delLocal: [], seen: {} };
  for (const name of new Set([...Object.keys(local), ...Object.keys(remote)])) {
    const l = local[name], r = remote[name], s = seen[name];
    if (l !== undefined && r !== undefined) {
      if (l === r) plan.seen[name] = hashCode(l);
      else if (s === hashCode(l)) { plan.setLocal.push(name); plan.seen[name] = hashCode(r); } // changed on the other device
      else { plan.push.push(name); plan.seen[name] = hashCode(l); }
    } else if (l !== undefined) {
      if (s !== undefined && s === hashCode(l)) plan.delLocal.push(name); // removed on the other device
      else { plan.push.push(name); plan.seen[name] = hashCode(l); }
    } else if (r !== undefined) {
      if (s !== undefined && s === hashCode(r)) plan.delRemote.push(name); // removed here
      else { plan.setLocal.push(name); plan.seen[name] = hashCode(r); }
    }
  }
  return plan;
}
