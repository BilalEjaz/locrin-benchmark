/*
 * Every number the hero run is tuned by. Change them here and check with the bot:
 * `scripts/hr/playthrough.ts` (usage in its header).
 */
import type { Effect as QuirkEffect, PerkId, Stat } from "@/lib/roster/types";
import type { FoeKind, HeroNumbers, InterviewBoss, PassiveId, Stage, WeaponId } from "./types";

/** A walled office floor, about 3 by 3 phone screens. */
export const ARENA = { width: 1400, height: 1400 } as const;

export const HERO_RADIUS = 12;
/** A coworker with every stat at 10 plays with these. */
export const HERO_BASE: HeroNumbers = { maxHp: 100, speed: 120, damage: 1, cooldown: 1, magnet: 80, xp: 1, gold: 1, taken: 1 };
/** Each stat point above or below 10 moves its number by this fraction. */
export const STAT_STEP = 0.05;
/** Which hero number each stat moves; focus shortens the cooldown, so it divides. */
export const STAT_NUMBER: Readonly<Record<Stat, keyof HeroNumbers>> = {
  grit: "maxHp",
  output: "damage",
  hustle: "speed",
  focus: "cooldown",
  luck: "gold",
};
/** Which hero number each quirk effect moves, in percent. Quit chances and salary are not the run's business. */
export const QUIRK_NUMBER: Readonly<Partial<Record<QuirkEffect, keyof HeroNumbers>>> = {
  ...STAT_NUMBER,
  gold: "gold",
  xp: "xp",
  damageTaken: "taken",
};

export const HURT_FLASH = 0.15;
export const FOE_HURT_FLASH = 0.1;

// ---- The clock ---------------------------------------------------------------------------------------------------

export const MINI_BOSS_AT = 150;
export const BOSS_AT = 300;
/** If the auditor still stands at this time, the audit closes and the run is lost. */
export const AUDIT_CLOSES = 450;

/** Foes per second at `time` seconds; halved while the auditor is out. */
export function spawnRate(time: number): number {
  return 0.8 + time / 30;
}

/** Foes get tougher as the run goes on. Bosses are not scaled. */
export function hpScale(time: number): number {
  return 1 + time / 100;
}

export function touchScale(time: number): number {
  return 1 + time / 300;
}

/** The mix of the horde by time: from `from` seconds on, a kind is drawn with this weight. */
export const MIX: readonly { kind: FoeKind; from: number; weight: number }[] = [
  { kind: "replyAll", from: 0, weight: 10 },
  { kind: "mondayBlob", from: 75, weight: 2 },
  { kind: "meetingInvite", from: 90, weight: 1 },
];

export const PRINTER_FROM = 120;
export const PRINTER_EVERY = 25;
export const MAX_PRINTERS = 3;

/** New foes appear this far from the hero: just off a phone screen. */
export const SPAWN_DISTANCE = { min: 460, max: 520 } as const;

export const MAX_FOES = 300;
export const MAX_SHOTS = 200;
/** Past this many gems, the oldest is folded into the next oldest. */
export const MAX_GEMS = 150;

/** Cell size of the collision grid. */
export const GRID_CELL = 64;

// ---- Foes --------------------------------------------------------------------------------------------------------

export interface FoeDef {
  hp: number;
  radius: number;
  speed: number;
  touch: number;
  xp: number;
  gold: number;
  /** Seconds between summons, shots or charges; 0 for none. */
  every: number;
  /** Bosses keep their hp whatever the time. */
  boss: boolean;
}

