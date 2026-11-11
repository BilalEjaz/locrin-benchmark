import { expect, test } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { DECOR_SPRITES, RAMP_SPRITES, barrierView, drawnDecor, signView } from '../src/games/derapage/decor-sprites';
import { circuits } from '../src/engines/derapage/circuits';
import { createTrack as buildTrack } from '../src/engines/derapage/track';

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
