import assert from 'node:assert/strict';
import { Engine as Orbit, fleet } from '../src/engines/orbite/engine';
import { stage } from '../src/engines/orbite/campaign';
import { encounters, ENCOUNTERS, createLabyrinth } from '../src/engines/dedale/labyrinth';
import { lesson, WISP_LESSON } from '../src/games/dedale/lessons';
/** O-FLEET: the fleet grows by chapter (literal table), breathers and guardians keep theirs, the final is the largest guardian wave. */
export function orbiteFleet(E = Orbit): void {
    const counts = Array.from({ length: 30 }, (_, level) => new E(level, 28).state.probes.length);
    assert.deepEqual(counts, [15, 15, 15, 18, 12, 12, 18, 18, 18, 12, 12, 24, 24, 24, 12, 24, 12, 24, 24, 12, 14, 24, 28, 28, 12, 14, 28, 28, 18, 20]);
    for (let level = 0; level < 30; level++) assert.equal(counts[level], fleet(level).rows * fleet(level).columns);
    // Both dimensions, not only the product (a 5×4 final or 4×3 guardians would be other formations).
    assert.deepEqual(Array.from({ length: 30 }, (_, l) => `${String(fleet(l).rows)}x${String(fleet(l).columns)}`).join(' '),
        '3x5 3x5 3x5 3x6 3x4 2x6 3x6 3x6 3x6 3x4 2x6 4x6 4x6 4x6 3x4 4x6 2x6 4x6 4x6 3x4 2x7 4x6 4x7 4x7 3x4 2x7 4x7 4x7 3x6 4x5');
    // Measured on the real probes of every level (a transposed fleet keeps the same count).
    for (let level = 0; level < 30; level++) { const e = new E(level, 28); assert.equal(new Set(e.state.probes.map(p => p.row)).size, fleet(level).rows); assert.equal(new Set(e.state.probes.map(p => p.column)).size, fleet(level).columns); }
    // Ordinary (non-breather, non-guardian) fleets never shrink, except the stacked-mechanics level 29.
    const ordinary = counts.map((n, level) => ({ n, level })).filter(({ level }) => !stage(level).rest && !stage(level).boss && level !== 28);
    for (let i = 1; i < ordinary.length; i++) assert.ok((ordinary[i]?.n ?? 0) >= (ordinary[i - 1]?.n ?? 0));
    assert.ok((counts[29] ?? 0) > Math.max(...counts.filter((_, l) => stage(l).boss && l !== 29)));
    // Every fleet fits the playfield, far above the shields.
    for (let level = 0; level < 30; level++) for (const p of new E(level, 28).state.probes) assert.ok(p.x >= 12 && p.x <= 348 && p.y < 300);
}
/** D-MIX: each board draws its own mix and order; first appearances unchanged; every family returns in each later chapter. */
export function dedaleMix(plan = encounters, create = createLabyrinth, hud = lesson): void {
    assert.deepEqual([0, 3, 4, 5, 8, 12, 15, 19, 21, 27, 29].map(l => plan(l).join('+')), [
        '', 'key', 'key+arrow', 'arrow', 'portal+key', 'switch+key', 'portal+moving', 'switch+moving+ice+key+arrow+portal', 'dark', 'dark+key+key2',
        'key2+key+arrow+portal+switch+moving+ice+dark']);
    // HUD names the newest family really on the board; the wisp roles only on their debut (level 25).
    assert.equal(hud(24), WISP_LESSON);
    assert.equal(hud(27), 'Deux couleurs : chaque porte a sa clé'); assert.equal(hud(28), 'Deux couleurs : chaque porte a sa clé');
    assert.equal(hud(29), 'Deux couleurs : chaque porte a sa clé'); assert.equal(hud(21), 'Ombres : vision à 3 cases autour de vous');
    assert.equal(hud(12), 'Bouton orange : ouvre / ferme les grilles'); assert.equal(hud(0), 'Quatre soleils et quatre graines à retrouver');
    // Level 26 is the review board: everything acquired, in introduction order (historical placement).
    assert.equal(plan(25).join('+'), 'key+arrow+portal+switch+moving+ice+dark');
    const first = Object.fromEntries(ENCOUNTERS.map(m => [m, Array.from({ length: 30 }, (_, l) => l).find(l => plan(l).includes(m))]));
    assert.deepEqual(first, { key: 3, arrow: 4, portal: 8, switch: 12, moving: 15, ice: 18, dark: 21, key2: 27 });
    for (let l = 5; l < 30; l++) assert.notEqual(plan(l).join('+'), plan(l - 1).join('+'), `levels ${String(l)}/${String(l + 1)}`);
    for (const m of ENCOUNTERS) for (let chapter = Math.floor(first[m] / 5) + 1; chapter < 6; chapter++)
        assert.ok([0, 1, 2, 3, 4].some(k => plan(chapter * 5 + k).includes(m)), `${m} absent from chapter ${String(chapter + 1)}`);
    // The generated board holds exactly its plan (no cumulative leftovers).
    for (let l = 0; l < 30; l++) {
        const j = create(l, 28).journey, p = plan(l);
        assert.equal(j.portals.length > 0, p.includes('portal')); assert.equal(j.switches.length > 0, p.includes('switch'));
        assert.equal(j.moving.length > 0, p.includes('moving')); assert.equal(j.ice.length > 0, p.includes('ice'));
        assert.equal(j.dark.length > 0, p.includes('dark')); assert.equal(j.arrows.length > 0, p.includes('arrow'));
        // Mirror levels 20 and 30 also reflect optional copies onto free branches.
        if (l === 19 || l === 29) assert.ok(j.keys.length >= (p.includes('key') ? 1 : 0) + (p.includes('key2') ? 1 : 0));
        else assert.equal(j.keys.length, (p.includes('key') ? 1 : 0) + (p.includes('key2') ? 1 : 0));
        // Key before its door and switch before its gate along the route.
        const at = (cell: number) => j.principal?.indexOf(cell) ?? -1;
        for (const [i, k] of j.keys.entries()) if (at(k.at) >= 0 && at(j.doors[i]?.at ?? -1) >= 0) assert.ok(at(k.at) < at(j.doors[i]?.at ?? -1));
        if (j.switches[0] !== undefined) assert.ok(at(j.switches[0]) < at(j.gates[0] ?? -1));
        // Ice on a straight run (it really slides); portals at least three cells apart (a real shortcut).
        if (l !== 25 && j.ice[0] !== undefined) { const i = at(j.ice[0]), p0 = j.principal?.[i - 1], p2 = j.principal?.[i + 1];
            assert.ok(p0 !== undefined && p2 !== undefined && j.ice[0] - p0 === p2 - j.ice[0]); }
        if (l !== 25 && j.portals[0]) assert.ok(at(j.portals[0][1]) - at(j.portals[0][0]) >= 3);
        // Spatial order follows the plan, each family in its own equal window (8 %–88 % of the route); mirror copies ignored.
        if (l !== 25 && l !== 19 && l !== 29) {
            const n = (j.principal?.length ?? 1) - 1, first: Record<string, number | undefined> = {
                key: j.keys.find(k => k.color === 0)?.at, key2: j.keys.find(k => k.color === 1)?.at, arrow: j.arrows[0]?.at, portal: j.portals[0]?.[0],
                switch: j.switches[0], moving: j.moving[0], ice: j.ice[0], dark: j.dark[0] };
            const idx = p.map(m => at(first[m] ?? -1));
            for (let i = 1; i < idx.length; i++) assert.ok((idx[i] ?? -1) > (idx[i - 1] ?? -1), `order L${String(l + 1)}`);
            p.forEach((m, i) => { const start = 0.08 + i * 0.8 / p.length, f = (idx[i] ?? -1) / n;
                assert.ok(f >= start - 1 / n - 1e-9 && f < start + 0.8 / p.length, `window ${m} L${String(l + 1)}`); });
        }
    }
}
