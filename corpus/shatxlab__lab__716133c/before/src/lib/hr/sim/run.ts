import { DEPARTMENTS } from "@/lib/roster/data";
import type { Coworker } from "@/lib/roster/types";
import { random, randomBetween } from "@/lib/tower/sim/random";
import {
  ARENA,
  AUDIT_CLOSES,
  AUDITOR_SUMMON_EVERY,
  AUDITOR_SUMMONS,
  BOSS_AT,
  BOSS_PUSH,
  CHARGE,
  DROP_REACH,
  DUCK_RADIUS,
  FAN_SPREAD,
  FOE_HURT_FLASH,
  FOES,
  GEM_PULL,
  GEM_RADIUS,
  GRID_CELL,
  HERO_RADIUS,
  HURT_FLASH,
  INVITE_SUMMONS,
  MAX_FOES,
  MAX_GEMS,
  MAX_PRINTERS,
  MAX_SHOTS,
  MIN_COOLDOWN,
  MINI_BOSS_AT,
  MIX,
  PRINTER_EVERY,
  PRINTER_FROM,
  PRINTER_RANGE,
  PUSH_FADE,
  RED_TAPE,
  SPAWN_DISTANCE,
  TONER,
  WEAPONS,
  hpScale,
  spawnRate,
  touchScale,
  weaponNumbers,
  xpToNext,
} from "./balance";
import { Grid } from "./grid";
import { baseNumbers } from "./hero";
import { applyPick, rollPicks } from "./picks";
import type { Effect, Foe, FoeKind, Input, OwnedWeapon, Run, Shot, WeaponId } from "./types";

/** The fixed tick the page steps the sim with, so every device plays the same run. */
export const STEP = 1 / 60;
export const RUN_VERSION = 2;

/** The biggest foe's radius, which every grid search is widened by. */
const FOE_PAD = Math.max(...Object.values(FOES).map((foe) => foe.radius));
/** Homing and piercing weapons look for foes this close. */
const AIM_REACH = 450;

const grid = new Grid<Foe>(ARENA.width, ARENA.height, GRID_CELL);
/** Foes by id for homing shots; rebuilt every tick alongside the grid. */
const byId = new Map<number, Foe>();

/** `difficulty` is 1 for a first-day coworker and grows with their career level (see `difficultyFor`). */
export function createRun(coworker: Coworker, seed: number, difficulty = 1): Run {
  const base = baseNumbers(coworker);
  return {
    version: RUN_VERSION,
    seed,
    rng: seed,
    coworkerId: coworker.id,
    difficulty,
    status: "playing",
    time: 0,
    base,
    numbers: { ...base },
    hero: { x: ARENA.width / 2, y: ARENA.height / 2, hp: base.maxHp, faceX: 1, faceY: 0, hurt: 0 },
    weapons: [{ id: DEPARTMENTS[coworker.department].weapon, level: 1, cooldownLeft: 0, spin: 0 }],
    passives: {},
    level: 1,
    xp: 0,
    picks: null,
    queuedPicks: 0,
    spawnDebt: 0,
    printerIn: PRINTER_EVERY,
    miniBossDone: false,
    bossDone: false,
    foes: [],
    shots: [],
    drops: [],
    foeShots: [],
    gems: [],
    effects: [],
    nextId: 1,
    kills: 0,
    gold: 0,
    dealt: {},
    takenFrom: {},
    lastHitBy: null,
    abandoned: false,
  };
}

/** Advance the run by one `STEP`. While a pick is waiting, or once the run is over, only the effects fade. */
export function step(run: Run, input: Input): void {
  fadeEffects(run, STEP);
  if (run.status !== "playing" || run.picks) return;
  run.time += STEP;
  moveHero(run, input, STEP);
  spawn(run, STEP);
  index(run);
  moveFoes(run, STEP);
  index(run);
  for (const weapon of run.weapons) fire(run, weapon, STEP);
  moveShots(run, STEP);
  landDrops(run, STEP);
  moveFoeShots(run, STEP);
  touchHero(run, STEP);
  reap(run);
  collectGems(run, STEP);
  if (run.hero.hp <= 0) {
    run.hero.hp = 0;
    run.status = "lost";
  } else if (run.status === "playing" && run.time >= AUDIT_CLOSES) {
    run.status = "lost";
  } else if (run.status === "playing" && run.queuedPicks > 0 && !run.picks) {
    run.queuedPicks -= 1;
    run.picks = rollPicks(run);
  }
}

