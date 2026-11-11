import { useCallback, useEffect, useRef, useState } from "react";

import { withBase } from "@/lib/apps/paths";
import { useAppLang, useLangReady } from "@/lib/apps/use-app-lang";
import { clearCareer, defaultCareer, difficultyFor, openPack, rankOf, readCareer, review, reviewXp, reviewXpToNext, writeCareer, type Career } from "@/lib/hr/career";
import { clock, HR_TEXT, quirkLine, type HrText } from "@/lib/hr/i18n";
import { bakeHero, loadSheet, type Sheet } from "@/lib/hr/render/heroes";
import { AUDIT_CLOSES, PACKS } from "@/lib/hr/sim/balance";
import { createRun } from "@/lib/hr/sim/run";
import type { Run } from "@/lib/hr/sim/types";
import { clearRun, readRun, writeRun } from "@/lib/hr/snapshot";
import { DEPARTMENTS } from "@/lib/roster/data";
import { defaultSave, readSave, writeSave } from "@/lib/roster/save";
import { STARTERS } from "@/lib/roster/generate";
import { STATS, type Coworker, type RosterSave } from "@/lib/roster/types";

import { RunView } from "./RunView";

interface Result {
  status: Run["status"];
  abandoned: boolean;
  /** The audit closed with the Auditor still standing. */
  closed: boolean;
  time: number;
  level: number;
  kills: number;
  gold: number;
  /** The performance review that followed: null when the coworker is gone from the roster. */
  review: { xp: number; level: number; levelsGained: number; promotedTo: number | null } | null;
}

