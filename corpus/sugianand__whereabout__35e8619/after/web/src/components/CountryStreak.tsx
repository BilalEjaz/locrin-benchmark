"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";

import { countryAt } from "@/lib/countryHit";
import { countryName, shortlist } from "@/lib/countries";
import { seededShuffle } from "@/lib/game/daily";
import { fetchRecords, type Deck, type GameRecord } from "@/lib/game/deck";
import {
  offeredRegions,
  regionFromSlug,
  regionSlug,
  streakRegions,
  type Regions,
} from "@/lib/game/regions";
import {
  initialStreak,
  loadBestStreak,
  rememberStreak,
  runOver,
  streakReducer,
} from "@/lib/game/streak";
import {
  STREAK_CHALLENGE_PARAM,
  friendMissCountry,
  parseStreakChallenge,
  streakChallengeLine,
  streakChallengeOrder,
  streakChallengeText,
  type FinishedStreakRun,
  type StreakChallenge,
} from "@/lib/game/streakChallenge";
import { sendShare, type ShareOutcome } from "@/lib/share";
import type { Continent } from "@/lib/continents";
import type { LngLat } from "@/lib/geo";
import type { RevealView } from "@/lib/reveal";

import GamesMenu from "./GamesMenu";
import Globe from "./Globe";
import PhotoViewer from "./PhotoViewer";

type CountryStreakProps = {
  deck: Deck;
  /** For tests: load records without the network. Defaults to fetching the static files. */
  loadRecords?: (ids: string[]) => Promise<GameRecord[]>;
  /** For tests: the randomness that shuffles each run. */
  random?: () => number;
};

/** "1 photo", "3 photos". */
function photos(n: number): string {
  return `${n} photo${n === 1 ? "" : "s"}`;
}

/** The continent the page URL asks for (`/streak?region=europe`), if a run can be dealt there. */
function urlRegion(regions: Regions): Continent | null {
  const region = regionFromSlug(new URLSearchParams(window.location.search).get("region"));
  return region && regions[region] ? region : null;
}

/** "1 country", "4 countries". */
function countries(n: number): string {
  return `${n} ${n === 1 ? "country" : "countries"}`;
}

/** Why a challenge link was set aside for a fresh run. */
export const STREAK_CHALLENGE_NOTICE = {
  malformed: "That challenge link was cut short, so here's a fresh run instead.",
  missing: "That challenge's photos aren't in the game any more, so here's a fresh run instead.",
} as const;

/** The challenge the address carries, read once as the page opens; null without one. */
function linkedChallenge(dealable: readonly string[]) {
  const value = new URLSearchParams(window.location.search).get(STREAK_CHALLENGE_PARAM);
  return value === null ? null : parseStreakChallenge(value, dealable);
}

/** Take the challenge out of the address, so a reload deals a fresh run, not the old link. */
function dropChallengeParam() {
  const url = new URL(window.location.href);
  if (!url.searchParams.has(STREAK_CHALLENGE_PARAM)) return;
  url.searchParams.delete(STREAK_CHALLENGE_PARAM);
  window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
}

const CHALLENGE_NOTE: Record<ShareOutcome, string> = {
  shared: "Challenge sent.",
  copied: "Challenge link copied. Whoever opens it plays these photos, in this order.",
  cancelled: "",
  failed: "Couldn't copy the link. Your browser blocked the clipboard.",
};

/** Keep the address bar on the continent being played, so a shared link deals from it too. */
function syncUrl(region: Continent | null) {
  const url = new URL(window.location.href);
  if (region) url.searchParams.set("region", regionSlug(region));
  else url.searchParams.delete("region");
  const next = `${url.pathname}${url.search}${url.hash}`;
  if (next !== `${window.location.pathname}${window.location.search}${window.location.hash}`) {
    window.history.replaceState(window.history.state, "", next);
  }
}

/**
 * Country Streak (src/lib/game/streak.ts): a photo, a globe, and one question, which country?
 * The player taps a country to pick it, confirms, and plays on until the first miss.
 */