/** Take one of the offered picks; the next owed level-up is offered straight away. */
export function choose(run: Run, pick: number): boolean {
  const chosen = run.picks?.[pick];
  if (!chosen || run.status !== "playing") return false;
  applyPick(run, chosen);
  run.picks = null;
  if (run.queuedPicks > 0) {
    run.queuedPicks -= 1;
    run.picks = rollPicks(run);
  }
  return true;
}

/** Walk out of the run: it counts as falling. */
export function abandon(run: Run): void {
  if (run.status !== "playing") return;
  run.status = "lost";
  run.abandoned = true;
}

// ---- The hero ----------------------------------------------------------------------------------------------------

function clampTo(value: number, radius: number, size: number): number {
  return Math.min(size - radius, Math.max(radius, value));
}

function moveHero(run: Run, input: Input, dt: number): void {
  const { hero } = run;
  hero.hurt = Math.max(0, hero.hurt - dt);
  let { dx, dy } = input;
  const length = Math.hypot(dx, dy);
  if (!Number.isFinite(length) || length === 0) dx = dy = 0;
  else if (length > 1) {
    dx /= length;
    dy /= length;
  }
  hero.x = clampTo(hero.x + dx * run.numbers.speed * dt, HERO_RADIUS, ARENA.width);
  hero.y = clampTo(hero.y + dy * run.numbers.speed * dt, HERO_RADIUS, ARENA.height);
  if (length > 0.1) {
    hero.faceX = dx / Math.min(1, length);
    hero.faceY = dy / Math.min(1, length);
  }
  // Printer jams block the way.
  for (const foe of run.foes) {
    if (foe.kind !== "printerJam") continue;
    const ox = hero.x - foe.x;
    const oy = hero.y - foe.y;
    const distance = Math.hypot(ox, oy);
    const touch = HERO_RADIUS + foe.radius;
    if (distance >= touch) continue;
    const [nx, ny] = distance > 0 ? [ox / distance, oy / distance] : [1, 0];
    hero.x = clampTo(foe.x + nx * touch, HERO_RADIUS, ARENA.width);
    hero.y = clampTo(foe.y + ny * touch, HERO_RADIUS, ARENA.height);
  }
}

function touchHero(run: Run, dt: number): void {
  const { hero } = run;
  grid.near(hero.x, hero.y, HERO_RADIUS, FOE_PAD, (foe) => {
    if (foe.hp <= 0) return;
    const scale = FOES[foe.kind].boss ? 1 : touchScale(run.time);
    hurtHero(run, foe.touch * scale * dt, foe.kind);
  });
}

function hurtHero(run: Run, amount: number, by: FoeKind): void {
  const taken = amount * run.numbers.taken;
  run.hero.hp -= taken;
  run.takenFrom[by] = (run.takenFrom[by] ?? 0) + taken;
  run.hero.hurt = HURT_FLASH;
  run.lastHitBy = by;
}

// ---- Foes --------------------------------------------------------------------------------------------------------

function index(run: Run): void {
  grid.rebuild(run.foes);
  byId.clear();
  for (const foe of run.foes) byId.set(foe.id, foe);
}

function addFoe(run: Run, kind: FoeKind, x: number, y: number): Foe {
  const def = FOES[kind];
  const hp = (def.boss ? def.hp : def.hp * hpScale(run.time)) * run.difficulty;
  const foe: Foe = {
    id: run.nextId++,
    kind,
    x: clampTo(x, def.radius, ARENA.width),
    y: clampTo(y, def.radius, ARENA.height),
    hp,
    maxHp: hp,
    radius: def.radius,
    speed: def.speed,
    touch: def.touch,
    xp: def.xp,
    gold: def.gold,
    pushX: 0,
    pushY: 0,
    slow: 0,
    timer: def.every,
    cycles: 0,
    charge: 0,
    chargeX: 0,
    chargeY: 0,
    duckCooldown: 0,
    hurt: 0,
  };
  run.foes.push(foe);
  return foe;
}

