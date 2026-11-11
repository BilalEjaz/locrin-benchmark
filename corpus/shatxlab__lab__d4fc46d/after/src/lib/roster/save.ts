import { BASE_STAT, MAX_QUIRKS, MAX_STAT } from "./data";
import { starters } from "./generate";
import {
  DEPARTMENT_IDS,
  PERK_IDS,
  QUIRK_IDS,
  RARITIES,
  STATS,
  type CodexEntry,
  type Coworker,
  type DepartmentId,
  type PerkId,
  type QuirkId,
  type Rarity,
  type RosterSave,
  type Status,
} from "./types";

/** The coworkers every game here shares, and the codex of everyone and every quirk seen. */
export const ROSTER_STORAGE_KEY = "lab:roster:v1";

export interface RosterStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function storageOrUndefined(): RosterStorage | undefined {
  try {
    return typeof localStorage === "undefined" ? undefined : localStorage;
  } catch {
    return undefined;
  }
}

/** A seed for a new save's rng, so no two players see the same candidates. */
export function freshSeed(): number {
  return Math.floor(Math.random() * 0x1_0000_0000) >>> 0;
}

/** The save after the player has seen this coworker: they and their quirks go in the codex, once. */
export function recordSeen(save: RosterSave, coworker: Coworker): RosterSave {
  const known = save.codex.coworkers.some((entry) => entry.id === coworker.id);
  const quirks = coworker.quirks.filter((quirk) => !save.codex.quirks.includes(quirk));
  if (known && quirks.length === 0) return save;
  const { id, name, department, rarity } = coworker;
  return {
    ...save,
    codex: {
      coworkers: known ? save.codex.coworkers : [...save.codex.coworkers, { id, name, department, rarity }],
      quirks: [...save.codex.quirks, ...quirks],
    },
  };
}

/** A new save: the starters on day 0, stakes off. */
export function defaultSave(seed: number = freshSeed()): RosterSave {
  const coworkers = starters();
  const empty: RosterSave = {
    rng: seed >>> 0,
    nextId: coworkers.length + 1,
    day: 0,
    stakes: false,
    coworkers,
    codex: { coworkers: [], quirks: [] },
  };
  return coworkers.reduce(recordSeen, empty);
}

function count(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function oneOf<T extends string>(options: readonly T[], value: unknown, fallback: T): T {
  return options.includes(value as T) ? (value as T) : fallback;
}

function quirkList(value: unknown, max: number): QuirkId[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((quirk): quirk is QuirkId => QUIRK_IDS.includes(quirk as QuirkId)))].slice(0, max);
}

function perkList(value: unknown): PerkId[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((perk): perk is PerkId => PERK_IDS.includes(perk as PerkId)))];
}

function nameOf(value: unknown, id: number): string {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, 40) : `#${id}`;
}

function normalizeStatus(raw: unknown): Status {
  const status = record(raw);
  if (status.kind === "burnedOut") return { kind: "burnedOut", until: count(status.until) };
  if (status.kind === "quit") return { kind: "quit", day: count(status.day) };
  return { kind: "active" };
}

/** A stored coworker field by field, or null without a usable id. An unknown department or rarity falls back. */
function normalizeCoworker(raw: unknown): Coworker | null {
  const candidate = record(raw);
  const id = count(candidate.id);
  if (id === 0) return null;
  const stats = record(candidate.stats);
  return {
    id,
    name: nameOf(candidate.name, id),
    department: oneOf<DepartmentId>(DEPARTMENT_IDS, candidate.department, "interns"),
    rarity: oneOf<Rarity>(RARITIES, candidate.rarity, "common"),
    quirks: quirkList(candidate.quirks, MAX_QUIRKS),
    perks: perkList(candidate.perks),
    stats: Object.fromEntries(STATS.map((stat) => [stat, Math.min(MAX_STAT, count(stats[stat]) || BASE_STAT)])) as Coworker["stats"],
    level: Math.max(1, count(candidate.level)),
    xp: count(candidate.xp),
    status: normalizeStatus(candidate.status),
  };
}

function normalizeEntry(raw: unknown): CodexEntry | null {
  const candidate = record(raw);
  const id = count(candidate.id);
  if (id === 0) return null;
  return {
    id,
    name: nameOf(candidate.name, id),
    department: oneOf<DepartmentId>(DEPARTMENT_IDS, candidate.department, "interns"),
    rarity: oneOf<Rarity>(RARITIES, candidate.rarity, "common"),
  };
}

/** Keeps the first of each id. */
function uniqueById<T extends { id: number }>(items: readonly (T | null)[]): T[] {
  const seen = new Set<number>();
  return items.filter((item): item is T => item !== null && !seen.has(item.id) && Boolean(seen.add(item.id)));
}

/**
 * Validate a stored payload field by field; anything unreadable falls back to its default. Coworkers without an id
 * are dropped, and `nextId` always lands past every id in use, so an id is never handed out twice.
 */
export function normalizeSave(raw: unknown, seed: number = freshSeed()): RosterSave {
  const save = defaultSave(seed);
  if (!raw || typeof raw !== "object") return save;
  const candidate = raw as Partial<Record<keyof RosterSave, unknown>>;
  if (typeof candidate.rng === "number" && Number.isInteger(candidate.rng)) save.rng = candidate.rng >>> 0;
  save.day = count(candidate.day);
  save.stakes = candidate.stakes === true;
  if (Array.isArray(candidate.coworkers)) save.coworkers = uniqueById(candidate.coworkers.map(normalizeCoworker));
  // The codex is rebuilt from what was stored plus the coworkers on hand, never from the defaults.
  save.codex = { coworkers: [], quirks: [] };
  const codex = record(candidate.codex);
  if (Array.isArray(codex.coworkers)) save.codex.coworkers = uniqueById(codex.coworkers.map(normalizeEntry));
  if (Array.isArray(codex.quirks)) save.codex.quirks = quirkList(codex.quirks, QUIRK_IDS.length);
  const ids = [...save.coworkers, ...save.codex.coworkers].map((item) => item.id);
  save.nextId = Math.max(count(candidate.nextId), ...ids.map((id) => id + 1), 1);
  return save.coworkers.reduce(recordSeen, save);
}

export function readSave(storage: RosterStorage | undefined = storageOrUndefined()): RosterSave {
  try {
    const raw = storage?.getItem(ROSTER_STORAGE_KEY);
    return raw ? normalizeSave(JSON.parse(raw)) : defaultSave();
  } catch {
    return defaultSave();
  }
}

export function writeSave(save: RosterSave, storage: RosterStorage | undefined = storageOrUndefined()): void {
  try {
    storage?.setItem(ROSTER_STORAGE_KEY, JSON.stringify(save));
  } catch {
    // Private mode or a full quota: progress just isn't kept.
  }
}
