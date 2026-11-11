/** Pass 403: workshop mechanisms. One pure transition shared by the engine
 * and the exact breadth-first solver, so a proof replays the real rules.
 *   ~ ice: a box pushed onto ice keeps sliding while the next cell accepts it.
 *   < > ^ v one-way floor: entered only in the arrow's direction (player and boxes).
 *   o plate, | door: the door is passable while a box or the player presses a
 *     plate, or while something stands in the doorway.
 *   O pit: impassable for the player; a box pushed in fills it and disappears.
 *   1 2 paired pads: the player arriving on one pad reappears on the other if free.
 *   r red box, R red target: red boxes count only on red targets (gold on gold). */
export type Direction = 'up' | 'down' | 'left' | 'right';
export const directions: Direction[] = ['up', 'right', 'down', 'left'];
export interface Board {
    width: number; height: number; walls: number[]; targets: number[]; boxes: number[]; player: number;
    ice: number[]; arrows: { at: number; direction: Direction }[]; plates: number[]; doors: number[]; pits: number[]; pads: number[];
    /** 0 gold, 1 red; aligned with `boxes` and `targets`. */
    boxColors: number[]; targetColors: number[];
}
/** `colors` is aligned with `boxes`; a box that drops into a pit leaves both. */
export interface Position { player: number; boxes: number[]; colors: number[]; filled: number[] }
export function neighbor(board: Board, p: number, d: Direction): number { return p + ({ up: -board.width, down: board.width, left: -1, right: 1 })[d]; }
export const reverse: Record<Direction, Direction> = { up: 'down', down: 'up', left: 'right', right: 'left' };
export function mechanical(board: Board): boolean {
    return board.ice.length + board.arrows.length + board.plates.length + board.doors.length + board.pits.length + board.pads.length > 0 || board.boxColors.some(c => c !== 0);
}
interface Index { walls: Set<number>; doors: Set<number>; pits: Set<number>; ice: Set<number>; arrows: Map<number, Direction> }
const indexes = new WeakMap<Board, Index>();
/** Set views of a board, built once; boards are never mutated after parse(). */
function index(board: Board): Index {
    let i = indexes.get(board);
    if (!i) { i = { walls: new Set(board.walls), doors: new Set(board.doors), pits: new Set(board.pits), ice: new Set(board.ice), arrows: new Map(board.arrows.map(a => [a.at, a.direction])) }; indexes.set(board, i); }
    return i;
}
export function doorOpen(board: Board, pos: Position): boolean {
    return board.plates.some(p => p === pos.player || pos.boxes.includes(p));
}
/** May something moving in `d` enter `cell`? Boxes, pits and occupants are handled by the caller. */
function floorAccepts(board: Board, pos: Position, cell: number, d: Direction, open: boolean): boolean {
    const x = index(board);
    if (x.walls.has(cell)) return false;
    if (!open && x.doors.has(cell) && pos.player !== cell && !pos.boxes.includes(cell)) return false;
    const arrow = x.arrows.get(cell);
    return arrow === undefined || arrow === d;
}
const unfilledPit = (board: Board, pos: Position, cell: number) => index(board).pits.has(cell) && !pos.filled.includes(cell);
/** Where a box entering `cell` in `d` comes to rest: the cell itself, further along
 * the ice, or `-1` when it drops into a pit. `null` when it cannot enter at all. */
function landing(board: Board, pos: Position, cell: number, d: Direction, open: boolean, ignore: number): number | null {
    const free = (c: number) => floorAccepts(board, pos, c, d, open) && !pos.boxes.some((b, i) => i !== ignore && b === c);
    if (!free(cell)) return null;
    let at = cell;
    for (;;) {
        if (unfilledPit(board, pos, at)) return -1 - at;
        if (!index(board).ice.has(at)) return at;
        const next = neighbor(board, at, d);
        if (!free(next) || next === pos.player) return at;
        at = next;
    }
}
function arrive(board: Board, player: number, boxes: number[]): number {
    const pad = board.pads.indexOf(player);
    if (pad < 0 || board.pads.length !== 2) return player;
    const other = board.pads[1 - pad] ?? player;
    return boxes.includes(other) ? player : other;
}
export interface Moved { pos: Position; pushed: boolean; slid: boolean; fell: boolean; teleported: boolean }
/** One ordinary input: walk, or push the single box in front. `null` = refused. */
export function push(board: Board, pos: Position, d: Direction): Moved | null {
    const open = doorOpen(board, pos), next = neighbor(board, pos.player, d);
    if (!floorAccepts(board, pos, next, d, open) || unfilledPit(board, pos, next)) return null;
    const box = pos.boxes.indexOf(next);
    let boxes = pos.boxes, colors = pos.colors, filled = pos.filled, slid = false, fell = false;
    if (box >= 0) {
        const rest = landing(board, { ...pos, player: next }, neighbor(board, next, d), d, open, box);
        if (rest === null) return null;
        if (rest < 0) { fell = true; slid = -1 - rest !== neighbor(board, next, d); filled = [...filled, -1 - rest]; boxes = boxes.filter((_, i) => i !== box); colors = colors.filter((_, i) => i !== box); }
        else { slid = rest !== neighbor(board, next, d); boxes = boxes.map((b, i) => i === box ? rest : b); }
    }
    const player = arrive(board, next, boxes);
    return { pos: { player, boxes, colors, filled }, pushed: box >= 0, slid, fell, teleported: player !== next };
}
/** The optional pull: step back from the box in front, dragging it one cell (no slide). */
export function pull(board: Board, pos: Position, d: Direction): Moved | null {
    const open = doorOpen(board, pos), front = neighbor(board, pos.player, d), back = neighbor(board, pos.player, reverse[d]);
    const box = pos.boxes.indexOf(front);
    if (box < 0 || !floorAccepts(board, pos, back, reverse[d], open) || unfilledPit(board, pos, back) || pos.boxes.includes(back)) return null;
    const arrow = index(board).arrows.get(pos.player);
    if (arrow !== undefined && arrow !== reverse[d]) return null;
    const boxes = pos.boxes.map((b, i) => i === box ? pos.player : b), player = arrive(board, back, boxes);
    return { pos: { player, boxes, colors: pos.colors, filled: pos.filled }, pushed: false, slid: false, fell: false, teleported: player !== back };
}
/** Every target holds a box of its colour. */
export function solved(board: Board, pos: Position): boolean {
    return board.targets.every((t, i) => pos.boxes.some((b, j) => b === t && (pos.colors[j] ?? 0) === (board.targetColors[i] ?? 0)));
}
/** Which mechanisms a sequence of ordinary inputs actually uses (pass 403 oracle):
 * a slide, an arrow entered (player or box), a door crossed (player or box), a pit filled, a teleport. */
export function usage(board: Board, inputs: readonly string[]): Set<string> {
    let pos: Position = { player: board.player, boxes: [...board.boxes], colors: [...board.boxColors], filled: [] };
    const used = new Set<string>();
    for (const input of inputs) {
        const d = (input.startsWith('pull-') ? input.slice(5) : input) as Direction;
        const m = input.startsWith('pull-') ? pull(board, pos, d) : push(board, pos, d);
        if (!m) break;
        if (m.slid) used.add('ice'); if (m.fell) used.add('pit'); if (m.teleported) used.add('pad');
        const cells = [m.pos.player, ...m.pos.boxes.filter(b => !pos.boxes.includes(b))];
        if (cells.some(c => board.arrows.some(a => a.at === c))) used.add('arrow');
        if (cells.some(c => board.doors.includes(c))) used.add('door');
        pos = m.pos;
    }
    return used;
}