/** A point between `min` and `max` from the hero, inside the arena and not right on top of them. */
function pointAround(run: Run, min: number, max: number): { x: number; y: number } {
  const { hero } = run;
  let point = { x: hero.x, y: hero.y };
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const angle = random(run) * Math.PI * 2;
    const distance = randomBetween(run, min, max);
    point = { x: clampTo(hero.x + Math.cos(angle) * distance, 0, ARENA.width), y: clampTo(hero.y + Math.sin(angle) * distance, 0, ARENA.height) };
    if (Math.hypot(point.x - hero.x, point.y - hero.y) >= min * 0.75) break;
  }
  return point;
}

function drawKind(run: Run): FoeKind {
  const open = MIX.filter((entry) => run.time >= entry.from);
  let roll = random(run) * open.reduce((sum, entry) => sum + entry.weight, 0);
  for (const entry of open) {
    roll -= entry.weight;
    if (roll < 0) return entry.kind;
  }
  return "replyAll";
}

function spawn(run: Run, dt: number): void {
  if (!run.miniBossDone && run.time >= MINI_BOSS_AT) {
    run.miniBossDone = true;
    const at = pointAround(run, SPAWN_DISTANCE.min, SPAWN_DISTANCE.max);
    addFoe(run, "middleManager", at.x, at.y);
  }
  if (!run.bossDone && run.time >= BOSS_AT) {
    run.bossDone = true;
    const at = pointAround(run, SPAWN_DISTANCE.min, SPAWN_DISTANCE.max);
    addFoe(run, "auditor", at.x, at.y);
  }
  const auditorOut = run.foes.some((foe) => foe.kind === "auditor");
  run.spawnDebt += spawnRate(run.time) * (1 + (run.difficulty - 1) / 2) * (auditorOut ? 0.5 : 1) * dt;
  while (run.spawnDebt >= 1) {
    run.spawnDebt -= 1;
    if (run.foes.length >= MAX_FOES) continue;
    const at = pointAround(run, SPAWN_DISTANCE.min, SPAWN_DISTANCE.max);
    addFoe(run, drawKind(run), at.x, at.y);
  }
  if (run.time < PRINTER_FROM) return;
  run.printerIn -= dt;
  if (run.printerIn > 0) return;
  run.printerIn = PRINTER_EVERY;
  if (run.foes.filter((foe) => foe.kind === "printerJam").length >= MAX_PRINTERS) return;
  const at = pointAround(run, 220, 360);
  addFoe(run, "printerJam", at.x, at.y);
}

function summon(run: Run, around: Foe, count: number): void {
  for (let index = 0; index < count && run.foes.length < MAX_FOES; index += 1) {
    const angle = random(run) * Math.PI * 2;
    addFoe(run, "replyAll", around.x + Math.cos(angle) * (around.radius + 12), around.y + Math.sin(angle) * (around.radius + 12));
  }
}

function shootAt(run: Run, from: Foe, angle: number, shot: { speed: number; radius: number; damage: number; life: number }): void {
  run.foeShots.push({
    id: run.nextId++,
    from: from.kind,
    x: from.x,
    y: from.y,
    vx: Math.cos(angle) * shot.speed,
    vy: Math.sin(angle) * shot.speed,
    radius: shot.radius,
    damage: shot.damage,
    life: shot.life,
  });
}

/** A foe's timer went off: summon, shoot or charge, by kind. */
function act(run: Run, foe: Foe, toHero: number, distance: number): void {
  foe.cycles += 1;
  switch (foe.kind) {
    case "meetingInvite":
      summon(run, foe, INVITE_SUMMONS);
      break;
    case "printerJam":
      if (distance <= PRINTER_RANGE) shootAt(run, foe, toHero, TONER);
      break;
    case "middleManager":
      foe.charge = CHARGE.seconds;
      foe.chargeX = Math.cos(toHero);
      foe.chargeY = Math.sin(toHero);
      break;
    case "auditor":
      for (let index = 0; index < RED_TAPE.count; index += 1) shootAt(run, foe, toHero + (index / RED_TAPE.count) * Math.PI * 2, RED_TAPE);
      if (foe.cycles % AUDITOR_SUMMON_EVERY === 0) summon(run, foe, AUDITOR_SUMMONS);
      break;
    default:
      break;
  }
}

/** Is this foe heavy enough that others should move around it rather than push it? */
function anchored(foe: Foe): boolean {
  return foe.kind === "printerJam" || FOES[foe.kind].boss;
}

