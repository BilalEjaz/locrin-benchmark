/**
 * Challenge a friend to Country Streak: a link that deals a friend the very same run, photo by
 * photo, with the streak the sender made to beat and the country they tapped on the photo that
 * ended it.
 *
 * A run is its order, so the link names the photos the sender was shown, the miss included, and
 * carries the run's seed and streak, e.g. `/streak?challenge=wm077.wm003.wm104_1z141z3_2_ES`.
 * The friend plays those photos first, in that order; a friend who gets past the sender's miss
 * plays on through the rest of the run's photos, shuffled by the same seed, so a run is never cut
 * short at the number to beat. A run dealt from one continent keeps its `region` beside the
 * challenge, so the friend plays on from that continent too.
 *
 * On a miss the link also carries the country the sender tapped (an ISO alpha-2 code). That is a
 * wrong answer, so it spoils nothing; the friend only sees it once they have answered that photo
 * themselves. The link never names a place or the right country; nothing is stored, the whole
 * challenge lives in the address.
 *
 * A long run would make a long address, so a link names at most `STREAK_CHALLENGE_PHOTOS`; a run
 * past that carries its first photos and the streak, and the friend plays on from the seed.
 */

import { challengeOutcome, type ChallengeOutcome } from "./challenge";
import { seededShuffle } from "./daily";

export const STREAK_CHALLENGE_PARAM = "challenge";

/** The most photos a link names, so the address stays one people can send. */
export const STREAK_CHALLENGE_PHOTOS = 60;

export interface StreakChallenge {
  /** The photos the sender was shown, in order: the miss last, unless the run went past them. */
  ids: string[];
  /** The run's seed: it shuffles the photos a friend plays on through past the named ones. */
  seed: number;
  /** The sender's streak: countries named in a row. */
  streak: number;
  /** The country the sender tapped on the photo that ended the run; null if no miss is named. */
  miss: string | null;
}

export type StreakChallengeParse =
  | { ok: true; challenge: StreakChallenge }
  /** "malformed": not a challenge link at all; "missing": some photos aren't dealt any more. */
  | { ok: false; reason: "malformed" | "missing" };

const ID = /^[A-Za-z0-9-]{1,32}$/;
const SEED = /^[0-9a-z]{1,7}$/;
const COUNT = /^\d{1,4}$/;
const COUNTRY = /^[A-Z]{2}$/;

export function encodeStreakChallenge(c: StreakChallenge): string {
  const base = `${c.ids.join(".")}_${c.seed.toString(36)}_${c.streak}`;
  return c.miss ? `${base}_${c.miss}` : base;
}

/**
 * Read a `?challenge=` value against the photos the run can be dealt from: one to
 * `STREAK_CHALLENGE_PHOTOS` different photos, a seed that fits in 32 bits, and a streak those
 * photos could give. One short of them ended on a miss, so the tapped country must follow; all
 * of them (a cleared run) or, from a full link, more, shows no miss, so none may follow.
 */
export function parseStreakChallenge(
  value: string,
  dealable: readonly string[],
): StreakChallengeParse {
  const malformed = { ok: false, reason: "malformed" } as const;
  const parts = value.split("_");
  if (parts.length !== 3 && parts.length !== 4) return malformed;
  const [idPart, seedPart, streakPart, missPart] = parts;
  const ids = idPart.split(".");
  if (
    ids.length > STREAK_CHALLENGE_PHOTOS ||
    !ids.every((id) => ID.test(id)) ||
    new Set(ids).size !== ids.length ||
    !SEED.test(seedPart) ||
    !COUNT.test(streakPart) ||
    (missPart !== undefined && !COUNTRY.test(missPart))
  ) {
    return malformed;
  }
  const seed = parseInt(seedPart, 36);
  const streak = Number(streakPart);
  const endedOnMiss = streak === ids.length - 1;
  const ranOn =
    streak === ids.length || (ids.length === STREAK_CHALLENGE_PHOTOS && streak > ids.length);
  const fits = (endedOnMiss && missPart !== undefined) || (ranOn && missPart === undefined);
  if (seed >= 2 ** 32 || !fits) return malformed;
  const known = new Set(dealable);
  if (!ids.every((id) => known.has(id))) return { ok: false, reason: "missing" };
  return { ok: true, challenge: { ids, seed, streak, miss: missPart ?? null } };
}

