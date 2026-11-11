import { random } from "@/lib/tower/sim/random";
import {
  GOLD_PICK,
  HEAL_SHARE,
  MAX_PASSIVE_LEVEL,
  MAX_PASSIVES,
  MAX_WEAPON_LEVEL,
  MAX_WEAPONS,
  PASSIVE_IDS,
  PICKS_OFFERED,
  WEAPON_IDS,
} from "./balance";
import { withPassives } from "./hero";
import type { Pick, Run } from "./types";

/** Everything the hero could take right now: the next level of what they have, and new things while slots are free. */
export function possiblePicks(run: Run): Pick[] {
  const picks: Pick[] = [];
  for (const id of WEAPON_IDS) {
    const owned = run.weapons.find((weapon) => weapon.id === id);
    if (owned ? owned.level < MAX_WEAPON_LEVEL : run.weapons.length < MAX_WEAPONS) picks.push({ kind: "weapon", id, level: (owned?.level ?? 0) + 1 });
  }
  const passives = PASSIVE_IDS.filter((id) => (run.passives[id] ?? 0) > 0).length;
  for (const id of PASSIVE_IDS) {
    const level = run.passives[id] ?? 0;
    if (level > 0 ? level < MAX_PASSIVE_LEVEL : passives < MAX_PASSIVES) picks.push({ kind: "passive", id, level: level + 1 });
  }
  return picks;
}

/** Three (or more, with the corner office) different picks at random, topped up with a heal and gold once the build is nearly full. */
export function rollPicks(run: Run): Pick[] {
  const pool = possiblePicks(run);
  const offer: Pick[] = [];
  const size = PICKS_OFFERED + run.extraPicks;
  while (offer.length < size && pool.length > 0) offer.push(pool.splice(Math.floor(random(run) * pool.length), 1)[0]);
  if (offer.length < size) offer.push({ kind: "heal" });
  if (offer.length < size) offer.push({ kind: "gold" });
  return offer;
}

export function applyPick(run: Run, pick: Pick): void {
  switch (pick.kind) {
    case "weapon": {
      const owned = run.weapons.find((weapon) => weapon.id === pick.id);
      if (owned) owned.level = pick.level;
      else run.weapons.push({ id: pick.id, level: 1, cooldownLeft: 0, spin: 0 });
      break;
    }
    case "passive": {
      const before = run.numbers.maxHp;
      run.passives[pick.id] = pick.level;
      run.numbers = withPassives(run.base, run.passives);
      // More max hp comes with the hp to fill it.
      run.hero.hp += Math.max(0, run.numbers.maxHp - before);
      break;
    }
    case "heal":
      run.hero.hp = Math.min(run.numbers.maxHp, run.hero.hp + run.numbers.maxHp * HEAL_SHARE);
      break;
    case "gold":
      run.gold += GOLD_PICK;
      break;
  }
}
