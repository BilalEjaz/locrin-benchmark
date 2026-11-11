import { FIRST_NAMES, LAST_NAMES } from "@/lib/tycoon/data/names";
import { pick, rand, randInt, type RngHolder } from "@/lib/tycoon/sim/rng";

import { BASE_STAT, DEPARTMENTS, FAVOURED_BONUS, MAX_STAT, RARITY, STAT_JITTER } from "./data";
import { DEPARTMENT_IDS, QUIRK_IDS, RARITIES, STATS, type Coworker, type DepartmentId, type QuirkId, type Rarity, type Stats } from "./types";

/** Where new coworkers come from: an rng and the next free id. A `RosterSave` is one. */
export interface Generator extends RngHolder {
  nextId: number;
}

export function rollRarity(source: RngHolder): Rarity {
  const total = RARITIES.reduce((sum, rarity) => sum + RARITY[rarity].weight, 0);
  let roll = rand(source) * total;
  for (const rarity of RARITIES) {
    roll -= RARITY[rarity].weight;
    if (roll < 0) return rarity;
  }
  return "common";
}

function rollStats(source: RngHolder, department: DepartmentId, rarity: Rarity): Stats {
  const stats = {} as Stats;
  for (const stat of STATS) stats[stat] = BASE_STAT + randInt(source, -STAT_JITTER, STAT_JITTER);
  stats[DEPARTMENTS[department].favours] += FAVOURED_BONUS;
  for (let point = 0; point < RARITY[rarity].bonus; point += 1) stats[pick(source, STATS)] += 1;
  for (const stat of STATS) stats[stat] = Math.min(MAX_STAT, stats[stat]);
  return stats;
}

function rollQuirks(source: RngHolder, count: number): QuirkId[] {
  const pool = [...QUIRK_IDS];
  const quirks: QuirkId[] = [];
  while (quirks.length < count && pool.length > 0) quirks.push(pool.splice(Math.floor(rand(source) * pool.length), 1)[0]);
  return quirks;
}

/** A fresh level 1 coworker. Takes `source.nextId` and advances it and the rng; anything not given is rolled. */
export function generateCoworker(source: Generator, options: { department?: DepartmentId; rarity?: Rarity } = {}): Coworker {
  const id = source.nextId;
  source.nextId += 1;
  const name = `${pick(source, FIRST_NAMES)} ${pick(source, LAST_NAMES)}`;
  const department = options.department ?? pick(source, DEPARTMENT_IDS);
  const rarity = options.rarity ?? rollRarity(source);
  return {
    id,
    name,
    department,
    rarity,
    quirks: rollQuirks(source, RARITY[rarity].quirks),
    perks: [],
    stats: rollStats(source, department, rarity),
    level: 1,
    xp: 0,
    status: { kind: "active" },
  };
}

/** The three coworkers a new save starts with, before the HR loop exists. Each has its own seed, so they never change. */
export const STARTERS: readonly { department: DepartmentId; seed: number }[] = [
  { department: "interns", seed: 0x1a7e },
  { department: "finance", seed: 0xacc7 },
  { department: "it", seed: 0x5a5a },
];

/** The starters, with ids 1 to 3. */
export function starters(): Coworker[] {
  return STARTERS.map(({ department, seed }, index) => generateCoworker({ rng: seed, nextId: index + 1 }, { department, rarity: "common" }));
}
