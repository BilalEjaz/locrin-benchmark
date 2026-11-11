/*
 * Draws a hero run on a plain 2D canvas. Placeholder art: the hero is the real coworker sprite, everything else is
 * drawn from shapes until the run is proven fun. The camera follows the hero and stops at the walls (except below, on a tall view).
 */
import { DEPARTMENTS } from "@/lib/roster/data";
import { POSE_PAD } from "@/lib/tycoon/render-support/poses";
import { ARENA, DUCK_RADIUS, FOES, HERO_RADIUS, weaponNumbers } from "../sim/balance";
import type { Foe, Run } from "../sim/types";
import type { HeroFrames } from "./heroes";

export interface View {
  /** CSS pixels. */
  width: number;
  height: number;
  /** CSS pixels per world unit. */
  scale: number;
}

/**
 * About 420 world units across the short side, so a phone sees a little less than the distance foes spawn at; a wide
 * screen zooms in until its long side does too, so nobody watches foes pop into being.
 */
export function fitView(width: number, height: number): View {
  const scale = Math.max(Math.min(width, height) / 420, Math.max(width, height) / 880, 0.1);
  return { width, height, scale };
}

/**
 * Where the hero sits down the screen on a tall (phone) view, as a share of the height: above the middle, so the thumb
 * on the stick doesn't cover them or the ground ahead of them.
 */
const PORTRAIT_FOCUS = 0.4;

/**
 * The world point at the view's top-left corner: on the hero, held inside the arena at the top and the sides. On a tall
 * view the hero sits above the middle and the camera runs past the bottom wall, so the hero never ends up under the
 * thumb at the bottom of the map.
 */
export function cameraFor(run: Run, view: View): { x: number; y: number } {
  const across = view.width / view.scale;
  const down = view.height / view.scale;
  const fit = (centre: number, span: number, size: number) => (span >= size ? (size - span) / 2 : Math.min(size - span, Math.max(0, centre - span / 2)));
  if (view.height <= view.width) return { x: fit(run.hero.x, across, ARENA.width), y: fit(run.hero.y, down, ARENA.height) };
  return { x: fit(run.hero.x, across, ARENA.width), y: Math.max(0, run.hero.y - down * PORTRAIT_FOCUS) };
}

/** Where the thumb is: the stick appears where it went down and the knob follows it, in CSS pixels. */
export interface Stick {
  originX: number;
  originY: number;
  x: number;
  y: number;
}

export const STICK_RADIUS = 44;

/** World units per sprite pixel. */
const PIXEL = 2;
const INK = "#1a1c2c";
const FLOOR = "#4a5a6e";
const FLOOR_ALT = "#46566a";
const WALL = "#2a3140";
const SHADOW = "rgba(10, 12, 20, 0.28)";
/** The suit each boss wears; the shirt colours tell the interview bosses from the office ones. */
const SUIT_HEX: Partial<Record<string, string>> = { middleManager: "#566c86", auditor: "#333c57", teamLead: "#3b5dc9", hrManager: "#d6498a", recruiter: "#38b764" };

const SHIRT_HEX: Record<string, string> = {
  red: "#b13e53",
  blue: "#3b5dc9",
  green: "#38b764",
  orange: "#ef7d57",
  purple: "#8a4a8a",
  teal: "#257179",
  pink: "#d6498a",
};

export interface Scene {
  /** The hero's baked frames; null draws a plain figure (the sheet failed to load). */
  frames: HeroFrames | null;
  department: keyof typeof DEPARTMENTS;
  /** Whether the hero moved this frame, for the walk cycle. */
  moving: boolean;
  stick: Stick | null;
}

export function drawRun(ctx: CanvasRenderingContext2D, run: Run, view: View, scene: Scene, time: number): void {
  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = WALL;
  ctx.fillRect(0, 0, view.width, view.height);
  const camera = cameraFor(run, view);
  ctx.save();
  ctx.scale(view.scale, view.scale);
  ctx.translate(-camera.x, -camera.y);
  drawFloor(ctx, camera, view);
  drawAura(ctx, run);
  for (const gem of run.gems) drawGem(ctx, gem.x, gem.y, gem.value);
  for (const drop of run.drops) drawDropShadow(ctx, run, drop);
  const foes = [...run.foes].sort((a, b) => a.y - b.y);
  for (const foe of foes) drawFoe(ctx, foe, time);
  drawHero(ctx, run, scene, time);
  drawDucks(ctx, run);
  for (const shot of run.shots) drawShot(ctx, shot.weapon, shot.x, shot.y, shot.vx, shot.vy, shot.radius, time);
  for (const shot of run.foeShots) drawFoeShot(ctx, shot.from, shot.x, shot.y, shot.vx, shot.vy, shot.radius);
  for (const drop of run.drops) drawFallingRack(ctx, drop.x, drop.y, drop.delay);
  for (const effect of run.effects) drawEffect(ctx, effect.kind, effect.x, effect.y, effect.radius, effect.age / effect.life);
  ctx.restore();
  drawBossPointers(ctx, run, view, camera);
  if (scene.stick) drawStick(ctx, scene.stick);
}

