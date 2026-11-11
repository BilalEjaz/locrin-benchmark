import { Random } from '../shared/random';
import { createLabyrinth, labyrinthSeed, walk, type Walker, type Journey } from './labyrinth';
export { visible } from './labyrinth';
export const WIDTH = 19, HEIGHT = 23, TICK = 1000 / 60;
export type Direction = 'up' | 'left' | 'down' | 'right';
export type Mode = 'scatter' | 'chase';
export const PRIORITY: readonly Direction[] = ['up', 'left', 'down', 'right'];
const vectors: Record<Direction, readonly [number, number]> = { up: [0, -1], left: [-1, 0], down: [0, 1], right: [1, 0] };
export const opposite: Record<Direction, Direction> = { up: 'down', down: 'up', left: 'right', right: 'left' };
export interface Cell { x: number; y: number }
export interface Actor extends Cell { direction: Direction }
export interface Wisp extends Actor { kind: 'tracker' | 'seer' | 'roamer' | 'shy'; returning: boolean; wait: number }
export interface State {
    journey?: Journey; maze: boolean[]; seeds: number[]; suns: number[]; hero: Actor; wisps: Wisp[];
    requested: Direction; score: number; lives: number; ticks: number; heroClock: number; wispClock: number;
    vulnerable: number; chain: number; mode: Mode; phase: number; modeTime: number; schedule: number[]; grace: number;
}
export function difficulty(level: number) {
    if (!Number.isInteger(level) || level < 0 || level > 29) throw new RangeError('Niveau invalide');
    return { wispRatio: 0.75 + 0.3 * level / 29, vulnerableMs: 8000 - 7000 * level / 29, chaseMs: 12000 + 18000 * level / 29 };
}
export const LEVELS = Array.from({ length: 30 }, (_, i) => ({ name: `Dédale ${String(i + 1)}` }));
export const index = (c: Cell): number => c.y * WIDTH + c.x;
export const cell = (i: number): Cell => ({ x: i % WIDTH, y: Math.floor(i / WIDTH) });
export const HOME: Cell = { x: 9, y: 11 }, START: Cell = { x: 9, y: 17 };
export function neighbor(maze: readonly boolean[], c: Cell, direction: Direction): Cell | undefined {
    const [dx, dy] = vectors[direction]; let x = c.x + dx; const y = c.y + dy;
    if (y === 11 && (x < 0 || x >= WIDTH)) x = (x + WIDTH) % WIDTH;
    if (x < 0 || x >= WIDTH || y < 0 || y >= HEIGHT || !maze[y * WIDTH + x]) return undefined;
    return { x, y };
}
export function branching(maze: readonly boolean[]): number {
    let vertices = 0, edges = 0;
    for (let i = 0; i < maze.length; i++) if (maze[i]) {
        vertices++;
        for (const d of ['right', 'down'] as const) if (neighbor(maze, cell(i), d)) edges++;
    }
    return edges - vertices + 1;
}
export function generate(level: number, random: Random): boolean[] {
    difficulty(level); return createLabyrinth(level, Math.floor(random.next() * 1000000)).maze;
}
const corners: readonly Cell[] = [{ x: 1, y: 1 }, { x: 17, y: 1 }, { x: 17, y: 21 }, { x: 1, y: 21 }];
const home = (s: State): Cell => cell(s.journey?.wispStart ?? index(HOME));
const distance = (a: Cell, b: Cell): number => (a.x - b.x) ** 2 + (a.y - b.y) ** 2;
export function target(s: State, w: Wisp): Cell {
    if (w.returning) return home(s);
    const corner = corners[['tracker', 'seer', 'roamer', 'shy'].indexOf(w.kind)] ?? HOME;
    if (s.journey && w.kind === 'roamer') return (corners[Math.floor(s.ticks / 120) % 4] ?? HOME);
    if (s.journey && w.kind === 'shy') return s.hero;
    if (s.mode === 'scatter') return corner;
    if (w.kind === 'tracker') return s.hero;
    if (w.kind === 'seer') { const [dx, dy] = vectors[s.hero.direction]; return { x: s.hero.x + dx * 3, y: s.hero.y + dy * 3 }; }
    if (w.kind === 'roamer') return Math.floor(s.ticks * TICK / 4000) % 2 ? corner : s.hero;
    return distance(w, s.hero) < 36 ? corner : s.hero;
}
// Static floor distances are shared by returning wisps; gates affect only the hero.
const returnFields = new WeakMap<boolean[], { origin: number; distances: Map<number, number> }>();
function returnDistances(s: State): Map<number, number> {
    const origin = home(s), originIndex = index(origin), cached = returnFields.get(s.maze);
    if (cached?.origin === originIndex) return cached.distances;
    const distances = new Map([[originIndex, 0]]), queue = [origin];
    for (let i = 0; i < queue.length; i++) {
        const c = queue[i]; if (!c) continue;
        for (const d of PRIORITY) {
            const p = neighbor(s.maze, c, d);
            if (p && !distances.has(index(p))) { distances.set(index(p), (distances.get(index(c)) ?? 0) + 1); queue.push(p); }
        }
    }
    returnFields.set(s.maze, { origin: originIndex, distances });
    return distances;
}
export function choose(s: State, w: Wisp): Direction | undefined {
    let candidates = PRIORITY.filter(d => d !== opposite[w.direction] && neighbor(s.maze, w, d));
    if (!candidates.length && s.journey) candidates = PRIORITY.filter(d => neighbor(s.maze, w, d));
    const aim = target(s, w), flee = !w.returning && (s.vulnerable > 0 || (!!s.journey && w.kind === 'shy' && distance(w, s.hero) < 36));
    const distances = w.returning ? returnDistances(s) : new Map<number, number>();
    return candidates.sort((a, b) => {
        const pa = neighbor(s.maze, w, a), pb = neighbor(s.maze, w, b);
        if (w.returning && pa && pb) return (distances.get(index(pa)) ?? Infinity) - (distances.get(index(pb)) ?? Infinity);
        return pa && pb ? (distance(pa, aim) - distance(pb, aim)) * (flee ? -1 : 1) : 0;
    })[0];
}
function wisps(): Wisp[] { return (['tracker', 'seer', 'roamer', 'shy'] as const).map((kind, i) => ({ ...HOME, kind, direction: 'up', returning: false, wait: 2500 + i * 1800 })); }
export class Engine {
    level = 0; seed = 459; state!: State; status: 'playing' | 'won' | 'lost' = 'playing'; events: string[] = [];
    specialUses = 1; specialTicks = 0; lightPath: number[] = [];
    private remainder = 0; private random = new Random(459);
    constructor(level = 0, seed = 459) { this.loadLevel(level, seed); }
    loadLevel(level: number, seed = 459): void {
        this.specialUses = 1; this.specialTicks = 0; this.lightPath = [];
        const d = difficulty(level); this.level = level; this.seed = seed; this.random = new Random(labyrinthSeed(level, seed)); this.remainder = 0; this.status = 'playing'; this.events = [];
        const { maze, journey, seeds, suns } = createLabyrinth(level, seed);
        this.state = { journey, maze, suns, seeds, hero: { ...cell(journey.start ?? index(START)), direction: 'left' }, requested: 'left', wisps: wisps().filter(w => (level >= 24 && ![5, 10, 16, 21, 26].includes(level)) || w.kind === 'tracker'), score: 0, lives: 3, ticks: 0, heroClock: 0, wispClock: 0, vulnerable: 0, chain: 0, mode: 'scatter', phase: 0, modeTime: 0, schedule: Array.from({ length: 8 }, (_, i) => i % 2 ? d.chaseMs + Math.floor(this.random.next() * 1000) : 8000 + Math.floor(this.random.next() * 1000)), grace: 1800 };
        for (const w of this.state.wisps) Object.assign(w, cell(journey.wispStart ?? index(HOME)));
    }
    loadState(state: State & { specialUses?: number; specialTicks?: number; lightPath?: number[] }): void {
        this.specialUses = state.specialUses ?? 1; this.specialTicks = state.specialTicks ?? 0; this.lightPath = [...(state.lightPath ?? [])]; this.state = structuredClone(state);
        for (const key of ['specialUses', 'specialTicks', 'lightPath', 'reserve']) Reflect.deleteProperty(this.state, key); this.remainder = 0; this.status = 'playing'; this.events = []; }
    /** Breadth first over actual turns, including inventory, slides and portals. */
    special(): boolean {
        if (this.status !== 'playing' || this.specialUses === 0) return false;
        const s = this.state, j = s.journey;
        const initial: Walker = { pos: index(s.hero), direction: s.hero.direction, held: j?.held ?? 0, toggled: j?.toggled ?? 0, phase: (j?.turn ?? 0) % 4 };
        const queue = [{ state: initial, parent: -1, visited: [] as number[] }], seen = new Set([JSON.stringify(initial)]);
        for (let i = 0; i < queue.length; i++) {
            const node = queue[i]; if (!node) continue;
            for (const direction of PRIORITY) {
                const adjacent = neighbor(s.maze, cell(node.state.pos), direction);
                const result = j ? walk(s.maze, j, node.state, direction) : { next: { ...node.state, pos: adjacent ? index(adjacent) : node.state.pos, direction }, visited: adjacent ? [index(adjacent)] : [] };
                const goal = result.visited.findIndex(at => s.suns.includes(at));
                if (goal >= 0) {
                    const legs = [result.visited.slice(0, goal + 1)]; let parent = i;
                    while (parent >= 0) { const leg = queue[parent]; if (!leg) break; legs.push(leg.visited); parent = leg.parent; }
                    this.lightPath = [initial.pos, ...legs.reverse().flat()]; this.specialUses = 0; this.specialTicks = 180;
                    this.events.push('special'); return true;
                }
                const key = JSON.stringify(result.next);
                if (!seen.has(key)) { seen.add(key); queue.push({ state: result.next, parent: i, visited: result.visited }); }
            }
        }
        return false;
    }
    advance(ms: number): void { this.step(ms); }
    input(d: Direction): void { this.state.requested = d; }
    snapshot() { return { ...structuredClone(this.state), ...(this.specialUses === 1 ? {} : { specialUses: this.specialUses, specialTicks: this.specialTicks, lightPath: [...this.lightPath] }), level: this.level, seed: this.seed, status: this.status, random: this.random.state, remainder: Math.max(0, Math.round(this.remainder * 1e8) / 1e8) }; }
    private collect(): void {
        const s = this.state, pos = index(s.hero), at = s.seeds.indexOf(pos), sun = s.suns.indexOf(pos);
        if (at >= 0) { s.seeds.splice(at, 1); s.score += 10; this.events.push('seed'); }
        if (sun >= 0) { s.suns.splice(sun, 1); s.score += 50; s.vulnerable = s.journey && [5, 10, 16, 21, 26].includes(this.level) ? 12000 : difficulty(this.level).vulnerableMs; s.chain = 0; this.events.push('sun'); }
        if (!s.seeds.length && !s.suns.length) this.status = 'won';
    }
    private collision(beforeHero?: Cell, beforeWisps?: readonly Cell[]): boolean {
        const s = this.state;
        for (const [i, w] of s.wisps.entries()) if (!w.returning && w.wait <= 0 && (index(w) === index(s.hero) || (beforeHero && beforeWisps?.[i] && index(w) === index(beforeHero) && index(s.hero) === index(beforeWisps[i])))) {
            if (s.vulnerable > 0) { s.score += 200 * 2 ** Math.min(3, s.chain++); w.returning = true; this.events.push('wisp'); }
            else if (s.grace <= 0) {
                s.lives--; this.events.push('life');
                if (!s.lives) this.status = 'lost';
                s.hero = { ...cell(s.journey?.start ?? index(START)), direction: 'left' }; s.requested = 'left'; s.wisps = wisps().filter(w => !s.journey || (this.level >= 24 && ![5, 10, 16, 21, 26].includes(this.level)) || w.kind === 'tracker'); for (const actor of s.wisps) Object.assign(actor, home(s)); s.heroClock = s.wispClock = 0; s.grace = 1800; s.vulnerable = s.chain = 0; s.mode = 'scatter'; s.phase = 0; s.modeTime = 0; return true;
            }
        } return false;
    }
    private tick(): void {
        const s = this.state, d = difficulty(this.level); s.ticks++;
        if (this.specialTicks > 0 && --this.specialTicks === 0) this.lightPath = [];
        const beforeHero = { ...s.hero }, beforeWisps = s.wisps.map(w => ({ ...w }));
        const wispsDue = s.wispClock + TICK + 1e-8 >= 1000 / (6 * d.wispRatio);
        s.grace = Math.max(0, s.grace - TICK); s.vulnerable = Math.max(0, s.vulnerable - TICK);
        s.modeTime += TICK;
        if (s.modeTime + 1e-8 >= (s.schedule[s.phase] ?? d.chaseMs)) {
            s.modeTime = 0; s.phase++; s.mode = s.mode === 'scatter' ? 'chase' : 'scatter';
            for (const w of s.wisps) w.direction = opposite[w.direction]; this.events.push('mode');
        }
        for (const w of s.wisps) w.wait = Math.max(0, w.wait - TICK);
        s.heroClock += TICK;
        if (s.heroClock + 1e-8 >= 1000 / 6) {
            s.heroClock -= 1000 / 6;
            if (s.journey) {
                const j = s.journey;
                const result = walk(s.maze, j, { pos: index(s.hero), direction: s.hero.direction, held: j.held, toggled: j.toggled, phase: j.turn % 4 }, s.requested);
                j.turn++;
                for (const at of result.visited) {
                    Object.assign(s.hero, cell(at));
                    for (const key of j.keys) if (key.at === at) j.held |= 1 << key.color;
                    if (j.switches.includes(at)) j.toggled = 1 - j.toggled;
                    this.collect();
                    if (this.collision()) return;
                }
                s.hero.direction = result.next.direction; this.events.push(...result.events);
                if (result.visited.length) this.events.push('move');
                if (j.remaining > 0) { j.remaining = Math.max(0, j.remaining - 1000 / 6); if (!j.remaining && this.status === 'playing') { this.status = 'lost'; this.events.push('timeout'); } }
            } else {
                if (neighbor(s.maze, s.hero, s.requested)) s.hero.direction = s.requested;
                const next = neighbor(s.maze, s.hero, s.hero.direction);
                if (next) { Object.assign(s.hero, next); this.events.push('move'); }
                this.collect();
            }
            if ((!wispsDue && this.collision()) || this.status !== 'playing') return;
        }
        s.wispClock += TICK;
        if (s.wispClock + 1e-8 >= 1000 / (6 * d.wispRatio)) {
            s.wispClock -= 1000 / (6 * d.wispRatio);
            for (const w of s.wisps) {
                if (w.wait > 0) continue;
                if (w.returning && index(w) === index(home(s))) { w.returning = false; w.wait = 2000; continue; }
                const direction = choose(s, w);
                if (direction) { const next = neighbor(s.maze, w, direction); if (next) { Object.assign(w, next); w.direction = direction; if (s.journey) this.events.push(w.kind === 'roamer' ? 'patrol' : w.kind === 'shy' && (s.vulnerable > 0 || distance(w, s.hero) < 36) ? 'light-flee' : 'pursuit'); } }
            }
            this.collision(beforeHero, beforeWisps);
        }
    }
    step(dtMs: number): void {
        if (!Number.isFinite(dtMs) || dtMs < 0) throw new RangeError('Temps invalide');
        this.events = []; if (this.status === 'playing') this.remainder += dtMs;
        while (this.remainder + 1e-8 >= TICK && this.status === 'playing') { this.remainder -= TICK; this.tick(); }
        if (this.status !== 'playing') this.remainder = 0;
    }
}
