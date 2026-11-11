"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";

import { seededShuffle } from "@/lib/game/daily";
import { runToday } from "@/lib/game/dailyRuns";
import { fetchRecords, type Deck, type GameRecord } from "@/lib/game/deck";
import { dailyFarPairs, farDailyShare, loadFarDay, rememberFarDay } from "@/lib/game/farDaily";
import {
  MAX_KM,
  PAIRS,
  PAIR_POINTS,
  SLIDER_STEPS,
  atlasTotal,
  continentLookup,
  dealPairs,
  describeEstimate,
  howFarReducer,
  initialHowFar,
  loadBestHowFar,
  pairGrade,
  rememberHowFar,
  scalePosition,
  stepToKm,
  totalPoints,
  type Estimate,
  type PairResult,
} from "@/lib/game/howFar";
import { formatDistance, formatPoints } from "@/lib/geo";
import { placeholderUrl, sources } from "@/lib/photoSources";
import { KM_PER_MILE, type Units } from "@/lib/units";
import { useUnits } from "@/lib/useUnits";

import ControlsHelp from "./ControlsHelp";
import { DailyRunResult } from "./DailyRunShare";
import GamesMenu from "./GamesMenu";
import UnitsSwitch from "./UnitsSwitch";

type HowFarProps = {
  deck: Deck;
  /** For tests: load records without the network. Defaults to fetching the static files. */
  loadRecords?: (ids: string[]) => Promise<GameRecord[]>;
  /** For tests: the randomness that shuffles each game. */
  random?: () => number;
  /**
   * Today's game (src/lib/game/farDaily.ts): the day's pairs, one try a day, picked back up after
   * a reload, kept apart from the free games' best.
   */
  daily?: boolean;
  /** For tests: the clock that picks today's game. */
  now?: () => Date;
};

/** The slider starts halfway along the scale, about 450 km, on every pair. */
const START_STEP = SLIDER_STEPS / 2;

/** Round labels along the scale in the player's units, as kilometres. */
function ticks(units: Units): number[] {
  const perUnit = units === "km" ? 1 : KM_PER_MILE;
  return [10, 100, 1000, 10_000].map((n) => n * perUnit).filter((km) => km <= MAX_KM);
}

/**
 * How far apart? (src/lib/game/howFar.ts): two photos, and a slider on a log scale to set how
 * far apart they were taken, scored by how many times off the estimate was. Five pairs a game,
 * with Atlas's estimate from its own two guesses beside the player's at each reveal.
 */
