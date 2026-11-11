import { scenerySprites, drawScenery, groundTexture } from './scenery';
import { treeEssence } from './tree-sprites';
import { isDecor } from './decor-sprites';
import { kartLandscape, kartRoadArt, kartTree } from './kart-art';
import type Phaser from 'phaser';
import { nearest } from '../../engines/derapage/track';
import { required } from '../../engines/derapage/access';
import type { Track, Vec } from '../../engines/derapage/track';
interface Graphics {
    fillStyle(color: number, alpha?: number): unknown;
    fillPoints(points: Vec[], close?: boolean): unknown;
    fillCircle(x: number, y: number, radius: number): unknown;
}
interface UrbanGraphics extends Graphics {
    lineStyle(width: number, color: number): unknown;
    lineBetween(x: number, y: number, x2: number, y2: number): unknown;
}
/** Joined capsules: road and border are separate complete passes, never alternating strokes. */
export function drawRoad(g: Graphics, t: Track, project: (x: number, y: number) => Vec, scale: number, view?: {left: number; right: number; top: number; bottom: number}): void {
    const road = t.circuit.theme.road ?? (t.circuit.snow.length ? 0xc9dfe9 : t.circuit.family === 'bmx' ? 0x9b744d : 0x38434d);
    for (const border of [true, false]) for (let i=0; i<t.points.length; i++) {
        const a=required(t.points[i]), b=required(t.points[(i+1)%t.points.length]);
        const length=Math.hypot(b.x-a.x,b.y-a.y), nx=-(b.y-a.y)/length, ny=(b.x-a.x)/length;
        const half=required(t.widths[i])/2 + (border ? (t.circuit.theme.urban ? 3 : .5) : 0);
        if (view) {
            const p=project(a.x,a.y),q=project(b.x,b.y),r=half*scale;
            if(Math.max(p.x,q.x)+r<view.left || Math.min(p.x,q.x)-r>view.right || Math.max(p.y,q.y)+r<view.top || Math.min(p.y,q.y)-r>view.bottom) continue;
        }
        const corners=[{x:a.x+nx*half,y:a.y+ny*half},{x:b.x+nx*half,y:b.y+ny*half},{x:b.x-nx*half,y:b.y-ny*half},{x:a.x-nx*half,y:a.y-ny*half}];
        g.fillStyle(border ? t.circuit.theme.border : road);
        g.fillPoints(corners.map(p=>project(p.x,p.y)),true);
        for (const p of [a,b]) { const q=project(p.x,p.y); g.fillCircle(q.x,q.y,half*scale); }
    }
}

/** Static rails, posts and paving joints share the road texture lifetime. */
export function drawUrban(g: UrbanGraphics, t: Track, project: (x: number, y: number) => Vec, scale: number): void {
    const normals=t.circuit.theme.urban ? t.points.map(p=>nearest(t,p)) : [];
    const line=(a: Vec,b: Vec,width: number,color: number): void => {
        g.lineStyle(width,color);g.lineBetween(a.x,a.y,b.x,b.y);
        if(width>2) {g.fillStyle(color);g.fillCircle(a.x,a.y,width/2);g.fillCircle(b.x,b.y,width/2);}
    };
    if (t.circuit.theme.urban) {
        for (let i=0;i<96;i++) {
            if (!t.walls[i]) continue;
            const q=required(t.points[i]), r=required(t.points[(i+1)%96]);
            const n=required(normals[i]), m=required(normals[(i+1)%96]);
            for (const side of [-1,1]) {
                const edge = (p: { x:number; y:number }, normal: { nx:number; ny:number }, half:number) => project(p.x+normal.nx*half*side,p.y+normal.ny*half*side);
                line(edge(q,n,required(t.widths[i])/2+.9),edge(r,m,required(t.widths[(i+1)%96])/2+.9),Math.max(2,1.8*scale),0xbec5ca);
                const a=edge(q,n,required(t.widths[i])/2+1.8), b=edge(r,m,required(t.widths[(i+1)%96])/2+1.8);
                line(a,b,Math.max(2.5,.65*scale),0xf1f5f8);
                const posts=Math.max(1,Math.ceil(Math.hypot(r.x-q.x,r.y-q.y)/3));
                for (let j=0;j<posts;j++) {
                    const x=a.x+(b.x-a.x)*j/posts, y=a.y+(b.y-a.y)*j/posts;
                    line({ x,y },{ x,y:y-Math.max(3,1.1*scale) },Math.max(1.5,.45*scale),0x647583);
                }
            }
        }
        // Short paving joints follow the road; the continuous border is the kerb/rail.
        for (let i=0;i<96;i+=2) {
            const q=required(t.points[i]), n=required(normals[i]), half=required(t.widths[i])/2-1;
            line(project(q.x+n.nx*half,q.y+n.ny*half),project(q.x-n.nx*half,q.y-n.ny*half),1,0x65717a);
        }
    }
}

