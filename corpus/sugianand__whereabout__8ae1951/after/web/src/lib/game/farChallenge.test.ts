import { describe, expect, it } from "vitest";

import {
  encodeFarChallenge,
  farChallengeFrom,
  farChallengeLine,
  farChallengeOutcome,
  farChallengeText,
  farChallengeUrl,
  friendEstimate,
  friendTotal,
  parseFarChallenge,
  type FarChallenge,
} from "./farChallenge";
import {
  SLIDER_STEPS,
  judgeEstimate,
  kmToStep,
  stepToKm,
  type Pair,
  type PairResult,
} from "./howFar";

const DECK = Array.from({ length: 14 }, (_, i) => `wm${String(i).padStart(3, "0")}`);
const PAIRS: Pair[] = [
  ["wm000", "wm001"],
  ["wm002", "wm003"],
  ["wm004", "wm005"],
  ["wm006", "wm007"],
  ["wm008", "wm009"],
];
const LINK = "wm000.wm001-wm002.wm003-wm004.wm005-wm006.wm007-wm008.wm009_200.0.400.137.250";

/** A pair answered at slider step `step`, the photos `actualKm` apart. */
function answered(step: number, actualKm: number): PairResult {
  return { actualKm, you: judgeEstimate(stepToKm(step), actualKm), atlas: null };
}

describe("parseFarChallenge", () => {
  it("reads five pairs and five slider steps, and writes them back the same", () => {
    const parsed = parseFarChallenge(LINK, DECK);
    expect(parsed).toEqual({
      ok: true,
      challenge: { pairs: PAIRS, steps: [200, 0, 400, 137, 250] },
    });
    expect(encodeFarChallenge((parsed as { challenge: FarChallenge }).challenge)).toBe(LINK);
  });

  it.each([
    ["", "nothing at all"],
    ["wm000.wm001-wm002.wm003-wm004.wm005-wm006.wm007-wm008.wm009", "no steps"],
    ["wm000.wm001-wm002.wm003-wm004.wm005-wm006.wm007_1.2.3.4", "four pairs"],
    [`${LINK.split("_")[0]}-wm010.wm011_1.2.3.4.5.6`, "six pairs"],
    ["wm000.wm001-wm002.wm003-wm004.wm005-wm006.wm007-wm008_1.2.3.4.5", "a pair of one"],
    [
      "wm000.wm001-wm002.wm003-wm004.wm005-wm006.wm007-wm008.wm009.wm010_1.2.3.4.5",
      "a pair of three",
    ],
    ["wm000.wm001-wm002.wm003-wm004.wm005-wm006.wm007-wm008.wm000_1.2.3.4.5", "a photo twice"],
    [`${LINK.split("_")[0]}_1.2.3.4`, "four steps"],
    [`${LINK.split("_")[0]}_1.2.3.4.401`, "a step past the slider's end"],
    [`${LINK.split("_")[0]}_1.2.3.4.-5`, "a negative step"],
    [`${LINK.split("_")[0]}_1.2.3.4.2.5`, "a fractional step"],
    [`${LINK.split("_")[0]}_1.2.3.4.x`, "a step that isn't a number"],
    [`${LINK}_9`, "a third part"],
    ["wm0!0.wm001-wm002.wm003-wm004.wm005-wm006.wm007-wm008.wm009_1.2.3.4.5", "a bad id"],
  ])("turns away %j (%s) as cut short", (value) => {
    expect(parseFarChallenge(value, DECK)).toEqual({ ok: false, reason: "malformed" });
  });

  it("says when a photo has left the deck", () => {
    expect(
      parseFarChallenge(
        LINK,
        DECK.filter((id) => id !== "wm007"),
      ),
    ).toEqual({
      ok: false,
      reason: "missing",
    });
  });
});

