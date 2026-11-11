// Identity matching: which unit in the code now is which tracked unit, across
// renames, moves, splits and merges. Stages run in a fixed order (declared
// lineage, file and name, content hash, syntax-tree similarity), and anything
// with more than one plausible answer is queued for a person, never guessed.
import { isRemoved } from "./removal.ts";
import type { Hash, LineageEntry, LineageKind, Uid, Unit, UnitKind } from "./types.ts";

/** A unit as the indexer sees it in one snapshot of the code. */
export interface CodeUnit {
  /** Unique within the snapshot, e.g. `file#name`. */
  key: string;
  file: string;
  name: string;
  kind: UnitKind;
  contentHash: Hash;
  /** Hashes of the unit's subtrees, for similarity; see `similarity`. */
  fingerprint: readonly string[];
}

/** A code unit in the earlier snapshot, with the uid the store gives it. */
export interface TrackedUnit extends CodeUnit {
  uid: Uid;
}

/** Where a unit is, by file and name; the kind says whether it is a type or a value. */
export interface UnitRef {
  file: string;
  name: string;
  kind: UnitKind;
}

/**
 * A rename, move, split or merge someone declared. Renames and moves name one
 * uid and one target; a split names one uid and its parts, the first of which
 * keeps the uid; a merge names the merged uids, the first of which survives,
 * and one target.
 */
export interface LineageDeclaration {
  kind: LineageKind;
  uids: Uid[];
  to: UnitRef[];
}

export type MatchVia = "declared" | "location" | "content" | "similarity";

/** A tracked unit found again, and the lineage entries its file should gain. */
export interface IdentityMatch {
  uid: Uid;
  key: string;
  via: MatchVia;
  /** Set for similarity matches. */
  score?: number;
  lineage: LineageEntry[];
  /**
   * For a declared split, the keys of the new parts. Their uids do not exist
   * until the caller mints them, so the caller adds `{ kind: "split", uids }`
   * to this unit's lineage once they do.
   */
  splitInto?: string[];
}

/** A new unit, with lineage when it is part of a declared split. */
export interface CreatedUnit {
  key: string;
  lineage?: LineageEntry[];
}

/** A tracked unit no longer in the code; `mergedInto` when a declared merge absorbed it. */
export interface RemovedUnit {
  uid: Uid;
  mergedInto?: Uid;
}

/** Units that could each be several others. Nothing about them is decided until someone confirms. */
export interface QueuedMatch {
  reason: string;
  uids: Uid[];
  keys: string[];
}

export interface RejectedDeclaration {
  declaration: LineageDeclaration;
  reason: string;
}

export interface IdentityResult {
  matched: IdentityMatch[];
  created: CreatedUnit[];
  removed: RemovedUnit[];
  queued: QueuedMatch[];
  rejected: RejectedDeclaration[];
}

export interface MatchOptions {
  /** The similarity at which two units may be the same, 0 to 1. Default 0.65. */
  threshold?: number;
  /** Fewest fingerprint entries a unit needs to be matched by similarity. Default 8. */
  minSize?: number;
}

// Measured on this repository: the closest unrelated pair of functions scores 0.61,
// and a real move that also renamed a parameter throughout scores 0.68.
const DEFAULT_THRESHOLD = 0.65;
// One-line functions carry too little shape to tell apart; they match only by
// declaration, location or content.
const DEFAULT_MIN_SIZE = 8;

/** Jaccard similarity of two fingerprints: shared subtree hashes over all of them. */
export function similarity(a: readonly string[], b: readonly string[]): number {
  if (a.length === 0 && b.length === 0) return 1;
  const left = new Set(a);
  const right = new Set(b);
  let shared = 0;
  for (const hash of left) if (right.has(hash)) shared++;
  return shared / (left.size + right.size - shared);
}

/**
 * The tracked units in an earlier snapshot: each live store unit paired with the
 * code unit at its recorded file and name. Store units with no code there are
 * returned as `missing`, since nothing can be matched from them.
 */
export function trackedUnits(units: readonly Unit[], code: readonly CodeUnit[]): { tracked: TrackedUnit[]; missing: Uid[] } {
  const byRef = new Map(code.map((unit) => [refKey(unit), unit]));
  const tracked: TrackedUnit[] = [];
  const missing: Uid[] = [];
  for (const unit of units) {
    if (isRemoved(unit)) continue;
    const found = byRef.get(refKey({ file: unit.location.file, name: unit.name, kind: unit.kind }));
    if (found) tracked.push({ ...found, uid: unit.uid });
    else missing.push(unit.uid);
  }
  return { tracked, missing };
}

