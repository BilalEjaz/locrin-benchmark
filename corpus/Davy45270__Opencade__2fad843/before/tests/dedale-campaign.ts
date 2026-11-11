import { displayedWalls } from '../src/games/dedale/board';
import { Engine, index, neighbor, cell, PRIORITY } from '../src/engines/dedale/engine';
import { route } from '../src/engines/dedale/solver';
import { dedaleDiversity, routeOverlap, mechanicForEvent } from '../scripts/dedale-diversity.js';
import { solutions } from './dedale-solutions';
function check(ok: boolean, message: string): void { if (!ok) throw new Error(message); }
function required<T>(value: T | undefined): T { if (value === undefined) throw new Error('Missing evidence'); return value; }
export const campaignCases: Record<string, () => void> = {
    'D-ROUTE toutes les paires au seuil littéral de 30 %': () => {
        const rows = dedaleDiversity(Engine, solutions).levels;
        for (let i = 0; i < rows.length; i++) for (let k = i + 1; k < rows.length; k++) {
            check(routeOverlap(required(rows[i]).positions, required(rows[k]).positions) <= 0.30, `route overlap ${String(i + 1)}/${String(k + 1)}`);
        }
        check(routeOverlap([1, 2, 3], [1, 2, 3]) === 1, 'identical route must fail');
        check(routeOverlap([1, 2, 3, 4], [4, 3, 2, 1]) === 0.25, 'order matters');
    },
    'D-CURVE moyennes croissantes et rapport 1,5': () => {
        const means = Array.from({ length: 6 }, (_, i) => solutions.slice(i * 5, i * 5 + 5).reduce((n, r) => n + r.inputs.length, 0) / 5);
        for (let i = 2; i < means.length; i++) check(required(means[i]) > required(means[i - 1]), 'increasing five-level means 6–30');
        check(required(means[5]) / required(means[0]) >= 1.5, 'late / early >= 1.5');
    },
    'D-FINAL témoins recalculés et nouveautés par mécanique': () => {
        const result = dedaleDiversity(Engine, solutions), final = required(result.levels[29]);
        check(final.curve.status === 'won', 'final live replay wins');
        for (const event of ['key', 'door', 'one-way', 'portal', 'switch', 'gate', 'moving-wall', 'slide', 'darkness', 'patrol', 'light-flee']) check(!!final.witnesses[event], `live final ${event}`);
        check(new Set(['key', 'door', 'switch', 'gate', 'wall-wait', 'moving-wall'].map(mechanicForEvent)).size === 3, 'six events are three mechanics');
        const baseline = new Set(required(result.levels[0]).elements);
        check(new Set(result.levels.flatMap(r => r.elements).filter(v => !baseline.has(v))).size >= 7, 'seven played mechanics');
    },
    'D-SOLVER recherche réelle rapide incluant le final': () => {
        for (const level of [0, 8, 18, 29]) {
            const e = new Engine(level, 28), leg = route(e);
            check(!!leg?.length, `solver level ${String(level + 1)}`);
            const before = e.state.seeds.length + e.state.suns.length;
            for (const d of leg ?? []) { e.input(d); e.step(1000 / 6); }
            check(e.state.seeds.length + e.state.suns.length < before, 'solver reaches an actual goal');
        }
    },
    'D-GEOMETRY anneau spirale miroir': () => {
        for (let level = 0; level < 30; level++) for (const seed of [28, 459, 2026]) {
            const e = new Engine(level, seed), { maze, journey: j } = e.state;
            if (!j) throw new Error('journey absent');
            const floor = maze.flatMap((v, at) => v ? [at] : []);
            if (j.shape === 'mirror') {
                const walls = new Set(displayedWalls(maze));
                for (let at = 0; at < 437; at++) check(walls.has(at) === walls.has(Math.floor(at / 19) * 19 + 18 - at % 19), 'displayed walls reflect across vertical axis');
            }
            if (j.shape === 'ring') {
                for (const at of floor) check(PRIORITY.filter(d => neighbor(maze, cell(at), d)).length === 2, 'one unbranched cycle');
                const minX = Math.min(...floor.map(at => at % 19)), maxX = Math.max(...floor.map(at => at % 19));
                const minY = Math.min(...floor.map(at => Math.floor(at / 19))), maxY = Math.max(...floor.map(at => Math.floor(at / 19)));
                check(!maze[Math.floor((minY + maxY) / 2) * 19 + Math.floor((minX + maxX) / 2)], 'closed center enclosed by cycle');
                check(floor.length === 2 * (maxX - minX + maxY - minY), 'entire enclosing rectangle');
            }
            if (level === 3) {
                check(Math.max(...floor.map(at => at % 19)) - Math.min(...floor.map(at => at % 19)) >= 16, 'level 4 spiral spans the displayed width');
                check(Math.max(...floor.map(at => Math.floor(at / 19))) - Math.min(...floor.map(at => Math.floor(at / 19))) >= 16, 'level 4 spiral spans the displayed height');
            }
            if (j.shape === 'spiral') {
                const cx = (Math.min(...floor.map(at => at % 19)) + Math.max(...floor.map(at => at % 19))) / 2;
                const cy = (Math.min(...floor.map(at => Math.floor(at / 19))) + Math.max(...floor.map(at => Math.floor(at / 19)))) / 2;
                const radius = (at: number): number => Math.max(Math.abs(at % 19 - cx), Math.abs(Math.floor(at / 19) - cy));
                const path = required(j.corridor);
                check(new Set(path).size === floor.length && path.every(at => maze[at]), 'principal corridor covers the actual spiral floor');
                check(floor.every(at => PRIORITY.filter(d => neighbor(maze, cell(at), d)).length <= 2), 'spiral has no hidden shortcuts');
                for (let i = 1; i < path.length; i++) {
                    check(radius(required(path[i])) <= radius(required(path[i - 1])), 'monotone Chebyshev radius along square spiral');
                    check(Math.abs(cell(required(path[i])).x - cell(required(path[i - 1])).x) + Math.abs(cell(required(path[i])).y - cell(required(path[i - 1])).y) === 1, 'contiguous principal corridor');
                }
                check(radius(required(path[path.length - 1])) < radius(required(path[0])), 'spiral actually approaches center');
            }
            check(maze[index(e.state.hero)] === true, 'start is in shape');
        }
    },
};
