import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent } from "react";
import { Pause } from "lucide-react";

import { clock, type HrText } from "@/lib/hr/i18n";
import { bakeHero, type HeroFrames, type Sheet } from "@/lib/hr/render/heroes";
import { drawRun, fitView, stickInput, type Stick, type View } from "@/lib/hr/render/draw";
import { AUDIT_CLOSES, BOSS_AT, FOES, INTERVIEW, MINI_BOSS_AT, STAGES, xpToNext } from "@/lib/hr/sim/balance";
import { abandon, choose, step, STEP } from "@/lib/hr/sim/run";
import type { FoeKind, Pick, Run } from "@/lib/hr/sim/types";
import { writeRun } from "@/lib/hr/snapshot";
import type { Coworker } from "@/lib/roster/types";

interface Hud {
  status: Run["status"];
  /** The offer as JSON, so the HUD only re-renders when it changes. */
  picks: string;
  hp: number;
  maxHp: number;
  level: number;
  /** In twentieths, so the bar only re-renders when it visibly moves. */
  xp: number;
  /** Whole seconds. */
  time: number;
  gold: number;
  boss: FoeKind | null;
  bossHp: number;
}

function snapshot(run: Run): Hud {
  const boss = run.foes.find((foe) => FOES[foe.kind].boss) ?? null;
  return {
    status: run.status,
    picks: run.picks ? JSON.stringify(run.picks) : "",
    hp: Math.ceil(run.hero.hp),
    maxHp: Math.round(run.numbers.maxHp),
    level: run.level,
    xp: Math.floor((run.xp / xpToNext(run.level)) * 20) / 20,
    time: Math.floor(run.time),
    gold: Math.floor(run.gold),
    boss: boss?.kind ?? null,
    bossHp: boss ? Math.ceil((boss.hp / boss.maxHp) * 50) / 50 : 0,
  };
}

function sameHud(a: Hud, b: Hud): boolean {
  return (Object.keys(a) as (keyof Hud)[]).every((key) => a[key] === b[key]);
}

/** Longest frame gap the sim catches up on; after that it just runs slower instead of lurching. */
const MAX_CATCH_UP = 0.1;

const KEYS: Record<string, [number, number]> = {
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  KeyW: [0, -1],
  KeyS: [0, 1],
  KeyA: [-1, 0],
  KeyD: [1, 0],
};