/** Matches the tracked units of an earlier snapshot to the units in the code now. */
export function matchIdentities(
  before: readonly TrackedUnit[],
  after: readonly CodeUnit[],
  declarations: readonly LineageDeclaration[] = [],
  options: MatchOptions = {},
): IdentityResult {
  const threshold = options.threshold ?? DEFAULT_THRESHOLD;
  const minSize = options.minSize ?? DEFAULT_MIN_SIZE;
  const byUid = new Map(before.map((unit) => [unit.uid, unit]));
  const afterByRef = new Map(after.map((unit) => [refKey(unit), unit]));
  const openBefore = new Set(before.map((unit) => unit.uid));
  const openAfter = new Set(after.map((unit) => unit.key));
  const result: IdentityResult = { matched: [], created: [], removed: [], queued: [], rejected: [] };

  const match = (from: TrackedUnit, to: CodeUnit, via: MatchVia, extra: { score?: number; lineage?: LineageEntry[]; splitInto?: string[] } = {}) => {
    openBefore.delete(from.uid);
    openAfter.delete(to.key);
    const matched: IdentityMatch = { uid: from.uid, key: to.key, via, lineage: [...lineageBetween(from, to), ...(extra.lineage ?? [])] };
    if (extra.score !== undefined) matched.score = extra.score;
    if (extra.splitInto) matched.splitInto = extra.splitInto;
    result.matched.push(matched);
  };

  // 1. Declared lineage, checked against what the snapshots show.
  const declaredTargets = new Set(declarations.flatMap((declaration) => declaration.to.map(refKey)));
  for (const declaration of declarations) {
    const reason = checkDeclaration(declaration, byUid, afterByRef, openBefore, openAfter, declaredTargets);
    if (reason) {
      result.rejected.push({ declaration, reason });
      continue;
    }
    const sources = declaration.uids.map((uid) => byUid.get(uid)!);
    const targets = declaration.to.map((ref) => afterByRef.get(refKey(ref))!);
    if (declaration.kind === "split") {
      const [original] = sources;
      const [continuing, ...parts] = targets;
      match(original!, continuing!, "declared", { splitInto: parts.map((part) => part.key) });
      for (const part of parts) {
        openAfter.delete(part.key);
        result.created.push({ key: part.key, lineage: [{ kind: "split", uids: [original!.uid] }] });
      }
    } else if (declaration.kind === "merge") {
      const [survivor, ...merged] = sources;
      match(survivor!, targets[0]!, "declared", { lineage: [{ kind: "merge", uids: merged.map((unit) => unit.uid) }] });
      for (const unit of merged) {
        openBefore.delete(unit.uid);
        result.removed.push({ uid: unit.uid, mergedInto: survivor!.uid });
      }
    } else {
      match(sources[0]!, targets[0]!, "declared");
    }
  }

  // 2. The same file and name.
  for (const unit of before) {
    if (!openBefore.has(unit.uid)) continue;
    const same = afterByRef.get(refKey(unit));
    if (same && openAfter.has(same.key)) match(unit, same, "location");
  }

  // 3. The same content: a rename or move with no other edit. Shared content is ambiguous.
  const pending = () => ({
    left: before.filter((unit) => openBefore.has(unit.uid)),
    right: after.filter((unit) => openAfter.has(unit.key)),
  });
  {
    const { left, right } = pending();
    const groups = new Map<string, { left: TrackedUnit[]; right: CodeUnit[] }>();
    const group = (unit: CodeUnit) => {
      const key = `${space(unit.kind)}\0${unit.contentHash}`;
      let found = groups.get(key);
      if (!found) groups.set(key, (found = { left: [], right: [] }));
      return found;
    };
    for (const unit of left) group(unit).left.push(unit);
    for (const unit of right) group(unit).right.push(unit);
    for (const { left: from, right: to } of groups.values()) {
      if (from.length === 0 || to.length === 0) continue;
      if (from.length === 1 && to.length === 1) match(from[0]!, to[0]!, "content");
      else queue(result, `${from.length + to.length} units share the same content`, from, to, openBefore, openAfter);
    }
  }

  // 4. Similar syntax trees. A pair counts only when neither side resembles anything else.
  {
    const { left, right } = pending();
    const pairs: Array<{ from: TrackedUnit; to: CodeUnit; score: number }> = [];
    for (const from of left) {
      for (const to of right) {
        if (space(from.kind) !== space(to.kind)) continue;
        if (from.fingerprint.length < minSize || to.fingerprint.length < minSize) continue;
        const score = similarity(from.fingerprint, to.fingerprint);
        if (score >= threshold) pairs.push({ from, to, score });
      }
    }
    for (const component of components(pairs)) {
      if (component.from.length === 1 && component.to.length === 1) {
        match(component.from[0]!, component.to[0]!, "similarity", { score: Math.round(component.pairs[0]!.score * 1000) / 1000 });
      } else {
        queue(result, "similar to more than one unit", component.from, component.to, openBefore, openAfter);
      }
    }
  }

  for (const unit of after) if (openAfter.has(unit.key)) result.created.push({ key: unit.key });
  for (const unit of before) if (openBefore.has(unit.uid)) result.removed.push({ uid: unit.uid });
  return result;
}

