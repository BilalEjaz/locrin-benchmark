import { beforeEach, describe, expect, it, vi } from "vitest";

import { haversineKm, scoreDistance } from "@/lib/geo";

import {
  BEST_SURVIVAL_KEY,
  HEAL_KM,
  HEAL_POINTS,
  SURVIVAL_HEALTH,
  betterRun,
  biteFor,
  initialSurvival,
  loadBestSurvival,
  rememberSurvival,
  survivalOver,
  survivalReducer,
  survivalRound,
  type SurvivalAction,
  type SurvivalState,
} from "./survival";

const PARIS = { lng: 2.35, lat: 48.86 };
const LYON = { lng: 4.84, lat: 45.76 };
const SYDNEY = { lng: 151.21, lat: -33.87 };
const NEAR_PARIS = { lng: 2.45, lat: 48.9 }; // under 10 km away

function play(actions: SurvivalAction[], from: SurvivalState = initialSurvival): SurvivalState {
  return actions.reduce(survivalReducer, from);
}

const start: SurvivalAction = { type: "start", order: ["a", "b", "c"] };
const guess = (pin: typeof PARIS): SurvivalAction[] => [
  { type: "pinned", pin },
  { type: "answered", truth: PARIS },
];

describe("biteFor", () => {
  it("costs half the points a round missed", () => {
    expect(biteFor(5000)).toBe(0);
    expect(biteFor(0)).toBe(2500);
    expect(biteFor(4000)).toBe(500);
    expect(biteFor(3333)).toBe(834);
  });

  it("never bites below nothing or past half the bar", () => {
    expect(biteFor(6000)).toBe(0);
    expect(biteFor(-10)).toBe(2500);
  });
});

describe("survivalRound", () => {
  it("bites by the round's own score", () => {
    const km = haversineKm(LYON, PARIS);
    const round = survivalRound(km, SURVIVAL_HEALTH);
    expect(round.score).toBe(scoreDistance(km));
    expect(round.after).toBe(SURVIVAL_HEALTH - biteFor(round.score));
    expect(round.healed).toBe(false);
  });

  it(`heals ${HEAL_POINTS} for a pin within ${HEAL_KM} km, up to the full bar`, () => {
    expect(survivalRound(HEAL_KM, 3000)).toMatchObject({ healed: true, after: 3000 + HEAL_POINTS });
    expect(survivalRound(0, 4500)).toMatchObject({ healed: true, after: SURVIVAL_HEALTH });
    expect(survivalRound(HEAL_KM + 0.1, 3000).healed).toBe(false);
  });

  it("never takes the bar below zero", () => {
    expect(survivalRound(20000, 1000)).toMatchObject({ before: 1000, after: 0 });
  });
});

describe("survivalReducer", () => {
  it("starts on the first photo with a full bar", () => {
    expect(play([start])).toEqual({
      phase: "guessing",
      order: ["a", "b", "c"],
      index: 0,
      health: SURVIVAL_HEALTH,
      total: 0,
      survived: 0,
      pin: null,
    });
  });

  it("has nothing to play without photos", () => {
    const state = play([{ type: "start", order: [] }]);
    expect(state.phase).toBe("cleared");
    expect(survivalOver(state)).toBe(true);
  });

  it("needs a pin before the answer", () => {
    const before = play([start]);
    expect(survivalReducer(before, { type: "answered", truth: PARIS })).toBe(before);
  });

  it("takes a bite for a miss and plays on", () => {
    const state = play([start, ...guess(LYON)]);
    const round = survivalRound(haversineKm(LYON, PARIS), SURVIVAL_HEALTH);
    expect(state).toMatchObject({
      phase: "answered",
      health: round.after,
      total: round.score,
      survived: 1,
      round,
    });
    expect(survivalOver(state)).toBe(false);
    expect(play([{ type: "next" }], state)).toMatchObject({
      phase: "guessing",
      index: 1,
      health: round.after,
      pin: null,
    });
  });

  it("heals a close pin back towards the full bar", () => {
    const hurt = play([start, ...guess(SYDNEY), { type: "next" }]);
    expect(hurt.phase === "guessing" && hurt.health).toBe(SURVIVAL_HEALTH - biteFor(0));
    const healed = play(guess(NEAR_PARIS), hurt);
    expect(healed).toMatchObject({
      round: { healed: true },
      health: SURVIVAL_HEALTH - biteFor(0) + HEAL_POINTS,
    });
  });

  it("ends on the round that empties the bar, which does not count as survived", () => {
    // Sydney is about as far from Paris as the globe allows: each miss bites 2,500.
    const first = play([start, ...guess(SYDNEY), { type: "next" }]);
    const over = play(guess(SYDNEY), first);
    expect(over).toMatchObject({ phase: "answered", health: 0, survived: 1 });
    expect(survivalOver(over)).toBe(true);
    expect(survivalReducer(over, { type: "next" })).toBe(over);
  });

  it("clears once every photo is played with health left", () => {
    const one: SurvivalAction = { type: "start", order: ["a"] };
    const state = play([one, ...guess(NEAR_PARIS), { type: "next" }]);
    expect(state).toMatchObject({ phase: "cleared", survived: 1, health: SURVIVAL_HEALTH });
    expect(survivalOver(state)).toBe(true);
  });

  it("ignores pins once the answer is shown", () => {
    const answered = play([start, ...guess(LYON)]);
    expect(survivalReducer(answered, { type: "pinned", pin: SYDNEY })).toBe(answered);
  });
});

describe("the best run", () => {
  beforeEach(() => localStorage.clear());

  it("ranks by photos survived, then points", () => {
    expect(betterRun({ survived: 3, total: 100 }, { survived: 2, total: 9000 })).toBe(true);
    expect(betterRun({ survived: 2, total: 9001 }, { survived: 2, total: 9000 })).toBe(true);
    expect(betterRun({ survived: 2, total: 9000 }, { survived: 2, total: 9000 })).toBe(false);
    expect(betterRun({ survived: 0, total: 0 }, null)).toBe(false);
  });

  it("is kept only when beaten", () => {
    expect(loadBestSurvival()).toBeNull();
    expect(rememberSurvival({ survived: 4, total: 12000 })).toEqual({ survived: 4, total: 12000 });
    expect(rememberSurvival({ survived: 3, total: 15000 })).toEqual({ survived: 4, total: 12000 });
    expect(loadBestSurvival()).toEqual({ survived: 4, total: 12000 });
  });

  it("reads nothing from a value it did not write", () => {
    for (const raw of ["7", "not json", '{"survived":-1,"total":3}', '{"survived":2.5}']) {
      localStorage.setItem(BEST_SURVIVAL_KEY, raw);
      expect(loadBestSurvival()).toBeNull();
    }
  });

  it("still returns the run when storage refuses it", () => {
    const setItem = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota");
    });
    expect(rememberSurvival({ survived: 1, total: 4000 })).toEqual({ survived: 1, total: 4000 });
    setItem.mockRestore();
  });
});