export default function HowFar({
  deck,
  loadRecords,
  random,
  daily = false,
  now,
}: HowFarProps) {
  const [state, dispatch] = useReducer(howFarReducer, initialHowFar);
  const [step, setStep] = useState(START_STEP);
  const [best, setBest] = useState(0);
  // The best before this game, so the end screen can say when it was beaten.
  const [bestBefore, setBestBefore] = useState(0);
  const [records, setRecords] = useState<ReadonlyMap<string, GameRecord>>(() => new Map());
  const [error, setError] = useState<string | null>(null);
  const units = useUnits();
  const sliderRef = useRef<HTMLInputElement>(null);

  // The day today's game was dealt for, kept when the clock passes midnight mid-game.
  const [day, setDay] = useState<string | null>(null);

  const start = useCallback(() => {
    if (daily) {
      const today = runToday(now?.());
      setDay(today);
      setStep(START_STEP);
      dispatch({
        type: "start",
        pairs: dailyFarPairs(deck.ids, deck.regions, today),
        results: loadFarDay(today)?.results,
      });
      return;
    }
    const seed = Math.floor((random ?? Math.random)() * 2 ** 32);
    const stored = loadBestHowFar();
    setBest(stored);
    setBestBefore(stored);
    setStep(START_STEP);
    dispatch({
      type: "start",
      pairs: dealPairs(seededShuffle(deck.ids, seed), continentLookup(deck.regions)),
    });
  }, [deck.ids, deck.regions, random, daily, now]);

  // The pairs are shuffled in the browser after hydration, never at build time.
  useEffect(() => {
    const id = requestAnimationFrame(start);
    return () => cancelAnimationFrame(id);
  }, [start]);

  const load = useCallback(
    (ids: string[]) => (loadRecords ? loadRecords(ids) : fetchRecords(deck, ids)),
    [deck, loadRecords],
  );

  // The pair on screen and the one after it, so the next pair opens without waiting.
  const wanted = useMemo(() => {
    if (state.phase !== "setting" && state.phase !== "answered") return [];
    return state.pairs.slice(state.index, state.index + 2).flat();
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

  const playing = state.phase === "setting" || state.phase === "answered" ? state : null;
  const pair = playing ? playing.pairs[playing.index] : null;
  const recA = pair ? records.get(pair[0]) : undefined;
  const recB = pair ? records.get(pair[1]) : undefined;
  const upcoming = playing?.pairs[playing.index + 1];

  // Warm the cache with the next pair's photos while the player reads the answer.
  useEffect(() => {
    if (!upcoming) return;
    for (const id of upcoming) {
      const r = records.get(id);
      if (r) new Image().src = sources(r.photo).src;
    }
  }, [upcoming, records]);

  const ready = state.phase === "setting" && recA !== undefined && recB !== undefined;
  const result = state.phase === "answered" ? state.results[state.results.length - 1] : null;

  const lockIn = useCallback(() => {
    if (state.phase !== "setting" || !recA || !recB) return;
    const action = {
      type: "estimated",
      km: stepToKm(step),
      a: recA.photo,
      b: recB.photo,
      atlasA: recA.atlas,
      atlasB: recB.atlas,
    } as const;
    const after = howFarReducer(state, action);
    if (after.phase === "answered" && day) {
      // Today's game is kept after every pair, so a reload picks up at the next one.
      rememberFarDay(day, { results: after.results });
    } else if (
      // The best is a whole game's points, kept as soon as its last pair is answered.
      after.phase === "answered" &&
      after.pairs.length === PAIRS &&
      after.index === after.pairs.length - 1
    ) {
      setBest(rememberHowFar(totalPoints(after.results)));
    }
    dispatch(action);
  }, [state, recA, recB, step, day]);

  const next = useCallback(() => {
    setStep(START_STEP);
    dispatch({ type: "next" });
  }, []);

  // Back on the slider for each new pair, so the arrow keys set it straight away.
  const settingIndex = state.phase === "setting" ? state.index : -1;
  useEffect(() => {
    if (settingIndex > 0) sliderRef.current?.focus({ preventScroll: true });
  }, [settingIndex]);

  if (state.phase === "finished") {
    if (day && state.results.length > 0) {
      return <FarDayResult day={day} results={state.results} units={units} now={now} />;
    }
    return (
      <Finished
        results={state.results}
        whole={state.pairs.length === PAIRS}
        best={best}
        newBest={totalPoints(state.results) > bestBefore && state.pairs.length === PAIRS}
        units={units}
        onAgain={start}
      />
    );
  }

  const index = playing?.index ?? 0;
  const pairCount = playing?.pairs.length ?? PAIRS;
  const score = totalPoints(playing?.results ?? []);

  return (
    <main
      className="relative flex h-dvh w-full flex-col overflow-hidden bg-ocean-deep"
      data-phase={result ? "revealed" : "setting"}
    >
      <h1 className="sr-only">{`Whereabout: How far apart?${day ? ", today's game" : ""}, pair ${index + 1} of ${pairCount}`}</h1>

      <header className="flex items-start justify-between gap-4 px-4 pb-2 pt-4 md:px-6">
        <div className="min-w-0">
          <Link
            href="/"
            className="font-sign text-3xl font-extrabold leading-none tracking-tight md:text-4xl"
          >
            Whereabout
          </Link>
          <p className="mt-1 text-sm text-chalk-dim">
            {day
              ? `How far apart?, today's game (${day}): pair ${index + 1} of ${pairCount}`
              : `How far apart? Pair ${index + 1} of ${pairCount}`}
          </p>
          <Link
            href={daily ? "/how-far" : "/how-far/daily"}
            className="mt-0.5 inline-block text-sm text-gold underline underline-offset-2 hover:brightness-110"
          >
            {daily ? "Free games" : "Today's game"}
          </Link>
        </div>
        <div className="flex shrink-0 items-start gap-3">
          <GamesMenu screen="how-far" streakHref="/streak" />
          <ControlsHelp screen="how-far" />
          <dl className="text-right">
            <dt className="text-sm text-chalk-dim">Score</dt>
            <dd className="font-sign tabular text-3xl font-bold leading-none" aria-live="polite">
              {formatPoints(score)}
            </dd>
            {!daily && (
              <div className="mt-1 flex justify-end gap-1.5 text-sm text-chalk-dim">
                <dt>Best</dt>
                <dd className="tabular">{formatPoints(best)}</dd>
              </div>
            )}
          </dl>
        </div>
      </header>

      <div className="grid min-h-0 flex-1 grid-rows-2 gap-2 px-2 md:grid-cols-2 md:grid-rows-1 md:gap-3 md:px-6">
        {[recA, recB].map((record, i) => (
          <PairPhoto key={i} n={i + 1} record={record} revealed={result !== null} />
        ))}
      </div>

      {error && (
        <p role="alert" className="px-4 pt-2 text-center text-sm text-flare">
          {error}
        </p>
      )}

      <div className="flex justify-center p-2 md:p-4">
        {result && recA && recB ? (
          <HowFarCard
            key={index}
            result={result}
            places={[recA.photo.place, recB.photo.place]}
            units={units}
            last={index + 1 >= pairCount}
            onNext={next}
          />
        ) : (
          <EstimatePanel
            sliderRef={sliderRef}
            step={step}
            units={units}
            ready={ready}
            onStep={setStep}
            onLockIn={lockIn}
          />
        )}
      </div>
    </main>
  );
}

function PairPhoto({
  n,
  record,
  revealed,
}: {
  n: number;
  record: GameRecord | undefined;
  revealed: boolean;
}) {
  const photo = record?.photo;
  const src = photo ? sources(photo) : null;
  const blur = photo ? placeholderUrl(photo.imageUrl) : null;
  return (
    <div
      className="relative min-h-0 overflow-hidden rounded-2xl border-2 border-graticule bg-graticule/40"
      data-testid={`how-far-photo-${n}`}
      data-photo={photo?.id}
      style={blur ? { backgroundImage: `url(${blur})`, backgroundSize: "cover" } : undefined}
    >
      {src && (
        // Wikimedia thumbnails, already sized; next/image can't optimise a static export.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          key={photo!.id}
          src={src.src}
          srcSet={src.srcSet}
          sizes="(min-width: 768px) 50vw, 100vw"
          alt={`Photo ${n}`}
          decoding="async"
          className="absolute inset-0 h-full w-full object-cover"
        />
      )}
      <span className="absolute left-2 top-2 rounded-full bg-ocean-deep/85 px-2.5 py-0.5 font-sign text-lg font-extrabold">
        {n}
      </span>
      {revealed && photo && (
        <span className="absolute right-2 top-2 ml-9 max-w-[calc(100%-3.5rem)] truncate rounded-full bg-ocean-deep/85 px-2.5 py-0.5 text-sm">
          {photo.place}
        </span>
      )}
      {photo && (
        <a
          href={photo.credit.sourceUrl}
          target="_blank"
          rel="noreferrer"
          className="absolute bottom-1 right-2 max-w-[70%] truncate text-[11px] text-chalk-dim underline decoration-graticule underline-offset-2 hover:text-chalk"
        >
          Photo: {photo.credit.author}, {photo.credit.license}
        </a>
      )}
    </div>
  );
}

/** The scale's labels under the slider or the reveal's markers. */
function ScaleLabels({ units, className = "mt-1" }: { units: Units; className?: string }) {
  return (
    <div className={`relative h-4 text-xs text-chalk-dim ${className}`} aria-hidden="true">
      {ticks(units).map((km) => {
        const x = scalePosition(km) * 100;
        return (
          <span
            key={km}
            // Labels near an end line up with it rather than spill past the scale.
            className={`absolute whitespace-nowrap tabular ${x < 5 ? "" : x > 85 ? "-translate-x-full" : "-translate-x-1/2"}`}
            style={{ left: `${x}%` }}
          >
            {formatDistance(km, units)}
          </span>
        );
      })}
    </div>
  );
}

function EstimatePanel({
  sliderRef,
  step,
  units,
  ready,
  onStep,
  onLockIn,
}: {
  sliderRef: React.RefObject<HTMLInputElement | null>;
  step: number;
  units: Units;
  ready: boolean;
  onStep: (step: number) => void;
  onLockIn: () => void;
}) {
  const km = stepToKm(step);
  const shown = formatDistance(km, units);
  return (
    <section
      aria-label="Your estimate"
      className="w-full max-w-xl rounded-2xl border border-graticule/70 bg-ocean-deep/95 p-3 md:p-4"
    >
      <div className="flex items-baseline justify-between gap-3">
        <label htmlFor="how-far-slider" className="text-sm text-chalk-dim">
          How far apart were these taken?
        </label>
        <output
          htmlFor="how-far-slider"
          className="font-sign tabular text-2xl font-bold leading-none text-gold"
          data-testid="how-far-estimate"
        >
          {shown}
        </output>
      </div>
      <input
        ref={sliderRef}
        id="how-far-slider"
        type="range"
        min={0}
        max={SLIDER_STEPS}
        step={1}
        value={step}
        aria-valuetext={shown}
        onChange={(e) => onStep(Number(e.target.value))}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            onLockIn();
          }
        }}
        className="mt-3 w-full accent-gold"
      />
      <ScaleLabels units={units} />
      <button
        type="button"
        onClick={onLockIn}
        disabled={!ready}
        className="mt-2 w-full rounded-full bg-gold px-6 py-2.5 font-semibold text-ocean-deep transition hover:brightness-110 disabled:cursor-wait disabled:opacity-60 md:w-auto"
      >
        Lock it in
      </button>
    </section>
  );
}