function moveFoes(run: Run, dt: number): void {
  const { hero } = run;
  const fade = Math.max(0, 1 - PUSH_FADE * dt);
  for (const foe of [...run.foes]) {
    foe.hurt = Math.max(0, foe.hurt - dt);
    foe.duckCooldown = Math.max(0, foe.duckCooldown - dt);
    const dx = hero.x - foe.x;
    const dy = hero.y - foe.y;
    const distance = Math.hypot(dx, dy);
    const toHero = Math.atan2(dy, dx);
    const def = FOES[foe.kind];
    if (def.every > 0) {
      foe.timer -= dt;
      if (foe.timer <= 0) {
        foe.timer += def.every;
        act(run, foe, toHero, distance);
      }
    }
    let speed = foe.speed * (1 - foe.slow);
    let [mx, my] = distance > 0 ? [dx / distance, dy / distance] : [0, 0];
    if (foe.charge > 0) {
      foe.charge -= dt;
      speed *= CHARGE.speed;
      mx = foe.chargeX;
      my = foe.chargeY;
    }
    // Stop at the hero's edge rather than walking through them.
    const stride = foe.charge > 0 ? speed * dt : Math.min(speed * dt, Math.max(0, distance - foe.radius - HERO_RADIUS + 1));
    foe.x = clampTo(foe.x + mx * stride + foe.pushX * dt, foe.radius, ARENA.width);
    foe.y = clampTo(foe.y + my * stride + foe.pushY * dt, foe.radius, ARENA.height);
    foe.pushX *= fade;
    foe.pushY *= fade;
    foe.slow = 0;
  }
  separate(run);
}

/** Foes that overlap shove apart, so the horde spreads instead of stacking on one spot. */
function separate(run: Run): void {
  for (const foe of run.foes) {
    if (anchored(foe)) continue;
    grid.near(foe.x, foe.y, foe.radius, FOE_PAD, (other) => {
      if (other === foe || (!anchored(other) && other.id < foe.id)) return;
      const dx = foe.x - other.x;
      const dy = foe.y - other.y;
      const distance = Math.hypot(dx, dy);
      const overlap = foe.radius + other.radius - distance;
      if (overlap <= 0) return;
      const [nx, ny] = distance > 0 ? [dx / distance, dy / distance] : [1, 0];
      const share = anchored(other) ? 1 : 0.5;
      foe.x += nx * overlap * share;
      foe.y += ny * overlap * share;
      if (!anchored(other)) {
        other.x -= nx * overlap * share;
        other.y -= ny * overlap * share;
      }
    });
  }
}

function hurtFoe(run: Run, foe: Foe, amount: number, weapon: WeaponId): void {
  if (foe.hp <= 0) return;
  const dealt = Math.min(foe.hp, amount * run.numbers.damage);
  foe.hp -= dealt;
  foe.hurt = FOE_HURT_FLASH;
  run.dealt[weapon] = (run.dealt[weapon] ?? 0) + dealt;
}

function knock(foe: Foe, fromX: number, fromY: number, speed: number): void {
  const dx = foe.x - fromX;
  const dy = foe.y - fromY;
  const distance = Math.hypot(dx, dy) || 1;
  const scale = FOES[foe.kind].boss ? BOSS_PUSH : foe.kind === "printerJam" ? 0 : 1;
  foe.pushX += (dx / distance) * speed * scale;
  foe.pushY += (dy / distance) * speed * scale;
}

function reap(run: Run): void {
  const alive: Foe[] = [];
  for (const foe of run.foes) {
    if (foe.hp > 0) {
      alive.push(foe);
      continue;
    }
    run.kills += 1;
    run.gold += foe.gold * run.numbers.gold;
    if (foe.xp > 0) run.gems.push({ id: run.nextId++, x: foe.x, y: foe.y, value: foe.xp, pulled: false });
    addEffect(run, "pop", foe.x, foe.y, foe.radius, 0.3);
    if (foe.kind === "auditor") run.status = "won";
  }
  run.foes = alive;
  while (run.gems.length > MAX_GEMS) {
    const oldest = run.gems.shift()!;
    run.gems[0].value += oldest.value;
  }
}

// ---- Weapons -----------------------------------------------------------------------------------------------------

