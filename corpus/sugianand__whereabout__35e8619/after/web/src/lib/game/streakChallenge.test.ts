import { describe, expect, it } from "vitest";

import { seededShuffle } from "./daily";
import {
  STREAK_CHALLENGE_PHOTOS,
  encodeStreakChallenge,
  friendMissCountry,
  parseStreakChallenge,
  streakChallengeFrom,
  streakChallengeLine,
  streakChallengeOrder,
  streakChallengeText,
  streakChallengeUrl,
  type StreakChallenge,
} from "./streakChallenge";

const DEALABLE = ["a1", "b2", "c3", "d4", "e5", "f6", "g7", "h8"];
const C: StreakChallenge = { ids: ["c3", "a1", "f6"], seed: 4_000_000_000, streak: 2, miss: "ES" };
const HREF = "https://example.org/whereabout/streak/?region=asia&x=1#top";

describe("Country Streak challenge links", () => {
  it("round-trip the photos, the seed, the streak and the country tapped on the miss", () => {
    const value = encodeStreakChallenge(C);
    expect(value).toBe(`c3.a1.f6_${(4_000_000_000).toString(36)}_2_ES`);
    expect(parseStreakChallenge(value, DEALABLE)).toEqual({ ok: true, challenge: C });
    for (const seed of [0, 2 ** 32 - 1]) {
      const c = { ...C, seed };
      expect(parseStreakChallenge(encodeStreakChallenge(c), DEALABLE)).toEqual({
        ok: true,
        challenge: c,
      });
    }
  });

  it("take a miss on the first photo, and a cleared run with no miss", () => {
    for (const c of [
      { ids: ["b2"], seed: 7, streak: 0, miss: "FR" },
      { ids: ["b2", "c3"], seed: 7, streak: 2, miss: null },
    ]) {
      expect(parseStreakChallenge(encodeStreakChallenge(c), DEALABLE)).toEqual({
        ok: true,
        challenge: c,
      });
    }
    expect(encodeStreakChallenge({ ids: ["b2", "c3"], seed: 7, streak: 2, miss: null })).toBe(
      "b2.c3_7_2",
    );
  });

  it("take a full link whose streak went past its photos, with no miss", () => {
    const ids = Array.from({ length: STREAK_CHALLENGE_PHOTOS }, (_, i) => `p${i}`);
    const value = `${ids.join(".")}_1_${STREAK_CHALLENGE_PHOTOS + 9}`;
    expect(parseStreakChallenge(value, ids)).toEqual({
      ok: true,
      challenge: { ids, seed: 1, streak: STREAK_CHALLENGE_PHOTOS + 9, miss: null },
    });
    expect(parseStreakChallenge(`${value}_ES`, ids)).toEqual({ ok: false, reason: "malformed" });
  });

  it("turn away junk, streaks the photos can't give, and a miss where there was none", () => {
    for (const value of [
      "",
      "c3.a1_7",
      "c3.a1_7_1_ES_x",
      "c3..a1_7_1_ES",
      "c3.c3_7_1_ES",
      "c3.a1_7_-1_ES",
      "c3.a1_7_1.5_ES",
      "c3.a1_Z_1_ES",
      "c3.a1_7_1_es",
      "c3.a1_7_1_ESP",
      "c3.a1_7_1", // ended on a miss, but which country was tapped is missing
      "c3.a1_7_2_ES", // named both photos, so there was no miss
      "c3.a1_7_0_ES", // two photos shown, but the run ended on the first
      "c3.a1_7_3",
      `c3.a1_${(2 ** 32).toString(36)}_1_ES`,
      `c3.a1_${"z".repeat(8)}_1_ES`,
      `${"x".repeat(33)}_7_0_ES`,
    ]) {
      expect(parseStreakChallenge(value, DEALABLE)).toEqual({ ok: false, reason: "malformed" });
    }
    const tooMany = Array.from({ length: STREAK_CHALLENGE_PHOTOS + 1 }, (_, i) => `p${i}`);
    expect(parseStreakChallenge(`${tooMany.join(".")}_1_60_ES`, tooMany)).toEqual({
      ok: false,
      reason: "malformed",
    });
  });

  it("say so when a photo can't be dealt from this run's photos any more", () => {
    expect(parseStreakChallenge("c3.zz9_7_1_ES", DEALABLE)).toEqual({
      ok: false,
      reason: "missing",
    });
  });

  it("deal the sender's photos first, then the rest shuffled by the seed", () => {
    const order = streakChallengeOrder(C, DEALABLE);
    expect(order.slice(0, 3)).toEqual(C.ids);
    expect(order.slice(3)).toEqual(
      seededShuffle(
        DEALABLE.filter((id) => !C.ids.includes(id)),
        C.seed,
      ),
    );
    expect(new Set(order).size).toBe(DEALABLE.length);
  });

  it("are made from a finished run, up to the photo it ended on", () => {
    const order = ["c3", "a1", "f6", "b2"];
    expect(streakChallengeFrom({ order, index: 2, seed: 9, streak: 2, miss: "ES" })).toEqual({
      ids: ["c3", "a1", "f6"],
      seed: 9,
      streak: 2,
      miss: "ES",
    });
    // A cleared run ends on its last photo, with no miss.
    expect(streakChallengeFrom({ order, index: 3, seed: 9, streak: 4, miss: null })).toEqual({
      ids: order,
      seed: 9,
      streak: 4,
      miss: null,
    });
    // A run past what a link can name keeps its first photos and its streak, not the miss.
    const long = Array.from({ length: 80 }, (_, i) => `p${i}`);
    const c = streakChallengeFrom({ order: long, index: 70, seed: 1, streak: 70, miss: "ES" });
    expect(c.ids).toHaveLength(STREAK_CHALLENGE_PHOTOS);
    expect(c.miss).toBeNull();
    expect(parseStreakChallenge(encodeStreakChallenge(c), long)).toEqual({
      ok: true,
      challenge: c,
    });
  });

  it("keep only the challenge, and the continent a run was dealt from, in the address", () => {
    expect(streakChallengeUrl(HREF, C, "asia")).toBe(
      `https://example.org/whereabout/streak/?region=asia&challenge=${encodeStreakChallenge(C)}`,
    );
    expect(streakChallengeUrl(HREF, C, null)).toBe(
      `https://example.org/whereabout/streak/?challenge=${encodeStreakChallenge(C)}`,
    );
  });

  it("word the message and the outcome with counts only", () => {
    const run = { order: ["c3", "a1", "f6"], index: 2, seed: 9, streak: 2, miss: "ES" };
    const sent = streakChallengeText(run, HREF, null);
    expect(sent.split("\n")).toEqual([
      "Whereabout · Country Streak: I named 2 countries in a row on the globe.",
      "Same photos, same order: can you go further?",
      "https://example.org/whereabout/streak/?challenge=c3.a1.f6_9_2_ES",
    ]);
    expect(sent).not.toMatch(/Spain/);
    expect(streakChallengeText(run, HREF, "asia", { ...C, streak: 1 })).toContain(
      "That beats your 1.",
    );
    expect(streakChallengeText(run, HREF, null, { ...C, streak: 5 })).toContain(
      "Your 5 wins this time.",
    );
    expect(streakChallengeText(run, HREF, null, C)).toContain("We tied.");
    expect(streakChallengeLine(4, C)).toBe("You beat your friend's 2 in a row by 2.");
    expect(streakChallengeLine(1, C)).toBe("Your friend's 2 in a row wins, by 1.");
    expect(streakChallengeLine(2, C)).toBe("A dead heat: you both named 2 countries.");
  });

  it("show the friend's tapped country only on the photo that ended their run", () => {
    expect(friendMissCountry(C, 2, "FR")).toBe("ES");
    expect(friendMissCountry(C, 1, "FR")).toBeNull();
    expect(friendMissCountry(C, 2, "ES")).toBeNull();
    expect(
      friendMissCountry({ ...C, ids: ["c3", "a1"], streak: 2, miss: null }, 1, "FR"),
    ).toBeNull();
  });
});
