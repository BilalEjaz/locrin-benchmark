import { Random } from '../shared/random';

export const SHAPES = ['corridors', 'rooms', 'ring', 'spiral', 'mirror'] as const;
export type Shape = typeof SHAPES[number];
export type Heading = 'up' | 'left' | 'down' | 'right';
export interface Journey {
    start?: number; wispStart?: number; principal?: number[]; corridor?: number[]; shape: Shape; keys: { at: number; color: number }[]; doors: { at: number; color: number }[];
    arrows: { at: number; direction: Heading }[]; portals: [number, number][];
    switches: number[]; gates: number[]; moving: number[]; ice: number[]; dark: number[];
    held: number; toggled: number; turn: number; remaining: number;
}
export interface Walker { pos: number; held: number; toggled: number; phase: number; direction: Heading }
function required<T>(value: T | undefined): T {
    if (value === undefined) throw new RangeError('Case absente');
    return value;
}
const width = 19;
// Seed salts selected by full engine replays, route separation and campaign pacing
// (levels 20, 24, 27-30 re-selected for the per-level encounter mix, pass 503: both seeds won, D-ROUTE ≤ 30 %, D-CURVE;
// level 26 is the review board and keeps its historical salt and placement).
const placementSalts = [0, 837832, 0, 733103, 0, 0, 0, 209458, 104729, 104729, 0, 0, 0, 209458, 209458, 523645, 104729, 104729, 733103, 314501198, 733103, 1256748, 117087022, 1466367, 418916, 22097819, 2723136, 319842377, 56344398, 324869369];
const offsets: Record<Heading, number> = { up: -19, left: -1, down: 19, right: 1 };
/** The principal corridor is also the placement frame: there is no common gallery. */
export const labyrinthSeed = (level: number, seed: number): number => (seed + level * 7919 + (placementSalts[level] ?? 0)) >>> 0;
/** Placement families, in order of first appearance (level = index + 1). */
export const ENCOUNTERS = ['key', 'arrow', 'portal', 'switch', 'moving', 'ice', 'dark', 'key2'] as const;
export type Encounter = typeof ENCOUNTERS[number];
const INTRO: Record<Encounter, number> = { key: 3, arrow: 4, portal: 8, switch: 12, moving: 15, ice: 18, dark: 21, key2: 27 };
const BREATHERS = [5, 10, 16, 21, 26];
const REVIEW = 25;
/** Historical route fractions, kept for the review board (its long route stays distinct from the short early ones). */
const HISTORICAL: Partial<Record<Encounter, number>> = { key: 0.08, portal: 0.30, switch: 0.40, moving: 0.69, ice: 0.76, dark: 0.86 };
/**
 * Encounters of a level. Challenges (every fifth) and the final use everything acquired; breathers only the newest;
 * an introduction level adds one older family; the others mix the newest with two older ones in rotation, so two
 * neighbouring levels never meet the same set in the same order.
 */
