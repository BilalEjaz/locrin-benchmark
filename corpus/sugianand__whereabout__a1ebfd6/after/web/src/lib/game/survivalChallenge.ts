/**
 * Challenge a friend to Survival: a link that deals a friend the very same run, photo by photo,
 * with the sender's health after each photo to race on the bar, and how far they got to beat.
 *
 * A run is its order, so the link names the photos the sender played, the one that emptied the
 * bar included, and carries the run's seed, the sender's health after each of those photos (in
 * base 36, like the seed), how many photos they survived and their points, e.g.
 * `/survival?challenge=wm077.wm003.wm104_1z141z3_3e8.1yk.0_2_8120`. The friend plays those photos
 * first, in that order; a friend who outlasts the sender plays on through the rest of the deck,
 * shuffled by the same seed, so a run is never cut short at the number to beat.
 *
 * Health and points are numbers only, so the link spoils nothing: no place, country or
 * coordinate. Nothing is stored; the whole challenge lives in the address. A long run would make
 * a long address, so a link names at most `SURVIVAL_CHALLENGE_PHOTOS`; a run past that carries
 * its first photos, the health after each, and the full count and points.
 */

import { MAX_POINTS, formatPoints } from "@/lib/geo";

import { challengeOutcome, type ChallengeOutcome } from "./challenge";
import { seededShuffle } from "./daily";
import { HEAL_POINTS, SURVIVAL_HEALTH, type SurvivalBest } from "./survival";

export const SURVIVAL_CHALLENGE_PARAM = "challenge";

/** The most photos a link names, so the address stays one people can send. */
export const SURVIVAL_CHALLENGE_PHOTOS = 60;

export interface SurvivalChallenge {
  /** The photos the sender played, in order: the one that emptied the bar last, if it did. */
  ids: string[];
  /** The run's seed: it shuffles the photos a friend plays on through past the named ones. */
  seed: number;
  /** The sender's health after each named photo, in the same order. */
  healths: number[];
  /** Photos the sender survived, which can run past the named ones. */
  survived: number;
  /** The sender's points over the whole run. */
  total: number;
}

export type SurvivalChallengeParse =
  | { ok: true; challenge: SurvivalChallenge }
  /** "malformed": not a challenge link at all; "missing": some photos aren't dealt any more. */
  | { ok: false; reason: "malformed" | "missing" };

const ID = /^[A-Za-z0-9-]{1,32}$/;
const SEED = /^[0-9a-z]{1,7}$/;
const HEALTH = /^[0-9a-z]{1,3}$/;
const COUNT = /^\d{1,4}$/;
const POINTS = /^\d{1,9}$/;

export function encodeSurvivalChallenge(c: SurvivalChallenge): string {
  const healths = c.healths.map((h) => h.toString(36)).join(".");
  return `${c.ids.join(".")}_${c.seed.toString(36)}_${healths}_${c.survived}_${c.total}`;
}

/**
 * True when `healths` is a bar the game could have drawn: every value whole and within the bar,
 * never more than one heal above the photo before, and empty only on the last photo, which ends
 * the run.
 */
function plausibleHealths(healths: readonly number[]): boolean {
  let before = SURVIVAL_HEALTH;
  for (const [i, h] of healths.entries()) {
    if (!Number.isInteger(h) || h < 0 || h > Math.min(SURVIVAL_HEALTH, before + HEAL_POINTS)) {
      return false;
    }
    if (h === 0 && i !== healths.length - 1) return false;
    before = h;
  }
  return true;
}

/**
 * Read a `?challenge=` value against the photos the run can be dealt from: one to
 * `SURVIVAL_CHALLENGE_PHOTOS` different photos, a seed that fits in 32 bits, a health after each
 * that the bar could show, and a count and points those photos could give. A bar that emptied
 * survived every photo but the last; one that didn't either cleared the deck (all of them) or,
 * from a full link, ran on past it.
 */
export function parseSurvivalChallenge(
  value: string,
  dealable: readonly string[],
): SurvivalChallengeParse {
  const malformed = { ok: false, reason: "malformed" } as const;
  const parts = value.split("_");
  if (parts.length !== 5) return malformed;
  const [idPart, seedPart, healthPart, survivedPart, totalPart] = parts;
  const ids = idPart.split(".");
  const rawHealths = healthPart.split(".");
  if (
    ids.length > SURVIVAL_CHALLENGE_PHOTOS ||
    !ids.every((id) => ID.test(id)) ||
    new Set(ids).size !== ids.length ||
    rawHealths.length !== ids.length ||
    !rawHealths.every((h) => HEALTH.test(h)) ||
    !SEED.test(seedPart) ||
    !COUNT.test(survivedPart) ||
    !POINTS.test(totalPart)
  ) {
    return malformed;
  }
  const seed = parseInt(seedPart, 36);
  const healths = rawHealths.map((h) => parseInt(h, 36));
  const survived = Number(survivedPart);
  const total = Number(totalPart);
  const emptied = healths[healths.length - 1] === 0;
  const fits = emptied
    ? survived === ids.length - 1
    : survived === ids.length ||
      (ids.length === SURVIVAL_CHALLENGE_PHOTOS && survived > ids.length);
  const played = emptied ? ids.length : survived + 1;
  if (seed >= 2 ** 32 || !plausibleHealths(healths) || !fits || total > played * MAX_POINTS) {
    return malformed;
  }
  const known = new Set(dealable);
  if (!ids.every((id) => known.has(id))) return { ok: false, reason: "missing" };
  return { ok: true, challenge: { ids, seed, healths, survived, total } };
}

