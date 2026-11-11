// Observations come from complete input replays on the real generator.
import { measureDiversity } from './diversity-metrics.js';
export function routeOverlap(a, b) {
    const row = new Uint16Array(b.length + 1);
    for (const at of a) {
        let previous = 0;
        for (let i = 1; i <= b.length; i++) {
            const old = row[i];
            row[i] = at === b[i - 1] ? previous + 1 : Math.max(row[i], row[i - 1]); previous = old;
        }
    }
    return row[b.length] / Math.max(1, Math.min(a.length, b.length));
}
export const mechanicForEvent = event => ({ key: 'colored-lock', door: 'colored-lock', switch: 'switch-gate', gate: 'switch-gate', 'wall-wait': 'cyclic-wall', 'moving-wall': 'cyclic-wall' })[event] ?? event;
export function dedaleDiversity(Engine, records) {
    const rows = records.map(record => {
        const e = new Engine(record.level - 1, record.seed), initial = e.snapshot(), witnesses = {}, positions = [];
        const baseline = ['maze', 'seed', 'sun'];
        const observable = ['key', 'door', 'one-way', 'portal', 'switch', 'gate', 'wall-wait', 'moving-wall', 'slide', 'darkness', 'patrol', 'light-flee'];
        record.inputs.forEach((d, i) => {
            e.input(d); e.step(1000 / 6); positions.push(e.state.hero.y * 19 + e.state.hero.x);
            for (const event of e.events) if (observable.includes(event)) witnesses[event] ??= { move: i + 1, hero: { ...e.state.hero } };
        });
        const j = initial.journey;
        // Ordered played positions and typed mechanism positions, never unused floor.
        const layout = positions.map((at, step) => `route:${step}:${at}`);
        const observed = { keys: 'key', doors: 'door', arrows: 'one-way', portals: 'portal', switches: 'switch', gates: 'gate', moving: 'moving-wall', ice: 'slide', dark: 'darkness' };
        for (const k of ['keys', 'doors', 'arrows']) if (witnesses[observed[k]]) for (const tile of j[k]) layout.push(`${k}:${tile.at}:${tile.color ?? tile.direction}`);
        for (const k of ['portals', 'switches', 'gates', 'moving', 'ice', 'dark']) if (witnesses[observed[k]]) for (const tile of j[k]) layout.push(`${k}:${tile}`);
        return { level: record.level, positions, elements: [...new Set([...baseline, ...Object.keys(witnesses).map(mechanicForEvent)])].sort(), parameters: { routeMoves: record.inputs.length, visitedCells: new Set(positions).size }, layout, witnesses,
            curve: { status: e.status, actions: record.inputs.length, completionMs: record.inputs.length * 1000 / 6, livesLost: 3 - e.state.lives, censored: e.status === 'playing' } };
    });
    return measureDiversity(rows);
}
