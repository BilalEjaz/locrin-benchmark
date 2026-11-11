/* global console, process, URL, Buffer */
import './ts-loader.js';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
const { Engine } = await import('../src/engines/dedale/engine.ts');
const { mechanicCases } = await import('../tests/dedale-mechanics.ts');
for (const run of Object.values(mechanicCases)) run();
// D-MIX (voie E): per-level encounter mix and order, with its mutations rejected.
const { dedaleMix } = await import('../tests/variety-e.ts');
const { mutationModule } = await import('./mutation-module.js');
dedaleMix();
// within() rejects an overrun and an inflated budget alike.
{ const { within } = await import('./dedale-step-budget.js');
    assert.throws(() => within('overrun', 11, 10)); assert.throws(() => within('inflated', 100, 1000)); within('exact', 100, 150); }
{ const { module } = await mutationModule('../src/games/dedale/lessons.ts', "key2: 'Deux couleurs : chaque porte a sa clé'", "key2: 'Une seule clé ouvre toutes les portes'");
    assert.throws(() => dedaleMix(undefined, undefined, module.lesson), 'HUD key2 lesson'); }
for (const [name, before, after] of [['cumulative encounters', 'if (BREATHERS.includes(level)) return', 'if (false) return'],
    ['fixed encounter order', 'const n = items.length, k = n ? (level * 3) % n : 0;', 'const n = items.length, k = 0;'],
    ['no older family', 'const picks = Object.values(INTRO).includes(level) ? 1 : 2;', 'const picks = 0;'],
    ['compressed windows', 'width = 0.8 / Math.max(1, placed.length);', 'width = 0.6 / Math.max(1, placed.length);'],
    ['arrow outside its window', "const windowed = level === REVIEW ? -1 : straightIndex(at('arrow'));", 'const windowed = -1;'],
    ['ice on a turn', "ice: has('ice') ? [level === REVIEW ? point(at('ice')) : straight(at('ice'))] : [],", "ice: has('ice') ? [point(at('ice'))] : [],"]]) {
    const { module } = await mutationModule('../src/engines/dedale/labyrinth.ts', before, after);
    assert.throws(() => dedaleMix(module.encounters, module.createLabyrinth), name);
}
const { route } = await import('../src/engines/dedale/solver.ts');