export const FOES: Readonly<Record<FoeKind, FoeDef>> = {
  /** A swarm: weak, quick, many. */
  replyAll: { hp: 5, radius: 8, speed: 70, touch: 10, xp: 1, gold: 0.1, every: 0, boss: false },
  /** A slow tank. */
  mondayBlob: { hp: 30, radius: 16, speed: 38, touch: 18, xp: 4, gold: 0.5, every: 0, boss: false },
  /** Calls more reply-alls into the meeting. */
  meetingInvite: { hp: 30, radius: 11, speed: 45, touch: 10, xp: 3, gold: 0.4, every: 6, boss: false },
  /** Does not move, blocks the hero, and spits toner. */
  printerJam: { hp: 60, radius: 16, speed: 0, touch: 6, xp: 5, gold: 1, every: 3.5, boss: false },
  /** The mini-boss: walks, then charges at where the hero is. */
  middleManager: { hp: 1000, radius: 22, speed: 55, touch: 30, xp: 60, gold: 25, every: 4, boss: true },
  /** The kitchen's mini-boss: charges like the middle manager, a little quicker and tougher. */
  lunchMonitor: { hp: 1300, radius: 21, speed: 60, touch: 30, xp: 70, gold: 30, every: 3.5, boss: true },
  /** The boss: rings of red tape and a reply-all chain now and then. */
  auditor: { hp: 7000, radius: 28, speed: 45, touch: 40, xp: 0, gold: 100, every: 3, boss: true },
  /** Interview bosses (hp before the coworker's difficulty). A lead who charges often and hard. */
  teamLead: { hp: 1500, radius: 22, speed: 60, touch: 28, xp: 0, gold: 0, every: 2.6, boss: true },
  /** Throws paperwork in fans, and now and then a ring of it. */
  hrManager: { hp: 600, radius: 24, speed: 55, touch: 25, xp: 0, gold: 0, every: 2.2, boss: true },
  /** Keeps calling in clones. */
  recruiter: { hp: 1700, radius: 20, speed: 50, touch: 20, xp: 0, gold: 0, every: 3.5, boss: true },
};

/** The interview: a short fight against one boss, with a thin horde around it. */
export const INTERVIEW = {
  /** The boss walks in at this time. */
  bossAt: 4,
  /** If the boss still stands at this time, the interview is over. */
  closesAt: 150,
  /** Foes per second, flat; only `bossOutShare` of it while the boss is out, so the fight is about the boss. */
  spawnRate: 1.6,
  bossOutShare: 0.3,
} as const;

export const INTERVIEW_BOSSES: readonly InterviewBoss[] = ["teamLead", "hrManager", "recruiter"];

/** The boss a card's interview is, fixed by its id so a retry is the same fight. */
export function interviewBossFor(candidateId: number): InterviewBoss {
  return INTERVIEW_BOSSES[candidateId % INTERVIEW_BOSSES.length];
}

/** The HR manager throws a fan of this many sheets at the hero, and every `ringEvery` fans a ring of `ring`. */
export const PAPERWORK = { speed: 120, radius: 6, damage: 9, life: 5, fan: 5, spread: 0.22, ringEvery: 3, ring: 10 } as const;
/** Clones a recruiter calls in at a time. */
export const RECRUITER_CLONES = 5;
/** The team lead's charge: the middle manager's, but quicker. */
export const LEAD_CHARGE = { seconds: 0.8, speed: 3 } as const;

/** Reply-alls a meeting invite calls in at a time. */
export const INVITE_SUMMONS = 3;
export const PRINTER_RANGE = 280;
export const TONER = { speed: 150, radius: 6, damage: 8, life: 3 } as const;
export const CHARGE = { seconds: 1, speed: 2.4 } as const;
export const RED_TAPE = { count: 12, speed: 140, radius: 7, damage: 14, life: 5 } as const;
/** Every this many rings, the auditor also cc's a chain of reply-alls. */
export const AUDITOR_SUMMON_EVERY = 3;
export const AUDITOR_SUMMONS = 6;
/** Knockback speed fades by this fraction per second. */
export const PUSH_FADE = 8;
/** Bosses only take this share of knockback. */
export const BOSS_PUSH = 0.15;

// ---- Weapons -----------------------------------------------------------------------------------------------------

/**
 * How a weapon fights. `homing`: shots that follow a foe. `pierce`: thrown at the nearest foe, through several.
 * `drop`: lands on a foe after a delay and hits all around. `swing`: hits and knocks back everything close.
 * `orbit`: circles the hero. `aura`: hurts and slows everything close, on a tick. `fan`: a spread thrown forward.
 */
export type Pattern = "homing" | "pierce" | "drop" | "swing" | "orbit" | "aura" | "fan";

export interface WeaponNumbers {
  cooldown: number;
  damage: number;
  count: number;
  pierce: number;
  /** Shot size, blast radius, swing reach or orbit distance. */
  radius: number;
  /** Shot speed, or the orbit's turn in radians per second. */
  speed: number;
  /** Shot lifetime, or a drop's delay. */
  life: number;
  knockback: number;
  slow: number;
}