function drawFloor(ctx: CanvasRenderingContext2D, camera: { x: number; y: number }, view: View): void {
  ctx.fillStyle = FLOOR;
  ctx.fillRect(0, 0, ARENA.width, ARENA.height);
  // Carpet tiles, only the ones in view.
  const tile = 100;
  ctx.fillStyle = FLOOR_ALT;
  const fromX = Math.max(0, Math.floor(camera.x / tile));
  const fromY = Math.max(0, Math.floor(camera.y / tile));
  const toX = Math.min(ARENA.width / tile, Math.ceil((camera.x + view.width / view.scale) / tile));
  const toY = Math.min(ARENA.height / tile, Math.ceil((camera.y + view.height / view.scale) / tile));
  for (let ty = fromY; ty < toY; ty += 1) {
    for (let tx = fromX; tx < toX; tx += 1) if ((tx + ty) % 2 === 0) ctx.fillRect(tx * tile, ty * tile, tile, tile);
  }
  ctx.strokeStyle = "rgba(0, 0, 0, 0.35)";
  ctx.lineWidth = 6;
  ctx.strokeRect(-3, -3, ARENA.width + 6, ARENA.height + 6);
}

function ellipseShadow(ctx: CanvasRenderingContext2D, x: number, y: number, radius: number): void {
  ctx.fillStyle = SHADOW;
  ctx.beginPath();
  ctx.ellipse(x, y + radius * 0.8, radius, radius * 0.4, 0, 0, Math.PI * 2);
  ctx.fill();
}