export function solve(level, seed) {
    const e = new Engine(level, seed), inputs = [], witnesses = {};
    while (e.status === 'playing' && inputs.length < 1500) {
        const leg = route(e);
        assert.ok(leg?.length, `BFS blocked: level ${level + 1}, seed ${seed}`);
        for (const d of leg) {
            if (e.status !== 'playing') break;
            e.input(d); e.step(1000 / 6); inputs.push(d);
            for (const event of e.events) witnesses[event] ??= inputs.length;
        }
    }
    assert.equal(e.status, 'won', `level ${level + 1}, seed ${seed}, moves ${inputs.length}`);
    return { level: level + 1, seed, shape: e.state.journey.shape, inputs, witnesses, lives: e.state.lives };
}
const { index, cell, neighbor, PRIORITY } = await import('../src/engines/dedale/engine.ts');
for (let level = 0; level < 30; level++) for (const seed of [28, 459, 1, 17, 99, 2026]) {
    const e = new Engine(level, seed), seen = new Set([index(e.state.hero)]), queue = [...seen];
    for (let i = 0; i < queue.length; i++) for (const d of PRIORITY) {
        const p = neighbor(e.state.maze, cell(queue[i]), d);
        if (p && !seen.has(index(p))) { seen.add(index(p)); queue.push(index(p)); }
    }
    assert.equal(seen.size, e.state.maze.filter(Boolean).length, `connected ${level + 1}/${seed}`);
}
const checksOnly = process.argv.includes('--checks-only') && !process.argv.includes('--record');
// Verification replays both recorded seeds; BFS generation belongs to the full mode.
const records = checksOnly ? JSON.parse(readFileSync('docs/dedale-validation.json', 'utf8')).records : [];
if (!checksOnly) for (const seed of [28, 459]) for (let level = 0; level < 30; level++) records.push(solve(level, seed));
assert.equal(records.length, 60);
assert.deepEqual(records.map(r => [r.level, r.seed]), [28, 459].flatMap(seed => Array.from({ length: 30 }, (_, level) => [level + 1, seed])));
const start = performance.now();
const { countSteps, within } = await import('./dedale-step-budget.js');
const { STEP_BUDGETS } = await import('./dedale-step-budgets.js');
const counter = countSteps(Engine);
for (const record of records) {
    const e = new Engine(record.level - 1, record.seed);
    const witnesses = {};
    for (const [i, d] of record.inputs.entries()) {
        e.input(d); e.step(1000 / 6);
        for (const event of e.events) witnesses[event] ??= i + 1;
    }
    assert.equal(e.status, 'won');
    assert.equal(e.state.lives, record.lives);
    assert.equal(e.state.journey.shape, record.shape);
    assert.deepEqual(witnesses, record.witnesses);
}
const replayMs = performance.now() - start;
// Deterministic budget: one engine step per recorded input (wall time is reported, not asserted).
within('D-SOLVE replay', counter.steps, STEP_BUDGETS.replay);
if (process.argv.includes('--record')) writeFileSync('tests/dedale-solutions.ts', `// BFS recordings; regenerate with the Node validator --record.\nimport type { Direction } from '../src/engines/dedale/engine';\nexport const solutions: { level: number; seed: number; shape: string; inputs: Direction[]; witnesses: Record<string, number>; lives: number }[] = ${JSON.stringify(records.filter(r => r.seed === 28), null, 2)};\n`);
if (!process.argv.includes('--checks-only')) writeFileSync('docs/dedale-validation.json', JSON.stringify({ replayMs, records }, null, 2) + '\n');
console.log(`D-SOLVE: ${records.length} victories; replay ${replayMs.toFixed(1)} ms`);
console.log(records.filter(r => r.seed === 28).map(r => `${r.level} ${r.shape} ${r.inputs.length} moves ${r.lives} lives: ${Object.keys(r.witnesses).join(', ')}`).join('\n'));
const { campaignCases } = await import('../tests/dedale-campaign.ts');
for (const [id, run] of Object.entries(campaignCases)) {
    counter.steps = 0; run(); within(id, counter.steps, STEP_BUDGETS[id]);
}
const { dedaleDiversity } = await import('./dedale-diversity.js');
const diversity = dedaleDiversity(Engine, records.filter(r => r.seed === 28));
function verifyDiversity(result) {
    assert.ok(result.cloneShare < 0.25, 'clone share');
    const baseline = new Set(result.levels[0].elements);
    assert.ok(new Set(result.levels.flatMap(r => r.elements).filter(v => !baseline.has(v))).size >= 7, 'seven observed discoveries');
    let last = 1;
    for (const level of result.noveltyLevels.filter(n => n <= 25)) { assert.ok(level - last <= 5, 'discovery gap'); last = level; }
    assert.ok(25 - last <= 5);
    assert.ok(result.levels.every(r => r.curve.status === 'won'), 'complete real attempts');
}
verifyDiversity(diversity);
const { transpile } = await import('./transpile.js');
const mutations = [];
async function mutated(file, before, after) {
    const source = readFileSync(file, 'utf8');
    assert.equal(source.split(before).length, 2, `unique mutation: ${before}`);
    const line = source.slice(0, source.indexOf(before)).split('\n').length;
    const replaced = source.replace(before, after).replace(/from '(\.\.?\/[^']+)'/g, (_, path) => `from '${new URL(path + '.ts', new URL('../' + file, import.meta.url)).href}'`);
    const code = transpile(replaced);
    const mod = await import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'));
    return { mod, line };
}
for (const [name, id, before, after] of [
    ['porte sans clé', 'D-MEC-01', 'if (door && !(next.held & (1 << door.color))) return false;', 'if (door && false) return false;'],
    ['sens unique inversé', 'D-MEC-02', 'if (j.arrows.some(a => (a.at === dest || a.at === pos) && a.direction !== d)) return false;', 'if (false) return false;'],
    ['portail inerte', 'D-MEC-03', 'if (pair) {', 'if (false && pair) {'],
    ['interrupteur inerte', 'D-MEC-04', 'next.toggled = 1 - next.toggled;', 'next.toggled = next.toggled;'],
    ['glace sans glisse', 'D-MEC-06', 'if (j.ice.includes(next.pos)) while (allowed(next.pos, direction))', 'if (false) while (false)'],
]) {
    const file = 'src/engines/dedale/labyrinth.ts', { mod, line } = await mutated(file, before, after);
    const run = Object.entries(mechanicCases).find(([key]) => key.startsWith(id))[1];
    assert.throws(() => run(mod.walk), undefined, name);
    mutations.push({ name, file, line, rejectedBy: id });
}
{
    const file = 'src/engines/dedale/engine.ts', { mod, line } = await mutated(file, 'createLabyrinth(level, seed);', 'createLabyrinth(0, seed);');
    assert.throws(() => verifyDiversity(dedaleDiversity(mod.Engine, records.filter(r => r.seed === 28))));
    mutations.push({ name: 'tous les niveaux égaux au premier', file, line, rejectedBy: 'D-DIV-01' });
}
if (!process.argv.includes('--checks-only')) writeFileSync('docs/dedale-validation.json', JSON.stringify({ replayMs, score: diversity.score, noveltyLevels: diversity.noveltyLevels, cloneShare: diversity.cloneShare, mutations, records }, null, 2) + '\n');
console.log(`D-DIV-01: ${diversity.score}/100, ${diversity.cloneShare * 100}% clones; ${mutations.length} mutations rejected`);
