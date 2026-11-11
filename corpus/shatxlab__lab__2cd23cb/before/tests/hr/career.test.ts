import { describe, expect, it } from "vitest";

import { defaultCareer, difficultyFor, hire, interviewDifficultyFor, normalizeCareer, openPack, rankOf, review, reviewXp, reviewXpToNext } from "@/lib/hr/career";
import { interviewBossFor, INTERVIEW_BOSSES, PACKS, REVIEW } from "@/lib/hr/sim/balance";
import { createRun } from "@/lib/hr/sim/run";
import { starters } from "@/lib/roster/generate";
import { defaultSave } from "@/lib/roster/save";
import { STATS } from "@/lib/roster/types";

const total = (stats: Record<string, number>) => Object.values(stats).reduce((sum, value) => sum + value, 0);

describe("reviewXp", () => {
  it("pays for time survived and the win, and nothing for walking out at once", () => {
    expect(reviewXp(0, false)).toBe(0);
    expect(reviewXp(180, false)).toBe(36);
    expect(reviewXp(360, true)).toBe(72 + REVIEW.winBonus);
  });
});

describe("review", () => {
  const [coworker] = starters();

  it("adds XP without a level while short of the next", () => {
    const result = review(coworker, 10);
    expect(result.coworker).toMatchObject({ level: 1, xp: 10, stats: coworker.stats });
    expect(result.levelsGained).toBe(0);
    expect(result.promoted).toBe(false);
  });

  it("grants a stat point per level, in the same order for every department, and carries the leftover XP over", () => {
    const result = review(coworker, reviewXpToNext(1) + 5);
    expect(result.coworker).toMatchObject({ level: 2, xp: 5 });
    expect(result.levelsGained).toBe(1);
    expect(result.coworker.stats.output).toBe(coworker.stats.output + 1);
    const other = starters()[1];
    expect(review(other, reviewXpToNext(1)).coworker.stats.output).toBe(other.stats.output + 1);
    expect(total(result.coworker.stats)).toBe(total(coworker.stats) + 1);
  });

  it("can gain several levels at once, and promotes at the rank boundary with a bonus", () => {
    let need = 0;
    for (let level = 1; level < REVIEW.levelsPerRank + 1; level += 1) need += reviewXpToNext(level);
    const result = review(coworker, need);
    expect(result.coworker.level).toBe(REVIEW.levelsPerRank + 1);
    expect(result.promoted).toBe(true);
    expect(total(result.coworker.stats)).toBe(total(coworker.stats) + REVIEW.levelsPerRank + 3 * REVIEW.promotionBonus);
    expect(rankOf(result.coworker.level)).toBe(1);
  });

  it("leaves the original coworker alone and keeps stats under the cap", () => {
    const capped = { ...coworker, stats: Object.fromEntries(STATS.map((stat) => [stat, 99])) as typeof coworker.stats };
    const result = review(capped, 5000);
    expect(Object.values(result.coworker.stats).every((value) => value === 99)).toBe(true);
    expect(coworker.level).toBe(1);
  });
});

describe("career pace", () => {
  it("takes about a week of average runs to the first promotion", () => {
    let need = 0;
    for (let level = 1; level <= REVIEW.levelsPerRank; level += 1) need += reviewXpToNext(level);
    const average = (reviewXp(180, false) + reviewXp(360, true)) / 2;
    expect(need / average).toBeGreaterThan(5);
    expect(need / average).toBeLessThan(10);
  });
});

describe("difficulty", () => {
  it("starts at 1 and toughens foes in a run", () => {
    expect(difficultyFor(1)).toBe(1);
    expect(difficultyFor(11)).toBeGreaterThan(difficultyFor(6));
    expect(difficultyFor(1, "legend")).toBeGreaterThan(difficultyFor(1, "rare"));
    expect(difficultyFor(1, "rare")).toBeGreaterThan(difficultyFor(1, "uncommon"));
    expect(difficultyFor(1, "uncommon")).toBeGreaterThan(difficultyFor(1, "common"));
    expect(difficultyFor(1, "common")).toBe(1);
    expect(createRun(starters()[0], 1, 1.5).difficulty).toBe(1.5);
    expect(createRun(starters()[0], 1).difficulty).toBe(1);
  });
});

describe("normalizeCareer", () => {
  it("repairs what it can and defaults the rest", () => {
    expect(normalizeCareer(null)).toEqual(defaultCareer());
    expect(normalizeCareer({ focusId: 2.7, gold: -5 })).toEqual({ focusId: 2, owned: [2], sealed: [], gold: 0 });
    expect(normalizeCareer({ focusId: "x", gold: 12 })).toEqual({ focusId: null, owned: [], sealed: [], gold: 12 });
  });

  it("keeps sealed cards apart from owned ones", () => {
    expect(normalizeCareer({ focusId: 1, owned: [1, 4], sealed: [4, 5, 5, "x"], gold: 0 })).toEqual({ focusId: 1, owned: [1, 4], sealed: [5], gold: 0 });
  });

  it("always owns the focus, once, and drops bad ids", () => {
    expect(normalizeCareer({ focusId: 3, owned: [5, 3, "x", 5, -1], gold: 0 }).owned).toEqual([3, 5]);
  });
});

describe("openPack", () => {
  it("refuses without the gold", () => {
    expect(openPack(defaultSave(1), { focusId: 1, owned: [1], sealed: [], gold: PACKS.price - 1 })).toBeNull();
  });

  it("spends the price and adds a new level 1 card to the roster and the codex, sealed until its interview", () => {
    const roster = defaultSave(1);
    const bought = openPack(roster, { focusId: 1, owned: [1], sealed: [], gold: PACKS.price + 5 })!;
    expect(bought.career).toEqual({ focusId: 1, owned: [1], sealed: [bought.coworker.id], gold: 5 });
    expect(bought.coworker).toMatchObject({ level: 1, xp: 0 });
    expect(bought.coworker.id).toBe(roster.nextId);
    expect(bought.roster.nextId).toBe(roster.nextId + 1);
    expect(bought.roster.coworkers).toHaveLength(roster.coworkers.length + 1);
    expect(bought.roster.codex.coworkers.some((entry) => entry.id === bought.coworker.id)).toBe(true);
    expect(roster.coworkers).toHaveLength(3);
  });

  it("gives a different card each time, and the same ones from the same save", () => {
    const career = { focusId: 1, owned: [1], sealed: [], gold: PACKS.price * 3 };
    const first = openPack(defaultSave(7), career)!;
    const second = openPack(first.roster, first.career)!;
    expect(second.coworker.id).not.toBe(first.coworker.id);
    expect(openPack(defaultSave(7), career)!.coworker).toEqual(first.coworker);
  });
});

describe("hire", () => {
  it("moves a sealed card to owned, and ignores a card that is not sealed", () => {
    const career = { focusId: 1, owned: [1], sealed: [4, 5], gold: 0 };
    expect(hire(career, 4)).toEqual({ focusId: 1, owned: [1, 4], sealed: [5], gold: 0 });
    expect(hire(career, 9)).toBe(career);
  });
});

describe("interviews", () => {
  it("give each card the same boss every time, spread over all three", () => {
    expect(interviewBossFor(7)).toBe(interviewBossFor(7));
    expect(new Set([4, 5, 6].map(interviewBossFor)).size).toBe(INTERVIEW_BOSSES.length);
  });

  it("scale at half the day's pace", () => {
    expect(interviewDifficultyFor(1)).toBe(1);
    expect(interviewDifficultyFor(11) - 1).toBeCloseTo((difficultyFor(11) - 1) / 2);
  });
});