function checkDeclaration(
  declaration: LineageDeclaration,
  byUid: ReadonlyMap<Uid, TrackedUnit>,
  afterByRef: ReadonlyMap<string, CodeUnit>,
  openBefore: ReadonlySet<Uid>,
  openAfter: ReadonlySet<string>,
  declaredTargets: ReadonlySet<string>,
): string | undefined {
  const { kind, uids, to } = declaration;
  if (kind === "split" ? uids.length !== 1 || to.length < 2 : kind === "merge" ? uids.length < 2 || to.length !== 1 : uids.length !== 1 || to.length !== 1) {
    return `a ${kind} names ${kind === "split" ? "one uid and at least two parts" : kind === "merge" ? "at least two uids and one target" : "one uid and one target"}`;
  }
  for (const uid of uids) {
    if (!byUid.has(uid)) return `${uid} is not a tracked unit in the earlier snapshot`;
    if (!openBefore.has(uid)) return `${uid} is already matched by an earlier declaration`;
  }
  for (const ref of to) {
    const target = afterByRef.get(refKey(ref));
    if (!target) return `there is no ${ref.kind === "type" ? "type" : "function"} ${ref.name} in ${ref.file}`;
    if (!openAfter.has(target.key)) return `${ref.file}#${ref.name} is already claimed by an earlier declaration`;
  }
  const sources = uids.map((uid) => byUid.get(uid)!);
  // A unit still at its old place was copied, not moved, unless a declaration gives that place to another unit,
  // as in a swap. Merged units must be gone.
  for (const [i, source] of sources.entries()) {
    const stillThere = afterByRef.has(refKey(source)) && !declaredTargets.has(refKey(source));
    if (stillThere && (kind !== "merge" || i > 0)) return `${source.name} is still in ${source.file}, so it was not ${kind === "merge" ? "merged" : kind === "split" ? "split" : "moved or renamed"}`;
  }
  if (kind === "rename" || kind === "move") {
    const [source] = sources;
    const [target] = to;
    if (kind === "rename" && source!.name === target!.name) return `${source!.name} kept its name, so it was not renamed`;
    if (kind === "move" && source!.file === target!.file) return `${source!.name} stayed in ${source!.file}, so it was not moved`;
  }
  return undefined;
}

/** The entries recording how a unit's file or name changed between two snapshots. */
function lineageBetween(from: CodeUnit, to: CodeUnit): LineageEntry[] {
  const entries: LineageEntry[] = [];
  if (from.file !== to.file) entries.push({ kind: "move", from: from.file });
  if (from.name !== to.name) entries.push({ kind: "rename", from: from.name });
  return entries;
}

function queue(result: IdentityResult, reason: string, from: readonly TrackedUnit[], to: readonly CodeUnit[], openBefore: Set<Uid>, openAfter: Set<string>) {
  for (const unit of from) openBefore.delete(unit.uid);
  for (const unit of to) openAfter.delete(unit.key);
  result.queued.push({ reason, uids: from.map((unit) => unit.uid), keys: to.map((unit) => unit.key) });
}

/** Connected groups of above-threshold pairs, so a unit resembling two others is seen as ambiguous. */
function components<P extends { from: TrackedUnit; to: CodeUnit }>(pairs: readonly P[]): Array<{ from: TrackedUnit[]; to: CodeUnit[]; pairs: P[] }> {
  const parent = new Map<string, string>();
  const find = (id: string): string => {
    const up = parent.get(id) ?? id;
    if (up === id) return id;
    const top = find(up);
    parent.set(id, top);
    return top;
  };
  for (const pair of pairs) parent.set(find(`b:${pair.from.uid}`), find(`a:${pair.to.key}`));
  const groups = new Map<string, { from: Map<Uid, TrackedUnit>; to: Map<string, CodeUnit>; pairs: P[] }>();
  for (const pair of pairs) {
    const id = find(`b:${pair.from.uid}`);
    let group = groups.get(id);
    if (!group) groups.set(id, (group = { from: new Map(), to: new Map(), pairs: [] }));
    group.from.set(pair.from.uid, pair.from);
    group.to.set(pair.to.key, pair.to);
    group.pairs.push(pair);
  }
  return [...groups.values()].map((group) => ({ from: [...group.from.values()], to: [...group.to.values()], pairs: group.pairs }));
}

// Types and values live in separate namespaces: a function never becomes a type.
function space(kind: UnitKind): "type" | "value" {
  return kind === "type" ? "type" : "value";
}

function refKey(ref: { file: string; name: string; kind: UnitKind }): string {
  return `${ref.file}#${ref.name}#${space(ref.kind)}`;
}
