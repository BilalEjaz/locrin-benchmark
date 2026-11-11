/** The stats every coworker has; the games turn them into numbers of their own (see `src/lib/hr/sim/`). */
export const STATS = ["grit", "output", "hustle", "focus", "luck"] as const;
/** grit: health. output: damage. hustle: move speed. focus: attack rate. luck: gold and better picks. */
export type Stat = (typeof STATS)[number];
export type Stats = Record<Stat, number>;

export const RARITIES = ["common", "uncommon", "rare", "legend"] as const;
export type Rarity = (typeof RARITIES)[number];

export const DEPARTMENT_IDS = ["engineering", "finance", "legal", "sales", "it", "hr", "interns"] as const;
export type DepartmentId = (typeof DEPARTMENT_IDS)[number];

/** A department's signature weapon in the hero run. */
export type WeaponId = "rubberDuck" | "spreadsheet" | "contract" | "businessCard" | "serverRack" | "policyBinder" | "stickyNotes";

export const QUIRK_IDS = [
  "caffeinated",
  "stealsLunches",
  "overachiever",
  "loyal",
  "networker",
  "nightOwl",
  "gymRegular",
  "perfectionist",
  "clockWatcher",
  "officeGossip",
  "unionRep",
  "coffeeSnob",
  "standingDesk",
] as const;
export type QuirkId = (typeof QUIRK_IDS)[number];

/**
 * What a quirk changes, in percent: a stat, or gold and XP earned, damage taken, the coworker's own chance to quit,
 * their colleagues' chance to quit, or their salary.
 */
export type Effect = Stat | "gold" | "xp" | "damageTaken" | "quitChance" | "teamQuitChance" | "salary";

/** Burned out can't be sent on a run until `until`; quit is for good. Days are the roster's `day`. */
export type Status = { kind: "active" } | { kind: "burnedOut"; until: number } | { kind: "quit"; day: number };

export interface Coworker {
  /** Unique within a save, never reused; also picks the face (see `rosterAppearance`). */
  id: number;
  name: string;
  department: DepartmentId;
  rarity: Rarity;
  quirks: QuirkId[];
  stats: Stats;
  level: number;
  xp: number;
  status: Status;
}

/** What the codex keeps of a coworker the player has seen, hired or not. */
export interface CodexEntry {
  id: number;
  name: string;
  department: DepartmentId;
  rarity: Rarity;
}

export interface RosterSave {
  /** The roster's own rng, for candidates; advances as they are drawn. */
  rng: number;
  nextId: number;
  day: number;
  /** Whether falling can make a coworker quit. Off until the HR loop exists. */
  stakes: boolean;
  /** Everyone ever hired, quit ones included (they leave a gap on the desk). */
  coworkers: Coworker[];
  codex: { coworkers: CodexEntry[]; quirks: QuirkId[] };
}