function nearestFoes(run: Run, count: number, reach: number): Foe[] {
  const { hero } = run;
  return run.foes
    .map((foe) => ({ foe, distance: Math.hypot(foe.x - hero.x, foe.y - hero.y) }))
    .filter((entry) => entry.distance <= reach && entry.foe.hp > 0)
    .sort((a, b) => a.distance - b.distance)
    .slice(0, count)
    .map((entry) => entry.foe);
}

function addShot(run: Run, weapon: WeaponId, angle: number, numbers: ReturnType<typeof weaponNumbers>, targetId = 0): void {
  if (run.shots.length >= MAX_SHOTS) return;
  const shot: Shot = {
    id: run.nextId++,
    weapon,
    x: run.hero.x,
    y: run.hero.y,
    vx: Math.cos(angle) * numbers.speed,
    vy: Math.sin(angle) * numbers.speed,
    radius: numbers.radius,
    damage: numbers.damage,
    life: numbers.life,
    pierce: numbers.pierce,
    targetId,
    hitIds: [],
  };
  run.shots.push(shot);
}

/** Fires the weapon if it's ready and has something to fire at; returns whether it did. */
function trigger(run: Run, weapon: OwnedWeapon): boolean {
  const { hero } = run;
  const numbers = weaponNumbers(weapon.id, weapon.level);
  const facing = Math.atan2(hero.faceY, hero.faceX);
  switch (WEAPONS[weapon.id].pattern) {
    case "homing": {
      const targets = nearestFoes(run, numbers.count, AIM_REACH);
      if (targets.length === 0) return false;
      for (let index = 0; index < numbers.count; index += 1) {
        const target = targets[index % targets.length];
        addShot(run, weapon.id, Math.atan2(target.y - hero.y, target.x - hero.x) + (index - (numbers.count - 1) / 2) * 0.3, numbers, target.id);
      }
      return true;
    }
    case "pierce": {
      const [target] = nearestFoes(run, 1, AIM_REACH);
      if (!target) return false;
      const aim = Math.atan2(target.y - hero.y, target.x - hero.x);
      for (let index = 0; index < numbers.count; index += 1) addShot(run, weapon.id, aim + (index - (numbers.count - 1) / 2) * 0.15, numbers);
      return true;
    }
    case "fan":
      for (let index = 0; index < numbers.count; index += 1) addShot(run, weapon.id, facing + (index - (numbers.count - 1) / 2) * FAN_SPREAD, numbers);
      return true;
    case "drop": {
      const near = nearestFoes(run, 12, DROP_REACH);
      for (let index = 0; index < numbers.count; index += 1) {
        const target = near.length > 0 ? near[Math.floor(random(run) * near.length)] : null;
        const x = target ? target.x : hero.x + hero.faceX * 120;
        const y = target ? target.y : hero.y + hero.faceY * 120;
        run.drops.push({ id: run.nextId++, x, y, delay: numbers.life, radius: numbers.radius, damage: numbers.damage });
      }
      return true;
    }
    case "swing":
      grid.near(hero.x, hero.y, numbers.radius, FOE_PAD, (foe) => {
        hurtFoe(run, foe, numbers.damage, weapon.id);
        knock(foe, hero.x, hero.y, numbers.knockback);
      });
      addEffect(run, "swing", hero.x, hero.y, numbers.radius, 0.2);
      return true;
    case "aura":
      grid.near(hero.x, hero.y, numbers.radius, FOE_PAD, (foe) => hurtFoe(run, foe, numbers.damage, weapon.id));
      return true;
    case "orbit":
      return false;
  }
}

function fire(run: Run, weapon: OwnedWeapon, dt: number): void {
  const { hero } = run;
  const numbers = weaponNumbers(weapon.id, weapon.level);
  const pattern = WEAPONS[weapon.id].pattern;
  if (pattern === "orbit") {
    weapon.spin = (weapon.spin + numbers.speed * dt) % (Math.PI * 2);
    for (let index = 0; index < numbers.count; index += 1) {
      const angle = weapon.spin + (index / numbers.count) * Math.PI * 2;
      grid.near(hero.x + Math.cos(angle) * numbers.radius, hero.y + Math.sin(angle) * numbers.radius, DUCK_RADIUS, FOE_PAD, (foe) => {
        if (foe.duckCooldown > 0) return;
        hurtFoe(run, foe, numbers.damage, weapon.id);
        foe.duckCooldown = numbers.life;
      });
    }
    return;
  }
  if (pattern === "aura") grid.near(hero.x, hero.y, numbers.radius, FOE_PAD, (foe) => (foe.slow = Math.max(foe.slow, numbers.slow)));
  weapon.cooldownLeft -= dt;
  if (weapon.cooldownLeft > 0) return;
  // Nothing to fire at: stay ready rather than waste the shot.
  if (!trigger(run, weapon)) {
    weapon.cooldownLeft = 0;
    return;
  }
  weapon.cooldownLeft = Math.max(MIN_COOLDOWN, numbers.cooldown * run.numbers.cooldown);
}