export default function CountryStreak({ deck, loadRecords, random }: CountryStreakProps) {
  const [state, dispatch] = useReducer(streakReducer, initialStreak);
  // The continents a run can be dealt from, and the one being played: null deals from every
  // continent, undefined until the page URL has been read after hydration.
  const regions = useMemo(
    () => streakRegions(deck.regions ?? {}, deck.streakIds),
    [deck.regions, deck.streakIds],
  );
  const regionList = useMemo(() => offeredRegions(regions), [regions]);
  const [region, setRegion] = useState<Continent | null | undefined>(undefined);
  const slug = region ? regionSlug(region) : null;
  const [best, setBest] = useState(0);
  const [records, setRecords] = useState<ReadonlyMap<string, GameRecord>>(() => new Map());
  const [error, setError] = useState<string | null>(null);
  // The best streak before this run, so the end card can say when it was beaten.
  const [bestBeforeRun, setBestBeforeRun] = useState(0);
  // The run's seed, which a challenge link carries so a friend plays on in the same order.
  const [seed, setSeed] = useState(0);
  // A friend's challenge this run answers: their photos and streak to beat.
  const [challenge, setChallenge] = useState<StreakChallenge | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // The address's challenge is taken up once, by the first run the page deals.
  const linkRead = useRef(false);

  /** Deal a run; `fromLink` takes up a challenge the address carries, as the page opens. */
  const start = useCallback(
    (fromLink = false) => {
      if (region === undefined) return;
      const stored = loadBestStreak(region ? regionSlug(region) : null);
      setBestBeforeRun(stored);
      setBest(stored);
      const pool = region ? regions[region]! : deck.streakIds;
      const linked = fromLink ? linkedChallenge(pool) : null;
      setNotice(linked && !linked.ok ? STREAK_CHALLENGE_NOTICE[linked.reason] : null);
      if (linked?.ok) {
        const { challenge: c } = linked;
        setChallenge(c);
        setSeed(c.seed);
        dispatch({ type: "start", order: streakChallengeOrder(c, pool) });
        return;
      }
      setChallenge(null);
      dropChallengeParam();
      const fresh = Math.floor((random ?? Math.random)() * 2 ** 32);
      setSeed(fresh);
      dispatch({ type: "start", order: seededShuffle(pool, fresh) });
    },
    [deck.streakIds, random, region, regions],
  );

  // The URL is read after hydration, so the static page is the same for every continent.
  useEffect(() => {
    const id = requestAnimationFrame(() => setRegion(urlRegion(regions)));
    return () => cancelAnimationFrame(id);
  }, [regions]);

  // The order is shuffled in the browser after hydration, never at build time. Picking another
  // continent changes `start`, which deals a new run from there.
  useEffect(() => {
    if (region === undefined) return;
    syncUrl(region);
    const id = requestAnimationFrame(() => {
      start(!linkRead.current);
      linkRead.current = true;
    });
    return () => cancelAnimationFrame(id);
  }, [start, region]);

  // Show the new continent's best with its name at once, not a frame later when the run deals.
  const pickRegion = useCallback((next: Continent | null) => {
    setRegion(next);
    setBest(loadBestStreak(next ? regionSlug(next) : null));
  }, []);

  const load = useCallback(
    (ids: string[]) => (loadRecords ? loadRecords(ids) : fetchRecords(deck, ids)),
    [deck, loadRecords],
  );

  // This photo and the next one, so the next round opens without waiting.
  const wanted = useMemo(() => {
    if (state.phase !== "guessing" && state.phase !== "answered") return [];
    return state.order.slice(state.index, state.index + 2);
  }, [state]);
  const missing = wanted.filter((id) => !records.has(id)).join(",");

  useEffect(() => {
    if (!missing) return;
    let cancelled = false;
    load(missing.split(","))
      .then((loaded) => {
        if (cancelled) return;
        setRecords((known) => {
          const next = new Map(known);
          for (const r of loaded) next.set(r.photo.id, r);
          return next;
        });
      })
      .catch((err: Error) => !cancelled && setError(err.message));
    return () => {
      cancelled = true;
    };
  }, [missing, load]);

  const current =
    state.phase === "guessing" || state.phase === "answered"
      ? records.get(state.order[state.index])
      : undefined;
  const next =
    state.phase === "answered" ? records.get(state.order[state.index + 1] ?? "") : undefined;

  // Warm the cache with the next photo while the player reads the answer.
  useEffect(() => {
    if (next) new Image().src = next.photo.imageUrl;
  }, [next]);

  const onPinChange = useCallback(
    (at: LngLat) => dispatch({ type: "picked", pick: { at, country: countryAt(at) } }),
    [],
  );

  function confirm() {
    if (state.phase !== "guessing" || !current || !state.pick?.country) return;
    const correct = state.pick.country === current.photo.country;
    dispatch({ type: "answered", truth: current.photo.country });
    // A challenge's photos may have been seen before, so it never counts toward the best.
    if (correct && !challenge) {
      setBest((b) => Math.max(b, rememberStreak(state.streak + 1, slug)));
    }
  }

  const pick = state.phase === "guessing" || state.phase === "answered" ? state.pick : null;
  const answered = state.phase === "answered" ? state : null;
  const streak = state.phase === "idle" ? 0 : state.streak;
  const over = runOver(state);
  // The run as it ended, for the challenge link its end can send.
  const finished: FinishedStreakRun | null =
    state.phase === "cleared"
      ? {
          order: state.order,
          index: state.order.length - 1,
          seed,
          streak: state.streak,
          miss: null,
        }
      : answered && over
        ? {
            order: answered.order,
            index: answered.index,
            seed,
            streak: answered.streak,
            miss: answered.answer.guess,
          }
        : null;

  const reveal = useMemo<RevealView | null>(() => {
    if (!answered || !current) return null;
    return { truth: current.photo, guesses: [{ actor: "player", at: answered.pick.at }] };
  }, [answered, current]);

  const marks = useMemo(
    () => ({ picked: pick?.country ?? null, answer: answered?.answer.truth ?? null }),
    [pick, answered],
  );

  if (state.phase === "cleared") {
    return (
      <main className="mx-auto flex min-h-dvh w-full max-w-xl flex-col justify-center px-6 py-16">
        <p className="text-sm text-gold">Country Streak</p>
        <h1 className="mt-2 font-sign text-5xl font-extrabold leading-none tracking-tight">
          {state.order.length === 0 ? "No photos to play yet" : "Every photo, no misses"}
        </h1>
        <p className="mt-4 text-lg text-chalk-dim">
          {state.order.length === 0
            ? "Country Streak needs photos taken in countries the globe draws."
            : region
              ? `You named the country of all ${photos(state.streak)} taken in ${region}.`
              : `You named the country of all ${photos(state.streak)} in the game.`}
          {state.order.length > 0 &&
            challenge &&
            ` ${streakChallengeLine(state.streak, challenge)}`}
        </p>
        <div className="mt-8 flex flex-wrap items-center gap-4">
          {state.order.length > 0 && (
            <button
              type="button"
              onClick={() => start()}
              className="rounded-full bg-gold px-6 py-3 font-semibold text-ocean-deep transition hover:brightness-110"
            >
              {challenge ? "Play a fresh run" : "Play again"}
            </button>
          )}
          {finished && finished.order.length > 0 && (
            <ChallengeButton run={finished} region={slug} answering={challenge} />
          )}
          <Link href="/" className="text-chalk-dim underline underline-offset-2 hover:text-chalk">
            Back to the main game
          </Link>
        </div>
      </main>
    );
  }

  // Atlas's first choice of country for this photo, from its precomputed guess.
  const atlasCountry = current?.atlas
    ? shortlist(current.atlas.topCountries ?? [])[0]?.country
    : undefined;
  const newBest = over && streak > bestBeforeRun;

  return (
    <main
      className="wb-stage relative h-dvh w-full overflow-hidden bg-ocean-deep"
      data-phase={answered ? "revealed" : "guessing"}
      data-photo={current?.photo.id}
    >
      <h1 className="sr-only">{`Whereabout: Country Streak, ${streak} in a row`}</h1>

      <div className="wb-photo">
        {current ? (
          <PhotoViewer
            src={current.photo.imageUrl}
            roundKey={current.photo.id}
            width={current.photo.width}
            height={current.photo.height}
          />
        ) : (
          <div
            className="wb-photo-placeholder h-full w-full"
            data-photo-placeholder="showing"
            aria-hidden="true"
          />
        )}
      </div>

      <header className="wb-header pointer-events-none absolute inset-x-0 top-0 z-20 flex items-start justify-between gap-4 px-4 pt-4 md:px-6">
        <div className="min-w-0">
          <Link
            href="/"
            className="pointer-events-auto font-sign text-3xl font-extrabold leading-none tracking-tight md:text-4xl"
          >
            Whereabout
          </Link>
          <p className="mt-1 text-sm text-chalk-dim">
            {challenge
              ? `A friend's challenge: ${countries(challenge.streak)} in a row to beat`
              : region
                ? `Country Streak in ${region}: ${photos(regions[region]!.length)}`
                : "Country Streak: name the country"}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <GamesMenu screen="streak" streakHref={slug ? `/streak?region=${slug}` : "/streak"} />
            {regionList.length > 0 && (
              <select
                aria-label="Which photos: from anywhere, or taken on one continent"
                value={slug ?? "any"}
                onChange={(e) => {
                  dropChallengeParam();
                  pickRegion(regionFromSlug(e.target.value));
                }}
                className="pointer-events-auto max-w-40 rounded-full border border-chalk/30 bg-ocean-deep/60 py-1 pl-3 pr-1 text-xs font-semibold text-chalk backdrop-blur transition hover:border-chalk"
              >
                <option value="any">Anywhere</option>
                <optgroup label="One continent">
                  {regionList.map((c) => (
                    <option key={c} value={regionSlug(c)}>
                      {c}
                    </option>
                  ))}
                </optgroup>
              </select>
            )}
          </div>
        </div>
        <dl className="pointer-events-auto text-right">
          <div>
            <dt className="text-sm text-chalk-dim">Streak</dt>
            <dd className="font-sign tabular text-3xl font-bold leading-none" aria-live="polite">
              {streak}
            </dd>
          </div>
          <div className="mt-1 flex justify-end gap-1.5 text-sm text-chalk-dim">
            <dt>{region ? `Best in ${region}` : "Best"}</dt>
            <dd className="tabular">{best}</dd>
          </div>
        </dl>
      </header>

      <div className="wb-globe-panel z-10" data-pinned={pick ? "true" : "false"}>
        <div className="wb-globe-frame">
          <Globe
            pin={pick?.at ?? null}
            onPinChange={onPinChange}
            disabled={state.phase !== "guessing" || !current}
            reveal={reveal}
            countries={marks}
            className="h-full"
          />
        </div>
        {!answered && (
          <div className="wb-guess-bar">
            <button
              type="button"
              onClick={confirm}
              disabled={state.phase !== "guessing" || !current || !pick?.country}
              className="w-full rounded-full bg-flare px-4 py-3 font-semibold text-ocean-deep transition enabled:hover:brightness-110 disabled:cursor-not-allowed disabled:bg-chalk/15 disabled:text-chalk-dim"
            >
              {!pick
                ? "Tap the country on the globe"
                : pick.country
                  ? `It's ${countryName(pick.country)}`
                  : "That's the sea. Tap a country"}
            </button>
            {notice && state.phase === "guessing" && state.index === 0 && (
              <p role="status" className="mt-2 text-center text-sm text-chalk-dim">
                {notice}
              </p>
            )}
            {error && (
              <p role="alert" className="mt-2 text-center text-sm text-flare">
                {error}
              </p>
            )}
          </div>
        )}
      </div>

      {answered && current && (
        <div className="wb-reveal pointer-events-none absolute z-30">
          <StreakCard
            key={`${state.phase}-${answered.index}`}
            correct={answered.answer.correct}
            truth={answered.answer.truth}
            guess={answered.answer.guess}
            record={current}
            atlasCountry={atlasCountry}
            streak={streak}
            best={best}
            newBest={newBest}
            region={region ?? null}
            challenge={challenge}
            friendPick={
              challenge ? friendMissCountry(challenge, answered.index, answered.answer.truth) : null
            }
            finished={finished}
            regionSlug={slug}
            onNext={over ? () => start() : () => dispatch({ type: "next" })}
          />
        </div>
      )}
    </main>
  );
}

