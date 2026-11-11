import type Phaser from 'phaser';
import type { Board, Position } from '../../engines/caisses/rules';
import { backdrop, floorTile, groundTile, iceTile, stoneBlock, type World } from '../universal/art';
type G = Phaser.GameObjects.Graphics;
/** Drawing shared by the scene and the catalogue thumbnail (one source, no drift). */
export function workshopLayout(b: Board): { unit: number; ox: number; oy: number } {
    // Full world width: the outer ring is walls, so its ground rim may run off the edge.
    const unit = Math.min(360 / b.width, 470 / b.height);
    return { unit, ox: (360 - b.width * unit) / 2, oy: 140 + (470 - b.height * unit) / 2 };
}
/** Sky, ground slab, walls, ice and floor: they never move within a workshop. */
export function workshopScenery(g: G, world: World, b: Board): void {
    const { unit, ox, oy } = workshopLayout(b);
    backdrop(g, world, 360, 640);
    // The workshop stands on a ground slab: grass frame, soil underneath; walls, ice and floor never move.
    const rim = Math.max(6, unit * .3);
    for (let i = 0; i < b.width + 1; i++) groundTile(g, world, ox - rim + i * (b.width * unit + rim * 2) / (b.width + 1), oy + b.height * unit, (b.width * unit + rim * 2) / (b.width + 1), i);
    g.fillStyle(0x000000, .25); g.fillRoundedRect(ox - rim, oy - rim, b.width * unit + rim * 2, b.height * unit + rim * 2, rim);
    for (let p = 0; p < b.width * b.height; p++) {
        const column = p % b.width, row = Math.floor(p / b.width), x = ox + column * unit, y = oy + row * unit;
        if (b.walls.includes(p)) stoneBlock(g, world, x, y, unit, column * 7 + row * 3); else if (b.ice.includes(p)) iceTile(g, x, y, unit); else floorTile(g, world, x, y, unit, (column + row) % 2 === 1);
    }
}
/** Arrows, plates, doors, pits, cracks, pads and targets of one cell (top left x, y). */
export function cellMarks(g: G, b: Board, s: Position, p: number, x: number, y: number, unit: number, time: number, open: boolean): void {
    const cx = x + unit / 2, cy = y + unit / 2, red = 0xff6b6b;
    const arrow = b.arrows.find(a => a.at === p);
    if (arrow) { const [dx, dy] = ({ up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] } as const)[arrow.direction]; g.fillStyle(0x7fdcff, 0.85); g.fillTriangle(cx+dx*unit*.3, cy+dy*unit*.3, cx-dx*unit*.15-dy*unit*.22, cy-dy*unit*.15-dx*unit*.22, cx-dx*unit*.15+dy*unit*.22, cy-dy*unit*.15+dx*unit*.22); }
    if (b.plates.includes(p)) { g.fillStyle(0xffd166); g.fillCircle(cx, cy, unit*.22); g.lineStyle(2, 0x8a6d1f); g.strokeCircle(cx, cy, unit*.22); }
    if (b.doors.includes(p)) { g.lineStyle(3, 0xffd166); g.strokeRect(x+3, y+3, unit-6, unit-6); if (!open) { g.fillStyle(0xb8892a); g.fillRect(x+5, y+5, unit-10, unit-10); } }
    if (b.pits.includes(p)) { g.fillStyle(s.filled.includes(p) ? 0x5b4636 : 0x05080d); g.fillRoundedRect(x+3, y+3, unit-6, unit-6, unit*.3); }
    if (b.cracks.includes(p)) {
        // Cracked slab while it holds; a hole once it has given way, earth once a crate has filled it.
        if (s.broken?.includes(p)) { g.fillStyle(s.filled.includes(p) ? 0x5b4636 : 0x05080d); g.fillRoundedRect(x+3, y+3, unit-6, unit-6, unit*.3); }
        else { g.fillStyle(0x8f7a5c, .55); g.fillRect(x+2, y+2, unit-4, unit-4); g.lineStyle(2, 0x2b2118, .9); g.lineBetween(x+unit*.15, y+unit*.2, x+unit*.5, y+unit*.45); g.lineBetween(x+unit*.5, y+unit*.45, x+unit*.42, y+unit*.85); g.lineBetween(x+unit*.5, y+unit*.45, x+unit*.88, y+unit*.35); g.lineBetween(x+unit*.66, y+unit*.4, x+unit*.75, y+unit*.12); }
    }
    if (b.pads.includes(p)) { g.lineStyle(3, 0xd29af2); g.strokeCircle(cx, cy, unit*.32); g.strokeCircle(cx, cy, unit*.16); }
    const target = b.targets.indexOf(p);
    if (target >= 0) { const tc = b.targetColors[target] ? red : 0x64e4cc; g.fillStyle(tc, .3 + .15 * Math.sin(time * 3)); g.fillCircle(cx, cy, unit*.36); g.lineStyle(3, tc); g.strokeCircle(cx, cy, unit*.3); g.strokeCircle(cx, cy, unit*.14); }
}
/** Crate colour of box `box` standing on cell `p`: green once home, red or wood otherwise. */
export function boxPaint(b: Board, s: Position, box: number, p: number): { home: boolean; color: number } {
    const target = b.targets.indexOf(p);
    const isRed = (s.colors[box] ?? 0) === 1, home = target >= 0 && (b.targetColors[target] ?? 0) === (s.colors[box] ?? 0);
    return { home, color: home ? 0x5fbf6a : isRed ? 0xc4483c : 0xd08a3e };
}
/** David's crate from above (06/11, the view without "?", like Pistouille's): 96 × 89 WebP. */
export const DRAWN_CRATE = { w: 96, h: 89 } as const;
export const CRATE_TEXTURE = 'caisses-crate';
export type CrateTone = 'wood' | 'red' | 'home';
/** Tone of a crate as `boxPaint` decides it: green once home, red for a red crate, wood otherwise. */
export function crateTone(b: Board, s: Position, box: number, p: number): CrateTone {
    const { home } = boxPaint(b, s, box, p);
    return home ? 'home' : (s.colors[box] ?? 0) === 1 ? 'red' : 'wood';
}
/** Bakes David's crate in one tone (the same cue as the vector crate: red crates go to red targets, a crate home
 *  turns green). The tint is painted into the texture, so it does not depend on the renderer. */
export function paintCrate(ctx: CanvasRenderingContext2D, source: CanvasImageSource, tone: CrateTone): void {
    ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(source, 0, 0, DRAWN_CRATE.w, DRAWN_CRATE.h);
    if (tone === 'wood') return;
    ctx.globalCompositeOperation = 'source-atop';
    ctx.fillStyle = tone === 'red' ? 'rgba(210,40,32,.6)' : 'rgba(60,200,96,.55)';
    ctx.fillRect(0, 0, DRAWN_CRATE.w, DRAWN_CRATE.h);
    ctx.globalCompositeOperation = 'source-over';
}
