import { MAX_STAT, RARITY } from "@/lib/roster/data";
import { generateCoworker } from "@/lib/roster/generate";
import { recordSeen } from "@/lib/roster/save";
import type { Coworker, Rarity, RosterSave, Stat } from "@/lib/roster/types";
import { PACKS, REVIEW } from "./sim/balance";

/**
 * The journey between runs: the one coworker the player is growing and the gold saved up. Level, XP and the day live
 * with the coworker and the day counter in the shared roster save; this is the part only the hero game cares about.
 */
export const CAREER_STORAGE_KEY = "lab:hr:v1";

export interface Career {
  /** The coworker being grown; null until the player picks a starter. */
  focusId: number | null;
  /** Ids of the cards the player owns: the starter they picked and every pack since. */
  owned: number[];
  /** Gold banked from runs, spent on packs. */
  gold: number;
}

export interface CareerStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function storageOrUndefined(): CareerStorage | undefined {
  try {
    return typeof localStorage === "undefined" ? undefined : localStorage;
  } catch {
    return undefined;
  }
}

export function defaultCareer(): Career {
  return { focusId: null, owned: [], gold: 0 };
}

export function normalizeCareer(raw: unknown): Career {
  if (!raw || typeof raw !== "object") return defaultCareer();
  const { focusId, owned, gold } = raw as Partial<Record<keyof Career, unknown>>;
  const whole = (value: unknown) => (typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0);
  const focus = whole(focusId) || null;
  const ids = Array.isArray(owned) ? owned.map(whole).filter((id) => id > 0) : [];
  // The focus is always owned, so a save from before packs keeps its coworker.
  return { focusId: focus, owned: [...new Set(focus ? [focus, ...ids] : ids)], gold: whole(gold) };
}

export function readCareer(storage: CareerStorage | undefined = storageOrUndefined()): Career {
  try {
    const raw = storage?.getItem(CAREER_STORAGE_KEY);
    return raw ? normalizeCareer(JSON.parse(raw)) : defaultCareer();
  } catch {
    return defaultCareer();
  }
}

export function writeCareer(career: Career, storage: CareerStorage | undefined = storageOrUndefined()): void {
  try {
    storage?.setItem(CAREER_STORAGE_KEY, JSON.stringify(career));
  } catch {
    // Private mode or a full quota: progress just isn't kept.
  }
}

export function clearCareer(storage: CareerStorage | undefined = storageOrUndefined()): void {
  try {
    storage?.removeItem(CAREER_STORAGE_KEY);
  } catch {
    // Nothing to do.
  }
}

/** Review XP for a run: a little for every few seconds survived, and a bonus for beating the auditor. */
export function reviewXp(time: number, won: boolean): number {
  return Math.floor(Math.max(0, time) / REVIEW.secondsPerXp) + (won ? REVIEW.winBonus : 0);
}

/** Review XP from `level` to the next. */
export function reviewXpToNext(level: number): number {
  return REVIEW.toNextBase + REVIEW.toNextPerLevel * level;
}

/** 0 is the first rank; the next starts every `levelsPerRank` levels. */
export function rankOf(level: number): number {
  return Math.floor((Math.max(1, level) - 1) / REVIEW.levelsPerRank);
}

/** How much tougher the office is for a coworker of this level and rarity (see `PACKS`). */
export function difficultyFor(level: number, rarity: Rarity = "common"): number {
  const extra = Math.max(0, RARITY[rarity].bonus - RARITY.common.bonus) * PACKS.rarityLevels;
  return 1 + REVIEW.difficultyPerLevel * (Math.max(1, level) - 1 + extra);
}

const GROWTH_ORDER: readonly Stat[] = ["output", "grit", "focus", "hustle", "luck"];
/** The stats a promotion lifts, by `REVIEW.promotionBonus` each. */
const PROMOTION_STATS: readonly Stat[] = ["grit", "output", "focus"];

export interface Review {
  coworker: Coworker;
  /** The XP that was added. */
  xp: number;
  levelsGained: number;
  promoted: boolean;
}

/**
 * The stat every coworker grows on reaching `level`, the same cycle for all departments: growth that followed the
 * favourite stat made a hustle coworker (the intern) fall behind a damage one over the weeks.
 */
function grownStat(level: number): Stat {
  return GROWTH_ORDER[(level - 2) % GROWTH_ORDER.length];
}

/** The coworker after a review: the XP added, every level it earns granted a stat point, a promotion a bonus. */
export function review(coworker: Coworker, xp: number): Review {
  const stats = { ...coworker.stats };
  const bump = (stat: Stat, points: number) => {
    stats[stat] = Math.min(MAX_STAT, stats[stat] + points);
  };
  let { level } = coworker;
  let pool = coworker.xp + Math.max(0, Math.floor(xp));
  let promoted = false;
  while (pool >= reviewXpToNext(level)) {
    pool -= reviewXpToNext(level);
    level += 1;
    bump(grownStat(level), 1);
    if (rankOf(level) > rankOf(level - 1)) {
      promoted = true;
      for (const stat of PROMOTION_STATS) bump(stat, REVIEW.promotionBonus);
    }
  }
  return { coworker: { ...coworker, level, xp: pool, stats }, xp: Math.max(0, Math.floor(xp)), levelsGained: level - coworker.level, promoted };
}

/** The roster and career after buying a pack, with the card it held; null when the gold falls short. */
export function openPack(roster: RosterSave, career: Career): { roster: RosterSave; career: Career; coworker: Coworker } | null {
  if (career.gold < PACKS.price) return null;
  const source = { rng: roster.rng, nextId: roster.nextId };
  const coworker = generateCoworker(source);
  const next = recordSeen({ ...roster, rng: source.rng, nextId: source.nextId, coworkers: [...roster.coworkers, coworker] }, coworker);
  return { roster: next, career: { ...career, owned: [...career.owned, coworker.id], gold: career.gold - PACKS.price }, coworker };
}