function StreakCard({
  correct,
  truth,
  guess,
  record,
  atlasCountry,
  streak,
  best,
  newBest,
  region,
  challenge,
  friendPick,
  finished,
  regionSlug: slugOfRegion,
  onNext,
}: {
  correct: boolean;
  truth: string;
  guess: string;
  record: GameRecord;
  atlasCountry: string | undefined;
  streak: number;
  best: number;
  newBest: boolean;
  /** The continent the run is dealt from, whose own best this run counts towards. */
  region: Continent | null;
  /** The friend's challenge this run answers, if it is one. */
  challenge: StreakChallenge | null;
  /** The country the friend tapped on this photo, when it ended their run on a miss. */
  friendPick: string | null;
  /** The run as it ended, once it has: the challenge link its end can send. */
  finished: FinishedStreakRun | null;
  /** The slug of the continent the run is dealt from, which a challenge link keeps. */
  regionSlug: string | null;
  onNext: () => void;
}) {
  const nextRef = useRef<HTMLButtonElement>(null);
  const { credit } = record.photo;
  useEffect(() => {
    nextRef.current?.focus({ preventScroll: true });
  }, []);

  return (
    <section
      aria-labelledby="streak-answer"
      className="wb-card pointer-events-auto w-full max-w-md rounded-2xl border border-graticule/70 bg-ocean-deep/95 p-4 shadow-2xl md:p-6"
    >
      <p className={`text-sm ${correct ? "text-sonar" : "text-flare"}`}>
        {correct ? "Right!" : `Not ${countryName(guess)}.`}
      </p>
      <h2
        id="streak-answer"
        className="font-sign text-3xl font-extrabold leading-tight text-chalk md:text-5xl"
      >
        {correct ? `It's ${countryName(truth)}` : `It was ${countryName(truth)}`}
      </h2>
      <p className="mt-1 text-chalk-dim">{record.photo.place}</p>
      {atlasCountry && (
        <p className="mt-3 text-sm text-chalk-dim">
          Atlas said <span className="text-sonar">{countryName(atlasCountry)}</span>
          {atlasCountry === truth ? ", and it was right." : "."}
        </p>
      )}
      {friendPick && (
        <p className="mt-1 text-sm text-chalk-dim" data-friend-pick={friendPick}>
          {`Your friend said ${countryName(friendPick)}, and their run ended here.`}
        </p>
      )}
      {challenge && correct && streak === challenge.streak + 1 && (
        <p className="mt-3 font-semibold text-sonar">
          {`That beats your friend's ${challenge.streak} in a row!`}
        </p>
      )}
      {correct ? (
        <p className="mt-3 text-chalk">{streak} in a row. Keep going until you miss.</p>
      ) : (
        <p className="mt-3 text-chalk">
          {`Your streak ends at ${photos(streak)}. `}
          {challenge
            ? streakChallengeLine(streak, challenge)
            : newBest
              ? region
                ? `That's your new best in ${region}!`
                : "That's your new best!"
              : region
                ? `Your best in ${region} is ${best}.`
                : `Your best is ${best}.`}
        </p>
      )}
      <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 md:mt-5">
        <button
          ref={nextRef}
          type="button"
          onClick={onNext}
          className="shrink-0 rounded-full bg-gold px-6 py-3 font-semibold text-ocean-deep transition hover:brightness-110"
        >
          {correct ? "Next photo" : challenge ? "Play a fresh run" : "Start a new streak"}
        </button>
        {!correct && finished ? (
          <ChallengeButton run={finished} region={slugOfRegion} answering={challenge} compact />
        ) : (
          <a
            href={credit.sourceUrl}
            target="_blank"
            rel="noreferrer"
            className="min-w-0 truncate text-xs text-chalk-dim underline decoration-graticule underline-offset-2 hover:text-chalk"
          >
            Photo: {credit.author}, {credit.license}
          </a>
        )}
      </div>
      {!correct && finished && (
        <a
          href={credit.sourceUrl}
          target="_blank"
          rel="noreferrer"
          className="mt-2 block truncate text-xs text-chalk-dim underline decoration-graticule underline-offset-2 hover:text-chalk"
        >
          Photo: {credit.author}, {credit.license}
        </a>
      )}
    </section>
  );
}

/**
 * Challenge a friend from a finished run (src/lib/game/streakChallenge.ts): a link to the same
 * photos in the same order, and the streak to beat. Answering a challenge, it sends the reply back.
 */
function ChallengeButton({
  run,
  region,
  answering,
  compact = false,
}: {
  run: FinishedStreakRun;
  region: string | null;
  answering: StreakChallenge | null;
  /** On the answer card, where it shares a row with the button for a new run. */
  compact?: boolean;
}) {
  const [sent, setSent] = useState("");
  async function send() {
    const text = streakChallengeText(run, window.location.href, region, answering ?? undefined);
    setSent(CHALLENGE_NOTE[await sendShare(text, navigator)]);
  }
  return (
    <span className={compact ? "flex min-w-0 flex-col" : "flex flex-col"}>
      <button
        type="button"
        onClick={send}
        className={`rounded-full border-2 border-gold font-semibold text-gold transition hover:bg-gold/10 ${compact ? "px-4 py-2" : "px-5 py-2.5"}`}
      >
        {answering ? "Send yours back" : "Challenge a friend"}
      </button>
      <span role="status" className={sent ? "mt-1 text-xs text-chalk-dim" : "sr-only"}>
        {sent}
      </span>
    </span>
  );
}