export function RunView({
  run,
  coworker,
  sheet,
  text,
  onOver,
  children,
}: {
  run: Run;
  coworker: Coworker;
  sheet: Sheet | null;
  text: HrText;
  /** Called once, the moment the run is won or lost. */
  onOver: (run: Run) => void;
  /** The result panel, shown over the floor once the run is over. */
  children?: React.ReactNode;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const viewRef = useRef<View>(fitView(1, 1));
  const [hud, setHud] = useState<Hud>(() => snapshot(run));
  const [paused, setPaused] = useState(false);
  const pausedRef = useRef(false);
  pausedRef.current = paused;
  const stickRef = useRef<Stick | null>(null);
  const stickPointerRef = useRef<number | null>(null);
  const keysRef = useRef(new Set<string>());
  const overRef = useRef(false);
  const frames = useMemo<HeroFrames | null>(() => (sheet ? bakeHero(sheet, coworker.id, coworker.department) : null), [sheet, coworker]);
  const framesRef = useRef(frames);
  framesRef.current = frames;

  const lastPicksRef = useRef("");

  const refresh = useCallback(() => {
    const next = snapshot(run);
    // A new offer is a natural place to save: the player stops to read it.
    if (next.picks && next.picks !== lastPicksRef.current) writeRun(run);
    lastPicksRef.current = next.picks;
    setHud((current) => (sameHud(current, next) ? current : next));
    if (run.status !== "playing" && !overRef.current) {
      overRef.current = true;
      onOver(run);
    }
  }, [run, onOver]);

  // Keep the canvas backing store at device resolution and the view fitted to it.
  useEffect(() => {
    const host = hostRef.current;
    const canvas = canvasRef.current;
    if (!host || !canvas) return;
    const resize = () => {
      const width = host.clientWidth;
      const height = host.clientHeight;
      const ratio = Math.min(3, window.devicePixelRatio || 1);
      canvas.width = Math.max(1, Math.round(width * ratio));
      canvas.height = Math.max(1, Math.round(height * ratio));
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      viewRef.current = fitView(width, height);
    };
    resize();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(resize);
    observer?.observe(host);
    return () => observer?.disconnect();
  }, []);

  // One loop for the whole run: fixed-step sim while playing, a fresh frame every display refresh.
  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    let frame = 0;
    let last = performance.now();
    let pending = 0;
    const tick = (now: number) => {
      const elapsed = Math.min(MAX_CATCH_UP, (now - last) / 1000);
      last = now;
      const fromX = run.hero.x;
      const fromY = run.hero.y;
      if (!pausedRef.current && run.status === "playing" && !run.picks) {
        pending += elapsed;
        const input = currentInput(stickRef.current, keysRef.current);
        while (pending >= STEP && run.status === "playing" && !run.picks) {
          step(run, input);
          pending -= STEP;
        }
      } else {
        pending = 0;
      }
      if (ctx && canvas) {
        const ratio = canvas.width / Math.max(1, viewRef.current.width);
        ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
        const moving = Math.hypot(run.hero.x - fromX, run.hero.y - fromY) > 0.01;
        drawRun(ctx, run, viewRef.current, { frames: framesRef.current, department: coworker.department, moving, stick: stickRef.current }, now / 1000);
      }
      refresh();
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [run, coworker, refresh]);

  const pause = useCallback(() => {
    stickRef.current = null;
    stickPointerRef.current = null;
    keysRef.current.clear();
    setPaused(true);
  }, []);

  // Leaving the tab pauses and saves; closing it saves, so reopening picks up the same moment.
  useEffect(() => {
    const onHide = () => {
      if (run.status !== "playing") return;
      writeRun(run);
      if (document.visibilityState === "hidden") pause();
    };
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("pagehide", onHide);
    return () => {
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("pagehide", onHide);
    };
  }, [run, pause]);

  // Keys are read from the window, so moving and pausing don't depend on the canvas having focus.
  useEffect(() => {
    const down = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape" && run.status === "playing" && !run.picks) {
        pause();
        return;
      }
      if (event.code in KEYS) {
        keysRef.current.add(event.code);
        event.preventDefault();
      }
    };
    const up = (event: globalThis.KeyboardEvent) => keysRef.current.delete(event.code);
    const blur = () => keysRef.current.clear();
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", blur);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", blur);
    };
  }, [run, pause]);

  const localPoint = (event: PointerEvent<HTMLCanvasElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    return { x: event.clientX - box.left, y: event.clientY - box.top };
  };

  const onPointerDown = (event: PointerEvent<HTMLCanvasElement>) => {
    if (paused || run.status !== "playing" || stickPointerRef.current !== null) return;
    const point = localPoint(event);
    stickPointerRef.current = event.pointerId;
    stickRef.current = { originX: point.x, originY: point.y, x: point.x, y: point.y };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };

  const onPointerMove = (event: PointerEvent<HTMLCanvasElement>) => {
    if (event.pointerId !== stickPointerRef.current || !stickRef.current) return;
    const point = localPoint(event);
    stickRef.current = { ...stickRef.current, x: point.x, y: point.y };
  };

  const onPointerEnd = (event: PointerEvent<HTMLCanvasElement>) => {
    if (event.pointerId !== stickPointerRef.current) return;
    stickPointerRef.current = null;
    stickRef.current = null;
  };

  const takePick = (index: number) => {
    choose(run, index);
    refresh();
    canvasRef.current?.focus();
  };

  const walkOut = () => {
    setPaused(false);
    abandon(run);
    refresh();
  };

  const picks: Pick[] = hud.picks ? (JSON.parse(hud.picks) as Pick[]) : [];
  const hpShare = hud.maxHp > 0 ? hud.hp / hud.maxHp : 0;
  const next = run.interview
    ? text.interviewClock(text.foes[run.interview.boss], clock(INTERVIEW.closesAt - hud.time))
    : hud.time < MINI_BOSS_AT
      ? text.next(text.foes[STAGES[run.stage].miniBoss], clock(MINI_BOSS_AT - hud.time))
      : hud.time < BOSS_AT
        ? text.next(text.foes.auditor, clock(BOSS_AT - hud.time))
        : text.auditCloses(clock(AUDIT_CLOSES - hud.time));

  return (
    <div className="tower-run">
      <div className="tower-hud">
        <button type="button" className="tower-icon-button" onClick={pause} disabled={hud.status !== "playing"} aria-label={text.pause}>
          <Pause size={18} aria-hidden="true" />
        </button>
        <div className="hr-hud-clock">
          <span className="hr-hud-time">{clock(hud.time)}</span>
          <span className="hr-hud-next">{next}</span>
        </div>
        <div className="tower-hud-gold">{text.goldAmount(hud.gold)}</div>
      </div>
      <div
        className="tower-hp"
        role="meter"
        aria-label={text.hp}
        aria-valuemin={0}
        aria-valuemax={hud.maxHp}
        aria-valuenow={hud.hp}
        aria-valuetext={`${hud.hp} / ${hud.maxHp}`}
      >
        <div
          className="tower-hp-fill"
          data-level={hpShare > 0.5 ? "good" : hpShare > 0.25 ? "warn" : "bad"}
          style={{ width: `${Math.max(0, Math.min(1, hpShare)) * 100}%` }}
        />
        <span className="tower-hp-text">
          {text.hp} {hud.hp} / {hud.maxHp}
        </span>
      </div>
      <div className="hr-xp" role="meter" aria-label={text.level(hud.level)} aria-valuemin={0} aria-valuemax={1} aria-valuenow={hud.xp}>
        <div className="hr-xp-fill" style={{ width: `${hud.xp * 100}%` }} />
        <span className="hr-xp-text">{text.level(hud.level)}</span>
      </div>
      {hud.boss && (
        <div className="hr-boss" role="meter" aria-label={text.foes[hud.boss]} aria-valuemin={0} aria-valuemax={1} aria-valuenow={hud.bossHp}>
          <div className="hr-boss-fill" style={{ width: `${hud.bossHp * 100}%` }} />
          <span className="hr-boss-text">{text.foes[hud.boss]}</span>
        </div>
      )}

      <div className="tower-field" ref={hostRef}>
        <canvas
          ref={canvasRef}
          className="tower-canvas"
          tabIndex={0}
          aria-label={text.fieldLabel}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerEnd}
          onPointerCancel={onPointerEnd}
          onLostPointerCapture={onPointerEnd}
        />

        {hud.status === "playing" && picks.length > 0 && (
          <div className="tower-overlay" role="dialog" aria-modal="true" aria-labelledby="hr-pick-title">
            <div className="tower-panel">
              <p className="tower-kicker">{text.level(hud.level)}</p>
              <h2 id="hr-pick-title">{text.levelUp}</h2>
              <div className="tower-choices">
                {picks.map((pick, index) => {
                  const blurb = pickBlurb(text, pick);
                  return (
                    <button key={JSON.stringify(pick)} type="button" className="tower-choice" onClick={() => takePick(index)} autoFocus={index === 0}>
                      <span className="tower-choice-name">{blurb.name}</span>
                      <span className="tower-choice-level">{pickLevel(text, pick)}</span>
                      <span className="tower-choice-description">{blurb.description}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {paused && hud.status === "playing" && (
          <div className="tower-overlay" role="dialog" aria-modal="true" aria-labelledby="hr-pause-title">
            <div className="tower-panel">
              <h2 id="hr-pause-title">{text.paused}</h2>
              <div className="tower-actions">
                <button type="button" className="tower-button" onClick={() => setPaused(false)} autoFocus>
                  {text.resume}
                </button>
                <button type="button" className="tower-button tower-button-quiet" onClick={walkOut}>
                  {text.walkOut}
                </button>
              </div>
              <p className="tower-tagline">{text.walkOutHint}</p>
            </div>
          </div>
        )}

        {hud.status !== "playing" && children}
      </div>
    </div>
  );
}

/** The stick wins over the keys while a thumb is down. */
function currentInput(stick: Stick | null, keys: Set<string>): { dx: number; dy: number } {
  if (stick) return stickInput(stick);
  let dx = 0;
  let dy = 0;
  for (const code of keys) {
    const [x, y] = KEYS[code] ?? [0, 0];
    dx += x;
    dy += y;
  }
  const length = Math.hypot(dx, dy);
  return length > 0 ? { dx: dx / length, dy: dy / length } : { dx: 0, dy: 0 };
}

function pickBlurb(text: HrText, pick: Pick) {
  switch (pick.kind) {
    case "weapon":
      return text.weapons[pick.id];
    case "passive":
      return text.passives[pick.id];
    case "heal":
      return text.heal;
    case "gold":
      return text.gold;
  }
}

function pickLevel(text: HrText, pick: Pick): string {
  if (pick.kind === "heal" || pick.kind === "gold") return "";
  return pick.level === 1 ? text.isNew : text.level(pick.level);
}
