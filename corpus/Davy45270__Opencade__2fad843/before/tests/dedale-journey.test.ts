import { test, expect } from 'vitest';
import { Engine, index, neighbor, cell, PRIORITY } from '../src/engines/dedale/engine';
import { mechanicCases } from './dedale-mechanics';
import { campaignCases } from './dedale-campaign';
import { solutions } from './dedale-solutions';
import { dedaleDiversity } from '../scripts/dedale-diversity.js';
for (const [id, run] of Object.entries(mechanicCases)) test(id, () => { run(); }, 2000);
for (const [id, run] of Object.entries(campaignCases)) test(id, run, 2000);
test('D-SOLVE rejeu des trente preuves BFS sans recherche', () => {
    for (const r of solutions) {
        const e = new Engine(r.level - 1, r.seed);
        for (const d of r.inputs) { e.input(d); e.step(1000 / 6); }
        expect(e.status, `niveau ${String(r.level)}`).toBe('won');
    }
}, 2000);
test('D-DIV-01 nouveautés observées, rythme et vrais clones', () => {
    const result = dedaleDiversity(Engine, solutions);
    const distinct = new Set(result.levels.slice(1).flatMap(r => r.elements).filter(v => !(result.levels[0]?.elements ?? []).includes(v)));
    expect(distinct.size).toBeGreaterThanOrEqual(7);
    expect(result.cloneShare).toBeLessThan(0.25);
    expect(result.levels.every(r => r.curve.status === 'won')).toBe(true);
    let last = 1;
    for (const n of result.noveltyLevels.filter(n => n <= 25)) { expect(n - last).toBeLessThanOrEqual(5); last = n; }
    expect(25 - last).toBeLessThanOrEqual(5);
    expect(new Set(solutions.map(r => r.shape)).size).toBe(5);
}, 2000);
test('D-GEN toutes les cases restent connexes et les graines changent les formes', () => {
    for (let level = 0; level < 30; level++) {
        const e = new Engine(level, 28), s = e.state, seen = new Set([index(s.hero)]), queue = [...seen];
        for (let i = 0; i < queue.length; i++) for (const d of PRIORITY) {
            const p = neighbor(s.maze, cell(queue[i] ?? 0), d);
            if (p && !seen.has(index(p))) { seen.add(index(p)); queue.push(index(p)); }
        }
        expect(seen.size).toBe(s.maze.filter(Boolean).length);
        expect(s.suns).toHaveLength(4);
        expect(new Set([28, 459, 2026, 123456789].map(seed => JSON.stringify(new Engine(level, seed).state.maze))).size).toBeGreaterThan(1);
    }
});
test('D-RHYTHM défi chronométré, respiration et final combiné', () => {
    const challenge = new Engine(4); if (!challenge.state.journey) throw new Error('Défi absent');
    challenge.state.journey.remaining = 1;
    challenge.input('left'); challenge.step(1000 / 6);
    expect(challenge.status).toBe('lost'); expect(challenge.events).toContain('timeout');
    const recovery = new Engine(5, 28);
    for (const d of (solutions[5]?.inputs ?? [])) { recovery.input(d); recovery.step(1000 / 6); if (recovery.events.includes('sun')) break; }
    expect(recovery.state.vulnerable).toBe(12000);
    const final = dedaleDiversity(Engine, solutions).levels[29];
    for (const event of ['key', 'door', 'one-way', 'portal', 'switch', 'gate', 'moving-wall', 'slide', 'darkness', 'patrol', 'light-flee']) expect(final?.witnesses[event]).toBeDefined();
});
test('D-SAVE ancien état sans extension, cadence et sérialisation', () => {
    const a = new Engine(14, 17), b = new Engine(14, 17);
    for (const d of ['left', 'down', 'right', 'up'] as const) {
        a.input(d); b.input(d); a.step(1000 / 6);
        for (let tick = 0; tick < 10; tick++) b.step(1000 / 60);
    }
    expect(a.snapshot()).toEqual(b.snapshot());
    const legacy = structuredClone(a.state); delete legacy.journey;
    a.loadState(legacy); expect(a.state.journey).toBeUndefined();
    a.input('left'); a.step(1000 / 6); expect(a.state.ticks).toBe(legacy.ticks + 10);
    expect(JSON.parse(JSON.stringify(a.snapshot()))).toEqual(a.snapshot());
});
test('D-DIV-01 contrôle négatif : trente copies du premier niveau', () => {
    class Repeated extends Engine { constructor(level = 0, seed = 28) { super(0, seed); if (level < 0) throw new RangeError('Niveau invalide'); } }
    const result = dedaleDiversity(Repeated, solutions.map(r => ({ ...r, inputs: solutions[0]?.inputs ?? [], level: r.level })));
    expect(result.cloneShare).toBe(1); expect(result.noveltyCount).toBe(0);
});
