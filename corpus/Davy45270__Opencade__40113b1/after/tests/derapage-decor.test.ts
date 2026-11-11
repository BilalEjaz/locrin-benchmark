import { expect, test } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { DECOR_SPRITES, RAMP_SPRITES, barrierView, drawnDecor, signView } from '../src/games/derapage/decor-sprites';
import { circuits } from '../src/engines/derapage/circuits';
import { createTrack as buildTrack, nearest } from '../src/engines/derapage/track';
import { PARIS_SPRITES, isParis, parisPanel, parisTop } from '../src/games/derapage/paris-sprites';
import { resultLines } from '../src/games/derapage/result-panel';
import { scenerySprites } from '../src/games/derapage/scenery';

/** Width and height of a WebP with alpha (VP8X header). */
function webpSize(path: string): { w: number; h: number } {
    const b = readFileSync(path);
    expect(b.toString('ascii', 0, 4)).toBe('RIFF');
    expect(b.toString('ascii', 12, 16)).toBe('VP8X');
    return { w: 1 + b.readUIntLE(24, 3), h: 1 + b.readUIntLE(27, 3) };
}

test('Z47-Z48 David\'s props: one WebP with alpha per sprite, the size of the table, 120 kB in all at most', () => {
    let bytes = 0;
    for (const [key, size] of Object.entries(DECOR_SPRITES)) {
        const path = `src/games/derapage/decor/${key}.webp`;
        expect(webpSize(path)).toEqual(size);
        bytes += readFileSync(path).length;
    }
    expect(readdirSync('src/games/derapage/decor').sort()).toEqual(Object.keys(DECOR_SPRITES).map(key => `${key}.webp`).sort());
    expect(bytes).toBeLessThan(120_000);
});

test('Z48 David\'s boost ramp: its top view and its four quarters, 25 kB at most', () => {
    let bytes = 0;
    for (const [key, size] of Object.entries(RAMP_SPRITES)) {
        const path = `src/games/derapage/ramp/${key}.webp`;
        expect(webpSize(path)).toEqual(size);
        bytes += readFileSync(path).length;
    }
    expect(readdirSync('src/games/derapage/ramp').sort()).toEqual(Object.keys(RAMP_SPRITES).map(key => `${key}.webp`).sort());
    expect(bytes).toBeLessThan(25_000);
});

test('Z47-Z48 barrier in the city, crate on the quays, signs in the technical cup, tyres in the tight bends', () => {
    const kinds = (name: string) => {
        const level = circuits.findIndex(c => c.name === name);
        return new Set(drawnDecor(buildTrack(level)).map(item => item.kind));
    };
    expect(kinds('Autour des Invalides')).toEqual(new Set(['barrier']));
    expect(kinds('Le Rocher')).toEqual(new Set(['barrier', 'tyres']));
    expect(kinds('La Terrasse des quais')).toEqual(new Set(['barrier', 'cargo', 'tyres']));
    expect(kinds('Les Trois replis')).toEqual(new Set(['sign', 'tyres']));
    expect(kinds('Le Petit guidon')).toEqual(new Set(['tyres']));
    expect(kinds('La Grande ellipse')).toEqual(new Set());
    expect(kinds('Bambou Express')).toEqual(new Set());
});

test('Z47 the view follows the angle between the camera ray and the object', () => {
    // Barrier along the x axis; the ray is the direction from the camera to the barrier.
    expect(barrierView(0, Math.PI / 2)).toBe('barriere_face');
    expect(barrierView(0, -Math.PI / 2)).toBe('barriere_face');
    expect(barrierView(Math.PI, Math.PI / 2)).toBe('barriere_face');
    expect(barrierView(0, 0)).toMatch(/^barriere_profil(_g)?$/);
    expect(barrierView(0, Math.PI)).toMatch(/^barriere_profil(_g)?$/);
    const a = barrierView(0, Math.PI / 4), b = barrierView(0, 3 * Math.PI / 4);
    expect([a, b].sort()).toEqual(['barriere_3q', 'barriere_3q_g']);
    // Sign on a road heading along x, facing the karts that come from -x.
    expect(signView(0, 0, false)).toBe('panneau_face');
    expect(signView(0, 0, true)).toBe('panneau_face_g');
    expect(signView(0, Math.PI, false)).toBe('panneau_arriere');
    expect(signView(0, Math.PI / 2, false)).toBe('panneau_cote');
    expect(signView(0, -Math.PI / 2, true)).toBe('panneau_cote_g');
});

test('Paris cup props: one WebP with alpha per sprite, the size of the table, 60 kB in all at most', () => {
    let bytes = 0;
    for (const [key, size] of Object.entries(PARIS_SPRITES)) {
        const path = `src/games/derapage/paris/${key}.webp`;
        expect(webpSize(path)).toEqual(size);
        bytes += readFileSync(path).length;
    }
    expect(readdirSync('src/games/derapage/paris').sort()).toEqual(Object.keys(PARIS_SPRITES).map(key => `${key}.webp`).sort());
    expect(bytes).toBeLessThan(60_000);
});

test('Paris cup props: the city slots of the first cup take the drawn building, lamp and column, off the road', () => {
    const t = buildTrack(1);
    const props = scenerySprites(t).filter(item => isParis(item.kind));
    expect(new Set(props.map(item => parisPanel(item).key))).toEqual(new Set(['immeuble_face', 'immeuble2_face', 'lampadaire_face', 'colonne_face']));
    for (const item of props) {
        const top = parisTop(item), reach = Math.hypot(top.width, top.height) / 2;
        const n = nearest(t, item);
        // The corner of a roof may come no closer than 3 units to the kerb of its own road.
        expect(n.distance - (t.widths[n.index] ?? 28) / 2).toBeGreaterThan(reach - 6);
    }
    // No other cup has them.
    for (const level of [0, 5, 20]) expect(scenerySprites(buildTrack(level)).some(item => isParis(item.kind))).toBe(false);
});

test('end panel: three result tiles, then the ranking by mascot name with the player marked', () => {
    const lines = resultLines({ total: '00:56.96', bestLap: '00:18.38', record: '00:17.33', newRecord: false, order: [0, 2, 4, 3, 1], drivers: ['dragon', 'panda', 'singe', 'licorne', 'pandaroux'] });
    expect(lines.stats).toEqual([['Temps total', '00:56.96'], ['Meilleur tour', '00:18.38'], ['Record du circuit', '00:17.33']]);
    expect(lines.ranking.map(l => `${String(l.place)}. ${l.name}${l.you ? ' (toi)' : ''}`)).toEqual(['1. Drakart (toi)', '2. Carrosse Tutu', '3. Chariot Feuille', '4. L’Étoilade', '5. Bolide Bambou']);
});
