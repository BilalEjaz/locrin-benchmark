/*
 * The hero run's simulation types.
 *
 * As in Tower and Kingsroad, a run is one mutable object stepped in place on a fixed tick, and everything random
 * goes through `run.rng`, so a run replays exactly from its seed and the same inputs. It is plain JSON on purpose:
 * the page saves it as it goes and picks it up again (see `snapshot.ts`).
 */
import type { WeaponId } from "@/lib/roster/types";

export type { WeaponId };

export type FoeKind = "replyAll" | "mondayBlob" | "meetingInvite" | "printerJam" | "middleManager" | "lunchMonitor" | "auditor" | InterviewBoss;

/** What hurt the hero: a foe, or a hazard of the stage. */
export type Source = FoeKind | "microwave";

/** Where a day is spent: the open space everyone starts in, then areas with a hazard of their own. */
export type Stage = "openSpace" | "kitchen";

/** Something fixed to the floor of a stage: a coffee spill that slows the hero, a microwave that fires rings. */
export interface Hazard {
  kind: "spill" | "microwave";
  x: number;
  y: number;
  radius: number;
  /** Seconds until a microwave fires. */
  timer: number;
}

/** The monsters a new hire has to beat before they join: a charging lead, an HR manager, a recruiter. */
export type InterviewBoss = "teamLead" | "hrManager" | "recruiter";

/** A run that is an interview, not a day: beat `boss` to hire the card `candidateId`. */
export interface Interview {
  boss: InterviewBoss;
  candidateId: number;
}

export type PassiveId = "coffee" | "gym" | "sneakers" | "lanyard" | "mentor" | "ergoChair" | "powerTie";

export type Status = "playing" | "won" | "lost";

/** The stick: a direction, at most length 1. */
export interface Input {
  dx: number;
  dy: number;
}

/** What the hero's stats and passives come to; recomputed whenever a passive is picked. */
export interface HeroNumbers {
  maxHp: number;
  /** World units per second. */
  speed: number;
  damage: number;
  /** Multiplies every weapon's cooldown; below 1 is faster. */
  cooldown: number;
  /** Gems inside this radius fly to the hero. */
  magnet: number;
  xp: number;
  gold: number;
  /** Multiplies damage the hero takes. */
  taken: number;
}

export interface Hero {
  x: number;
  y: number;
  hp: number;
  /** The last way the hero moved, for weapons that throw forward and for the sprite. */
  faceX: number;
  faceY: number;
  /** Seconds left on the hit flash. */
  hurt: number;
}

export interface OwnedWeapon {
  id: WeaponId;
  level: number;
  /** Seconds until it fires again. */
  cooldownLeft: number;
  /** Angle of the first orbiter, for the rubber duck. */
  spin: number;
}

export interface Foe {
  id: number;
  kind: FoeKind;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  radius: number;
  speed: number;
  /** Damage per second while touching the hero. */
  touch: number;
  xp: number;
  gold: number;
  /** Knockback velocity, which fades. */
  pushX: number;
  pushY: number;
  /** Fraction of speed lost to the contract's fine print; set each tick it is inside. */
  slow: number;
  /** Seconds to its next summon, shot or charge. */
  timer: number;
  /** How many times the timer has gone off. */
  cycles: number;
  /** Seconds left on a charge, for the middle manager. */
  charge: number;
  chargeX: number;
  chargeY: number;
  /** Seconds until a rubber duck may hit it again. */
  duckCooldown: number;
  /** Seconds left on its hit flash. */
  hurt: number;
}

/** Something the hero's weapons have let fly. */
export interface Shot {
  id: number;
  weapon: WeaponId;
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  damage: number;
  /** Seconds before it drops. */
  life: number;
  /** Foes it may still pass through; it is spent at 0. */
  pierce: number;
  /** A homing shot follows this foe; 0 once it's gone. */
  targetId: number;
  hitIds: number[];
}

/** A server rack on its way down: it lands after `delay` and hits everything under it. */
export interface Drop {
  id: number;
  x: number;
  y: number;
  delay: number;
  radius: number;
  damage: number;
}

/** Toner from a printer jam or red tape from the auditor, flying at the hero. */
export interface FoeShot {
  id: number;
  from: Source;
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  damage: number;
  life: number;
}

export interface Gem {
  id: number;
  x: number;
  y: number;
  value: number;
  /** Flying to the hero once caught by the magnet. */
  pulled: boolean;
}

/** Something only the renderer cares about: a swing, a blast, a pop. */
export interface Effect {
  kind: "swing" | "blast" | "pop";
  x: number;
  y: number;
  radius: number;
  age: number;
  life: number;
}

/** One of the three offers at a level-up. */
export type Pick =
  | { kind: "weapon"; id: WeaponId; level: number }
  | { kind: "passive"; id: PassiveId; level: number }
  | { kind: "heal" }
  | { kind: "gold" };

export interface Run {
  /** Bump when the shape changes, so an old snapshot is thrown away rather than misread. */
  version: number;
  seed: number;
  rng: number;
  coworkerId: number;
  /** Multiplies foes' hp and (by half) their spawns; 1 on a coworker's first day. */
  difficulty: number;
  /** Set when the run is an interview: no review, no day, and the boss is the only goal. */
  interview: Interview | null;
  stage: Stage;
  hazards: Hazard[];
  status: Status;
  /** Seconds played; the clock stops while a pick is waiting. */
  time: number;
  /** What the coworker's stats and quirks give, before passives. */
  base: HeroNumbers;
  /** `base` with the passives on. */
  numbers: HeroNumbers;
  hero: Hero;
  weapons: OwnedWeapon[];
  passives: Partial<Record<PassiveId, number>>;
  level: number;
  xp: number;
  /** The offer the player must choose from before the run goes on; null while playing. */
  picks: Pick[] | null;
  /** Level-ups still owed an offer after this one. */
  queuedPicks: number;
  /** Fractional spawns carried between ticks. */
  spawnDebt: number;
  /** Seconds until the next printer jam may be placed. */
  printerIn: number;
  miniBossDone: boolean;
  bossDone: boolean;
  foes: Foe[];
  shots: Shot[];
  drops: Drop[];
  foeShots: FoeShot[];
  gems: Gem[];
  effects: Effect[];
  nextId: number;
  kills: number;
  gold: number;
  /** Damage dealt by each weapon, for the bot's report. */
  dealt: Partial<Record<WeaponId, number>>;
  /** Damage the hero took from each kind of foe, for the bot's report and "what wore me down". */
  takenFrom: Partial<Record<Source, number>>;
  /** The last thing that hurt the hero, for "how did I die". */
  lastHitBy: Source | null;
  abandoned: boolean;
}