function drawHero(ctx: CanvasRenderingContext2D, run: Run, scene: Scene, time: number): void {
  const { hero } = run;
  ellipseShadow(ctx, hero.x, hero.y, HERO_RADIUS);
  const frames = scene.frames;
  if (!frames) {
    ctx.fillStyle = SHIRT_HEX[DEPARTMENTS[scene.department].shirt] ?? "#ffffff";
    ctx.beginPath();
    ctx.arc(hero.x, hero.y, HERO_RADIUS, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = INK;
    ctx.lineWidth = 2;
    ctx.stroke();
    return;
  }
  const image = scene.moving ? frames.walk[Math.floor(time * 8) % frames.walk.length] : frames.stand;
  const width = frames.width * PIXEL;
  const height = frames.height * PIXEL;
  // The sprite's own middle sits `POSE_PAD.left` pixels in from the padded frame's edge.
  const middle = (POSE_PAD.left + (frames.width - POSE_PAD.left - POSE_PAD.right) / 2) * PIXEL;
  const feet = hero.y + HERO_RADIUS;
  ctx.save();
  ctx.translate(hero.x, 0);
  if (hero.faceX < -0.1) ctx.scale(-1, 1);
  ctx.drawImage(image, -middle, feet - height, width, height);
  if (hero.hurt > 0) {
    ctx.globalAlpha = 0.75;
    ctx.drawImage(frames.flash, -middle, feet - height, width, height);
  }
  ctx.restore();
}

function drawAura(ctx: CanvasRenderingContext2D, run: Run): void {
  const contract = run.weapons.find((weapon) => weapon.id === "contract");
  if (!contract) return;
  const { radius } = weaponNumbers("contract", contract.level);
  ctx.fillStyle = "rgba(138, 74, 138, 0.18)";
  ctx.strokeStyle = "rgba(184, 124, 192, 0.6)";
  ctx.lineWidth = 2;
  ctx.setLineDash([8, 6]);
  ctx.beginPath();
  ctx.arc(run.hero.x, run.hero.y, radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.setLineDash([]);
}

function drawDucks(ctx: CanvasRenderingContext2D, run: Run): void {
  const duck = run.weapons.find((weapon) => weapon.id === "rubberDuck");
  if (!duck) return;
  const { count, radius } = weaponNumbers("rubberDuck", duck.level);
  for (let index = 0; index < count; index += 1) {
    const angle = duck.spin + (index / count) * Math.PI * 2;
    const x = run.hero.x + Math.cos(angle) * radius;
    const y = run.hero.y + Math.sin(angle) * radius;
    ctx.fillStyle = "#ffcd2a";
    ctx.strokeStyle = INK;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(x, y, DUCK_RADIUS, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(x + 3, y - 6, DUCK_RADIUS * 0.55, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = "#ef7d57";
    ctx.fillRect(x + 6, y - 7, 5, 3);
  }
}

function drawGem(ctx: CanvasRenderingContext2D, x: number, y: number, value: number): void {
  const size = 4 + Math.min(7, Math.log2(value + 1) * 1.6);
  ctx.fillStyle = value >= 20 ? "#ffcd75" : value >= 4 ? "#73eff7" : "#41a6f6";
  ctx.strokeStyle = INK;
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(x, y - size);
  ctx.lineTo(x + size * 0.7, y);
  ctx.lineTo(x, y + size);
  ctx.lineTo(x - size * 0.7, y);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
}

function drawDropShadow(ctx: CanvasRenderingContext2D, run: Run, drop: Run["drops"][number]): void {
  const rack = run.weapons.find((weapon) => weapon.id === "serverRack");
  const delay = rack ? weaponNumbers("serverRack", rack.level).life : 0.6;
  const share = 1 - Math.max(0, drop.delay) / delay;
  ctx.fillStyle = `rgba(224, 72, 63, ${0.12 + share * 0.25})`;
  ctx.beginPath();
  ctx.arc(drop.x, drop.y, drop.radius, 0, Math.PI * 2);
  ctx.fill();
}

function drawFallingRack(ctx: CanvasRenderingContext2D, x: number, y: number, delay: number): void {
  const lift = Math.max(0, delay) * 420;
  ctx.fillStyle = "#333c57";
  ctx.strokeStyle = INK;
  ctx.lineWidth = 2;
  ctx.fillRect(x - 12, y - 30 - lift, 24, 30);
  ctx.strokeRect(x - 12, y - 30 - lift, 24, 30);
  ctx.fillStyle = "#38b764";
  for (let row = 0; row < 4; row += 1) ctx.fillRect(x - 8, y - 26 - lift + row * 7, 3, 2);
}

function drawShot(ctx: CanvasRenderingContext2D, weapon: string, x: number, y: number, vx: number, vy: number, radius: number, time: number): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.strokeStyle = INK;
  ctx.lineWidth = 1.2;
  switch (weapon) {
    case "stickyNotes":
      ctx.rotate(time * 6);
      ctx.fillStyle = "#ffe066";
      ctx.fillRect(-radius, -radius, radius * 2, radius * 2);
      ctx.strokeRect(-radius, -radius, radius * 2, radius * 2);
      break;
    case "spreadsheet": {
      ctx.rotate(time * 5);
      const w = radius * 2.4;
      const h = radius * 1.8;
      ctx.fillStyle = "#e8f5e9";
      ctx.fillRect(-w / 2, -h / 2, w, h);
      ctx.strokeStyle = "#38b764";
      for (let line = 1; line < 3; line += 1) {
        ctx.beginPath();
        ctx.moveTo(-w / 2 + (w / 3) * line, -h / 2);
        ctx.lineTo(-w / 2 + (w / 3) * line, h / 2);
        ctx.moveTo(-w / 2, -h / 2 + (h / 3) * line);
        ctx.lineTo(w / 2, -h / 2 + (h / 3) * line);
        ctx.stroke();
      }
      ctx.strokeStyle = INK;
      ctx.strokeRect(-w / 2, -h / 2, w, h);
      break;
    }
    default:
      ctx.rotate(Math.atan2(vy, vx));
      ctx.fillStyle = "#f4f4f4";
      ctx.fillRect(-radius * 1.4, -radius * 0.9, radius * 2.8, radius * 1.8);
      ctx.strokeRect(-radius * 1.4, -radius * 0.9, radius * 2.8, radius * 1.8);
      ctx.fillStyle = "#b13e53";
      ctx.fillRect(-radius * 1.1, -radius * 0.5, radius * 0.8, radius * 0.4);
  }
  ctx.restore();
}

function drawFoeShot(ctx: CanvasRenderingContext2D, from: string, x: number, y: number, vx: number, vy: number, radius: number): void {
  if (from === "printerJam") {
    ctx.fillStyle = "#262838";
    ctx.strokeStyle = "#94b0c2";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    return;
  }
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(Math.atan2(vy, vx));
  // Paperwork is a white sheet; red tape is red.
  ctx.fillStyle = from === "hrManager" ? "#f4f4f4" : "#e0483f";
  ctx.strokeStyle = INK;
  ctx.lineWidth = 1;
  ctx.fillRect(-radius * 1.5, -radius * 0.5, radius * 3, radius);
  ctx.strokeRect(-radius * 1.5, -radius * 0.5, radius * 3, radius);
  ctx.restore();
}

function drawEffect(ctx: CanvasRenderingContext2D, kind: string, x: number, y: number, radius: number, progress: number): void {
  const fade = 1 - progress;
  ctx.lineWidth = 3;
  switch (kind) {
    case "swing":
      ctx.strokeStyle = `rgba(214, 73, 138, ${fade})`;
      ctx.beginPath();
      ctx.arc(x, y, radius * (0.6 + progress * 0.4), 0, Math.PI * 2);
      ctx.stroke();
      break;
    case "blast":
      ctx.fillStyle = `rgba(255, 205, 117, ${fade * 0.6})`;
      ctx.beginPath();
      ctx.arc(x, y, radius * (0.4 + progress * 0.6), 0, Math.PI * 2);
      ctx.fill();
      break;
    default:
      ctx.strokeStyle = `rgba(244, 244, 244, ${fade * 0.8})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(x, y, radius * (0.5 + progress), 0, Math.PI * 2);
      ctx.stroke();
  }
}

// ---- Foes --------------------------------------------------------------------------------------------------------

function drawFoe(ctx: CanvasRenderingContext2D, foe: Foe, time: number): void {
  const { x, y, radius: r } = foe;
  ellipseShadow(ctx, x, y, r);
  ctx.save();
  ctx.translate(x, y);
  ctx.strokeStyle = INK;
  ctx.lineWidth = 1.5;
  switch (foe.kind) {
    case "replyAll": {
      const bob = Math.sin(time * 10 + foe.id) * 1.5;
      ctx.translate(0, bob);
      ctx.fillStyle = "#f4f4f4";
      ctx.fillRect(-r, -r * 0.7, r * 2, r * 1.4);
      ctx.strokeRect(-r, -r * 0.7, r * 2, r * 1.4);
      ctx.beginPath();
      ctx.moveTo(-r, -r * 0.7);
      ctx.lineTo(0, r * 0.1);
      ctx.lineTo(r, -r * 0.7);
      ctx.stroke();
      ctx.fillStyle = "#e0483f";
      ctx.fillRect(r * 0.4, -r * 1.1, r * 0.7, r * 0.7);
      break;
    }
    case "mondayBlob": {
      const squash = 1 + Math.sin(time * 3 + foe.id) * 0.06;
      ctx.fillStyle = "#6d7fa6";
      ctx.beginPath();
      ctx.ellipse(0, 0, r * squash, r / squash, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      // Half-shut eyes.
      ctx.fillStyle = INK;
      ctx.fillRect(-r * 0.5, -r * 0.2, r * 0.35, r * 0.12);
      ctx.fillRect(r * 0.15, -r * 0.2, r * 0.35, r * 0.12);
      break;
    }
    case "meetingInvite":
      ctx.fillStyle = "#f4f4f4";
      ctx.fillRect(-r, -r, r * 2, r * 2);
      ctx.fillStyle = "#b13e53";
      ctx.fillRect(-r, -r, r * 2, r * 0.6);
      ctx.strokeRect(-r, -r, r * 2, r * 2);
      ctx.fillStyle = INK;
      for (let cell = 0; cell < 4; cell += 1) ctx.fillRect(-r * 0.6 + (cell % 2) * r * 0.8, -r * 0.1 + Math.floor(cell / 2) * r * 0.6, r * 0.3, r * 0.3);
      break;
    case "printerJam":
      ctx.fillStyle = "#94b0c2";
      ctx.fillRect(-r * 1.1, -r * 0.7, r * 2.2, r * 1.5);
      ctx.strokeRect(-r * 1.1, -r * 0.7, r * 2.2, r * 1.5);
      ctx.fillStyle = "#f4f4f4";
      ctx.beginPath();
      ctx.moveTo(-r * 0.6, -r * 0.7);
      ctx.lineTo(-r * 0.4, -r * 1.4);
      ctx.lineTo(r * 0.1, -r * 1.1);
      ctx.lineTo(r * 0.6, -r * 1.5);
      ctx.lineTo(r * 0.6, -r * 0.7);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = Math.floor(time * 3) % 2 === 0 ? "#e0483f" : "#5d275d";
      ctx.fillRect(r * 0.6, -r * 0.4, r * 0.3, r * 0.3);
      break;
    case "middleManager":
    case "teamLead":
    case "hrManager":
    case "recruiter":
    case "auditor": {
      const auditor = foe.kind === "auditor";
      ctx.fillStyle = SUIT_HEX[foe.kind] ?? "#566c86";
      ctx.beginPath();
      ctx.arc(0, r * 0.2, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = "#ffcd75";
      ctx.beginPath();
      ctx.arc(0, -r * 0.75, r * 0.45, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = "#b13e53";
      ctx.fillRect(-r * 0.1, -r * 0.3, r * 0.2, r * 0.7);
      if (auditor) {
        ctx.strokeStyle = "#e0483f";
        ctx.lineWidth = 2;
        ctx.strokeRect(-r * 0.35, -r * 0.85, r * 0.28, r * 0.18);
        ctx.strokeRect(r * 0.07, -r * 0.85, r * 0.28, r * 0.18);
        ctx.fillStyle = "#a8744a";
        ctx.fillRect(r * 0.5, -r * 0.1, r * 0.5, r * 0.7);
      }
      break;
    }
  }
  if (foe.hurt > 0) {
    ctx.fillStyle = "rgba(255, 255, 255, 0.5)";
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

/** An arrow at the edge of the screen toward a boss out of view. */
function drawBossPointers(ctx: CanvasRenderingContext2D, run: Run, view: View, camera: { x: number; y: number }): void {
  for (const foe of run.foes) {
    if (!FOES[foe.kind].boss) continue;
    const sx = (foe.x - camera.x) * view.scale;
    const sy = (foe.y - camera.y) * view.scale;
    if (sx >= 0 && sy >= 0 && sx <= view.width && sy <= view.height) continue;
    const cx = view.width / 2;
    const cy = view.height / 2;
    const angle = Math.atan2(sy - cy, sx - cx);
    const reach = Math.min(cx / Math.abs(Math.cos(angle) || 1e-6), cy / Math.abs(Math.sin(angle) || 1e-6)) - 22;
    ctx.save();
    ctx.translate(cx + Math.cos(angle) * reach, cy + Math.sin(angle) * reach);
    ctx.rotate(angle);
    ctx.fillStyle = "#e0483f";
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(12, 0);
    ctx.lineTo(-8, -9);
    ctx.lineTo(-8, 9);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }
}

function drawStick(ctx: CanvasRenderingContext2D, stick: Stick): void {
  const dx = stick.x - stick.originX;
  const dy = stick.y - stick.originY;
  const length = Math.hypot(dx, dy);
  const reach = Math.min(length, STICK_RADIUS);
  const knobX = stick.originX + (length > 0 ? (dx / length) * reach : 0);
  const knobY = stick.originY + (length > 0 ? (dy / length) * reach : 0);
  ctx.fillStyle = "rgba(255, 255, 255, 0.05)";
  ctx.strokeStyle = "rgba(255, 255, 255, 0.3)";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(stick.originX, stick.originY, STICK_RADIUS, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = "rgba(255, 255, 255, 0.4)";
  ctx.beginPath();
  ctx.arc(knobX, knobY, 16, 0, Math.PI * 2);
  ctx.fill();
}

/** The stick's input: the knob's offset as a share of the ring, at most length 1. */
export function stickInput(stick: Stick | null): { dx: number; dy: number } {
  if (!stick) return { dx: 0, dy: 0 };
  const dx = (stick.x - stick.originX) / STICK_RADIUS;
  const dy = (stick.y - stick.originY) / STICK_RADIUS;
  const length = Math.hypot(dx, dy);
  // A small dead zone, so resting a thumb doesn't drift.
  if (length < 0.15) return { dx: 0, dy: 0 };
  return length > 1 ? { dx: dx / length, dy: dy / length } : { dx, dy };
}