const NONE: WeaponNumbers = { cooldown: 1, damage: 0, count: 1, pierce: 1, radius: 0, speed: 0, life: 1, knockback: 0, slow: 0 };

export interface WeaponDef {
  pattern: Pattern;
  base: WeaponNumbers;
  /** Added per level past the first; counts and pierce are floored when used. */
  perLevel: Partial<WeaponNumbers>;
}

const weapon = (pattern: Pattern, base: Partial<WeaponNumbers>, perLevel: Partial<WeaponNumbers>): WeaponDef => ({
  pattern,
  base: { ...NONE, ...base },
  perLevel,
});

export const WEAPONS: Readonly<Record<WeaponId, WeaponDef>> = {
  stickyNotes: weapon("homing", { cooldown: 0.55, damage: 8, radius: 5, speed: 320, life: 1.5 }, { damage: 3, count: 0.6, cooldown: -0.03, pierce: 0.3 }),
  spreadsheet: weapon("pierce", { cooldown: 1.1, damage: 16, pierce: 4, radius: 8, speed: 260, life: 1.6 }, { damage: 5, pierce: 1, count: 0.34 }),
  serverRack: weapon("drop", { cooldown: 2.2, damage: 22, radius: 45, life: 0.6 }, { damage: 7, radius: 4, cooldown: -0.15, count: 0.3 }),
  policyBinder: weapon("swing", { cooldown: 1, damage: 12, radius: 55, knockback: 260 }, { damage: 4, radius: 6, cooldown: -0.05 }),
  rubberDuck: weapon("orbit", { damage: 8, radius: 60, speed: 3, life: 0.4 }, { damage: 3, radius: 3, count: 1 }),
  contract: weapon("aura", { cooldown: 0.5, damage: 4, radius: 50, slow: 0.3 }, { damage: 2, radius: 8, slow: 0.03 }),
  businessCard: weapon("fan", { cooldown: 1.1, damage: 10, count: 3, pierce: 1, radius: 5, speed: 300, life: 1.2 }, { damage: 3, count: 0.5, pierce: 0.2 }),
};

export const WEAPON_IDS = Object.keys(WEAPONS) as WeaponId[];
export const MAX_WEAPON_LEVEL = 6;
export const MAX_WEAPONS = 4;
/** Angle between two cards of a fan, in radians. */
export const FAN_SPREAD = 0.22;
/** A server rack lands on a foe within this reach of the hero, or in front of them. */
export const DROP_REACH = 300;
/** Size of a rubber duck. */
export const DUCK_RADIUS = 9;
/** Floor for any weapon's cooldown, in seconds. */
export const MIN_COOLDOWN = 0.15;

export function weaponNumbers(id: WeaponId, level: number): WeaponNumbers {
  const { base, perLevel } = WEAPONS[id];
  const numbers = { ...base };
  for (const key of Object.keys(perLevel) as (keyof WeaponNumbers)[]) numbers[key] += perLevel[key]! * (level - 1);
  numbers.count = Math.floor(numbers.count);
  numbers.pierce = Math.floor(numbers.pierce);
  return numbers;
}

// ---- Passives ----------------------------------------------------------------------------------------------------

/** Each level multiplies one hero number by (1 + `per`). */
export const PASSIVES: Readonly<Record<PassiveId, { number: keyof HeroNumbers; per: number }>> = {
  coffee: { number: "cooldown", per: -0.08 },
  gym: { number: "maxHp", per: 0.15 },
  sneakers: { number: "speed", per: 0.08 },
  lanyard: { number: "magnet", per: 0.3 },
  mentor: { number: "xp", per: 0.1 },
  ergoChair: { number: "taken", per: -0.08 },
  powerTie: { number: "damage", per: 0.1 },
};

export const PASSIVE_IDS = Object.keys(PASSIVES) as PassiveId[];
export const MAX_PASSIVE_LEVEL = 5;
export const MAX_PASSIVES = 4;

// ---- Levels and pickups ------------------------------------------------------------------------------------------

export const PICKS_OFFERED = 3;

/** Perks: each starts a run with a passive at level 1 (these), or changes the run in a way noted at its use. */
export const PERK_PASSIVE: Readonly<Partial<Record<PerkId, PassiveId>>> = {
  coffeeRun: "coffee",
  gymPass: "gym",
  freshSneakers: "sneakers",
  mentorship: "mentor",
};
/** The second wind: the hero gets up with this share of max hp, and cannot be hurt for `grace` seconds. */
export const SECOND_WIND = { hp: 0.4, grace: 2 } as const;

