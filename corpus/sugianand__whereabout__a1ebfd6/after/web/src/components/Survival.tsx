"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";

import { seededShuffle } from "@/lib/game/daily";
import { fetchRecords, type Deck, type GameRecord } from "@/lib/game/deck";
import {
  HEAL_KM,
  HEAL_POINTS,
  SURVIVAL_HEALTH,
  betterRun,
  initialSurvival,
  loadBestSurvival,
  rememberSurvival,
  survivalOver,
  survivalReducer,
  type SurvivalBest,
  type SurvivalRound,
} from "@/lib/game/survival";
import {
  SURVIVAL_CHALLENGE_PARAM,
  friendHealthAt,
  friendRunEndedAt,
  parseSurvivalChallenge,
  survivalChallengeLine,
  survivalChallengeOrder,
  survivalChallengeText,
  type FinishedSurvivalRun,
  type SurvivalChallenge,
} from "@/lib/game/survivalChallenge";
import { formatDistance, formatPoints, haversineKm, type LngLat } from "@/lib/geo";
import type { RevealView } from "@/lib/reveal";
import { sendShare, type ShareOutcome } from "@/lib/share";
import type { Units } from "@/lib/units";
import { useUnits } from "@/lib/useUnits";

import GamesMenu from "./GamesMenu";
import Globe from "./Globe";
import PhotoViewer from "./PhotoViewer";
import UnitsSwitch from "./UnitsSwitch";