/** The truth, the player's estimate and Atlas's, each placed on the log scale. */
function RevealScale({ result, units }: { result: PairResult; units: Units }) {
  const marks: { key: string; km: number; label: string; className: string }[] = [
    { key: "actual", km: result.actualKm, label: "Truth", className: "bg-gold text-ocean-deep" },
    { key: "you", km: result.you.km, label: "You", className: "bg-sonar text-ocean-deep" },
  ];
  if (result.atlas) {
    marks.push({
      key: "atlas",
      km: result.atlas.km,
      label: "Atlas",
      className: "bg-chalk text-ocean-deep",
    });
  }
  return (
    <div className="mt-3" aria-hidden="true">
      <div className="relative h-14">
        <div className="absolute inset-x-0 top-1/2 h-0.5 -translate-y-1/2 rounded-full bg-chalk/20" />
        {marks.map((m, i) => (
          <span
            key={m.key}
            data-testid={`how-far-mark-${m.key}`}
            className={`absolute whitespace-nowrap rounded-full px-1.5 py-px text-[11px] font-semibold ${m.className}`}
            // Truth sits on the line; you above it and Atlas below, so close marks never cover.
            style={{
              left: `${Math.min(96, Math.max(4, scalePosition(m.km) * 100))}%`,
              top: i === 0 ? "50%" : i === 1 ? "0" : "100%",
              transform: `translate(-50%, ${i === 0 ? "-50%" : i === 1 ? "0" : "-100%"})`,
            }}
          >
            {m.label}
          </span>
        ))}
      </div>
      <ScaleLabels units={units} className="mt-2" />
    </div>
  );
}

