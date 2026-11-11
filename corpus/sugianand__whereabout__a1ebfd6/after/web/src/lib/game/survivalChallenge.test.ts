import { describe, expect, it } from "vitest";

import { seededShuffle } from "./daily";
import { HEAL_POINTS, SURVIVAL_HEALTH } from "./survival";
import {
  SURVIVAL_CHALLENGE_PHOTOS,
  encodeSurvivalChallenge,
  friendHealthAt,
  friendRunEndedAt,
  parseSurvivalChallenge,
  survivalChallengeFrom,
  survivalChallengeLine,
  survivalChallengeOrder,
  survivalChallengeOutcome,
  survivalChallengeText,
  survivalChallengeUrl,
  type SurvivalChallenge,
} from "./survivalChallenge";

const DEALABLE = ["a1", "b2", "c3", "d4", "e5", "f6", "g7", "h8"];
// Bitten to 3,000, healed to 4,000, then emptied on f6: two photos survived.
const C: SurvivalChallenge = {
  ids: ["c3", "a1", "f6"],
  seed: 4_000_000_000,
  healths: [3000, 4000, 0],
  survived: 2,
  total: 9100,
};
const HREF = "https://example.org/whereabout/survival/?x=1#top";

const parse = (c: SurvivalChallenge, dealable: readonly string[] = DEALABLE) =>
  parseSurvivalChallenge(encodeSurvivalChallenge(c), dealable);

describe("Survival challenge links", () => {
  it("round-trip the photos, the seed, the bar after each photo, the count and the points", () => {
    const value = encodeSurvivalChallenge(C);
    expect(value).toBe(`c3.a1.f6_${(4_000_000_000).toString(36)}_2bc.334.0_2_9100`);
    expect(parseSurvivalChallenge(value, DEALABLE)).toEqual({ ok: true, challenge: C });
    for (const seed of [0, 2 ** 32 - 1]) {
      expect(parse({ ...C, seed })).toEqual({ ok: true, challenge: { ...C, seed } });
    }
  });

  it("take a bar emptied on the first photo, and a run that cleared the deck", () => {
    for (const c of [
      { ids: ["b2"], seed: 7, healths: [0], survived: 0, total: 0 },
      { ids: ["b2", "c3"], seed: 7, healths: [SURVIVAL_HEALTH, 2500], survived: 2, total: 5000 },
    ]) {
      expect(parse(c)).toEqual({ ok: true, challenge: c });
    }
  });

  it("take a full link whose run went on past its photos", () => {
    const ids = Array.from({ length: SURVIVAL_CHALLENGE_PHOTOS }, (_, i) => `p${i}`);
    const healths = ids.map(() => SURVIVAL_HEALTH);
    const c = { ids, seed: 1, healths, survived: SURVIVAL_CHALLENGE_PHOTOS + 9, total: 300_000 };
    expect(parse(c, ids)).toEqual({ ok: true, challenge: c });
    // A shorter link that didn't empty the bar must have played every photo it names.
    expect(parse({ ...C, healths: [3000, 4000, 1], survived: 5 })).toEqual({
      ok: false,
      reason: "malformed",
    });
  });

  it("turn away junk and bars, counts and points the game couldn't give", () => {
    for (const value of [
      "",
      "c3.a1_1_0",
      "c3.a1_1_a.0_1_0_x",
      "c3.c3_1_a.0_1_0",
      "c3.a1_1_a_1_0", // one health for two photos
      "c3.a1_1_A.0_1_0",
      "c3.a1_zzzzzzzz_a.0_1_0", // seed too long
      "c3.a1_1z141z4_a.0_1_0", // seed past 32 bits
      "c3.a1_1_3uz.0_1_0", // 5,003 health: past the full bar
      "c3.a1_1_0.a_1_0", // empty, then on again
      "c3.a1_1_1oo.3e8_1_0", // 2,184 then 4,400: more than one heal up
      "c3.a1_1_a.0_2_0", // emptied on a1, so only c3 was survived
      "c3.a1_1_a.0_1_10001", // more points than two photos give
      "c3.a1.b2_1_a.b.c_2_0", // the bar never emptied, but the run stopped short
    ]) {
      expect(parseSurvivalChallenge(value, DEALABLE), value).toEqual({
        ok: false,
        reason: "malformed",
      });
    }
    // A heal back to the full bar from within a heal of it is fine.
    expect(
      parseSurvivalChallenge(
        `c3.a1_1_${(SURVIVAL_HEALTH - HEAL_POINTS).toString(36)}.${SURVIVAL_HEALTH.toString(36)}_2_6000`,
        DEALABLE,
      ).ok,
    ).toBe(true);
  });

  it("say when the photos have left the deck", () => {
    expect(parse(C, ["c3", "a1"])).toEqual({ ok: false, reason: "missing" });
  });

  it("deal the friend's photos first, then the rest of the deck shuffled by the seed", () => {
    const order = survivalChallengeOrder(C, DEALABLE);
    expect(order.slice(0, 3)).toEqual(C.ids);
    expect(order.slice(3)).toEqual(
      seededShuffle(
        DEALABLE.filter((id) => !C.ids.includes(id)),
        C.seed,
      ),
    );
    expect(new Set(order).size).toBe(DEALABLE.length);
  });

  it("know the friend's bar at each point of their run", () => {
    expect([0, 1, 2, 3, 4].map((n) => friendHealthAt(C, n))).toEqual([
      SURVIVAL_HEALTH,
      3000,
      4000,
      0,
      0,
    ]);
    // A run that went past the link's photos is unknown beyond them.
    const long = { ...C, healths: [3000, 4000, 4500], survived: 70 };
    expect(friendHealthAt(long, 3)).toBe(4500);
    expect(friendHealthAt(long, 4)).toBeNull();
    expect([0, 1, 2, 3].map((i) => friendRunEndedAt(C, i))).toEqual([false, false, true, false]);
    expect(friendRunEndedAt(long, 2)).toBe(false);
  });

  it("are made from a finished run, naming at most the link's photos", () => {
    const run = {
      order: ["c3", "a1", "f6", "b2"],
      seed: 5,
      healths: [3000, 0],
      survived: 1,
      total: 4000,
    };
    expect(survivalChallengeFrom(run)).toEqual({
      ids: ["c3", "a1"],
      seed: 5,
      healths: [3000, 0],
      survived: 1,
      total: 4000,
    });
    const order = Array.from({ length: 80 }, (_, i) => `p${i}`);
    const long = survivalChallengeFrom({
      order,
      seed: 5,
      healths: order.slice(0, 75).map(() => SURVIVAL_HEALTH),
      survived: 75,
      total: 375_000,
    });
    expect(long.ids).toHaveLength(SURVIVAL_CHALLENGE_PHOTOS);
    expect(long.healths).toHaveLength(SURVIVAL_CHALLENGE_PHOTOS);
    expect(parse(long, order)).toEqual({ ok: true, challenge: long });
  });

  it("keep only the challenge in the address", () => {
    expect(survivalChallengeUrl(HREF, C)).toBe(
      `https://example.org/whereabout/survival/?challenge=${encodeSurvivalChallenge(C)}`,
    );
  });
});

