import { walk, visible, type Journey, type Walker } from '../src/engines/dedale/labyrinth';
import { Engine, choose, target } from '../src/engines/dedale/engine';
function check(ok: boolean, message: string): void { if (!ok) throw new Error(message); }
// Literal micro-grid, at (1,1); walls outside the printed rows.
const rows = ['.......', '.#####.', '.......'];
const maze = Array<boolean>(437).fill(false);
rows.forEach((row, y) => { for (let x = 0; x < row.length; x++) maze[(y + 1) * 19 + x + 1] = row[x] === '.'; });
const fixture = (): Journey => ({ shape: 'corridors', keys: [], doors: [], arrows: [], portals: [], switches: [], gates: [], moving: [], ice: [], dark: [], held: 0, toggled: 0, turn: 0, remaining: 0 });
const start = (): Walker => ({ pos: 20, held: 0, toggled: 0, phase: 0, direction: 'right' });
export const mechanicCases: Record<string, (move?: typeof walk) => void> = {
    'D-MEC-01 clés et portes colorées': (move = walk) => {
        const j = fixture(); j.keys = [{ at: 21, color: 0 }]; j.doors = [{ at: 22, color: 0 }, { at: 23, color: 1 }];
        check(move(maze, j, { ...start(), pos: 21 }, 'right').next.pos === 21, 'door must block without key');
        const a = move(maze, j, start(), 'right').next;
        check(a.held === 1, 'collect color'); const b = move(maze, j, a, 'right').next;
        check(b.pos === 22, 'matching key opens door'); check(move(maze, j, b, 'right').next.pos === 22, 'wrong color blocked');
    },
    'D-MEC-02 sens unique': (move = walk) => {
        const j = fixture(); j.arrows = [{ at: 22, direction: 'right' }];
        check(move(maze, j, { ...start(), pos: 21 }, 'right').next.pos === 22, 'forward passage');
        check(move(maze, j, { ...start(), pos: 23, direction: 'left' }, 'left').next.pos === 23, 'reverse passage blocked');
        check(move(maze, j, { ...start(), pos: 22, direction: 'left' }, 'left').next.pos === 22, 'reverse exit blocked');
    },
    'D-MEC-03 portails appariés': (move = walk) => {
        const j = fixture(); j.portals = [[21, 64]];
        check(move(maze, j, start(), 'right').next.pos === 64, 'paired teleport');
        check(move(maze, j, { ...start(), pos: 65, direction: 'left' }, 'left').next.pos === 21, 'return teleport');
    },
    'D-MEC-04 interrupteur ouvre et ferme': (move = walk) => {
        const j = fixture(); j.switches = [21]; j.gates = [23];
        check(move(maze, j, { ...start(), pos: 22 }, 'right').next.pos === 22, 'gate closed');
        const a = move(maze, j, start(), 'right').next;
        check(a.toggled === 1, 'switch opens');
        check(move(maze, j, { ...a, pos: 22 }, 'right').next.pos === 23, 'open gate passed');
        const b = move(maze, j, { ...a, pos: 22, direction: 'left' }, 'left').next;
        check(b.toggled === 0, 'switch closes');
        check(move(maze, j, { ...b, pos: 22, direction: 'right' }, 'right').next.pos === 22, 'gate closed again');
    },
    'D-MEC-05 murs au cycle régulier': (move = walk) => {
        const j = fixture(); j.moving = [21];
        const results = [0, 1, 2, 3, 0].map(phase => move(maze, j, { ...start(), phase }, 'right').next.pos);
        check(results.join(',') === '20,20,21,21,20', 'two closed phases, two open phases');
    },
    'D-MEC-06 glace jusqu’au prochain obstacle': (move = walk) => {
        const j = fixture(); j.ice = [21, 22, 23, 24, 25, 26];
        const a = move(maze, j, start(), 'right');
        check(a.next.pos === 26 && a.visited.length === 6, 'slide through all frozen cells to wall');
        j.ice = [21, 22]; j.doors = [{ at: 24, color: 0 }]; check(move(maze, j, start(), 'right').next.pos === 23, 'slide ends at locked obstacle even beyond ice');
    },
    'D-SLIDE-CONTACT contact intermédiaire actif et vulnérable': () => {
        for (const vulnerable of [0, 5000]) {
            const e = new Engine(18), j = fixture(); j.ice = [21, 22, 23, 24, 25, 26];
            e.state.journey = j; e.state.maze = [...maze]; e.state.hero = { x: 1, y: 1, direction: 'right' };
            e.state.seeds = [26, 64]; e.state.suns = []; e.state.grace = 0; e.state.vulnerable = vulnerable;
            const w = { x: 4, y: 1, direction: 'up' as const, kind: 'tracker' as const, wait: 0, returning: false };
            e.state.wisps = [w]; e.input('right'); e.step(1000 / 6);
            check(e.state.lives === (vulnerable ? 3 : 2), 'intermediate contact costs one life');
            check(e.events.includes(vulnerable ? 'wisp' : 'life'), 'intermediate contact event');
            check(vulnerable ? w.returning : e.state.seeds.includes(26), 'eat wisp or stop slide immediately');
        }
    },
    'D-DEATH inventaire et interrupteur persistent': () => {
        const e = new Engine(27), j = fixture(); j.held = 3; j.toggled = 1; j.wispStart = 64; j.turn = 7; j.remaining = 20000;
        e.state.journey = j; e.state.maze = [...maze]; e.state.hero = { x: 1, y: 1, direction: 'right' };
        e.state.grace = 0; e.state.suns = []; e.state.seeds = [64];
        e.state.wisps = [{ x: 2, y: 1, direction: 'up', kind: 'tracker', wait: 0, returning: false }];
        e.input('right'); e.step(1000 / 6);
        check(e.state.lives === 2 && e.events.includes('life'), 'real death required');
        check(e.state.wisps.every(w => w.y * 19 + w.x === 64 && e.state.maze[w.y * 19 + w.x]), 'wisps respawn on generated floor');
        check(j.held === 3 && j.toggled === 1 && j.turn === 8 && j.remaining === 20000, 'persistent inventory switch phase and clock');
    },
    'D-CLOCK niveaux et durées exactes': () => {
        for (let level = 0; level < 30; level++) {
            const e = new Engine(level);
            check(e.state.journey?.remaining === ((level + 1) % 5 === 0 ? (level === 29 ? 40000 : 25000) : 0), 'exact challenge schedule and duration');
        }
    },
    'D-MEC-07 obscurité limite la vision': () => {
        const j = fixture(); j.dark = [20];
        check(visible(j, 20, 23) && !visible(j, 20, 24), 'literal horizontal sight radius three');
        check(visible(j, 20, 77) && !visible(j, 20, 96), 'literal vertical sight radius three');
        check(!visible(j, 20, 60), 'Manhattan radius on both axes');
        check(visible(j, 21, 26), 'full sight outside darkness');
        const e = new Engine(); e.state.journey = j; e.state.maze = maze; e.state.hero = { x: 1, y: 1, direction: 'right' }; j.dark = [21]; e.state.wisps = [];
        e.input('right'); e.step(1000 / 6); check(e.events.includes('darkness'), 'darkness entered in live engine');
    },
    'D-MEC-08 follets poursuivent patrouillent et fuient la lumière': () => {
        const e = new Engine(24), s = e.state; s.maze = maze; s.mode = 'chase'; s.hero = { x: 7, y: 1, direction: 'left' };
        const w = { x: 4, y: 1, direction: 'up' as const, kind: 'tracker' as const, returning: false, wait: 0 };
        check(target(s, w) === s.hero && choose(s, w) === 'right', 'tracker approaches');
        const patrol = { ...w, kind: 'roamer' as const }; s.ticks = 0; const a = target(s, patrol); s.ticks = 120;
        check(target(s, patrol).x !== a.x, 'patrol changes waypoint independently of hero');
        const shy = { ...w, kind: 'shy' as const }; s.vulnerable = 1000;
        check(choose(s, shy) === 'left', 'light causes distinct flight');
    },
};