/** XP from `level` to the next. */
export function xpToNext(level: number): number {
  return 5 + level * 5;
}

/** The heal offered when nothing else is left, as a share of max hp. */
export const HEAL_SHARE = 0.3;
/** Gold offered when nothing else is left. */
export const GOLD_PICK = 10;
/** Speed of a gem flying to the hero. */
export const GEM_PULL = 320;
export const GEM_RADIUS = 5;

// ---- The career (between runs) -----------------------------------------------------------------------------------

/**
 * One run is one day. A run ends in a performance review: review XP from the time survived (and a bonus for beating
 * the auditor) raises the coworker's career level, and each level adds a stat point (the same cycle for everyone).
 * Every `levelsPerRank` levels is a promotion. Foes get tougher with the level so growth doesn't make runs trivial.
 * Aim: about a week of runs to the first promotion, about a month to Senior.
 */
export const REVIEW = {
  /** One review XP per this many seconds survived. */
  secondsPerXp: 5,
  /** Extra XP for beating the auditor. */
  winBonus: 50,
  /** XP from level L to the next: `toNextBase + toNextPerLevel * L`. */
  toNextBase: 60,
  toNextPerLevel: 20,
  levelsPerRank: 5,
  /** Extra points in each of grit, output and focus at a promotion. */
  promotionBonus: 1,
  /** A promotion lets the player pick one of this many perks (see `PERK_IDS`). */
  perksOffered: 3,
  /** Foes' hp (bosses too) grows by this fraction per career level past the first; spawns by half of it. */
  difficultyPerLevel: 0.06,
} as const;

/**
 * Packs: gold buys one new coworker card, rolled with the roster's rarity odds. Aim: a pack about every three runs.
 * A card's rarity gives it bonus stat points (see `RARITY`), so it also faces a tougher office: each bonus point past a
 * common's counts as `rarityLevels` career levels of difficulty. A lucky pull is stronger, not a walkover.
 */
export const PACKS = { price: 1200, rarityLevels: 1 } as const;

// ---- Stages ------------------------------------------------------------------------------------------------------

export interface StageDef {
  /** The career level a coworker needs to be sent here. */
  unlockLevel: number;
  /** Multiplies the coworker's difficulty. */
  difficulty: number;
  /** Multiply the gold from foes and the review XP from the run, so a harder stage pays. */
  gold: number;
  xp: number;
  /** Comes in place of the middle manager at `MINI_BOSS_AT`. */
  miniBoss: FoeKind;
}

export const STAGES: Readonly<Record<Stage, StageDef>> = {
  openSpace: { unlockLevel: 1, difficulty: 1, gold: 1, xp: 1, miniBoss: "middleManager" },
  kitchen: { unlockLevel: 6, difficulty: 1.05, gold: 1.25, xp: 1.2, miniBoss: "lunchMonitor" },
};

export const STAGE_IDS = Object.keys(STAGES) as Stage[];

/** The kitchen: coffee spills that slow the hero (not the foes), and microwaves in the corners firing rings. */
export const KITCHEN = {
  spills: 9,
  spillRadius: 40,
  /** The share of speed lost standing in a spill. */
  spillSlow: 0.35,
  /** No spill lands this close to where the hero starts. */
  clearRadius: 170,
  microwaves: 2,
  microwaveEvery: 5,
  microwaveRadius: 18,
  /** Shots in a ring; each ring is turned a little from the last so the gaps move. */
  ring: 8,
  shot: { speed: 130, radius: 6, damage: 10, life: 4 },
} as const;

/**
 * What each perk adds to the difficulty its coworker faces (like extra rarity), so a perk is power, not a free win. Set
 * from the bot: alone at level 6, the strong ones (overtime, corner office) won about 10 points more than the rest.
 */
export const PERK_DIFFICULTY: Readonly<Record<PerkId, number>> = {
  coffeeRun: 0.22,
  gymPass: 0.17,
  freshSneakers: 0.12,
  mentorship: 0.18,
  overtime: 0.45,
  cornerOffice: 0.38,
  secondWind: 0.24,
};