function verdictColour(e: Estimate): string {
  return { close: "text-sonar", off: "text-gold", miss: "text-flare" }[pairGrade(e.points)];
}

function HowFarCard({
  result,
  places,
  units,
  last,
  onNext,
}: {
  result: PairResult;
  places: readonly [string, string];
  units: Units;
  last: boolean;
  onNext: () => void;
}) {
  const nextRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    nextRef.current?.focus({ preventScroll: true });
  }, []);
  const { you, atlas, actualKm } = result;
  const atlasWins = atlas !== null && atlas.points > you.points;

  return (
    <section
      aria-labelledby="how-far-verdict"
      className="w-full max-w-xl rounded-2xl border border-graticule/70 bg-ocean-deep/95 p-3 shadow-2xl md:p-4"
    >
      <div className="flex items-center justify-between gap-3">
        <h2
          id="how-far-verdict"
          className={`font-sign text-3xl font-extrabold leading-tight ${verdictColour(you)}`}
        >
          {describeEstimate(you)}
        </h2>
        <span className="font-sign tabular text-2xl font-bold">{`+${formatPoints(you.points)}`}</span>
      </div>
      <p className="mt-1 text-chalk">
        {`${places[0]} and ${places[1]} are ${formatDistance(actualKm, units)} apart. You said ${formatDistance(you.km, units)}.`}
      </p>
      <RevealScale result={result} units={units} />
      <p className="mt-2 text-sm text-chalk-dim">
        {atlas
          ? `Atlas said ${formatDistance(atlas.km, units)} from its two guesses: ${describeEstimate(atlas).toLowerCase()}, ${formatPoints(atlas.points)} points${atlasWins ? ", closer than you" : ""}.`
          : "Atlas hasn't guessed both photos, so it sits this pair out."}
      </p>
      <div className="mt-3 flex items-center justify-between gap-3">
        <button
          ref={nextRef}
          type="button"
          onClick={onNext}
          className="rounded-full bg-gold px-6 py-3 font-semibold text-ocean-deep transition hover:brightness-110"
        >
          {last ? "See your score" : "Next pair"}
        </button>
        <UnitsSwitch />
      </div>
    </section>
  );
}

