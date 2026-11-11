import { createDemo } from '../../engines/caisses/demo';
import { doorOpen } from '../../engines/caisses/rules';
import { backdrop, crate, worldOf } from '../universal/art';
import { DRAWN_CRATE, boxPaint, cellMarks, crateTone, paintCrate, workshopLayout, workshopScenery } from './art';
import { bake, bakeArt, canvasGraphics, castSprite, thumbnailHero } from '../thumbnail-art';
import type { Thumbnail } from '../thumbnail';
export { createDemo };
/** David's crate from above for the catalogue card too (06/11): its own small chunk, asked for once in a browser,
 *  the vector crate until the image is decoded. */
let crateImage: CanvasImageSource | null = null, crateAsked = false;
/** Installs the crate image (the loader below, or a test). */
export function useThumbnailCrate(image: CanvasImageSource | null): void { crateImage = image; crateAsked = true; }
function thumbnailCrate(): CanvasImageSource | null {
    if (!crateAsked && typeof Image !== 'undefined') {
        crateAsked = true;
        void import('./crate-atlas').then(({ crate: url }) => {
            if (!url) return;
            const image = new Image(); image.onload = () => { crateImage = image; }; image.src = url;
        }).catch(() => undefined);
    }
    return crateImage;
}
/** The game's workshop at its own scale (360 × 640), framed on the board: same sky, stone,
 * floor, marks, crates and character. Scenery and marks are baked per board, crates per colour. */
export function createThumbnail(seed = 28): Thumbnail {
    const demo = createDemo(seed), hero = thumbnailHero();
    let frame = 0;
    return { step: () => { demo.step(); frame++; }, get restarts() { return demo.restarts; }, read: () => demo.engine.snapshot(), draw(c) {
        const e = demo.engine, b = e.board, s = e.state, world = worldOf(e.level);
        const { unit, ox, oy } = workshopLayout(b), boardH = b.height * unit;
        // Window of 4:3 around the board, a little sky above and the slab below.
        const viewH = Math.min(640, boardH + 40), k = 120 / viewH, viewW = 160 / k, res = k * 2;
        const top = Math.max(0, Math.min(640 - viewH, oy + boardH / 2 - viewH / 2)), left = (360 - viewW) / 2;
        c.save(); c.scale(k, k); c.translate(-left, -top);
        const board = `${String(e.level)}-${String(b.width)}x${String(b.height)}-${b.walls.join('.')}`;
        if (viewW > 360) bakeArt(c, `caisses-wide-${world}-${String(Math.round(viewW))}`, left, 0, viewW, 640, res, g => { backdrop(g, world, viewW, 640); });
        bakeArt(c, `caisses-${world}-${board}`, 0, 0, 360, 640, res, g => { workshopScenery(g, world, b); });
        const open = doorOpen(b, { player: s.player, boxes: s.boxes, colors: s.colors, filled: s.filled });
        bakeArt(c, `caisses-marks-${board}-${String(open)}-${s.filled.join('.')}`, 0, 0, 360, 640, res, g => {
            for (let p = 0; p < b.width * b.height; p++) cellMarks(g, b, s, p, ox + p % b.width * unit, oy + Math.floor(p / b.width) * unit, unit, 0, open);
        });
        const drawn = thumbnailCrate();
        s.boxes.forEach((p, box) => {
            const x = ox + p % b.width * unit, y = oy + Math.floor(p / b.width) * unit, { color } = boxPaint(b, s, box, p);
            const vector = (g: Parameters<typeof crate>[0]): void => { crate(g, 0, 0, unit * .84, color); };
            if (!drawn) { bakeArt(c, `caisses-crate-${color.toString(16)}-${String(Math.round(unit))}`, x + unit * .08, y + unit * .08, unit * .84, unit * .84, res, vector); return; }
            // As in the game: 0.96 of a cell, centred; the tint composites on the crate's own bitmap only.
            const tone = crateTone(b, s, box, p), w = unit * .96, h = w * DRAWN_CRATE.h / DRAWN_CRATE.w;
            bake(c, `caisses-crate-drawn-${tone}-${String(Math.round(unit))}`, x + (unit - w) / 2, y + (unit - h) / 2, w, h, res,
                k => { k.scale(w / DRAWN_CRATE.w, h / DRAWN_CRATE.h); paintCrate(k, drawn, tone); },
                k => { k.translate((w - unit * .84) / 2, (h - unit * .84) / 2); vector(canvasGraphics(k)); });
        });
        const size = unit * 1.55, px = ox + s.player % b.width * unit, py = oy + Math.floor(s.player / b.width) * unit;
        castSprite(c, hero, 'face', 'concentre', 'repos', frame / 2, px + (unit - size) / 2, py + unit - size, size, res);
        c.restore();
    } };
}
