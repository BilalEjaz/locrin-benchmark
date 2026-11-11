/* global console, Buffer, URL */
// Read-only analysis; uses the repository's existing TypeScript loader.
import './ts-loader.js';
import { essaimFeatures, essaimDiversity } from './essaim-diversity.js';
import { ferrailleFeatures } from './ferraille-diversity.js';
import { alunirFeatures } from './alunir-diversity.js';
import { dedaleDiversity } from './dedale-diversity.js';
import { briqueterieDiversity } from './briqueterie-diversity.js';
import { orbiteDiversity } from './orbite-diversity.js';
import { serpentinFeatures } from './serpentin-diversity.js';
import { empiloFeatures } from './empilo-diversity.js';
import { caissesFeatures } from './caisses-diversity.js';
import { traverseFeatures } from './traverse-diversity.js';
const { PLANS: traversePlans } = await import('../src/engines/traverse/engine.ts');
const { LEVELS: caissesLevels } = await import('../src/engines/caisses/engine.ts');
const { stratum: empiloStratum } = await import('../src/engines/empilo/engine.ts');
const { layout: serpentinLayout } = await import('../src/engines/serpentin/engine.ts');
import { measureDiversity } from './diversity-metrics.js';
import { transform } from './transpile.js';
import { readFileSync } from 'node:fs';
const ids = ['bubble', 'briqueterie', 'empilo', 'serpentin', 'orbite', 'essaim', 'dedale', 'caisses', 'alunir', 'ferraille', 'traverse', 'derapage'];
const names = ['Bulles', 'Briqueterie', 'Empilo', 'Serpentin', 'Orbite', 'Essaim', 'Dédale', 'Caisses', 'Alunir', 'Ferraille', 'Traverse', 'Dérapage'];
const SEED = 28, CAP = 1800, CLONE = 0.08, FLAT = 0.08;
const numeric = (o, prefix = '') => Object.fromEntries(Object.entries(o).flatMap(([k, v]) => typeof v === 'number' || typeof v === 'boolean' ? [[prefix + k, Number(v)]] : []));
function extract(id, e, d) {
    const s = e.snapshot(), elements = new Set(), layout = [], params = {};
    const add = (...a) => a.forEach(x => elements.add(x));
    const typed = (a, prefix, field = 'kind') => (a ?? []).forEach(x => add(`${prefix}:${x[field]}`));
    switch (id) {
    case 'bubble':
        add('bubble', 'match-three', 'detach'); if (d.interval) add('ceiling-drop');
        for (const cell of s.grid) if (cell.kind) add(cell.kind);
        if (e.rainbow) add('rainbow'); if (e.bumpers.length) add('bumper');
        layout.push(...s.grid.map(c => `${c.row},${c.col}:${c.color}:${c.kind ?? 'color'}`)); break;
    case 'empilo': {
        const f = empiloFeatures(e, empiloStratum(e.level)); add(...f.elements); layout.push(...f.layout); break;
    }
    case 'serpentin': {
        const f = serpentinFeatures(e, d, serpentinLayout); add(...f.elements); if (s.crystal) add('crystal');
        layout.push(...f.layout); break;
    }
    case 'orbite':
        add('probe', 'shield', 'shoot'); if (s.probes.some(p => p.hp > 1)) add('armored-probe'); if (s.comet) add('comet');
        if (d.shotLimit > 1) add('two-player-shots');
        layout.push(...s.probes.map(p => `${p.row},${p.column}:probe`)); break;
    case 'essaim':
        return essaimFeatures(e);
    case 'dedale':
        add('maze', 'seed', 'sun', 'scatter', 'chase'); typed(s.wisps, 'wisp');
        layout.push(...s.maze.flatMap((v, i) => v ? [String(i)] : [])); break;
    case 'caisses': {
        const f = caissesFeatures(e.board, caissesLevels[e.level]); add(...f.elements); layout.push(...f.layout);
        Object.assign(params, { width: e.board.width, height: e.board.height }); break;
    }
    case 'alunir':
        return alunirFeatures(e, d);
    case 'ferraille':
        return ferrailleFeatures(s);
    case 'traverse': {
        const f = traverseFeatures(s.board, d, traversePlans[e.level]); add(...f.elements); layout.push(...f.layout); break;
    }
    case 'derapage': {
        add('kart', 'drift', 'item-crate', 'grass'); const t = e.track, c = t.circuit;
        for (const k of ['snow', 'berms', 'jumps', 'gates']) if (c[k].length) add(`track:${k}`);
        if (t.boosts.length) add('boost-pad'); if (c.theme.urban) add('urban-rail');
        for (const k of s.karts) if (k.item) add(`item:${k.item}`); if (s.puddles.length) add('puddle');
        Object.assign(params, { length: t.length, boosts: t.boosts.length, slalom: t.slalom.length, trees: t.trees.length, elevationRange: Math.max(...t.heights) - Math.min(...t.heights) });
        break;
    }
    }
    params.layoutCells = layout.length;
    return { elements: [...elements].sort(), layout, params };
}
async function policy(id, mod, level) {
    if (id === 'caisses') {
        const e = new mod.Engine(); e.loadLevel(level, SEED);
        const { solve } = await import('../src/engines/caisses/solver.ts'); const proof = solve(e.board);
        return { engine: e, decide: (e, f) => { if (proof?.inputs[f]) e.input(proof.inputs[f]); }, advance: e => e.step(1000 / 15), limit: proof?.inputs.length ?? 0 };
    }
    if (id === 'derapage') {
        const { controller } = await import('../src/engines/derapage/ai.ts');
        return { engine: new mod.Engine(level, SEED), decide: e => e.input(controller(e.karts[0], e.track)), advance: e => e.step(1000 / 15) };
    }
    const url = new URL(`../src/engines/${id}/demo.ts`, import.meta.url);
    let source = readFileSync(url, 'utf8').replace(/import \{ demo \} from '..\/shared\/demo';/, 'const demo = (engine, seed, decide, advance) => ({engine, decide, advance});');
    source = source.replace(/from '(\.\.?\/[^']+)'/g, (_, path) => `from '${new URL(path + '.ts', url).href}'`);
    const { createDemo } = await import('data:text/javascript;base64,' + Buffer.from(transform(source)).toString('base64'));
    const p = createDemo(SEED); p.engine.loadLevel(level, SEED); return p;
}
const variations = [
    'Thirty seeded layouts with increasing density and pressure; stone, bomb chains, rainbow shots, two-hit ice, star rescues and internal bumpers.',
    'Thirty authored silhouettes; observed sliding rows, chicanes, neighbor explosions, regrowth, portals, inclined reflections, keys, brick multiball, inverse-gravity zones and falling suspensions.',
    'Thirty authored strata; bombs, dig-for-gems objectives, sliding conveyor rows, a rising floor, padlocks with a key, fog over the queue, five timed challenges and calmer strata after each new rule.',
    'Thirty authored rooms; portals, timed gates, a fleeing prey, arrows imposing the next move, scissors and sentries, five timed challenges and calmer rooms after each new rule.',
    'Six authored formations; observed rotating shields, split fragments, asteroid deflections, gravity curves, stealth, local repair, satellite defense and coordinated swarms; six guardians and a two-phase finale.',
    'Six tactical pickups, shields, mines, split swarms, spirals, carried turrets, rescue, mirrors, armored columns and six guardians including a two-phase command ship.',
    'Seeded routes inside five topologies; observed mechanism positions, colored locks, one-way passages, portals, switches, cyclic walls, sliding ice, darkness and distinct wisp behaviors.',
    'Thirty workshops; fifteen historical rooms, then ice, one-way floors, plate doors, pits, paired pads and colour-matched boxes, five move-budget challenges.',
    'Thirty authored flight plans on a flat floor; pad choice, caves, moving pads, refuelling, cargo, comets, light gravity, wind tunnels, geysers, beacons, rescues and ice, alone (1-12) then in distinct trios (13-30).',
    'Authored ascent/descent, wagon rides, hostage rescues, six enemy behaviors, three special weapons and five guardian patterns plus a three-phase reactor.',
    'Thirty crossings; traffic lights, diving logs, rapids, tides, bank rocks, a castaway to rescue, shelters in order, five one-life challenges and slower flow after each.',
    'Authored track geometry, slalom, snow, berms, jumps, boosts, width and opponent tuning.'
];
const games = [];
for (const [index, id] of ids.entries()) {
    const mod = await import(`../src/engines/${id}/engine.ts`);
    if (id === 'orbite') { const { recordings } = await import('../tests/orbite-solutions.ts'); games.push({ id, game: names[index], ...orbiteDiversity(mod.Engine, recordings), varies: variations[index] }); continue; }
    if (id === 'briqueterie') { const { solutions } = await import('../tests/briqueterie-solutions.ts'); const { replay } = await import('../tests/briqueterie-replay.ts'); games.push({ id, game: names[index], ...briqueterieDiversity(mod.Engine, solutions, replay), varies: variations[index] }); continue; }
    if (id === 'dedale') { const { solutions } = await import('../tests/dedale-solutions.ts'); games.push({ id, game: names[index], ...dedaleDiversity(mod.Engine, solutions), varies: variations[index] }); continue; }
    if (id === 'essaim') { games.push({ id, game:names[index], ...essaimDiversity(mod.Engine, mod.difficulty), varies:variations[index] }); continue; }
    const levelsMod = id === 'bubble' ? await import('../src/engines/bubble/levels.ts') : mod;
    const track = id === 'derapage' ? await import('../src/engines/derapage/track.ts') : null;
    const rows = [];
    for (let level = 0; level < 30; level++) {
        if (level >= levelsMod.LEVELS.length) { rows.push({ level: level + 1, unavailable: 'No level data in this revision' }); continue; }
        const d = mod.difficulty ? mod.difficulty(level) : { colors: levelsMod.LEVELS[level].colors, rows: levelsMod.LEVELS[level].rows, interval: levelsMod.LEVELS[level].interval };
        const p = await policy(id, mod, level), e = p.engine;
        const initial = extract(id, e, d), initialSnapshot = e.snapshot();
        let actions = 0, elapsedMs = 0;
        for (const method of ['input', 'move', 'moveTo', 'aim', 'shoot', 'launch', 'holdFire']) if (typeof e[method] === 'function') {
            const original = e[method].bind(e); e[method] = (...args) => { actions++; return original(...args); };
        }
        const advance = e.step?.bind(e) ?? e.advance.bind(e);
        if (e.step) e.step = ms => { elapsedMs += ms; advance(ms); };
        else e.advance = ms => { elapsedMs += ms; advance(ms); };
        let frames = 0;
        const limit = Math.min(CAP, p.limit ?? CAP);
        while (e.status === 'playing' && frames < limit) { p.decide(e, frames++); p.advance(e); }
        const final = e.snapshot(), midpointFrame = Math.floor(frames / 2);
        // Replay the same policy to the midpoint of the observed attempt, not of an invented victory.
        const replay = await policy(id, mod, level);
        for (let f = 0; f < midpointFrame; f++) { replay.decide(replay.engine, f); replay.advance(replay.engine); }
        const middle = extract(id, replay.engine, d);
        rows.push({ level: level + 1, parameters: { ...numeric(d), ...initial.params }, initialElements: initial.elements, midpointElements: middle.elements,
            elements: [...new Set([...initial.elements, ...middle.elements])].sort(), layout: track ? track.shapeSignature(e.track) : initial.layout,
            initialSnapshot, midpointSnapshot: replay.engine.snapshot(), curve: { status: e.status, completionMs: e.status === 'won' ? elapsedMs : null, observedMs: elapsedMs, actions, frames, midpointFrame, failures: e.status === 'lost' ? 1 : 0, livesLost: initialSnapshot.lives !== undefined ? initialSnapshot.lives - final.lives : null, censored: e.status === 'playing' } });
    }
    games.push({ id, game: names[index], ...measureDiversity(rows, track ? (a, b) => track.signatureDistance(a, b) / 2 : undefined), varies: variations[index] });
}
games.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
const table = ['| Game | Score | Novelties (count; levels) | Clone share | Longest flat plateau | What actually varies |', '| --- | ---: | --- | ---: | ---: | --- |', ...games.map(g => `| ${g.game}${g.partial ? ' *' : ''} | ${g.score} | ${g.noveltyCount}; ${g.noveltyLevels.join(', ') || 'none'} | ${(g.cloneShare * 100).toFixed(1)}% | ${g.longestPlateau} | ${g.varies} |`)].join('\n');
console.log(JSON.stringify({ revision: 'pass-64', seed: SEED, thresholds: { clone: CLONE, flatParameterRange: FLAT, minPlateauLevels: 3, maxPolicySteps: CAP }, games }, null, 2));
console.log('\n' + table);
