import { fingerProof } from './finger';
import { fingerReceipts } from '../finger-receipts';
import Phaser from 'phaser';
import { pullRecords } from '../../engines/caisses/records';
import { GameCharacter } from '../../characters/game';
import { Engine, LEVELS, type Direction } from '../../engines/caisses/engine';
import { doorOpen, pull, directions, type Position } from '../../engines/caisses/rules';
import { workshopTip } from '../../engines/caisses/tips';
import { Inputs, renderTouchControls, directionalSwipe, type TouchButton } from '../../shell/input';
import { PlaySession } from '../../shell/pause';
import { Progression } from '../../shell/progression';
import { browserStorage, readSave, writeSave } from '../../shell/storage';
import { renderPanels } from '../../shell/panels';
import { renderLevels } from '../../shell/levels';
import { sound } from '../../shell/services';
import { crate, hudVeil, worldOf, SceneryLayer } from '../universal/art';
import { CRATE_TEXTURE, DRAWN_CRATE, boxPaint, cellMarks, crateTone, paintCrate, workshopLayout, workshopScenery, type CrateTone } from './art';
export const caissesButtons: readonly TouchButton[] = [
    // Moves are swipes on the board; Annuler always shows, Tirer only next to a pullable crate.
    { id: 'caisses-undo', label: '↶', ariaLabel: 'Annuler', size: 56, placement: 'left', mode: 'tap' },
    { id: 'caisses-special', label: 'Tirer', ariaLabel: 'Tirer une caisse', size: 56, placement: 'right', mode: 'tap' },
];
export interface CaissesHook {
    performance(): { frames: number; gameMs: number };
    advance(ms: number): void;
    bounds(): { hero: { x: number; y: number; width: number; height: number } };
    fingerReceipts: ReturnType<typeof fingerReceipts>;
    read(): ReturnType<Engine['snapshot']> & { fingerInput: { paused: boolean; pulling: boolean; down: boolean }; cumulativeScore: number; progression: string; character: ReturnType<GameCharacter['snapshot']> };
    loadLevel(index: number, seed?: number): void;
    hudText(): string;
    usefulArea(): { x: number; y: number; width: number; height: number };
    scenario(name: 'finish' | 'corner'): void;
    /** Tone and drawing of every crate on screen: `wood|red|home/drawn` once David's crate is loaded, `/vector` before. */
    crateViews(): string[];
}
declare global { interface Window { __CAISSES_TEST__?: CaissesHook } }
export class CaissesScene extends Phaser.Scene {
    private engine = new Engine();
    private hero = new GameCharacter();
    private progress = new Progression(readSave(browserStorage(), 'caisses', 30), 30);
    private inputs = new Inputs();
    private selecting = false;
    private testManual = false;
    private pulling = false;
    private down = false;
    private heroBounds = { x: 0, y: 0, width: 0, height: 0 };
    private graphics?: Phaser.GameObjects.Graphics;
    /** The character, above the crates: it stands a head taller than its cell. */
    private top?: Phaser.GameObjects.Graphics;
    /** David's crate (06/11), one image per crate on screen, once its chunk has arrived; the vector crate until then. */
    private crates: Phaser.GameObjects.Image[] = [];
    private drawnCrate = false;
    private crateViews: string[] = [];
    /** Static scenery layer, repainted only when its key changes (level, board): software rendering stays fast. */
    private scenery?: SceneryLayer;
    private hud?: Phaser.GameObjects.Text;
    constructor(private session = new PlaySession(false)) { super('caisses'); }
    private panels(): void { renderPanels(this.engine.status, this.progress.state, this.engine.level, this.engine.state.score, this.progress.total, this.selecting); }
    private start(index: number, seed?: number, fresh = false): void {
        this.pulling = false; this.progress.start(index, fresh); this.engine.loadLevel(index, seed); this.selecting = false; this.sync();
    }
    create(): void {
        const receipts = fingerReceipts(this.inputs);
        document.body.classList.add('caisses');
        const cleanup = (): void => { this.inputs.dispose(); document.body.classList.remove('caisses'); delete window.__CAISSES_TEST__; sound.stop(); };
        this.events.once('shutdown', cleanup); this.events.once('destroy', cleanup);
        this.scenery = new SceneryLayer(this, 'caisses');
        this.graphics = this.add.graphics();
        this.top = this.add.graphics().setDepth(2);
        this.hud = this.add.text(12, 20, '', { fontFamily: 'system-ui', fontSize: '14px', color: '#e5f3ff', lineSpacing: 6 }).setDepth(3);
        this.crates = []; this.drawnCrate = false;
        // David's crate arrives in its own chunk, like Pistouille's drawings: baked once per tone, the vector crate until then.
        void import('./crate-atlas').then(({ crate }) => {
            if (!this.sys.isActive() || !crate) return;
            if (!this.textures.exists(CRATE_TEXTURE)) this.load.image(CRATE_TEXTURE, crate);
            this.load.once('complete', () => {
                if (!this.sys.isActive() || !this.textures.exists(CRATE_TEXTURE)) return;
                const source = this.textures.get(CRATE_TEXTURE).getSourceImage() as CanvasImageSource;
                for (const tone of ['wood', 'red', 'home'] as const) {
                    const key = `${CRATE_TEXTURE}-${tone}`; if (this.textures.exists(key)) continue;
                    const texture = this.textures.createCanvas(key, DRAWN_CRATE.w, DRAWN_CRATE.h);
                    if (texture) { paintCrate(texture.context, source, tone); texture.refresh(); }
                }
                this.drawnCrate = true; this.draw();
            });
            this.load.start();
        }).catch(() => undefined);
        const action = (d: Direction | 'undo' | 'special'): void => {
            if (this.session.paused || this.selecting) return;
            if (d === 'special') {
                // One crate within reach: pull it at once. Several: the next swipe picks one.
                const reach = this.pullable();
                if (reach.length === 1 && reach[0]) { this.pulling = false; this.step(reach[0], true); }
                else this.pulling = reach.length > 0 && !this.pulling;
            } else if (d === 'undo') {
                if (this.engine.status !== 'playing') this.progress.retry();
                this.engine.undo(); sound.playEffect('undo');
            } else {
                // While pulling, a swipe toward the crate or away from it both mean that crate.
                const reverse = ({ up: 'down', down: 'up', left: 'right', right: 'left' } as const)[d];
                const pulled = this.pulling ? this.pullable().find(p => p === d || p === reverse) : undefined;
                this.step(pulled ?? d, pulled !== undefined); this.pulling = false;
            }
            this.sync();
        };
        renderTouchControls(this.inputs, caissesButtons, (id, held) => { if (held) action(id.replace('caisses-', '') as Direction | 'undo' | 'special'); });
        const area = document.querySelector<HTMLElement>('#game');
        if (area) {
            directionalSwipe(this.inputs, area, action, 20, false);
            // A finger on the board (the swipe origin), for the touch proof.
            this.inputs.on(area, 'pointerdown', () => { this.down = true; });
            for (const type of ['pointerup', 'pointercancel']) this.inputs.on(area, type, () => { this.down = false; });
        }
        const keys: Record<string, Direction> = { ArrowUp: 'up', KeyW: 'up', ArrowDown: 'down', KeyS: 'down', ArrowLeft: 'left', KeyQ: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right' };
        const retry = (): void => { this.pulling = false; this.progress.retry(); this.engine.loadLevel(this.engine.level, this.engine.seed); this.sync(); };
        this.inputs.on(document, 'keydown', event => {
            const e = event as KeyboardEvent;
            if (e.repeat || this.session.paused || this.selecting) return;
            if (e.code === 'Space') { e.preventDefault(); action('special'); }
            else if (e.code === 'KeyR') { e.preventDefault(); retry(); }
            else if (e.code === 'Backspace' || e.code === 'KeyZ') { e.preventDefault(); action(e.code === 'KeyZ' && e.shiftKey ? 'up' : 'undo'); }
            else if (keys[e.code]) { e.preventDefault(); action(keys[e.code] ?? 'up'); }
        });
        const choose = (): void => { this.selecting = !this.selecting; renderLevels(LEVELS, this.progress.save, index => { this.start(index, undefined, true); }); this.panels(); };
        for (const id of ['levels', 'result-levels', 'close-levels']) this.inputs.on(document.querySelector(`#${id}`), 'click', choose);
        this.inputs.on(document.querySelector('#next-level'), 'click', () => { if (this.progress.state === 'won') this.start(this.engine.level + 1); });
        for (const id of ['retry-level', 'replay-level', 'restart']) this.inputs.on(document.querySelector(`#${id}`), 'click', retry);
        this.game.canvas.setAttribute('aria-label', 'Caisses : pousser les caisses dorées sur les cibles turquoise');
        if (new URLSearchParams(location.search).get('test') === '1') window.__CAISSES_TEST__ = {
            ...fingerProof,
            advance: ms => {
                if (!Number.isFinite(ms) || ms < 0) throw new RangeError('Temps invalide');
                this.testManual = true;
                const step = 1000 / 60;
                for (let i = 0; i < Math.ceil(ms / step); i++) this.tick(Math.min(step, ms - i * step));
            },
            bounds: () => ({ hero: { ...this.heroBounds } }),
            performance: () => ({ frames: this.game.loop.frame, gameMs: this.hero.time }),
            fingerReceipts: receipts,
            read: () => ({ fingerInput: { paused: this.session.paused, pulling: this.pulling, down: this.down }, ...this.engine.snapshot(), character: this.hero.snapshot(), cumulativeScore: this.progress.total, progression: this.progress.state }),
            loadLevel: (index, seed) => { this.start(index, seed, true); },
            hudText: () => this.hud?.text ?? '', crateViews: () => [...this.crateViews], usefulArea: () => ({ x: 0, y: 0, width: 360, height: 640 }),
            scenario: name => {
                this.start(0, 28, true);
                // Ordinary legal moves only; level one is already one approach step from its push.
                if (name === 'finish') action('right');
                else { this.engine.loadPuzzle('######\n# $@ #\n# .  #\n######'); this.sync(); }
            },
        };
        this.sync();
    }
    private pullable(): Direction[] {
        const s = this.engine.state, pos: Position = { player: s.player, boxes: s.boxes, colors: s.colors, filled: s.filled };
        if (this.engine.status !== 'playing' || this.engine.specialUses === 0) return [];
        return directions.filter(d => pull(this.engine.board, pos, d));
    }
    private step(d: Direction, pulling: boolean): void {
        const before = this.engine.state.pushes, position = this.engine.state.player;
        if (pulling) this.engine.special(d); else this.engine.input(d);
        if (position !== this.engine.state.player) this.hero.move(this.engine.state.player % this.engine.board.width - position % this.engine.board.width);
        else this.hero.impact = 350;
        sound.playEffect(this.engine.state.pushes > before ? 'push' : 'move');
        for (const event of this.engine.events) sound.playEffect(event);
    }
    updatePaused(): void { this.draw(); }
    update(_time: number, delta: number): void {
        this.tick(this.testManual ? 0 : delta);
    }
    private tick(delta: number): void {
        const paused = this.session.paused || this.selecting;
        if (!paused) this.engine.advance(delta);
        this.hero.advance(delta, paused, this.engine.status, this.engine.specialMs > 0);
        this.scale.refresh(); this.draw();
    }
    private sync(): void {
        if (this.engine.status !== 'playing' && this.progress.state === 'playing') {
            this.progress.finish(this.engine.status, this.engine.state.score); writeSave(browserStorage(), this.progress.save, 'caisses'); sound.playEffect(this.engine.status);
        }
        const special = document.querySelector<HTMLButtonElement>('#caisses-special');
        if (special) { const reach = this.pullable().length > 0; special.hidden = !reach; special.setAttribute('aria-pressed', String(reach && this.pulling)); if (!reach) this.pulling = false; }
        this.panels(); this.draw();
    }
    /** Shows crate image `index` of the pool, centred at (x, y), `size` wide. */
    private crate(index: number, tone: CrateTone, x: number, y: number, size: number): void {
        const key = `${CRATE_TEXTURE}-${tone}`;
        let image = this.crates[index];
        if (!image) { image = this.add.image(x, y, key).setDepth(1); this.crates[index] = image; }
        if (image.texture.key !== key) image.setTexture(key);
        image.setPosition(x, y).setDisplaySize(size, size * DRAWN_CRATE.h / DRAWN_CRATE.w).setVisible(true);
    }
    private draw(): void {
        const g = this.graphics; if (!g) return;
        this.hero.advance(0, this.session.paused || this.selecting, this.engine.status, this.engine.specialMs > 0);
        const b = this.engine.board, s = this.engine.state;
        const world = worldOf(this.engine.level), time = matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : this.time.now / 1000;
        g.clear(); this.top?.clear();
        const { unit, ox, oy } = workshopLayout(b);
        let shown = 0; this.crateViews = [];
        const layer = this.scenery, sg = layer?.g;
        if (layer && sg && layer.stale(b)) {
            workshopScenery(sg, world, b); hudVeil(sg, world, 6, 12, 348, 116);
            layer.commit();
        }
        const open = doorOpen(b, { player: s.player, boxes: s.boxes, colors: s.colors, filled: s.filled });
        for (let p=0; p<b.width*b.height; p++) {
            const x=ox+p%b.width*unit, y=oy+Math.floor(p/b.width)*unit, cx = x+unit/2;
            cellMarks(g, b, s, p, x, y, unit, time, open);
            const box = s.boxes.indexOf(p);
            if (box >= 0) {
                const { home, color } = boxPaint(b, s, box, p);
                if (home) { g.fillStyle(0x64e4cc, .45); g.fillRoundedRect(x+1, y+1, unit-2, unit-2, unit*.2); }
                const tone: CrateTone = crateTone(b, s, box, p);
                if (this.drawnCrate) this.crate(shown++, tone, x + unit / 2, y + unit / 2, unit * .96);
                else crate(g, x+unit*.08, y+unit*.08, unit*.84, color);
                this.crateViews.push(`${tone}/${this.drawnCrate ? 'drawn' : 'vector'}`);
            }
            if (s.player===p) {
                // The character stands a head taller than its cell so it reads on a phone.
                const size = unit * 1.55, hx = x + (unit - size) / 2, hy = y + unit - size;
                g.fillStyle(0x000000, .25); g.fillEllipse(cx, y + unit * .9, unit * .7, unit * .2);
                this.heroBounds = { x: hx, y: hy, width: size, height: size };
            }
        }
        // Drawn after every tile: the raised character overlaps its neighbours instead of hiding under them.
        for (let i = shown; i < this.crates.length; i++) this.crates[i]?.setVisible(false);
        this.hero.draw(this.top ?? g, this.heroBounds.x, this.heroBounds.y, this.heroBounds.width);
        const left = this.engine.budgetLeft(), tip = this.engine.status === 'lost' ? 'Budget épuisé : annulez ↶ ou recommencez' : workshopTip(this.engine.level);
        const text = `CAISSES · ${String(this.engine.level+1)}/30 · ${LEVELS[this.engine.level]?.name ?? ''} · SCORE ${String(s.score)}\nPAS ${String(s.moves)}${left > 0 || this.engine.status === 'lost' ? ` (reste ${String(left)})` : ''} · POUSSÉES ${String(s.pushes)}\nTIRER ${String(this.engine.specialUses)}/1${this.pulling ? ' : direction ?' : ''}\nRecords sans/avec : ${String(LEVELS[this.engine.level]?.minimumPushes ?? 0)}/${String(pullRecords[this.engine.level]?.pushes ?? 0)} poussées${this.engine.snapshot().deadlocked ? '\nCoin bloqué : annulez ↶' : `\n${tip}`}`;
        this.hud?.setText(text);
        const status = document.querySelector('#status'); if (status) status.textContent = text;
    }
}