/** World rectangle of the static road layer (top left, and its size in pixels at the top-view scale 5). */
export function roadBounds(t: Track): { left: number; top: number; width: number; height: number } {
    const margin = Math.max(32, Math.max(...t.widths) / 2 + 20);
    const left = Math.min(...t.points.map(p => p.x)) - margin;
    const top = Math.min(...t.points.map(p => p.y)) - margin;
    const width = Math.ceil((Math.max(...t.points.map(p => p.x)) + margin - left) * 5);
    const height = Math.ceil((Math.max(...t.points.map(p => p.y)) + margin - top) * 5);
    return { left, top, width, height };
}
/** The static road layer at the top-view scale 5, world (left, top) at the origin: ground texture,
 * landscape, road, rails, road art, trees and roadside props. Shared by the scene and the thumbnail.
 * `drawnTrees`: David's trees are drawn by the scene from above, so their vector trees are left out.
 * `drawnDecor`: likewise his barrier, crate and direction sign (Z47). */
export function paintRoadLayer(g: Phaser.GameObjects.Graphics, t: Track, left: number, top: number, drawnTrees = false, drawnDecor = false): void {
    const projectStatic = (x: number, y: number): Vec => ({ x: (x - left) * 5, y: (y - top) * 5 });
    groundTexture(g,t,projectStatic);
    kartLandscape(g,t,projectStatic,5,0,true);
    drawRoad(g, t, projectStatic, 5);
    drawUrban(g, t, projectStatic, 5);
    kartRoadArt(g,t,projectStatic,5,0,true);
    const theme=t.circuit.theme.kart;
    if (theme && !(drawnTrees && theme === 'autumn')) for (const tree of t.trees)
        kartTree(g,theme,projectStatic(tree.x,tree.y),tree.radius,5,0,true);
    for (const item of scenerySprites(t)) {
        if (drawnTrees && (item.kind === 'tree' || item.kind === 'fir') && treeEssence(t, item, item.kind)) continue;
        if (drawnDecor && isDecor(item.kind)) continue;
        drawScenery(g,item,projectStatic(item.x,item.y),5);
    }
}

/** Rasterize the exact joined road once, at the normal top-view resolution.
 * A single owned texture is replaced on track changes and released on shutdown. */
export class RoadLayer {
    private track?: Track;
    private drawnTrees = false;
    private drawnDecor = false;
    private image?: Phaser.GameObjects.Image;
    private left = 0;
    private top = 0;
    private readonly key = 'derapage-road';
    constructor(private readonly scene: Phaser.Scene) {}
    draw(t: Track, project: (x: number, y: number) => Vec, scale: number, rotation: number, drawnTrees = false, drawnDecor = false): void {
        if (this.track !== t || this.drawnTrees !== drawnTrees || this.drawnDecor !== drawnDecor) {
            this.destroy();
            this.drawnTrees = drawnTrees; this.drawnDecor = drawnDecor;
            const box = roadBounds(t);
            this.left = box.left; this.top = box.top;
            const g = this.scene.make.graphics({ x: 0, y: 0 });
            paintRoadLayer(g, t, box.left, box.top, drawnTrees, drawnDecor);
            const { width, height } = box;
            g.generateTexture(this.key, width, height);
            g.destroy();
            this.image = this.scene.add.image(0, 0, this.key).setOrigin(0, 0);
            this.track = t;
        }
        const origin = project(this.left, this.top);
        this.image?.setPosition(origin.x, origin.y).setScale(scale / 5).setRotation(rotation).setVisible(true);
    }
    hide(): void { this.image?.setVisible(false); }
    destroy(): void {
        this.image?.destroy();
        this.image = undefined;
        this.track = undefined;
        if (this.scene.textures.exists(this.key)) this.scene.textures.remove(this.key);
    }
}

/** Conservative screen bounds; padding includes strokes and animated decoration. */
export function inView(points: Vec[], padding = 0): boolean {
    return Math.max(...points.map(p => p.x)) + padding >= 0 && Math.min(...points.map(p => p.x)) - padding <= 360
        && Math.max(...points.map(p => p.y)) + padding >= 96 && Math.min(...points.map(p => p.y)) - padding <= 640;
}