function moveShots(run: Run, dt: number): void {
  const kept: Shot[] = [];
  for (const shot of run.shots) {
    if (shot.targetId) {
      const target = byId.get(shot.targetId);
      if (target && target.hp > 0) {
        const speed = Math.hypot(shot.vx, shot.vy);
        const angle = Math.atan2(target.y - shot.y, target.x - shot.x);
        shot.vx = Math.cos(angle) * speed;
        shot.vy = Math.sin(angle) * speed;
      } else shot.targetId = 0;
    }
    shot.x += shot.vx * dt;
    shot.y += shot.vy * dt;
    shot.life -= dt;
    grid.near(shot.x, shot.y, shot.radius, FOE_PAD, (foe) => {
      if (shot.pierce <= 0 || foe.hp <= 0 || shot.hitIds.includes(foe.id)) return;
      hurtFoe(run, foe, shot.damage, shot.weapon);
      shot.hitIds.push(foe.id);
      shot.pierce -= 1;
    });
    const inside = shot.x >= 0 && shot.y >= 0 && shot.x <= ARENA.width && shot.y <= ARENA.height;
    if (shot.life > 0 && shot.pierce > 0 && inside) kept.push(shot);
  }
  run.shots = kept;
}

function landDrops(run: Run, dt: number): void {
  run.drops = run.drops.filter((drop) => {
    drop.delay -= dt;
    if (drop.delay > 0) return true;
    grid.near(drop.x, drop.y, drop.radius, FOE_PAD, (foe) => hurtFoe(run, foe, drop.damage, "serverRack"));
    addEffect(run, "blast", drop.x, drop.y, drop.radius, 0.35);
    return false;
  });
}

function moveFoeShots(run: Run, dt: number): void {
  const { hero } = run;
  run.foeShots = run.foeShots.filter((shot) => {
    shot.x += shot.vx * dt;
    shot.y += shot.vy * dt;
    shot.life -= dt;
    if (Math.hypot(shot.x - hero.x, shot.y - hero.y) <= shot.radius + HERO_RADIUS) {
      hurtHero(run, shot.damage, shot.from);
      return false;
    }
    return shot.life > 0 && shot.x >= 0 && shot.y >= 0 && shot.x <= ARENA.width && shot.y <= ARENA.height;
  });
}

// ---- Gems and levels ---------------------------------------------------------------------------------------------

function collectGems(run: Run, dt: number): void {
  const { hero } = run;
  run.gems = run.gems.filter((gem) => {
    const dx = hero.x - gem.x;
    const dy = hero.y - gem.y;
    const distance = Math.hypot(dx, dy);
    if (distance <= HERO_RADIUS + GEM_RADIUS) {
      gainXp(run, gem.value);
      return false;
    }
    if (gem.pulled || distance <= run.numbers.magnet) {
      gem.pulled = true;
      const move = Math.min(distance, GEM_PULL * dt);
      gem.x += (dx / distance) * move;
      gem.y += (dy / distance) * move;
    }
    return true;
  });
}

function gainXp(run: Run, value: number): void {
  run.xp += value * run.numbers.xp;
  while (run.xp >= xpToNext(run.level)) {
    run.xp -= xpToNext(run.level);
    run.level += 1;
    run.queuedPicks += 1;
  }
}

// ---- Effects -----------------------------------------------------------------------------------------------------

function addEffect(run: Run, kind: Effect["kind"], x: number, y: number, radius: number, life: number): void {
  run.effects.push({ kind, x, y, radius, age: 0, life });
}

function fadeEffects(run: Run, dt: number): void {
  run.effects = run.effects.filter((effect) => (effect.age += dt) < effect.life);
}