/** Every pair of a game: the real distance, what you said and its points. */
function PairList({ results, units }: { results: readonly PairResult[]; units: Units }) {
  return (
    <ol className="mt-6 space-y-2" aria-label="Your pairs">
      {results.map((r, i) => (
        <li
          key={i}
          className="flex items-baseline justify-between gap-3 rounded-xl border border-graticule/70 px-4 py-2"
        >
          <span className="min-w-0">
            <span className="text-chalk">{`${formatDistance(r.actualKm, units)} apart`}</span>
            <span className="block text-sm text-chalk-dim">
              {`You said ${formatDistance(r.you.km, units)}: ${describeEstimate(r.you).toLowerCase()}`}
            </span>
          </span>
          <span className="tabular font-semibold">{formatPoints(r.you.points)}</span>
        </li>
      ))}
    </ol>
  );
}

/** Atlas's game against yours, once its pairs are in: "Atlas scored 3,100 on the same pairs." */
function atlasLine(results: readonly PairResult[]): string | null {
  const atlas = atlasTotal(results);
  if (atlas.played === 0) return null;
  const pairs = atlas.played === results.length ? "same pairs" : `${atlas.played} of them it played`;
  return `Atlas scored ${formatPoints(atlas.points)} on the ${pairs}.`;
}

/** Today's How far apart? once its last pair is in. */
function FarDayResult({
  day,
  results,
  units,
  now,
}: {
  day: string;
  results: readonly PairResult[];
  units: Units;
  now?: () => Date;
}) {
  const line = atlasLine(results);
  return (
    <DailyRunResult
      game="How far apart?"
      day={day}
      headline={`${formatPoints(totalPoints(results))} points`}
      summary={`Out of ${formatPoints(results.length * PAIR_POINTS)}.${line ? ` ${line}` : ""}`}
      shareText={(href) => farDailyShare(day, results, href)}
      freeHref="/how-far"
      now={now}
    >
      <PairList results={results} units={units} />
    </DailyRunResult>
  );
}

function Finished({
  results,
  whole,
  best,
  newBest,
  units,
  onAgain,
}: {
  results: readonly PairResult[];
  whole: boolean;
  best: number;
  newBest: boolean;
  units: Units;
  onAgain: () => void;
}) {
  const none = results.length === 0;
  const total = totalPoints(results);
  const atlas = atlasLine(results);
  const max = results.length * PAIR_POINTS;

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-xl flex-col justify-center px-6 py-16">
      <p className="text-sm text-gold">How far apart?</p>
      <h1 className="mt-2 font-sign text-5xl font-extrabold leading-none tracking-tight">
        {none ? "No photos to play yet" : `${formatPoints(total)} points`}
      </h1>
      {none ? (
        <p className="mt-4 text-lg text-chalk-dim">
          How far apart? needs at least two photos to deal.
        </p>
      ) : (
        <>
          <p className="mt-4 text-lg text-chalk-dim">
            {`Out of ${formatPoints(max)}. `}
            {newBest
              ? "That's your new best!"
              : whole && best > 0
                ? `Your best is ${formatPoints(best)}.`
                : ""}
          </p>
          {atlas && (
            <p className="mt-2 text-chalk" data-testid="how-far-atlas-total">
              {atlas}
            </p>
          )}
          <PairList results={results} units={units} />
        </>
      )}
      <div className="mt-8 flex flex-wrap items-center gap-4">
        {!none && (
          <button
            type="button"
            onClick={onAgain}
            className="rounded-full bg-gold px-6 py-3 font-semibold text-ocean-deep transition hover:brightness-110"
          >
            Play again
          </button>
        )}
        <Link href="/" className="text-chalk-dim underline underline-offset-2 hover:text-chalk">
          Back to the main game
        </Link>
      </div>
    </main>
  );
}