describe("a finished game's challenge", () => {
  it("names its pairs and the slider step behind every estimate", () => {
    const steps = [0, 57, 200, 333, SLIDER_STEPS];
    const results = steps.map((s) => answered(s, 1000));
    expect(farChallengeFrom(PAIRS, results)).toEqual({ pairs: PAIRS, steps });
  });

  it("finds every slider step again from the estimate it made", () => {
    for (let step = 0; step <= SLIDER_STEPS; step++) expect(kmToStep(stepToKm(step))).toBe(step);
  });

  it("links to the page it was played on, with only the challenge in the query", () => {
    const c = { pairs: PAIRS, steps: [200, 0, 400, 137, 250] };
    expect(farChallengeUrl("https://x.dev/whereabout/how-far/?challenge=old#top", c)).toBe(
      `https://x.dev/whereabout/how-far/?challenge=${LINK}`,
    );
  });
});

describe("the friend's estimates", () => {
  const c: FarChallenge = { pairs: PAIRS, steps: [200, 200, 200, 200, 200] };

  it("are judged on each pair's true distance, as the player's are", () => {
    expect(friendEstimate(c, 0, 450)).toEqual(judgeEstimate(stepToKm(200), 450));
    const results = [answered(100, 450), answered(300, 9000)];
    expect(friendTotal(c, results)).toBe(
      judgeEstimate(stepToKm(200), 450).points + judgeEstimate(stepToKm(200), 9000).points,
    );
  });

  it("decide who won, and by how much", () => {
    const truth = stepToKm(200);
    const exact = Array.from({ length: 5 }, () => answered(200, truth));
    expect(farChallengeOutcome(exact, c)).toBe("tied");
    expect(farChallengeLine(exact, c)).toBe("A dead heat with your friend.");

    const friendBetter = Array.from({ length: 5 }, () => answered(150, truth));
    const gap = friendTotal(c, friendBetter) - friendBetter.reduce((s, r) => s + r.you.points, 0);
    expect(farChallengeOutcome(friendBetter, c)).toBe("lost");
    expect(farChallengeLine(friendBetter, c)).toBe(
      `Your friend won by ${gap.toLocaleString("en-US")} points.`,
    );

    const youBetter = Array.from({ length: 5 }, () => answered(200, stepToKm(240)));
    expect(farChallengeOutcome(youBetter, { ...c, steps: [0, 0, 0, 0, 0] })).toBe("won");
    expect(farChallengeLine(youBetter, { ...c, steps: [0, 0, 0, 0, 0] })).toMatch(
      /^You won the challenge by [\d,]+ points\.$/,
    );
  });
});

describe("farChallengeText", () => {
  const href = "https://x.dev/how-far/";
  const results = [200, 0, 400, 137, 250].map((s) => answered(s, stepToKm(s)));

  it("dares a friend with the points and the link, giving no place or distance away", () => {
    const text = farChallengeText(PAIRS, results, href);
    expect(text).toBe(
      [
        "Whereabout · How far apart?: 5,000 of 5,000 points on 5 pairs of photos.",
        "Same pairs, same slider: can you judge the distances better than me?",
        `https://x.dev/how-far/?challenge=${LINK}`,
      ].join("\n"),
    );
    expect(text).not.toMatch(/km|mi\b/);
  });

  it("answers a friend's challenge with how it went", () => {
    const worse: FarChallenge = { pairs: PAIRS, steps: [0, 400, 0, 400, 0] };
    expect(farChallengeText(PAIRS, results, href, worse).split("\n")[1]).toMatch(
      /^That beats your [\d,]+\. Your turn to beat mine\.$/,
    );
    const same: FarChallenge = { pairs: PAIRS, steps: [200, 0, 400, 137, 250] };
    expect(farChallengeText(PAIRS, results, href, same).split("\n")[1]).toBe(
      "We tied. Play them again to break it?",
    );
    const off = [0, 400, 0, 400, 0].map((s) => answered(s, stepToKm(200)));
    expect(farChallengeText(PAIRS, off, href, same).split("\n")[1]).toMatch(
      /^Your [\d,]+ wins this time\. Try them again\?$/,
    );
  });
});