type SurvivalProps = {
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

/** "7 photos, 21,400 points". */
function runLine(run: SurvivalBest): string {
  return `${photos(run.survived)}, ${formatPoints(run.total)} points`;
}

/** Why a challenge link was set aside for a fresh run. */
export const SURVIVAL_CHALLENGE_NOTICE = {
  malformed: "That challenge link was cut short, so here's a fresh run instead.",
  missing: "That challenge's photos aren't in the game any more, so here's a fresh run instead.",
} as const;

/** The challenge the address carries, read once as the page opens; null without one. */
function linkedChallenge(dealable: readonly string[]) {
  const value = new URLSearchParams(window.location.search).get(SURVIVAL_CHALLENGE_PARAM);
  return value === null ? null : parseSurvivalChallenge(value, dealable);
}

/** Take the challenge out of the address, so a reload deals a fresh run, not the old link. */
function dropChallengeParam() {
  const url = new URL(window.location.href);
  if (!url.searchParams.has(SURVIVAL_CHALLENGE_PARAM)) return;
  url.searchParams.delete(SURVIVAL_CHALLENGE_PARAM);
  window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
}

const CHALLENGE_NOTE: Record<ShareOutcome, string> = {
  shared: "Challenge sent.",
  copied: "Challenge link copied. Whoever opens it plays these photos, in this order.",
  cancelled: "",
  failed: "Couldn't copy the link. Your browser blocked the clipboard.",
};

const share = (health: number) => Math.max(0, Math.min(1, health / SURVIVAL_HEALTH));

/**
 * The bar itself: the share of health left, gold when full and turning red as it runs low. In a
 * challenge, a tick marks where the friend's bar stood at the same point of their run.
 */
function HealthBar({ health, friend }: { health: number; friend: number | null }) {
  const mine = share(health);
  const tone = mine > 0.5 ? "bg-sonar" : mine > 0.2 ? "bg-gold" : "bg-flare";
  return (
    <div className="relative">
      <div
        role="meter"
        aria-label="Health"
        aria-valuemin={0}
        aria-valuemax={SURVIVAL_HEALTH}
        aria-valuenow={health}
        aria-valuetext={`${formatPoints(health)} of ${formatPoints(SURVIVAL_HEALTH)}`}
        className="h-2.5 w-36 overflow-hidden rounded-full bg-chalk/15 md:w-48"
      >
        <div
          className={`h-full rounded-full transition-[width] duration-700 motion-reduce:transition-none ${tone}`}
          style={{ width: `${mine * 100}%` }}
        />
      </div>
      {friend !== null && (
        <div
          aria-hidden="true"
          data-friend-health={friend}
          className="absolute -top-1 h-[1.125rem] w-0.5 -translate-x-1/2 rounded-full bg-chalk shadow-[0_0_0_1px_rgba(0,0,0,0.5)] transition-[left] duration-700 motion-reduce:transition-none"
          style={{ left: `${share(friend) * 100}%` }}
        />
      )}
    </div>
  );
}

/**
 * Survival (src/lib/game/survival.ts): one photo after another, pinned on the globe, until the
 * misses empty a 5,000-point health bar. A pin within 25 km heals.
 */
export default function Survival({ deck, loadRecords, random }: SurvivalProps) {
  const [state, dispatch] = useReducer(survivalReducer, initialSurvival);
  const [best, setBest] = useState<SurvivalBest | null>(null);
  // The best before this run, so the end card can say when it was beaten.
  const [bestBeforeRun, setBestBeforeRun] = useState<SurvivalBest | null>(null);
  const [records, setRecords] = useState<ReadonlyMap<string, GameRecord>>(() => new Map());
  const [error, setError] = useState<string | null>(null);
  const units = useUnits();
  // The run's seed, which a challenge link carries so a friend plays on in the same order.
  const [seed, setSeed] = useState(0);
  // A friend's challenge this run answers: their photos, their bar after each, and how far.
  const [challenge, setChallenge] = useState<SurvivalChallenge | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  /** Deal a run; `fromLink` takes up a challenge the address carries, as the page opens. */
  const start = useCallback(
    (fromLink = false) => {
      const stored = loadBestSurvival();
      setBestBeforeRun(stored);
      setBest(stored);
      const linked = fromLink ? linkedChallenge(deck.ids) : null;
      setNotice(linked && !linked.ok ? SURVIVAL_CHALLENGE_NOTICE[linked.reason] : null);
      if (linked?.ok) {
        const { challenge: c } = linked;
        setChallenge(c);
        setSeed(c.seed);
        dispatch({ type: "start", order: survivalChallengeOrder(c, deck.ids) });
        return;
      }
      setChallenge(null);
      dropChallengeParam();
      const fresh = Math.floor((random ?? Math.random)() * 2 ** 32);
      setSeed(fresh);
      dispatch({ type: "start", order: seededShuffle(deck.ids, fresh) });
    },
    [deck.ids, random],
  );

  // The order is shuffled (and the address's challenge read) in the browser after hydration,
  // never at build time.
  useEffect(() => {
    const id = requestAnimationFrame(() => start(true));
    return () => cancelAnimationFrame(id);
  }, [start]);

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

  const onPinChange = useCallback((pin: LngLat) => dispatch({ type: "pinned", pin }), []);

  const answered = state.phase === "answered" ? state : null;
  const over = survivalOver(state);
  const run = state.phase === "idle" ? null : { survived: state.survived, total: state.total };

  function guess() {
    if (state.phase !== "guessing" || !current || !state.pin) return;
    const action = { type: "answered", truth: current.photo } as const;
    // Keep the run as the best after every round that beats it, so leaving mid-run keeps it.
    // A challenge's photos may have been seen before, so it never counts toward the best.
    const after = survivalReducer(state, action);
    if (after.phase === "answered" && !challenge) {
      setBest(rememberSurvival({ survived: after.survived, total: after.total }));
    }
    dispatch(action);
  }

  const reveal = useMemo<RevealView | null>(() => {
    if (!answered || !current) return null;
    const guesses: RevealView["guesses"] = [{ actor: "player", at: answered.pin }];
    if (current.atlas) guesses.push({ actor: "atlas", at: current.atlas });
    return { truth: current.photo, guesses };
  }, [answered, current]);

  const health = state.phase === "idle" ? SURVIVAL_HEALTH : state.health;
  const newBest = over && !challenge && run !== null && betterRun(run, bestBeforeRun);
  // The friend's bar at the same point of their run: before this photo while pinning it, after
  // it once answered.
  const friendHealth =
    challenge && state.phase !== "idle" ? friendHealthAt(challenge, state.healths.length) : null;
  // The run as it ended, for the challenge link its end can send.
  const finished: FinishedSurvivalRun | null =
    over && state.phase !== "idle"
      ? {
          order: state.order,
          seed,
          healths: state.healths,
          survived: state.survived,
          total: state.total,
        }
      : null;

  if (state.phase === "cleared") {
    return (
      <main className="mx-auto flex min-h-dvh w-full max-w-xl flex-col justify-center px-6 py-16">
        <p className="text-sm text-gold">Survival</p>
        <h1 className="mt-2 font-sign text-5xl font-extrabold leading-none tracking-tight">
          {state.order.length === 0 ? "No photos to play yet" : "You outlasted every photo"}
        </h1>
        <p className="mt-4 text-lg text-chalk-dim">
          {state.order.length === 0
            ? "Survival needs photos to deal."
            : `${runLine(state)}, with ${formatPoints(state.health)} health to spare.`}
          {state.order.length > 0 && challenge && ` ${survivalChallengeLine(state, challenge)}`}
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
          {finished && finished.healths.length > 0 && (
            <ChallengeButton run={finished} answering={challenge} />
          )}
          <Link href="/" className="text-chalk-dim underline underline-offset-2 hover:text-chalk">
            Back to the main game
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main
      className="wb-stage relative h-dvh w-full overflow-hidden bg-ocean-deep"
      data-phase={answered ? "revealed" : "guessing"}
      data-photo={current?.photo.id}
    >
      <h1 className="sr-only">{`Whereabout: Survival, ${formatPoints(health)} health left`}</h1>

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
              ? `A friend's challenge: ${photos(challenge.survived)} to outlast`
              : "Survival: last as long as you can"}
          </p>
          <div className="mt-2">
            <GamesMenu screen="survival" streakHref="/streak" />
          </div>
        </div>
        <div className="pointer-events-auto flex flex-col items-end text-right">
          <dl>
            <dt className="text-sm text-chalk-dim">Health</dt>
            <dd className="font-sign tabular text-3xl font-bold leading-none" aria-live="polite">
              {formatPoints(health)}
            </dd>
          </dl>
          <div className="mt-1.5">
            <HealthBar health={health} friend={friendHealth} />
          </div>
          <dl className="mt-1 text-sm text-chalk-dim">
            <div className="flex justify-end gap-1.5">
              <dt>Survived</dt>
              <dd className="tabular">{run?.survived ?? 0}</dd>
            </div>
            {challenge ? (
              <div className="flex justify-end gap-1.5">
                <dt>Friend</dt>
                <dd className="tabular">
                  {friendHealth === null
                    ? "still going"
                    : friendHealth === 0
                      ? "out"
                      : formatPoints(friendHealth)}
                </dd>
              </div>
            ) : (
              <div className="flex justify-end gap-1.5">
                <dt>Best</dt>
                <dd className="tabular">{best ? best.survived : 0}</dd>
              </div>
            )}
          </dl>
        </div>
      </header>

      <div
        className="wb-globe-panel z-10"
        data-pinned={state.phase === "guessing" && state.pin ? "true" : "false"}
      >
        <div className="wb-globe-frame">
          <Globe
            pin={state.phase === "guessing" || state.phase === "answered" ? state.pin : null}
            onPinChange={onPinChange}
            disabled={state.phase !== "guessing" || !current}
            reveal={reveal}
            className="h-full"
          />
        </div>
        {!answered && (
          <div className="wb-guess-bar">
            <button
              type="button"
              onClick={guess}
              disabled={state.phase !== "guessing" || !current || !state.pin}
              className="w-full rounded-full bg-flare px-4 py-3 font-semibold text-ocean-deep transition enabled:hover:brightness-110 disabled:cursor-not-allowed disabled:bg-chalk/15 disabled:text-chalk-dim"
            >
              {state.phase === "guessing" && state.pin
                ? "Guess here"
                : "Place your pin on the globe"}
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

      {answered && current && run && (
        <div className="wb-reveal pointer-events-none absolute z-30">
          <SurvivalCard
            key={answered.index}
            round={answered.round}
            record={current}
            units={units}
            over={over}
            run={run}
            best={best}
            newBest={newBest}
            challenge={challenge}
            friendHealth={friendHealth}
            friendEnded={challenge ? friendRunEndedAt(challenge, answered.index) : false}
            finished={finished}
            onNext={over ? () => start() : () => dispatch({ type: "next" })}
          />
        </div>
      )}
    </main>
  );
}

function SurvivalCard({
  round,
  record,
  units,
  over,
  run,
  best,
  newBest,
  challenge,
  friendHealth,
  friendEnded,
  finished,
  onNext,
}: {
  round: SurvivalRound;
  record: GameRecord;
  units: Units;
  over: boolean;
  run: SurvivalBest;
  best: SurvivalBest | null;
  newBest: boolean;
  /** The friend's challenge this run answers, if it is one. */
  challenge: SurvivalChallenge | null;
  /** The friend's health after this same photo, when the link says. */
  friendHealth: number | null;
  /** True when this photo is the one that emptied the friend's bar. */
  friendEnded: boolean;
  /** The run as it ended, once it has: the challenge link its end can send. */
  finished: FinishedSurvivalRun | null;
  onNext: () => void;
}) {
  const nextRef = useRef<HTMLButtonElement>(null);
  const { credit } = record.photo;
  useEffect(() => {
    nextRef.current?.focus({ preventScroll: true });
  }, []);
  const change = round.after - round.before;
  const atlasKm = record.atlas ? haversineKm(record.atlas, record.photo) : null;

  return (
    <section
      aria-labelledby="survival-answer"
      className="wb-card pointer-events-auto w-full max-w-md rounded-2xl border border-graticule/70 bg-ocean-deep/95 p-4 shadow-2xl md:p-6"
    >
      <div className="flex items-center justify-between gap-3">
        <p className={`text-sm ${round.healed ? "text-sonar" : "text-flare"}`}>
          {round.healed
            ? change > 0
              ? `Within ${formatDistance(HEAL_KM, units)}: +${formatPoints(change)} health`
              : `Within ${formatDistance(HEAL_KM, units)}: health already full`
            : `${change < 0 ? "−" : ""}${formatPoints(Math.abs(change))} health`}
        </p>
        <UnitsSwitch />
      </div>
      <h2
        id="survival-answer"
        className="font-sign text-3xl font-extrabold leading-tight text-chalk md:text-5xl"
      >
        {formatDistance(round.distanceKm, units)} away
      </h2>
      <p className="mt-1 text-chalk-dim">
        {record.photo.place} · {formatPoints(round.score)} points
      </p>
      {atlasKm !== null && (
        <p className="mt-3 text-sm text-chalk-dim">
          Atlas was <span className="text-sonar">{formatDistance(atlasKm, units)}</span> away
          {atlasKm < round.distanceKm ? ", closer than you." : "."}
        </p>
      )}
      {challenge && friendHealth !== null && (
        <p className="mt-1 text-sm text-chalk-dim" data-friend-after={friendHealth}>
          {friendEnded
            ? "Your friend's bar ran out on this photo."
            : friendHealth === 0
              ? "Your friend was already out of health by here."
              : `Your friend had ${formatPoints(friendHealth)} health after this photo.`}
        </p>
      )}
      {challenge && !over && run.survived === challenge.survived + 1 && (
        <p className="mt-3 font-semibold text-sonar">
          {`That outlasts your friend's ${photos(challenge.survived)}!`}
        </p>
      )}
      {over ? (
        <p className="mt-3 text-chalk">
          {`Out of health. You survived ${runLine(run)}. `}
          {challenge
            ? survivalChallengeLine(run, challenge)
            : newBest
              ? "That's your new best!"
              : best
                ? `Your best is ${runLine(best)}.`
                : ""}
        </p>
      ) : (
        <p className="mt-3 text-chalk">
          {`${formatPoints(round.after)} health left. A pin within ${formatDistance(HEAL_KM, units)} heals ${formatPoints(HEAL_POINTS)}.`}
        </p>
      )}
      <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 md:mt-5">
        <button
          ref={nextRef}
          type="button"
          onClick={onNext}
          className="shrink-0 rounded-full bg-gold px-6 py-3 font-semibold text-ocean-deep transition hover:brightness-110"
        >
          {over ? (challenge ? "Play a fresh run" : "Start a new run") : "Next photo"}
        </button>
        {finished ? (
          <ChallengeButton run={finished} answering={challenge} compact />
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
      {finished && (
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
 * Challenge a friend from a finished run (src/lib/game/survivalChallenge.ts): a link to the same
 * photos in the same order, with the bar after each. Answering a challenge, it sends the reply.
 */
function ChallengeButton({
  run,
  answering,
  compact = false,
}: {
  run: FinishedSurvivalRun;
  answering: SurvivalChallenge | null;
  /** On the answer card, where it shares a row with the button for a new run. */
  compact?: boolean;
}) {
  const [sent, setSent] = useState("");
  async function send() {
    const text = survivalChallengeText(run, window.location.href, answering ?? undefined);
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
