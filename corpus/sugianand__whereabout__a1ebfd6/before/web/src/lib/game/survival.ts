/**
 * Survival: one photo after another, for as long as a 5,000-point health bar lasts.
 *
 * Every round is scored like a normal round (`scoreDistance`), and the points it missed take a
 * bite out of the bar: half of what the pin fell short of a perfect 5,000, so a guess in the
 * right region costs a few hundred points and one on the wrong continent costs over 2,000. A pin
 * within `HEAL_KM` of the answer bites nothing and heals `HEAL_POINTS` instead, up to the full
 * bar. The run ends on the round that empties the bar, or when every photo has been played.
 *
 * The rules live here as a pure reducer so they can be tested without a globe. The best run is
 * kept in this browser only, best effort: the most photos survived, then the most points.
 */

import { MAX_POINTS, haversineKm, scoreDistance, type LngLat } from "@/lib/geo";

export const SURVIVAL_HEALTH = 5000;
/** A pin this close to the answer heals instead of biting. */
export const HEAL_KM = 25;
export const HEAL_POINTS = 1000;
export const BEST_SURVIVAL_KEY = "whereabout:survival-best";

/** How much health a round of `score` points costs: half the points it missed. */
export function biteFor(score: number): number {
  return Math.round((MAX_POINTS - Math.min(MAX_POINTS, Math.max(0, score))) / 2);
}

/** What one round did to the bar. */
export interface SurvivalRound {
  distanceKm: number;
  score: number;
  /** Health before the round. */
  before: number;
  /** Health after it, never below 0 or above the full bar. */
  after: number;
  /** True when the pin landed within `HEAL_KM` and healed. */
  healed: boolean;
}

/** The outcome of a pin at `distanceKm` from the answer, with `health` left before it. */
export function survivalRound(distanceKm: number, health: number): SurvivalRound {
  const score = scoreDistance(distanceKm);
  const healed = distanceKm <= HEAL_KM;
  const after = healed
    ? Math.min(SURVIVAL_HEALTH, health + HEAL_POINTS)
    : Math.max(0, health - biteFor(score));
  return { distanceKm, score, before: health, after, healed };
}

interface Run {
  order: readonly string[];
  index: number;
  health: number;
  /** Points scored so far this run. */
  total: number;
  /** Photos played and lived through. */
  survived: number;
}

export type SurvivalState =
  | { phase: "idle" }
  | (Run & {
      /** Pinning photo `index`; `pin` is null until the first tap. */
      phase: "guessing";
      pin: LngLat | null;
    })
  | (Run & {
      /** The answer is shown. With the bar empty the run is over; otherwise it plays on. */
      phase: "answered";
      pin: LngLat;
      truth: LngLat;
      round: SurvivalRound;
    })
  | (Run & {
      /** Every photo played with health to spare. */
      phase: "cleared";
    });

export type SurvivalAction =
  | { type: "start"; order: readonly string[] }
  | { type: "pinned"; pin: LngLat }
  | { type: "answered"; truth: LngLat }
  | { type: "next" };

export const initialSurvival: SurvivalState = { phase: "idle" };

export function survivalReducer(state: SurvivalState, action: SurvivalAction): SurvivalState {
  switch (action.type) {
    case "start": {
      const run = { order: action.order, index: 0, health: SURVIVAL_HEALTH, total: 0, survived: 0 };
      return action.order.length === 0
        ? { phase: "cleared", ...run }
        : { phase: "guessing", ...run, pin: null };
    }
    case "pinned":
      return state.phase === "guessing" ? { ...state, pin: action.pin } : state;
    case "answered": {
      if (state.phase !== "guessing" || !state.pin) return state;
      const round = survivalRound(haversineKm(state.pin, action.truth), state.health);
      return {
        phase: "answered",
        order: state.order,
        index: state.index,
        health: round.after,
        total: state.total + round.score,
        survived: state.survived + (round.after > 0 ? 1 : 0),
        pin: state.pin,
        truth: action.truth,
        round,
      };
    }
    case "next": {
      // With the bar empty the run is over; only a new "start" plays on.
      if (state.phase !== "answered" || state.health <= 0) return state;
      const { order, health, total, survived } = state;
      const index = state.index + 1;
      if (index >= order.length) return { phase: "cleared", order, index, health, total, survived };
      return { phase: "guessing", order, index, health, total, survived, pin: null };
    }
  }
}

/** True once the run has ended, by emptying the bar or by playing every photo. */
export function survivalOver(state: SurvivalState): boolean {
  return state.phase === "cleared" || (state.phase === "answered" && state.health <= 0);
}

/** A finished (or interrupted) run, as kept for the best. */
export interface SurvivalBest {
  survived: number;
  total: number;
}

/** True when `a` is a better run than `b`: more photos survived, then more points. */
export function betterRun(a: SurvivalBest, b: SurvivalBest | null): boolean {
  if (!b) return a.survived > 0 || a.total > 0;
  return a.survived > b.survived || (a.survived === b.survived && a.total > b.total);
}

function storage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

function whole(n: unknown): n is number {
  return typeof n === "number" && Number.isInteger(n) && n >= 0;
}

/** The best run this browser has kept, or null when none is stored or it can't be read. */
export function loadBestSurvival(): SurvivalBest | null {
  try {
    const raw = storage()?.getItem(BEST_SURVIVAL_KEY);
    if (!raw) return null;
    const value: unknown = JSON.parse(raw);
    if (typeof value !== "object" || value === null) return null;
    const { survived, total } = value as Record<string, unknown>;
    return whole(survived) && whole(total) ? { survived, total } : null;
  } catch {
    return null;
  }
}

/**
 * Keep `run` if it beats the stored best, and return the best after that. Called after every
 * round, so a player who leaves mid-run keeps how far they got.
 */
export function rememberSurvival(run: SurvivalBest): SurvivalBest | null {
  const best = loadBestSurvival();
  if (!betterRun(run, best)) return best;
  try {
    storage()?.setItem(BEST_SURVIVAL_KEY, JSON.stringify(run));
  } catch {
    // Private mode or full storage: the run still counts for this visit.
  }
  return run;
}