export function encounters(level: number): Encounter[] {
    const acquired = ENCOUNTERS.filter(m => INTRO[m] <= level && m !== 'key2');
    const newest = [...acquired].sort((a, b) => INTRO[b] - INTRO[a])[0];
    if (!newest) return [];
    // From level 28 the second colour comes with its first-colour pair (it needs its own key).
    const second: Encounter[] = level >= INTRO.key2 ? ['key2'] : [];
    // Level 26 is the review board: everything acquired at the historical route fractions (see `slot`).
    if (level === REVIEW) return [...acquired];
    if ((level + 1) % 5 === 0) return rotate([...acquired, ...second], level);
    if (BREATHERS.includes(level)) return second.length ? rotate([newest, 'key', ...second], level) : [newest];
    const older = acquired.filter(m => m !== newest);
    const picks = Object.values(INTRO).includes(level) ? 1 : 2;
    const chosen = Array.from({ length: Math.min(picks, older.length) }, (_, k) => older[(level * 2 + k) % older.length]).filter((m): m is Encounter => m !== undefined);
    const mix = new Set<Encounter>([newest, ...chosen]);
    if (second.length) mix.add('key');
    return rotate([...mix, ...second], level);
}
function rotate<T>(items: T[], level: number): T[] {
    const n = items.length, k = n ? (level * 3) % n : 0;
    return [...items.slice(k), ...items.slice(0, k)];
}
/** Route fraction where a family starts: equal windows between 8 % and 88 % of the principal route, in plan order. */
function slot(plan: readonly Encounter[], m: Encounter, level: number): number {
    if (level === REVIEW) return HISTORICAL[m] ?? 0.5;
    // Every family, the arrow included, gets its own route slice in plan order.
    const placed: readonly Encounter[] = plan, i = placed.indexOf(m), width = 0.8 / Math.max(1, placed.length);
    return 0.08 + Math.max(0, i) * width;
}
export function createLabyrinth(level: number, seed: number): { maze: boolean[]; journey: Journey; seeds: number[]; suns: number[] } {
    const random = new Random(labyrinthSeed(level, seed)), shape = SHAPES[level % 5] ?? 'corridors';
    const maze = Array<boolean>(437).fill(false);
    const open = (x: number, y: number): void => { maze[y * width + x] = true; };
    const shuffle = <T>(items: T[]): T[] => {
        for (let i = items.length - 1; i > 0; i--) { const k = Math.floor(random.next() * (i + 1)); [items[i], items[k]] = [required(items[k]), required(items[i])]; }
        return items;
    };
    let principal: number[] = [];
    if (shape === 'ring') {
        const left = 1 + Math.floor(random.next() * 5), right = 13 + Math.floor(random.next() * 5);
        const top = 1 + Math.floor(random.next() * 6), bottom = 16 + Math.floor(random.next() * 6);
        for (let x = left; x < right; x++) principal.push(top * width + x);
        for (let y = top; y < bottom; y++) principal.push(y * width + right);
        for (let x = right; x > left; x--) principal.push(bottom * width + x);
        for (let y = bottom; y > top; y--) principal.push(y * width + left);
        if (random.next() < 0.5) principal.reverse();
        const cut = Math.floor(random.next() * principal.length);
        principal = [...principal.slice(cut), ...principal.slice(0, cut)];
        for (const at of principal) maze[at] = true;
    } else if (shape === 'spiral') {
        const radius = (level === 3 ? 8 : level === 28 ? 6 : 3 + Math.floor(level / 5)), cx = 1 + radius + Math.floor(random.next() * (17 - 2 * radius));
        const cy = 1 + radius + Math.floor(random.next() * (21 - 2 * radius));
        let x = -radius, y = -radius, left = -radius, right = radius, top = -radius, bottom = radius;
        const rotation = Math.floor(random.next() * 4), reflect = random.next() < 0.5;
        const add = (): void => {
            let a = reflect ? -x : x, b = y;
            for (let r = 0; r < rotation; r++) [a, b] = [-b, a];
            principal.push((cy + b) * width + cx + a);
        };
        add();
        while (left <= right && top <= bottom) {
            while (x < right) { x++; add(); }
            while (y < bottom) { y++; add(); }
            left += 2; top += 2;
            if (left > right || top > bottom) break;
            while (x > left) { x--; add(); }
            while (y > top) { y--; add(); }
            right -= 2; bottom -= 2;
        }
        for (const at of principal) maze[at] = true;
    } else {
        const stack: [number, number][] = [[1, 1]]; open(1, 1);
        while (stack.length) {
            const [x, y] = required(stack[stack.length - 1]);
            const options = shuffle<[number, number]>([[x - 2, y], [x + 2, y], [x, y - 2], [x, y + 2]]).filter(([a, b]) => a > 0 && a < 18 && b > 0 && b < 22 && !maze[b * width + a]);
            if (!options.length) { stack.pop(); continue; }
            const [a, b] = required(options[0]);
            open(a, b); open((x + a) / 2, (y + b) / 2); stack.push([a, b]);
        }
        if (shape === 'rooms') {
            for (let n = 0; n < 5; n++) {
                const x = 1 + 2 * Math.floor(random.next() * 7), y = 1 + 2 * Math.floor(random.next() * 9);
                for (let dy = 0; dy < 3; dy++) for (let dx = 0; dx < 3; dx++) open(x + dx, y + dy);
            }
        }
        if (shape === 'mirror') {
            for (let y = 1; y <= 21; y++) for (let x = 1; x <= 9; x++) maze[y * width + 18 - x] = (maze[y * width + x] ?? false);
            for (let y = 1; y <= 21; y++) open(9, y);
        }
        // A seeded DFS path through this very topology, rather than an attached tutorial.
        const root = required(shuffle(maze.flatMap((v, i) => v ? [i] : []))[0]);
        const seen = new Set<number>(), path: number[] = [];
        const visit = (at: number): void => {
            seen.add(at); path.push(at);
            if (path.length > principal.length) principal = [...path];
            for (const d of shuffle([-19, -1, 19, 1])) {
                const dest = at + d;
                if (maze[dest] && !seen.has(dest)) visit(dest);
            }
            path.pop();
        };
        visit(root);
    }
    const corridor = [...principal];
    const length = shape === 'spiral' ? principal.length : Math.min(principal.length, 26 + level * 4);
    principal = principal.slice(0, length);
    const point = (fraction: number): number => required(principal[Math.min(length - 1, Math.max(1, Math.floor(fraction * (length - 1))))]);
    // Each level draws its own mix and order of encounters (see `encounters`), not the cumulative list.
    const plan = encounters(level), has = (m: Encounter): boolean => plan.includes(m);
    const at = (m: Encounter): number => slot(plan, m, level);
    // Ice must sit on a straight run so entering it really slides (first straight cell at or after its slice).
    const straightIndex = (fraction: number): number => {
        const from = Math.min(length - 2, Math.max(1, Math.floor(fraction * (length - 1))));
        for (let i = from; i < length - 1; i++) if (required(principal[i]) - required(principal[i - 1]) === required(principal[i + 1]) - required(principal[i])) return i;
        return -1;
    };
    const straight = (fraction: number): number => { const i = straightIndex(fraction); return i < 0 ? point(fraction) : required(principal[i]); };
    // The arrow sits on the first straight run of its own slice (review board: the historical first straight run).
    const firstStraight = principal.findIndex((at, i) => i >= 2 && i < length - 1 && at - required(principal[i - 1]) === required(principal[i + 1]) - at);
    const windowed = level === REVIEW ? -1 : straightIndex(at('arrow'));
    const arrowAt = windowed >= 0 ? windowed : firstStraight;
    const direction = (a: number, b: number): Heading => b - a === -19 ? 'up' : b - a === 19 ? 'down' : b < a ? 'left' : 'right';
    const journey: Journey = {
        shape, start: required(principal[0]), principal, corridor,
        wispStart: shape === 'spiral' ? point(0.1 + random.next() * 0.85) : point(0.6),
        keys: has('key') ? [{ at: point(at('key')), color: 0 }, ...(has('key2') ? [{ at: point(at('key2')), color: 1 }] : [])] : [],
        doors: has('key') ? [{ at: point(at('key') + 0.08), color: 0 }, ...(has('key2') ? [{ at: point(at('key2') + 0.07), color: 1 }] : [])] : [],
        arrows: has('arrow') ? [{ at: required(principal[arrowAt]), direction: direction(required(principal[arrowAt]), required(principal[arrowAt + 1])) }] : [],
        // At least three cells apart on short routes, so the portal is a real shortcut (historical 0.02 on long ones).
        portals: has('portal') ? [[point(at('portal')), point(at('portal') + (level === REVIEW ? 0.02 : Math.max(0.02, 3 / (length - 1))))]] : [],
        switches: has('switch') ? [point(at('switch'))] : [], gates: has('switch') ? [point(at('switch') + 0.06)] : [],
        moving: has('moving') ? [point(at('moving'))] : [], ice: has('ice') ? [level === REVIEW ? point(at('ice')) : straight(at('ice'))] : [], dark: has('dark') ? [point(at('dark')), point(at('dark') + 0.01)] : [],
        held: 0, toggled: 0, turn: 0, remaining: (level + 1) % 5 === 0 ? (level === 29 ? 40000 : 25000) : 0,
    };
    // Goals on both sides of every interaction make the route playable evidence.
    const goals = new Set([point(0.05), point(0.25), point(0.52), point(1),
        ...journey.keys.map(v => v.at), ...journey.doors.map(v => v.at), ...journey.arrows.map(v => v.at),
        ...journey.switches, ...journey.gates, ...journey.moving, ...journey.ice, ...journey.dark,
        // A goal just past the portal makes the route take it (historical 0.34 = 0.30 + 0.04).
        ...(journey.portals.length ? [point(at('portal') + (level === REVIEW ? 0.04 : Math.max(0.04, 5 / (length - 1))))] : [])]);
    const suns = [point(0.05), point(0.25), point(0.52), point(1)];
    for (const at of [point(0.12), point(0.36), point(0.65), point(0.92)]) goals.add(at);
    if (shape === 'mirror' && (level === 19 || level === 29)) {
        // Keep the required route intact. Reflect optional mechanics only onto
        // free side branches: no extra lock or toggle may obstruct that route.
        const reflect = (at: number): number => Math.floor(at / width) * width + 18 - at % width;
        const occupied = new Set([...principal, ...journey.keys.map(v => v.at), ...journey.doors.map(v => v.at),
            ...journey.arrows.map(v => v.at), ...journey.portals.flat(), ...journey.switches, ...journey.gates,
            ...journey.moving, ...journey.ice, ...journey.dark]);
        const free = (at: number): boolean => reflect(at) !== at && !occupied.has(reflect(at));
        for (const list of [journey.keys, journey.doors]) for (const item of [...list]) {
            if (free(item.at)) list.push({ ...item, at: reflect(item.at) });
        }
        for (const item of [...journey.arrows]) if (free(item.at)) journey.arrows.push({ at: reflect(item.at),
            direction: item.direction === 'left' ? 'right' : item.direction === 'right' ? 'left' : item.direction });
        for (const pair of [...journey.portals]) if (pair.every(free)) journey.portals.push([reflect(pair[0]), reflect(pair[1])]);
        for (const list of [journey.switches, journey.gates, journey.moving, journey.ice, journey.dark]) {
            for (const at of [...list]) if (free(at)) list.push(reflect(at));
        }
    }
    return { maze, journey, suns, seeds: [...goals].filter(at => !suns.includes(at)) };
}
export function walk(maze: readonly boolean[], j: Journey, from: Walker, requested: Heading): { next: Walker; visited: number[]; events: string[] } {
    const next = { ...from, phase: (from.phase + 1) % 4 }, visited: number[] = [], events: string[] = [];
    const allowed = (pos: number, d: Heading): boolean => {
        const dest = pos + offsets[d];
        if (!maze[dest] || (d === 'left' && pos % width === 0) || (d === 'right' && pos % width === 18)) return false;
        const door = j.doors.find(v => v.at === dest);
        if (door && !(next.held & (1 << door.color))) return false;
        if (j.arrows.some(a => (a.at === dest || a.at === pos) && a.direction !== d)) return false;
        if (j.gates.includes(dest) && !next.toggled) return false;
        if (j.moving.includes(dest) && from.phase < 2) return false;
        return true;
    };
    const direction = allowed(from.pos, requested) ? requested : from.direction;
    if (!allowed(from.pos, direction)) { if (j.moving.includes(from.pos + offsets[direction])) events.push('wall-wait'); return { next, visited, events }; }
    next.direction = direction;
    const enter = (): void => {
        next.pos += offsets[direction]; visited.push(next.pos);
        for (const key of j.keys) if (key.at === next.pos && !(next.held & (1 << key.color))) { next.held |= 1 << key.color; events.push('key'); }
        if (j.doors.some(v => v.at === next.pos)) events.push('door');
        if (j.arrows.some(v => v.at === next.pos)) events.push('one-way');
        if (j.switches.includes(next.pos)) { next.toggled = 1 - next.toggled; events.push('switch'); }
        if (j.gates.includes(next.pos)) events.push('gate');
        if (j.moving.includes(next.pos)) events.push('moving-wall');
        if (j.dark.includes(next.pos)) events.push('darkness');
    };
    enter();
    if (j.ice.includes(next.pos)) while (allowed(next.pos, direction)) { events.push('slide'); enter(); }
    const pair = j.portals.find(p => p.includes(next.pos));
    if (pair) { next.pos = pair[0] === next.pos ? pair[1] : pair[0]; visited.push(next.pos); events.push('portal'); }
    return { next, visited, events };
}
export function visible(j: Journey | undefined, hero: number, at: number): boolean {
    return !j?.dark.includes(hero) || Math.abs(hero % width - at % width) + Math.abs(Math.floor(hero / width) - Math.floor(at / width)) <= 3;
}
