import { describe, expect, it } from "vitest";

import { BASE_STAT, MAX_STAT } from "@/lib/roster/data";
import { generateCoworker, starters } from "@/lib/roster/generate";
import { defaultSave, normalizeSave, readSave, recordSeen, ROSTER_STORAGE_KEY, writeSave } from "@/lib/roster/save";
import type { RosterSave } from "@/lib/roster/types";

function memoryStorage() {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
  };
}

/** Saves compared without their rng, which a new save draws at random. */
const sansRng = ({ rng: _rng, ...rest }: RosterSave) => rest;

describe("defaultSave", () => {
  it("starts with the starters, stakes off, and them in the codex", () => {
    const save = defaultSave(5);
    expect(save.rng).toBe(5);
    expect(save.coworkers).toEqual(starters());
    expect(save.nextId).toBe(4);
    expect(save.stakes).toBe(false);
    expect(save.codex.coworkers.map((entry) => entry.id)).toEqual([1, 2, 3]);
    expect(save.codex.quirks).toEqual([...new Set(save.coworkers.flatMap((coworker) => coworker.quirks))]);
  });
});

describe("recordSeen", () => {
  it("adds a coworker and their new quirks once", () => {
    const save = defaultSave(5);
    const candidate = generateCoworker({ rng: 77, nextId: save.nextId }, { rarity: "rare" });
    const seen = recordSeen(save, candidate);
    expect(seen.codex.coworkers.at(-1)).toEqual({ id: 4, name: candidate.name, department: candidate.department, rarity: "rare" });
    for (const quirk of candidate.quirks) expect(seen.codex.quirks.filter((known) => known === quirk)).toHaveLength(1);
    expect(recordSeen(seen, candidate)).toBe(seen);
  });
});

describe("normalizeSave", () => {
  it("falls back to a new save on garbage", () => {
    expect(normalizeSave(null, 3)).toEqual(defaultSave(3));
    expect(normalizeSave("x", 3)).toEqual(defaultSave(3));
  });

  it("round-trips a real save", () => {
    let save = defaultSave(11);
    const hire = generateCoworker(save);
    save = recordSeen({ ...save, day: 6, stakes: true, coworkers: [...save.coworkers, hire] }, hire);
    save.coworkers[0] = { ...save.coworkers[0], level: 4, xp: 30, status: { kind: "burnedOut", until: 8 } };
    save.coworkers[1] = { ...save.coworkers[1], status: { kind: "quit", day: 5 } };
    expect(normalizeSave(JSON.parse(JSON.stringify(save)))).toEqual(save);
  });

  it("repairs coworkers field by field", () => {
    const save = normalizeSave({
      coworkers: [
        { id: 9, name: "  Pat  ", department: "marketing", rarity: "mythic", quirks: ["loyal", "loyal", "bogus", "nightOwl", "caffeinated"], perks: ["secondWind", "secondWind", "bogus", "overtime"], stats: { grit: 500, output: -2 }, level: 0, xp: "lots", status: { kind: "burnedOut" } },
        { id: 9, name: "Duplicate" },
        { name: "No id" },
        "junk",
      ],
    });
    expect(save.coworkers).toEqual([
      {
        id: 9,
        name: "Pat",
        department: "interns",
        rarity: "common",
        quirks: ["loyal", "nightOwl"],
        perks: ["secondWind", "overtime"],
        stats: { grit: MAX_STAT, output: BASE_STAT, hustle: BASE_STAT, focus: BASE_STAT, luck: BASE_STAT },
        level: 1,
        xp: 0,
        status: { kind: "burnedOut", until: 0 },
      },
    ]);
    expect(save.nextId).toBe(10);
    expect(save.codex.coworkers.map((entry) => entry.id)).toEqual([9]);
  });

  it("never hands out an id already in use", () => {
    const save = normalizeSave({ nextId: 2, codex: { coworkers: [{ id: 40, name: "Gone" }], quirks: ["bogus", "loyal"] } });
    expect(save.coworkers.map((coworker) => coworker.id)).toEqual([1, 2, 3]);
    expect(save.nextId).toBe(41);
    expect(save.codex.coworkers.map((entry) => entry.id)).toEqual([40, 1, 2, 3]);
    expect(save.codex.quirks[0]).toBe("loyal");
    expect(save.codex.quirks).not.toContain("bogus");
  });
});

describe("storage", () => {
  it("round-trips and survives garbage", () => {
    const storage = memoryStorage();
    expect(sansRng(readSave(storage))).toEqual(sansRng(defaultSave()));
    const save = { ...defaultSave(8), day: 3 };
    writeSave(save, storage);
    expect(readSave(storage)).toEqual(save);
    storage.data.set(ROSTER_STORAGE_KEY, "{not json");
    expect(sansRng(readSave(storage))).toEqual(sansRng(defaultSave()));
  });
});