/**
 * The friend's run: the sender's photos first, as they were shown, then every other photo the
 * run can be dealt from, shuffled by the challenge's seed, for a friend who gets further.
 */
export function streakChallengeOrder(c: StreakChallenge, dealable: readonly string[]): string[] {
  const named = new Set(c.ids);
  return [
    ...c.ids,
    ...seededShuffle(
      dealable.filter((id) => !named.has(id)),
      c.seed,
    ),
  ];
}

/** A finished run: its order, the photo it ended on, its seed, streak and the country tapped. */
export interface FinishedStreakRun {
  order: readonly string[];
  /** The photo that ended the run: the miss, or the last photo of a cleared run. */
  index: number;
  seed: number;
  streak: number;
  /** The country tapped on a miss; null for a cleared run. */
  miss: string | null;
}

/** The challenge a finished run makes. A run past the link's photos names no miss. */
export function streakChallengeFrom(run: FinishedStreakRun): StreakChallenge {
  const ids = run.order.slice(0, Math.min(run.index + 1, STREAK_CHALLENGE_PHOTOS));
  return {
    ids,
    seed: run.seed,
    streak: run.streak,
    miss: run.streak === ids.length - 1 ? run.miss : null,
  };
}

/**
 * The page's address with only the challenge in its query, and the continent (its slug) a run
 * dealt from one continent was played on.
 */
export function streakChallengeUrl(
  href: string,
  c: StreakChallenge,
  region: string | null,
): string {
  const url = new URL(href);
  const query = region ? `region=${encodeURIComponent(region)}&` : "";
  return `${url.origin}${url.pathname}?${query}${STREAK_CHALLENGE_PARAM}=${encodeStreakChallenge(c)}`;
}

/** "1 country", "4 countries". */
function countries(n: number): string {
  return `${n} ${n === 1 ? "country" : "countries"}`;
}

/** How a finished run did against the challenge it answered. */
export function streakChallengeOutcome(streak: number, c: StreakChallenge): ChallengeOutcome {
  return challengeOutcome(streak, c.streak);
}

/**
 * The message that goes with the link: the streak, and when the run was itself a challenge, how
 * it went against the friend's. Counts only, so it names no place.
 */
export function streakChallengeText(
  run: FinishedStreakRun,
  href: string,
  region: string | null,
  answering?: StreakChallenge,
): string {
  const lines = [
    `Whereabout · Country Streak: I named ${countries(run.streak)} in a row on the globe.`,
  ];
  if (answering) {
    const outcome = streakChallengeOutcome(run.streak, answering);
    lines.push(
      outcome === "won"
        ? `That beats your ${answering.streak}. Your turn to go further.`
        : outcome === "lost"
          ? `Your ${answering.streak} wins this time. Try them again?`
          : "We tied. Play them again to break it?",
    );
  } else {
    lines.push("Same photos, same order: can you go further?");
  }
  lines.push(streakChallengeUrl(href, streakChallengeFrom(run), region));
  return lines.join("\n");
}

/** "You beat your friend's 3 in a row by 2.", from the finished streak and the challenge. */
export function streakChallengeLine(streak: number, c: StreakChallenge): string {
  const gap = Math.abs(streak - c.streak);
  const outcome = streakChallengeOutcome(streak, c);
  if (outcome === "won") return `You beat your friend's ${c.streak} in a row by ${gap}.`;
  if (outcome === "lost") return `Your friend's ${c.streak} in a row wins, by ${gap}.`;
  return `A dead heat: you both named ${countries(c.streak)}.`;
}

/**
 * The country the sender tapped on photo `index` of the friend's run, if that photo ended the
 * sender's run on a miss; null otherwise, and null for a hand-edited link whose "miss" was the
 * right country after all.
 */
export function friendMissCountry(c: StreakChallenge, index: number, truth: string): string | null {
  if (!c.miss || index !== c.ids.length - 1 || c.streak !== c.ids.length - 1) return null;
  return c.miss === truth ? null : c.miss;
}
