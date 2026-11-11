/**
 * Challenge a friend to How far apart?: a link that deals a friend the very same five pairs, with
 * where the sender set the slider on each, shown beside the friend's own estimate once it is in.
 *
 * A game is its five pairs and five slider settings, so the link carries exactly that, e.g.
 * `/how-far?challenge=wm077.wm003-wm104.wh012-wm020.wm031-wm008.wm112-wm090.wm045_212.330.95.401.18`
 * (pairs split by `-`, a pair's photos by `.`, then one slider step from 0 to `SLIDER_STEPS` per
 * pair). The photos are named, not re-dealt, so a link keeps dealing the same pairs as the catalog
 * grows.
 *
 * The sender's points are not in the link: an estimate's points follow from the slider step and
 * the true distance, which the game reads from the photos as each pair is revealed, so the friend's
 * score is worked out the same way as the player's and a link can't claim points its estimates
 * wouldn't earn. A step names an estimate, never a place or a true distance, so the link gives no
 * answer away, and the game only shows it once the friend has locked their own estimate in.
 * Nothing is stored: the whole challenge lives in the address.
 */

import { formatPoints } from "@/lib/geo";

import { challengeOutcome, type ChallengeOutcome } from "./challenge";
import {
  PAIRS,
  PAIR_POINTS,
  SLIDER_STEPS,
  judgeEstimate,
  kmToStep,
  stepToKm,
  totalPoints,
  type Estimate,
  type Pair,
  type PairResult,
} from "./howFar";

export const FAR_CHALLENGE_PARAM = "challenge";

export interface FarChallenge {
  /** The pairs to play, in order, each photo where it was shown. */
  pairs: Pair[];
  /** The sender's slider step on each pair, 0 (`MIN_KM`) to `SLIDER_STEPS` (`MAX_KM`). */
  steps: number[];
}

export type FarChallengeParse =
  | { ok: true; challenge: FarChallenge }
  /** "malformed": not a challenge link at all; "missing": some photos aren't dealt any more. */
  | { ok: false; reason: "malformed" | "missing" };

const ID = /^[A-Za-z0-9]{1,32}$/;
const STEP = /^\d{1,3}$/;

export function encodeFarChallenge(c: FarChallenge): string {
  return `${c.pairs.map((p) => p.join(".")).join("-")}_${c.steps.join(".")}`;
}

/**
 * Read a `?challenge=` value: five pairs of ten different photos How far apart? can deal, and five
 * whole slider steps on the slider's range.
 */
export function parseFarChallenge(value: string, dealable: readonly string[]): FarChallengeParse {
  const malformed = { ok: false, reason: "malformed" } as const;
  const parts = value.split("_");
  if (parts.length !== 2) return malformed;
  const [pairPart, stepPart] = parts as [string, string];
  const pairs = pairPart.split("-").map((p) => p.split("."));
  const rawSteps = stepPart.split(".");
  const ids = pairs.flat();
  if (
    pairs.length !== PAIRS ||
    rawSteps.length !== PAIRS ||
    !pairs.every((p) => p.length === 2) ||
    !ids.every((id) => ID.test(id)) ||
    new Set(ids).size !== ids.length ||
    !rawSteps.every((s) => STEP.test(s))
  ) {
    return malformed;
  }
  const steps = rawSteps.map(Number);
  if (steps.some((s) => s > SLIDER_STEPS)) return malformed;
  const known = new Set(dealable);
  if (!ids.every((id) => known.has(id))) return { ok: false, reason: "missing" };
  return {
    ok: true,
    challenge: { pairs: pairs.map(([a, b]) => [a!, b!] as const), steps },
  };
}

/** The challenge a finished game makes: its pairs and where the player set the slider on each. */
export function farChallengeFrom(
  pairs: readonly Pair[],
  results: readonly PairResult[],
): FarChallenge {
  return {
    pairs: pairs.slice(0, results.length).map(([a, b]) => [a, b] as const),
    steps: results.map((r) => kmToStep(r.you.km)),
  };
}

/** The page's address with only the challenge in its query. */
export function farChallengeUrl(href: string, c: FarChallenge): string {
  const url = new URL(href);
  return `${url.origin}${url.pathname}?${FAR_CHALLENGE_PARAM}=${encodeFarChallenge(c)}`;
}

/** The friend's estimate on pair `index`, judged against that pair's true distance. */
export function friendEstimate(c: FarChallenge, index: number, actualKm: number): Estimate {
  return judgeEstimate(stepToKm(c.steps[index]!), actualKm);
}

/** The friend's points over the pairs answered so far, each judged on its true distance. */
export function friendTotal(c: FarChallenge, results: readonly PairResult[]): number {
  return results.reduce((sum, r, i) => sum + friendEstimate(c, i, r.actualKm).points, 0);
}

/** How a finished game did against the challenge it answered. */
export function farChallengeOutcome(
  results: readonly PairResult[],
  c: FarChallenge,
): ChallengeOutcome {
  return challengeOutcome(totalPoints(results), friendTotal(c, results));
}

/** "You won the challenge by 1,240 points.", from the finished game and the friend's estimates. */
export function farChallengeLine(results: readonly PairResult[], c: FarChallenge): string {
  const gap = Math.abs(totalPoints(results) - friendTotal(c, results));
  const by = `${formatPoints(gap)} point${gap === 1 ? "" : "s"}`;
  const outcome = farChallengeOutcome(results, c);
  if (outcome === "won") return `You won the challenge by ${by}.`;
  if (outcome === "lost") return `Your friend won by ${by}.`;
  return "A dead heat with your friend.";
}

/**
 * The message that goes with the link: the points and, when the game was itself a challenge, how
 * it went against the friend's. Points only, so it names no place and gives no distance away.
 */
export function farChallengeText(
  pairs: readonly Pair[],
  results: readonly PairResult[],
  href: string,
  answering?: FarChallenge,
): string {
  const you = totalPoints(results);
  const lines = [
    `Whereabout · How far apart?: ${formatPoints(you)} of ${formatPoints(results.length * PAIR_POINTS)} points on ${results.length} pairs of photos.`,
  ];
  if (answering) {
    const outcome = farChallengeOutcome(results, answering);
    const theirs = formatPoints(friendTotal(answering, results));
    lines.push(
      outcome === "won"
        ? `That beats your ${theirs}. Your turn to beat mine.`
        : outcome === "lost"
          ? `Your ${theirs} wins this time. Try them again?`
          : "We tied. Play them again to break it?",
    );
  } else {
    lines.push("Same pairs, same slider: can you judge the distances better than me?");
  }
  lines.push(farChallengeUrl(href, farChallengeFrom(pairs, results)));
  return lines.join("\n");
}
