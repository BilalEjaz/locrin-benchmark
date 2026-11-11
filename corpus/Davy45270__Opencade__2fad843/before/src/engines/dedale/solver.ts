import { PRIORITY, index, type Engine, type Direction } from './engine';
import { walk, type Walker } from './labyrinth';

/** BFS over position, inventory, switch state, cyclic phase and buffered heading.
 * Each leg ends at an actual remaining collectible; replay proves the whole route.
 */
export function route(engine: Engine): Direction[] | undefined {
    const s = engine.state, j = s.journey;
    if (!j) return undefined;
    const goals = new Set([...s.seeds, ...s.suns]);
    const initial: Walker = { pos: index(s.hero), held: j.held, toggled: j.toggled, phase: j.turn % 4, direction: s.hero.direction };
    const queue = [{ state: initial, parent: -1, action: 'up' as Direction }];
    const key = (v: Walker): string => JSON.stringify(v);
    const seen = new Set([key(initial)]);
    for (let i = 0; i < queue.length; i++) {
        const node = queue[i]; if (!node) continue;
        for (const action of PRIORITY) {
            const result = walk(s.maze, j, node.state, action), state = result.next;
            if (result.visited.some(p => goals.has(p))) {
                const path = [action]; let p = i;
                while (p >= 0) { const ancestor = queue[p]; if (!ancestor || ancestor.parent < 0) break; path.push(ancestor.action); p = ancestor.parent; }
                return path.reverse();
            }
            const id = key(state);
            if (!seen.has(id)) { seen.add(id); queue.push({ state, parent: i, action }); }
        }
    }
    return undefined;
}
