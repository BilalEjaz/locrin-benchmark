import { fingerProof } from './finger';
import { lesson as dedaleLesson } from './lessons';
import { fingerReceipts } from '../finger-receipts';
import Phaser from 'phaser';
import { GameCharacter } from '../../characters/game';
import { Engine, LEVELS, WIDTH, HEIGHT, visible, index, type Direction } from '../../engines/dedale/engine';
import { Inputs, applyGroupedCross, renderTouchControls, directionalSwipe, type TouchButton } from '../../shell/input';
import { MOBILE_PLAY, PlaySession } from '../../shell/pause';
import { Progression } from '../../shell/progression';
import { browserStorage, readSave, readValue, writeSave, writeValue } from '../../shell/storage';
import { renderPanels } from '../../shell/panels';
import { renderLevels } from '../../shell/levels';
import { mazeScenery, seedLight, sunLight, wispArt } from './art';
import { sound } from '../../shell/services';
const CROSS_KEY = 'arcade-lab:dedale:cross:v1';
/** Lueur lasts 180 ticks (engine). */
const LUEUR_TICKS = 180;
export const dedaleButtons: readonly TouchButton[] = [
    // Swipes steer; the grouped cross is an option (pause page), hidden by default.
    { id: 'dedale-special', label: 'Lueur', ariaLabel: 'Lueur : chemin vers le soleil', size: 56, placement: 'right', mode: 'tap' },
    { id: 'dedale-left', label: '←', ariaLabel: 'Aller à gauche', size: 56, placement: 'left', mode: 'tap' },
    { id: 'dedale-up', label: '↑', ariaLabel: 'Monter', size: 56, placement: 'left', mode: 'tap' },
    { id: 'dedale-down', label: '↓', ariaLabel: 'Descendre', size: 56, placement: 'left', mode: 'tap' },
    { id: 'dedale-right', label: '→', ariaLabel: 'Aller à droite', size: 56, placement: 'left', mode: 'tap' },
    { id: 'dedale-cross', label: 'Croix', ariaLabel: 'Croix de direction', size: 56, placement: 'right', mode: 'tap', setting: true },
];
export interface DedaleHook {
    performance(): { frames: number; gameMs: number };
    advance(ms: number): void;
    hudText(): string;
    usefulArea(): { x: number; y: number; width: number; height: number };
    fingerReceipts: ReturnType<typeof fingerReceipts>;
    read(): ReturnType<Engine['snapshot']> & { fingerInput: { paused: boolean }; cumulativeScore: number; progression: string; character: ReturnType<GameCharacter['snapshot']>; specialUses: number; specialTicks: number };
    loadLevel(index: number, seed?: number): void;
    scenario(name: 'finish' | 'danger'): void;
}
declare global { interface Window { __DEDALE_TEST__?: DedaleHook } }
export class DedaleScene extends Phaser.Scene {
    private engine = new Engine();
    private hero = new GameCharacter();
    private progress = new Progression(readSave(browserStorage(), 'dedale', 30), 30);
    private inputs = new Inputs();
    private selecting = false;
    private testManual = false;
    private testAdvancing = false;
    private graphics?: Phaser.GameObjects.Graphics;
    private hud?: Phaser.GameObjects.Text;
    private cross = readValue(browserStorage(), CROSS_KEY) === 'on';
    private title?: Phaser.GameObjects.Text;
    private glow = 0;
    private panelSignature = '';
    private drawSignature = '';
    private board?: Phaser.Textures.CanvasTexture;
    /** Sky, paths, walls and veils: painted once per maze, then copied under the collectibles in one call. */
    private scenery?: Phaser.Textures.CanvasTexture;
    /** Level and maze content the scenery was painted for (a reloaded state may copy the same maze). */
    private sceneryKey = '';
    /** Full scenery paints since the scene started (cost check). */
    sceneryPaints = 0;
    private drawnMaze?: boolean[];
    private boardSignature = '';
    constructor(private session = new PlaySession(true)) { super('dedale'); }
    private panels(): void {
        const signature = `${this.engine.status}|${this.progress.state}|${String(this.engine.level)}|${String(this.engine.state.score)}|${String(this.progress.total)}|${String(this.selecting)}`;
        if (signature === this.panelSignature) return;
        this.panelSignature = signature;
        renderPanels(this.engine.status, this.progress.state, this.engine.level, this.engine.state.score, this.progress.total, this.selecting);
    }
    private start(index: number, seed?: number, fresh = false): void {
        this.testManual = false; this.progress.start(index, fresh); this.engine.loadLevel(index, seed); this.selecting = false; this.panels(); this.draw();
    }
    create(): void {
        const receipts = fingerReceipts(this.inputs);
        document.body.classList.add('dedale');
        const cleanup = (): void => { this.inputs.dispose(); applyGroupedCross('dedale', false, 'dedale-cross'); document.body.classList.remove('dedale'); delete window.__DEDALE_TEST__; sound.stop(); };
        this.events.once('shutdown', cleanup);
        this.events.once('destroy', cleanup);
        const board = this.textures.createCanvas('dedale-board', 360, 640);
        if (!board) throw new Error('Décor indisponible');
        this.board = board;
        this.scenery = (this.textures.exists('dedale-scenery') ? this.textures.get('dedale-scenery') : this.textures.createCanvas('dedale-scenery', 360, 640)) as Phaser.Textures.CanvasTexture | undefined ?? undefined;
        this.add.image(0, 0, 'dedale-board').setOrigin(0);
        this.graphics = this.add.graphics();
        this.title = this.add.text(20, 22, '', { fontFamily: 'system-ui', fontSize: '19px', color: '#b9fff0' });
        this.hud = this.add.text(18, 510, '', { fontFamily: 'system-ui', fontSize: '12px', color: '#e5f3ff', lineSpacing: 5, wordWrap: { width: 324 } });
        const direction = (value: Direction): void => {
            if (this.session.state === 'ready') this.session.send('start');
            if (this.session.paused || this.selecting || this.engine.status !== 'playing') return;
            this.engine.input(value); sound.playEffect('turn');
        };
        renderTouchControls(this.inputs, dedaleButtons, (id, held) => {
            if (id === 'dedale-special') { if (held && !this.session.paused && !this.selecting) this.engine.special(); }
            else if (id === 'dedale-cross') { if (held) { this.cross = !this.cross; writeValue(browserStorage(), CROSS_KEY, this.cross ? 'on' : 'off'); this.applyCross(); } }
            else if (held) direction(id.replace('dedale-', '') as Direction);
        });
        this.applyCross();
        const area = document.querySelector<HTMLElement>('#game');
        if (area) directionalSwipe(this.inputs, area, direction, 16, true);
        const keys: Record<string, Direction> = { ArrowUp: 'up', KeyW: 'up', KeyZ: 'up', ArrowDown: 'down', KeyS: 'down', ArrowLeft: 'left', KeyA: 'left', KeyQ: 'left', ArrowRight: 'right', KeyD: 'right' };
        this.inputs.on(document, 'keydown', event => {
            const e = event as KeyboardEvent;
            if (e.code === 'Space' && !e.repeat) { e.preventDefault(); if (!this.session.paused && !this.selecting) this.engine.special(); }
            const value = keys[e.code];
            if (value) { e.preventDefault(); if (!e.repeat) direction(value); }
        });
        const choose = (): void => {
            this.selecting = !this.selecting;
            renderLevels(LEVELS, this.progress.save, index => { this.start(index, undefined, true); }); this.panels();
        };
        for (const id of ['levels', 'result-levels', 'close-levels']) this.inputs.on(document.querySelector(`#${id}`), 'click', choose);
        this.inputs.on(document.querySelector('#next-level'), 'click', () => { if (this.progress.state === 'won') this.start(this.engine.level + 1); });
        const retry = (): void => { this.progress.retry(); this.engine.loadLevel(this.engine.level, this.engine.seed); this.panels(); this.draw(); };
        for (const id of ['retry-level', 'replay-level', 'restart']) this.inputs.on(document.querySelector(`#${id}`), 'click', retry);
        this.game.canvas.setAttribute('aria-label', 'Dédale : guider le compagnon et récolter la lumière');
        if (new URLSearchParams(location.search).get('test') === '1') window.__DEDALE_TEST__ = {
            ...fingerProof,
            advance: ms => { this.advanceTest(ms); },
            hudText: () => this.hud?.text ?? '',
            usefulArea: () => ({ x: 0, y: 0, width: 360, height: 640 }),
            performance: () => ({ frames: this.game.loop.frame, gameMs: this.engine.state.ticks * 1000 / 60 }),
            fingerReceipts: receipts,
            read: () => ({ fingerInput: { paused: this.session.paused }, ...this.engine.snapshot(), character: this.hero.snapshot(), specialUses: this.engine.specialUses, specialTicks: this.engine.specialTicks, cumulativeScore: this.progress.total, progression: this.progress.state }),
            loadLevel: (index, seed) => { this.start(index, seed, true); },
            scenario: name => {
                this.start(0, 459, true);
                const state = structuredClone(this.engine.state);
                state.hero = { x: 9, y: 17, direction: 'left' }; state.requested = 'left';
                state.maze[16 * WIDTH + 9] = true;
                state.seeds = name === 'finish' ? [16 * WIDTH + 9] : [WIDTH + 1];
                state.suns = []; state.grace = 0;
                state.lives = name === 'danger' ? 1 : 3;
                state.wisps = name === 'finish' ? [] : [{ x: 9, y: 16, direction: 'up', kind: 'tracker', returning: false, wait: 0 }];
                state.wispClock = 0;
                this.engine.loadState(state); this.draw();
            },
        };
        this.scale.refresh();
        this.panels(); this.draw();
    }
    private advanceTest(ms: number): void {
        if (!Number.isFinite(ms) || ms < 0) throw new RangeError('Temps invalide');
        this.testManual = true;
        this.testAdvancing = true;
        try {
            if (!this.session.paused && !this.selecting) {
                const step = 1000 / 60;
                for (let i = 0; i < Math.ceil(ms / step); i++) {
                    const delta = Math.min(step, ms - i * step);
                    this.tick(delta);
                }
            }
        } finally {
            this.testAdvancing = false;
            this.tick(0);
        }
    }
    updatePaused(): void { this.tick(0); }
    update(_time: number, delta: number): void {
        this.tick(this.testManual ? 0 : delta);
    }
    private tick(delta: number): void {
        if (!this.session.paused && !this.selecting) {
            this.engine.step(delta);
            for (const event of new Set(this.engine.events)) {
                sound.playEffect(event);
                if (event === 'move') this.hero.move(this.engine.state.hero.direction === 'left' ? -1 : this.engine.state.hero.direction === 'right' ? 1 : 0);
                if (event === 'life') this.hero.impact = 500;
                if (event === 'sun' || event === 'wisp') { this.hero.animation = 'celebration'; this.hero.moving = 400; }
                if (['seed', 'sun', 'wisp', 'life'].includes(event)) this.glow = 1;
            }
        }
        this.hero.advance(delta, this.session.paused || this.selecting, this.engine.status, this.engine.specialTicks > 0);
        if (this.engine.status !== 'playing' && this.progress.state === 'playing') {
            this.progress.finish(this.engine.status, this.engine.state.score); writeSave(browserStorage(), this.progress.save, 'dedale'); sound.playEffect(this.engine.status);
        }
        this.glow = Math.max(0, this.glow - delta / 400);
        if (this.testAdvancing) return;
        this.panels(); this.draw();
    }
    /** The optional cross: four arrows grouped under one thumb (left slot). */
    private applyCross(): void { applyGroupedCross('dedale', this.cross, 'dedale-cross'); }
    private paintScenery(ctx: CanvasRenderingContext2D, maze: boolean[], size: number, left: number, top: number): void {
        this.sceneryPaints++;
        mazeScenery(ctx, maze, this.engine.level, this.engine.state.journey, size, left, top);
    }
    private paintBoard(): void {
        const texture = this.board; if (!texture) return;
        const s = this.engine.state, signature = `${String(s.seeds.length)}|${String(s.suns.length)}|${String(s.journey?.held)}|${String(s.journey?.toggled)}|${String((s.journey?.turn ?? 0) % 4)}`;
        if (this.drawnMaze === s.maze && this.boardSignature === signature) return;
        this.drawnMaze = s.maze; this.boardSignature = signature;
        const ctx = texture.context, size = 18.4, left = 5.2, top = 64;
        const scenery = this.scenery;
        const key = `${String(this.engine.level)}:${s.maze.map(open => open ? 1 : 0).join('')}`;
        if (scenery && this.sceneryKey === key) ctx.clearRect(0, 0, 360, 640);
        else this.paintScenery(scenery?.context ?? ctx, s.maze, size, left, top);
        if (scenery) { this.sceneryKey = key; ctx.drawImage(scenery.canvas, 0, 0); }
        for (const i of s.seeds) seedLight(ctx, i, this.engine.level, size, left, top);
        for (const i of s.suns) sunLight(ctx, i, size, left, top);
        const j = s.journey;
        if (j) {
            const mark = (at: number, label: string, color: string, solid = false): void => {
                const x = left + (at % WIDTH) * size, y = top + Math.floor(at / WIDTH) * size;
                ctx.fillStyle = color; ctx.globalAlpha = solid ? 1 : 0.65;
                ctx.fillRect(x + 1, y + 1, size - 2, size - 2); ctx.globalAlpha = 1;
                ctx.font = 'bold 17px system-ui'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
                ctx.fillStyle = '#ffffff';
                const cx = x + size / 2, cy = y + size / 2;
                ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 2;
                if (label === 'key') {
                    ctx.beginPath(); ctx.arc(cx - 3, cy - 3, 3.5, 0, Math.PI * 2); ctx.moveTo(cx, cy); ctx.lineTo(cx + 6, cy + 6); ctx.lineTo(cx + 6, cy + 2); ctx.moveTo(cx + 3, cy + 3); ctx.lineTo(cx + 6, cy); ctx.stroke();
                } else if (label === 'door') {
                    ctx.strokeRect(cx - 5, cy - 7, 10, 14); ctx.fillRect(cx + 1, cy, 2, 2);
                } else if (label === 'portal') {
                    ctx.beginPath(); ctx.ellipse(cx, cy, 6, 7, 0, 0, Math.PI * 2); ctx.stroke();
                    ctx.beginPath(); ctx.ellipse(cx, cy, 2.5, 4, 0, 0, Math.PI * 2); ctx.stroke();
                } else if (label === 'ice') {
                    ctx.beginPath(); for (let n = 0; n < 3; n++) { const a = n * Math.PI / 3; ctx.moveTo(cx - Math.cos(a) * 7, cy - Math.sin(a) * 7); ctx.lineTo(cx + Math.cos(a) * 7, cy + Math.sin(a) * 7); } ctx.stroke();
                } else if (label === 'switch') {
                    ctx.beginPath(); ctx.arc(cx, cy, 6, Math.PI * 0.2, Math.PI * 1.8); ctx.moveTo(cx, cy - 7); ctx.lineTo(cx, cy); ctx.stroke();
                } else if (label === 'crumble') {
                    ctx.beginPath(); ctx.moveTo(cx - 7, cy - 5); ctx.lineTo(cx - 1, cy); ctx.lineTo(cx - 3, cy + 7); ctx.moveTo(cx - 1, cy); ctx.lineTo(cx + 7, cy - 2); ctx.moveTo(cx + 3, cy - 1); ctx.lineTo(cx + 4, cy - 7); ctx.stroke();
                } else ctx.fillText(label, cx, cy);
            };
            for (const at of j.dark) mark(at, '·', '#5b4194');
            for (const at of j.ice) mark(at, 'ice', '#1484a6');
            for (const key of j.keys) if (!(j.held & (1 << key.color))) mark(key.at, 'key', key.color ? '#ef92d4' : '#ffcf71');
            for (const door of j.doors) mark(door.at, j.held & (1 << door.color) ? '□' : 'door', door.color ? '#ef92d4' : '#ffcf71', !(j.held & (1 << door.color)));
            for (const a of j.arrows) mark(a.at, { up: '↑', down: '↓', left: '←', right: '→' }[a.direction], '#94ce93');
            j.portals.forEach(pair => { pair.forEach(at => { mark(at, 'portal', '#8754df'); }); });
            for (const at of j.switches) mark(at, 'switch', j.toggled ? '#39b879' : '#d66b25');
            for (const at of j.gates) mark(at, j.toggled ? '┄' : '╳', '#ffb669', !j.toggled);
            for (const at of j.crumble ?? []) if (!j.fallen?.includes(at)) mark(at, 'crumble', '#9a7b55');
            for (const at of j.moving) mark(at, j.turn % 4 < 2 ? '▥' : '┄', '#f17788', j.turn % 4 < 2);
        }
        texture.refresh();
    }
    private draw(): void {
        const g = this.graphics; if (!g) return;
        const s = this.engine.state, size = 18.4, left = 5.2, top = 64;
        const signature = JSON.stringify([this.hero.snapshot(), Math.floor(this.hero.time / 50), this.engine.specialTicks, this.engine.level, this.engine.seed, this.engine.status, s.hero.x, s.hero.y, s.score, s.lives,
            s.seeds.length, s.suns.length, s.journey, s.mode, (s.vulnerable / 1000).toFixed(1), Math.round(this.glow * 10),
            s.grace > 0 && s.ticks % 8 < 4, s.wisps.map(w => [w.x, w.y, w.kind, w.returning, w.wait > 0])]);
        if (signature === this.drawSignature && this.drawnMaze === s.maze) return;
        this.drawSignature = signature;
        this.paintBoard();
        g.clear();
        g.lineStyle(2, this.glow ? 0xffdf88 : 0x36666a); g.strokeRoundedRect(4, 4, 352, 632, 15);
        s.wisps.forEach(w => {
            if (!visible(s.journey, index(s.hero), index(w))) return;
            const x = left + (w.x + 0.5) * size, y = top + (w.y + 0.5) * size;
            wispArt(g, w, x, y, s.vulnerable > 0, size);
        });
        const x = left + (s.hero.x + 0.5) * size, y = top + (s.hero.y + 0.5) * size;
        this.hero.draw(g, x - 14, y - 14, 28);
        if (s.journey?.dark.includes(index(s.hero))) {
            for (let at = 0; at < WIDTH * HEIGHT; at++) if (!visible(s.journey, index(s.hero), at)) {
                g.fillStyle(0x080d19, 0.96); g.fillRect(left + at % WIDTH * size, top + Math.floor(at / WIDTH) * size, size, size);
            }
        }
        // Draw the revealed cells above darkness, including remote portal exits.
        if (this.engine.specialTicks > 0) {
            g.lineStyle(3, 0xffdf88, .8);
            for (const at of this.engine.lightPath) {
                const px = left + (at % WIDTH + .5) * size, py = top + (Math.floor(at / WIDTH) + .5) * size;
                g.strokeCircle(px, py, 4); this.hero.drawEffect(g, px - 10, py - 10, 20);
            }
        }
        const j = s.journey, shapes = { corridors: 'Couloirs', rooms: 'Salles reliées', ring: 'Anneau', spiral: 'Spirale', mirror: 'Miroir' };
        // Name what this board really holds (see lessons.ts).
        const lesson = dedaleLesson(this.engine.level);
        this.title?.setText(`${j ? shapes[j.shape].toLocaleUpperCase('fr') : 'DÉDALE'} · ${['ÉVEIL', 'SENTIERS', 'PASSAGES', 'REFLETS', 'OMBRES', 'AURORE'][Math.floor(this.engine.level / 5)] ?? ''}`);
        this.hud?.setText(`DÉDALE ${String(this.engine.level + 1)} · ${j ? shapes[j.shape] : ''} · VIES ${'◆'.repeat(s.lives)}\nLUEUR ${String(this.engine.specialUses)}/1 · ${(this.engine.specialTicks / 60).toFixed(1)} s\nSCORE ${String(s.score)} · LUMIÈRES ${String(s.seeds.length + s.suns.length)}\n${j?.remaining ? `DÉFI · ${String(Math.ceil(j.remaining / 1000))} s` : [5, 10, 16, 21, 26].includes(this.engine.level) ? 'RESPIRATION · soleils de 12 secondes' : s.vulnerable > 0 ? `SOLEIL ${(s.vulnerable / 1000).toFixed(1)} s` : 'Les follets vous cherchent'}\n${lesson}\n${this.engine.level === 29 ? 'FINAL · toutes les mécaniques réunies' : matchMedia(MOBILE_PLAY).matches ? 'Glisser pour tourner' : 'Flèches / ZQSD · glisser pour tourner'}`);
        // Lueur's ring: its remaining light while lit, full while available.
        const lueur = document.querySelector<HTMLElement>('#dedale-special'), ring = (this.engine.specialTicks > 0 ? Math.min(1, this.engine.specialTicks / LUEUR_TICKS) : this.engine.specialUses > 0 ? 1 : 0).toFixed(2);
        if (lueur && lueur.dataset.ring !== ring) { lueur.dataset.ring = ring; lueur.style.setProperty('--ring', ring); }
        const status = document.querySelector('#status');
        if (status) status.textContent = `Score : ${String(s.score)} · Vies : ${String(s.lives)} · ${this.engine.status === 'playing' ? 'En jeu' : this.engine.status === 'won' ? 'Victoire' : 'Défaite'}`;
    }
}
