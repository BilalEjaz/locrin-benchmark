import type { Scenery } from './scenery';
import { KART_HEIGHT } from './decor-sprites';
// Drawn props of the Paris cup (first cup, city circuits under the Paris horizon), in place of the flat code
// silhouettes: a Haussmann building with its café (two shopfronts), a cast-iron street lamp and an advertising
// column. Generated as vector art, rasterised to WebP; size in px. Side views are anchored at the foot of the drawing.
export const PARIS_SPRITES = {
    immeuble_face: { w: 192, h: 256 }, immeuble2_face: { w: 192, h: 256 }, immeuble_dessus: { w: 160, h: 133 },
    lampadaire_face: { w: 72, h: 224 }, lampadaire_dessus: { w: 64, h: 64 },
    colonne_face: { w: 96, h: 192 }, colonne_dessus: { w: 72, h: 72 },
} as const;
export type ParisSpriteKey = keyof typeof PARIS_SPRITES;
export const parisTexture = (key: string): string => `derapage-paris-${key}`;
/** The roadside slots of the Paris cup keep their names: building, lamp and the old crossing slot (now the column). */
export type ParisKind = 'building' | 'lamp' | 'crossing';
export const isParis = (kind: string): kind is ParisKind => kind === 'building' || kind === 'lamp' || kind === 'crossing';
// Heights in 3D: a building of five storeys about the height of the trees (3.3 karts), the lamp 2 karts, the column 1.6.
export const PARIS_HEIGHT: Record<ParisKind, number> = { building: 3.3 * KART_HEIGHT, lamp: 2 * KART_HEIGHT, crossing: 1.6 * KART_HEIGHT };
// From above, in world units (the slot stands 11 units beyond the kerb, 8 at least from any road): the roof lies
// along the road, 12 by 10; the lamp and the column are round.
const TOP: Record<ParisKind, { width: number; height: number }> = { building: { width: 12, height: 10 }, lamp: { width: 4.5, height: 4.5 }, crossing: { width: 5, height: 5 } };
/** Two shopfronts alternate along the street, by position (stable from frame to frame). */
function front(item: Scenery): ParisSpriteKey {
    return Math.abs(Math.round(item.x * 7 + item.y * 13)) % 2 ? 'immeuble2_face' : 'immeuble_face';
}
/** The 3D panel of a Paris prop (it faces the camera, like the trees) and its height in world units. */
export function parisPanel(item: Scenery): { key: ParisSpriteKey; height: number } {
    const kind = item.kind as ParisKind;
    const key: ParisSpriteKey = kind === 'building' ? front(item) : kind === 'lamp' ? 'lampadaire_face' : 'colonne_face';
    return { key, height: PARIS_HEIGHT[kind] };
}
/** The top view of a Paris prop: key, size in world units and the world angle of the image's horizontal axis. */
export function parisTop(item: Scenery): { key: ParisSpriteKey; width: number; height: number; rotation: number } {
    const kind = item.kind as ParisKind;
    const key: ParisSpriteKey = kind === 'building' ? 'immeuble_dessus' : kind === 'lamp' ? 'lampadaire_dessus' : 'colonne_dessus';
    return { key, ...TOP[kind], rotation: kind === 'building' ? item.angle ?? 0 : 0 };
}