/**
 * The friend's run: the sender's photos first, as they were played, then every other photo the
 * deck can deal, shuffled by the challenge's seed, for a friend who lasts longer.
 */
export function survivalChallengeOrder(
  c: SurvivalChallenge,
  dealable: readonly string[],
): string[] {
  const named = new Set(c.ids);
  return [
    ...c.ids,
    ...seededShuffle(
      dealable.filter((id) => !named.has(id)),
      c.seed,
    ),
  ];
}

/**
 * The sender's health once `played` photos of the run had been answered: the full bar before
 * the first, empty for good once their bar ran out, and null past a link's last photo when their
 * run went on further than the link could name.
 */
export function friendHealthAt(c: SurvivalChallenge, played: number): number | null {
  if (played <= 0) return SURVIVAL_HEALTH;
  if (played <= c.healths.length) return c.healths[played - 1];
  return c.healths[c.healths.length - 1] === 0 ? 0 : null;
}

/** True when photo `index` (from 0) is the one that emptied the sender's bar. */
export function friendRunEndedAt(c: SurvivalChallenge, index: number): boolean {
  return index === c.healths.length - 1 && c.healths[index] === 0;
}

/** A finished run: its order, its seed, the health after each photo played, count and points. */
export interface FinishedSurvivalRun {
  order: readonly string[];
  seed: number;
  /** Health after each photo played, in order: one entry per photo answered. */
  healths: readonly number[];
  survived: number;
  total: number;
}

/** The challenge a finished run makes, naming at most `SURVIVAL_CHALLENGE_PHOTOS` photos. */
export function survivalChallengeFrom(run: FinishedSurvivalRun): SurvivalChallenge {
  const named = Math.min(run.healths.length, SURVIVAL_CHALLENGE_PHOTOS);
  return {
    ids: run.order.slice(0, named),
    seed: run.seed,
    healths: run.healths.slice(0, named),
    survived: run.survived,
    total: run.total,
  };
}

/** The page's address with only the challenge in its query. */
export function survivalChallengeUrl(href: string, c: SurvivalChallenge): string {
  const url = new URL(href);
  return `${url.origin}${url.pathname}?${SURVIVAL_CHALLENGE_PARAM}=${encodeSurvivalChallenge(c)}`;
}

/** "1 photo", "4 photos". */
function photos(n: number): string {
  return `${n} photo${n === 1 ? "" : "s"}`;
}

/** How a finished run did against the challenge: more photos survived, then more points. */
export function survivalChallengeOutcome(
  run: SurvivalBest,
  c: SurvivalChallenge,
): ChallengeOutcome {
  return run.survived !== c.survived
    ? challengeOutcome(run.survived, c.survived)
    : challengeOutcome(run.total, c.total);
}

/**
 * The message that goes with the link: how far the run got, and when it was itself a challenge,
 * how it went against the friend's. Counts and points only, so it names no place.
 */
export function survivalChallengeText(
  run: FinishedSurvivalRun,
  href: string,
  answering?: SurvivalChallenge,
): string {
  const lines = [
    `Whereabout · Survival: I survived ${photos(run.survived)} (${formatPoints(run.total)} points) on the globe.`,
  ];
  if (answering) {
    const outcome = survivalChallengeOutcome(run, answering);
    lines.push(
      outcome === "won"
        ? `That beats your ${photos(answering.survived)}. Your turn to last longer.`
        : outcome === "lost"
          ? `Your ${photos(answering.survived)} wins this time. Try them again?`
          : "We tied. Play them again to break it?",
    );
  } else {
    lines.push("Same photos, same order: can you last longer?");
  }
  lines.push(survivalChallengeUrl(href, survivalChallengeFrom(run)));
  return lines.join("\n");
}

/** "You outlasted your friend's 3 photos by 2.", from the finished run and the challenge. */
export function survivalChallengeLine(run: SurvivalBest, c: SurvivalChallenge): string {
  const outcome = survivalChallengeOutcome(run, c);
  if (run.survived !== c.survived) {
    const gap = photos(Math.abs(run.survived - c.survived));
    return outcome === "won"
      ? `You outlasted your friend's ${photos(c.survived)} by ${gap}.`
      : `Your friend's ${photos(c.survived)} wins, by ${gap}.`;
  }
  const gap = formatPoints(Math.abs(run.total - c.total));
  if (outcome === "won") {
    return `You both survived ${photos(c.survived)}, and your points beat your friend's by ${gap}.`;
  }
  if (outcome === "lost") {
    return `You both survived ${photos(c.survived)}, but your friend's points win by ${gap}.`;
  }
  return `A dead heat: you both survived ${photos(c.survived)} with ${formatPoints(c.total)} points.`;
}