describe("Survival challenge results", () => {
  it("go by photos survived, then by points", () => {
    expect(survivalChallengeOutcome({ survived: 3, total: 0 }, C)).toBe("won");
    expect(survivalChallengeOutcome({ survived: 1, total: 99_999 }, C)).toBe("lost");
    expect(survivalChallengeOutcome({ survived: 2, total: 9101 }, C)).toBe("won");
    expect(survivalChallengeOutcome({ survived: 2, total: 9000 }, C)).toBe("lost");
    expect(survivalChallengeOutcome({ survived: 2, total: 9100 }, C)).toBe("tied");
  });

  it("read as one line", () => {
    expect(survivalChallengeLine({ survived: 5, total: 0 }, C)).toBe(
      "You outlasted your friend's 2 photos by 3 photos.",
    );
    expect(survivalChallengeLine({ survived: 1, total: 0 }, C)).toBe(
      "Your friend's 2 photos wins, by 1 photo.",
    );
    expect(survivalChallengeLine({ survived: 2, total: 10_100 }, C)).toBe(
      "You both survived 2 photos, and your points beat your friend's by 1,000.",
    );
    expect(survivalChallengeLine({ survived: 2, total: 9000 }, C)).toBe(
      "You both survived 2 photos, but your friend's points win by 100.",
    );
    expect(survivalChallengeLine({ survived: 2, total: 9100 }, C)).toBe(
      "A dead heat: you both survived 2 photos with 9,100 points.",
    );
  });

  it("send counts, points and the link, never a place", () => {
    const run = {
      order: ["c3", "a1", "f6"],
      seed: 9,
      healths: [2500, 0],
      survived: 1,
      total: 2600,
    };
    const url = survivalChallengeUrl(HREF, survivalChallengeFrom(run));
    expect(survivalChallengeText(run, HREF).split("\n")).toEqual([
      "Whereabout · Survival: I survived 1 photo (2,600 points) on the globe.",
      "Same photos, same order: can you last longer?",
      url,
    ]);
    expect(survivalChallengeText(run, HREF, C).split("\n")[1]).toBe(
      "Your 2 photos wins this time. Try them again?",
    );
    expect(survivalChallengeText({ ...run, survived: 4, total: 1 }, HREF, C).split("\n")[1]).toBe(
      "That beats your 2 photos. Your turn to last longer.",
    );
    expect(
      survivalChallengeText({ ...run, survived: 2, total: 9100 }, HREF, C).split("\n")[1],
    ).toBe("We tied. Play them again to break it?");
  });
});
