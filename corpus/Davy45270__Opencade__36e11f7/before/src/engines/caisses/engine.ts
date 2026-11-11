import { Random } from '../shared/random';
import { LEVELS } from './levels';
import { push, pull, solved, neighbor as step, directions as order, type Board, type Direction, type Position } from './rules';
export { LEVELS };
export type { Board, Direction, Position };
export const directions: Direction[] = order;
const symbols: Record<string, (b: Board, i: number) => void> = {
    '#': (b, i) => b.walls.push(i), '.': (b, i) => { b.targets.push(i); b.targetColors.push(0); }, '$': (b, i) => { b.boxes.push(i); b.boxColors.push(0); },
    '*': (b, i) => { b.targets.push(i); b.targetColors.push(0); b.boxes.push(i); b.boxColors.push(0); }, '+': (b, i) => { b.targets.push(i); b.targetColors.push(0); },
    R: (b, i) => { b.targets.push(i); b.targetColors.push(1); }, r: (b, i) => { b.boxes.push(i); b.boxColors.push(1); },
    '~': (b, i) => b.ice.push(i), o: (b, i) => b.plates.push(i), '|': (b, i) => b.doors.push(i), O: (b, i) => b.pits.push(i), 1: (b, i) => { b.pads[0] = i; }, 2: (b, i) => { b.pads[1] = i; },
    '<': (b, i) => b.arrows.push({ at: i, direction: 'left' }), '>': (b, i) => b.arrows.push({ at: i, direction: 'right' }), '^': (b, i) => b.arrows.push({ at: i, direction: 'up' }), v: (b, i) => b.arrows.push({ at: i, direction: 'down' }),
};
export function parse(text: string): Board {
    const rows = text.split('\n'), width = rows[0]?.length ?? 0;
    if (width < 3 || rows.length < 3 || rows.some(r => r.length !== width || /[^# .$*@+~<>^vo|O12rR]/.test(r))) throw new Error('Dimensions ou symbole');
    const board: Board = { width, height: rows.length, walls: [], targets: [], boxes: [], player: -1, ice: [], arrows: [], plates: [], doors: [], pits: [], pads: [], boxColors: [], targetColors: [] };
    let players = 0;
    rows.forEach((r, y) => { Array.from(r).forEach((c, x) => {
        const i = y * width + x;
        if ((x === 0 || y === 0 || x === width - 1 || y === rows.length - 1) && c !== '#') throw new Error('Grille ouverte');
        symbols[c]?.(board, i);
        if ('@+'.includes(c)) { board.player = i; players++; }
    }); });
    const count = (a: number[], color: number) => a.filter(c => c === color).length;
    const enough = [0, 1].every(color => count(board.boxColors, color) >= count(board.targetColors, color));
    const exact = board.pits.length > 0 || board.boxes.length === board.targets.length;
    // Pads come as one '1' and one '2', never alone, never repeated; doors need a plate.
    const count1 = text.split('1').length - 1, count2 = text.split('2').length - 1;
    const pads = (count1 === 0 && count2 === 0) || (count1 === 1 && count2 === 1);
    if (players !== 1 || !board.boxes.length || !enough || !exact || !pads || (board.doors.length > 0 && !board.plates.length)) throw new Error('Occupants invalides');
    return board;
}
export const neighbor = step;
export function deadlocked(board: Board, boxes: number[]): boolean {
    const wall = (p: number, d: Direction) => board.walls.includes(neighbor(board, p, d));
    return boxes.some(p => !board.targets.includes(p) && (wall(p, 'up') || wall(p, 'down')) && (wall(p, 'left') || wall(p, 'right')));
}
export function difficulty(level: number) {
    const data = LEVELS[level]; if (!data) throw new RangeError('Niveau');
    const b = parse(data.text);
    return { boxes: b.boxes.length, minimumPushes: data.minimumPushes, minimumSteps: data.minimumSteps, budget: data.budget ?? 0,
        ice: b.ice.length, arrows: b.arrows.length, doors: b.doors.length, pits: b.pits.length, pads: b.pads.length, red: b.boxColors.filter(c => c === 1).length };
}
interface State { player: number; boxes: number[]; colors: number[]; filled: number[]; moves: number; pushes: number; score: number }
export class Engine {
    facing: Direction = 'right';
    specialUses = 1;
    specialMs = 0;
    level = 0; seed = 28; board = parse(LEVELS[0]?.text ?? "");
    state: State = { player: this.board.player, boxes: [...this.board.boxes], colors: [...this.board.boxColors], filled: [], moves: 0, pushes: 0, score: 0 };
    status: 'playing' | 'won' | 'lost' = 'playing';
    /** Last input's mechanism events (slide, fall, teleport), for sound and HUD. */
    events: string[] = [];
    private history: (State & { facing: Direction })[] = [];
    budgetLeft(): number { const b = LEVELS[this.level]?.budget ?? 0; return b && this.board === this.levelBoard ? b - this.state.moves : 0; }
    private remainder = 0;
    private random = new Random(28);
    loadLevel(index: number, seed = 28): void {
        const data = LEVELS[index]; if (!data) throw new RangeError('Niveau');
        this.level = index; this.seed = seed; this.random = new Random(seed); this.board = parse(data.text); this.levelBoard = this.board; this.restart();
    }
    /** Load an ordinary validated board; useful for small rule examples. */
    loadPuzzle(text: string): void { this.board = parse(text); this.restart(); }
    restart(): void { this.facing = 'right'; this.specialUses = 1; this.specialMs = 0; this.events = []; this.state = { player: this.board.player, boxes: [...this.board.boxes], colors: [...this.board.boxColors], filled: [], moves: 0, pushes: 0, score: 0 }; this.status = 'playing'; this.history = []; this.remainder = 0; }
    /** Pull the facing box while stepping backwards. Undo never refunds the charge. */
    special(direction: Direction = this.facing): boolean {
        if (this.status !== 'playing' || this.specialUses === 0) return false;
        const moved = pull(this.board, this.position(), direction);
        if (!moved) return false;
        this.remember(); this.facing = direction; this.apply(moved);
        this.specialUses--; this.specialMs = 800;
        this.finish(); return true;
    }
    private position(): Position { return { player: this.state.player, boxes: this.state.boxes, colors: this.state.colors, filled: this.state.filled }; }
    private remember(): void { this.history.push({ ...this.state, facing: this.facing, boxes: [...this.state.boxes], colors: [...this.state.colors], filled: [...this.state.filled] }); }
    private apply(m: NonNullable<ReturnType<typeof push>>): void {
        this.state.player = m.pos.player; this.state.boxes = [...m.pos.boxes]; this.state.colors = [...m.pos.colors]; this.state.filled = [...m.pos.filled];
        this.state.moves++; if (m.pushed) this.state.pushes++;
        this.events = [...(m.slid ? ['slide'] : []), ...(m.fell ? ['fall'] : []), ...(m.teleported ? ['teleport'] : [])];
    }
    private finish(): void {
        if (solved(this.board, this.position())) {
            this.status = 'won';
            this.state.score = Math.max(1, Math.round(1000 * (LEVELS[this.level]?.minimumSteps ?? 1) / this.state.moves));
            return;
        }
        // Challenge rooms: running out of the move budget ends the attempt (undo still works).
        const budget = LEVELS[this.level]?.budget ?? 0;
        if (budget && this.board === this.levelBoard && this.state.moves >= budget) this.status = 'lost';
    }
    private levelBoard: Board | null = null;
    undo(): void { const previous = this.history.pop(); if (previous) { const { facing, ...state } = previous; this.state = state; this.facing = facing; this.status = 'playing'; this.events = []; } }
    input(d: Direction): void {
        if (this.status !== 'playing') return;
        const moved = push(this.board, this.position(), d);
        if (!moved) return;
        this.remember(); this.facing = d; this.apply(moved);
        this.finish();
    }
    step(dtMs: number): void {
        if (!Number.isFinite(dtMs) || dtMs < 0) throw new RangeError('Temps');
        this.specialMs = Math.max(0, this.specialMs - dtMs);
        this.remainder += dtMs; const fixed = 1000 / 60;
        while (this.remainder + 1e-9 >= fixed) this.remainder = Math.max(0, this.remainder - fixed);
    }
    advance(ms: number): void { this.step(ms); }
    snapshot() { return { events: [...this.events], facing: this.facing, specialUses: this.specialUses, specialMs: this.specialMs, level: this.level, seed: this.seed, status: this.status, ...this.state, boxes: [...this.state.boxes], colors: [...this.state.colors], filled: [...this.state.filled], history: this.history.map(s => ({ ...s, boxes: [...s.boxes], colors: [...s.colors], filled: [...s.filled] })), remainder: this.remainder, random: this.random.state, deadlocked: deadlocked(this.board, this.state.boxes) }; }
}