export default function HrApp() {
  const lang = useAppLang();
  const text = HR_TEXT[lang];
  const readyRef = useLangReady<HTMLDivElement>();
  const [roster, setRoster] = useState<RosterSave | null>(null);
  const [career, setCareer] = useState<Career | null>(null);
  const [sheet, setSheet] = useState<Sheet | null>(null);
  const [saved, setSaved] = useState<Run | null>(null);
  const [run, setRun] = useState<Run | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  /** The card a pack just revealed. */
  const [revealed, setRevealed] = useState<Coworker | null>(null);

  // Storage and the sprite sheet only exist in the browser; read them after mount.
  useEffect(() => {
    const save = readSave();
    // Written straight back, so a first visit keeps the roster it was dealt.
    writeSave(save);
    setRoster(save);
    const stored = readCareer();
    // A focus who is no longer on the roster means the career starts again.
    setCareer(save.coworkers.some((coworker) => coworker.id === stored.focusId && coworker.status.kind !== "quit") ? stored : { ...stored, focusId: null });
    setSaved(readRun());
    let live = true;
    void loadSheet().then((loaded) => live && setSheet(loaded));
    return () => {
      live = false;
    };
  }, []);

  // The latest saves, for `finish`, which the run view holds on to.
  const rosterRef = useRef(roster);
  rosterRef.current = roster;
  const careerRef = useRef(career);
  careerRef.current = career;

  const coworkerOf = (target: Run | null) => roster?.coworkers.find((coworker) => coworker.id === target?.coworkerId) ?? null;

  const start = (coworker: Coworker) => {
    setResult(null);
    const next = createRun(coworker, Math.floor(Math.random() * 2 ** 31), difficultyFor(coworker.level, coworker.rarity));
    writeRun(next);
    setSaved(null);
    setRun(next);
  };

  const resume = () => {
    setResult(null);
    setRun(saved);
    setSaved(null);
  };

  /** One run is one day: the review raises the coworker, the day moves on, and the gold goes into savings. */
  const finish = useCallback((ended: Run) => {
    clearRun();
    const before = rosterRef.current;
    const worker = before?.coworkers.find((coworker) => coworker.id === ended.coworkerId);
    let reviewed: Result["review"] = null;
    if (before && worker) {
      const outcome = review(worker, reviewXp(ended.time, ended.status === "won"));
      const after: RosterSave = { ...before, day: before.day + 1, coworkers: before.coworkers.map((coworker) => (coworker.id === worker.id ? outcome.coworker : coworker)) };
      writeSave(after);
      setRoster(after);
      const current = careerRef.current ?? defaultCareer();
      const savings: Career = { ...current, gold: current.gold + Math.floor(ended.gold) };
      writeCareer(savings);
      setCareer(savings);
      reviewed = { xp: outcome.xp, level: outcome.coworker.level, levelsGained: outcome.levelsGained, promotedTo: outcome.promoted ? rankOf(outcome.coworker.level) : null };
    }
    setResult({
      status: ended.status,
      abandoned: ended.abandoned,
      closed: ended.status === "lost" && ended.hero.hp > 0 && ended.time >= AUDIT_CLOSES,
      time: ended.time,
      level: ended.level,
      kills: ended.kills,
      gold: Math.floor(ended.gold),
      review: reviewed,
    });
  }, []);

  const startCareer = (coworker: Coworker) => {
    const next: Career = { focusId: coworker.id, owned: [coworker.id], gold: 0 };
    writeCareer(next);
    setCareer(next);
  };

  const buyPack = () => {
    if (!roster || !career) return;
    const bought = openPack(roster, career);
    if (!bought) return;
    writeSave(bought.roster);
    writeCareer(bought.career);
    setRoster(bought.roster);
    setCareer(bought.career);
    setRevealed(bought.coworker);
  };

  const makeFocus = (coworker: Coworker) => {
    if (!career) return;
    const next: Career = { ...career, focusId: coworker.id };
    writeCareer(next);
    setCareer(next);
  };

  const startOver = () => {
    if (!window.confirm(text.startOverConfirm)) return;
    const fresh = defaultSave();
    clearRun();
    clearCareer();
    writeSave(fresh);
    setRoster(fresh);
    setCareer(defaultCareer());
    setSaved(null);
  };

  const current = coworkerOf(run);
  if (run && current) {
    return (
      <div className="tower-root hr-root" ref={readyRef} data-lang-sensitive>
        <RunView key={run.seed} run={run} coworker={current} sheet={sheet} text={text} onOver={finish}>
          {result && (
            <div className="tower-overlay" role="dialog" aria-modal="true" aria-labelledby="hr-over-title">
              <div className="tower-panel">
                <h2 id="hr-over-title">{resultTitle(text, result)}</h2>
                <p className="tower-result">{text.lasted(clock(result.time))}</p>
                <ul className="tower-stats">
                  <li>{text.reached(result.level)}</li>
                  <li>{text.kills(result.kills)}</li>
                  <li>{text.goldEarned(result.gold)}</li>
                </ul>
                {result.review && (
                  <ul className="tower-stats hr-review">
                    <li>{text.reviewEarned(result.review.xp)}</li>
                    {result.review.levelsGained > 0 && <li>{text.leveledUp(result.review.level)}</li>}
                    {result.review.promotedTo !== null && <li className="hr-promoted">{text.promoted(rankName(text, result.review.promotedTo))}</li>}
                  </ul>
                )}
                <div className="tower-actions">
                  <button type="button" className="tower-button" onClick={() => start(current)} autoFocus>
                    {text.playAgain}
                  </button>
                  <button type="button" className="tower-button tower-button-quiet" onClick={() => setRun(null)}>
                    {text.menu}
                  </button>
                </div>
              </div>
            </div>
          )}
        </RunView>
      </div>
    );
  }

  const savedCoworker = coworkerOf(saved);
  const focus = roster?.coworkers.find((coworker) => coworker.id === career?.focusId) ?? null;
  const others = (roster?.coworkers ?? []).filter((coworker) => career?.owned.includes(coworker.id) && coworker.id !== focus?.id);
  return (
    <div className="tower-root hr-root" ref={readyRef} data-lang-sensitive>
      <div className="tower-screen">
        <div className="tower-panel hr-menu">
          <h1>{text.title}</h1>
          <p className="tower-tagline">{text.tagline}</p>
          <ul className="tower-howto">
            {text.howTo.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
          {saved && savedCoworker && (
            <div className="tower-actions">
              <button type="button" className="tower-button" onClick={resume}>
                {text.continueRun}
              </button>
              <p className="hr-continue-hint">{text.continueHint(savedCoworker.name, clock(saved.time))}</p>
            </div>
          )}
          {roster && career && !focus && (
            <>
              <h2 className="hr-menu-heading">{text.chooseCareer}</h2>
              <p className="hr-continue-hint">{text.careerBlurb}</p>
              <ul className="hr-coworkers">
                {roster.coworkers
                  .filter((coworker) => coworker.id <= STARTERS.length && coworker.status.kind !== "quit")
                  .map((coworker) => (
                    <li key={coworker.id}>
                      <CoworkerCard coworker={coworker} sheet={sheet} text={text} action={text.startCareer} onAct={() => startCareer(coworker)} />
                    </li>
                  ))}
              </ul>
            </>
          )}
          {roster && career && focus && (
            <>
              <h2 className="hr-menu-heading">{text.day(roster.day + 1)}</h2>
              <p className="hr-continue-hint">{text.savings(text.goldAmount(career.gold))}</p>
              <ul className="hr-coworkers">
                <li>
                  <CoworkerCard coworker={focus} sheet={sheet} text={text} action={text.goToWork} onAct={() => start(focus)} showCareer />
                </li>
              </ul>
              <div className="hr-pack">
                <button type="button" className="tower-button" onClick={buyPack} disabled={career.gold < PACKS.price}>
                  {text.openPack(text.goldAmount(PACKS.price))}
                </button>
                <p className="hr-continue-hint">{text.packHint}</p>
              </div>
              {others.length > 0 && (
                <>
                  <h2 className="hr-menu-heading">{text.yourCards}</h2>
                  <ul className="hr-coworkers">
                    {others.map((coworker) => (
                      <li key={coworker.id}>
                        <CoworkerCard coworker={coworker} sheet={sheet} text={text} action={text.makeFocus} onAct={() => makeFocus(coworker)} showCareer />
                      </li>
                    ))}
                  </ul>
                </>
              )}
              <button type="button" className="tower-button tower-button-quiet tower-button-small hr-start-over" onClick={startOver}>
                {text.startOver}
              </button>
            </>
          )}
          <a className="tower-home" href={withBase("/")}>
            {text.home}
          </a>
        </div>
      </div>
      {revealed && (
        <div className="tower-overlay" role="dialog" aria-modal="true" aria-labelledby="hr-pack-title">
          <div className="tower-panel hr-reveal">
            <h2 id="hr-pack-title">{text.packOpened(text.rarities[revealed.rarity])}</h2>
            <CoworkerCard coworker={revealed} sheet={sheet} text={text} />
            <div className="tower-actions">
              <button type="button" className="tower-button" onClick={() => setRevealed(null)} autoFocus>
                {text.nice}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function resultTitle(text: HrText, result: Result): string {
  if (result.status === "won") return text.won;
  if (result.abandoned) return text.walkedOut;
  return result.closed ? text.auditClosed : text.fell;
}

function rankName(text: HrText, rank: number): string {
  return text.ranks[Math.min(rank, text.ranks.length - 1)];
}

interface CardProps {
  coworker: Coworker;
  sheet: Sheet | null;
  text: HrText;
  /** The button's label and what it does; none for a card that is only shown. */
  action?: string;
  onAct?: () => void;
  /** Show the career: rank, level and progress to the next level. */
  showCareer?: boolean;
}

function CoworkerCard({ coworker, sheet, text, action, onAct, showCareer }: CardProps) {
  return (
    <article className={`hr-card hr-card-${coworker.rarity}`}>
      <Portrait coworker={coworker} sheet={sheet} />
      <div className="hr-card-body">
        <p className="hr-card-name">{coworker.name}</p>
        {showCareer && (
          <>
            <p className="hr-card-rank">
              {rankName(text, rankOf(coworker.level))} · {text.careerLevel(coworker.level)}
            </p>
            <progress className="hr-card-progress" max={reviewXpToNext(coworker.level)} value={coworker.xp} aria-label={text.reviewProgress(coworker.xp, reviewXpToNext(coworker.level))} />
            <p className="hr-card-rank">{text.reviewProgress(coworker.xp, reviewXpToNext(coworker.level))}</p>
          </>
        )}
        <p className="hr-card-department">
          {text.rarities[coworker.rarity]} · {text.departments[coworker.department]} · {text.weapons[departmentWeapon(coworker)].name}
        </p>
        {coworker.quirks.map((quirk) => (
          <p key={quirk} className="hr-card-quirk">
            <strong>{text.quirks[quirk]}</strong> {quirkLine(text, quirk)}
          </p>
        ))}
      </div>
      <dl className="hr-card-stats">
        {STATS.map((stat) => (
          <div key={stat}>
            <dt>{text.stats[stat]}</dt>
            <dd>{coworker.stats[stat]}</dd>
          </div>
        ))}
      </dl>
      {action && (
        <button type="button" className="tower-button tower-button-small hr-card-send" onClick={onAct}>
          {action}
        </button>
      )}
    </article>
  );
}

function departmentWeapon(coworker: Coworker) {
  return DEPARTMENTS[coworker.department].weapon;
}

/** The coworker's standing frame, drawn big with crisp pixels; empty until the sheet has loaded. */
function Portrait({ coworker, sheet }: { coworker: Coworker; sheet: Sheet | null }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx || !sheet) return;
    const frames = bakeHero(sheet, coworker.id, coworker.department);
    canvas.width = frames.width * 3;
    canvas.height = frames.height * 3;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(frames.stand, 0, 0, canvas.width, canvas.height);
  }, [coworker, sheet]);
  return <canvas ref={canvasRef} className="hr-portrait" aria-hidden="true" />;
}
