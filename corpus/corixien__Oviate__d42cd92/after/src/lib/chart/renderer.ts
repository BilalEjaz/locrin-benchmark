import { activeZone, zonedParts, MONTHS, type Parts } from '../tz.ts';
import type { Candles } from './data';
import type { ChartType } from './transforms';
import type { PineResult, PlotOut } from '../pine/types';

const pad2 = (n: number) => String(n).padStart(2, '0');

export type DrawTool = 'cursor' | 'trend' | 'ray' | 'extline' | 'hray' | 'arrow' | 'hline' | 'vline' | 'crossline' | 'channel' | 'pitchfork'
  | 'arrowpath' | 'rect' | 'ellipse' | 'circle' | 'triangle' | 'fib' | 'fibext' | 'longpos' | 'shortpos' | 'measure' | 'pricerange' | 'daterange'
  | 'brush' | 'arrowup' | 'arrowdown' | 'text' | 'callout';
/** Toolbar groups (separated by a divider). */
export const DRAW_GROUPS: DrawTool[][] = [
  ['cursor'],
  ['trend', 'ray', 'extline', 'hray', 'arrow', 'arrowpath', 'hline', 'vline', 'crossline'],
  ['channel', 'pitchfork'],
  ['rect', 'ellipse', 'circle', 'triangle'],
  ['fib', 'fibext'],
  ['longpos', 'shortpos', 'measure', 'pricerange', 'daterange'],
  ['brush', 'arrowup', 'arrowdown', 'text', 'callout']
];
export const DRAW_TOOLS: DrawTool[] = DRAW_GROUPS.flat();
const POINTS: Record<DrawTool, number> = {
  cursor: 0, trend: 2, ray: 2, extline: 2, hray: 1, arrow: 2, arrowpath: 0, hline: 1, vline: 1, crossline: 1, channel: 3, pitchfork: 3,
  rect: 2, ellipse: 2, circle: 2, triangle: 3, fib: 2, fibext: 3, longpos: 3, shortpos: 3, measure: 2, pricerange: 2, daterange: 2,
  brush: 0, arrowup: 1, arrowdown: 1, text: 1, callout: 2
};

export interface DrawPt { t: number; p: number }
export interface TradeMark { t: number; price: number; side: 'buy' | 'sell'; text?: string }
/** Strategy trade drawn as an entry-to-exit box (green = win, red = loss). */
export interface TradeBox { t0: number; t1: number; p0: number; p1: number; win: boolean; text: string; open: boolean }
export interface PriceLine { price: number; color: string; label: string; dash?: boolean }

/** Economic calendar events on one bar: titles (with time), strongest impact. */
export interface CalMark { t: number; ids: string[]; titles: string[]; impact: 'high' | 'medium' | 'low'; /** macro | earnings | dividend | split | ipo of the first event */ kind: string }
export interface NewsMark { t: number; ids: string[]; titles: string[] }

export interface Drawing { id: string; type: DrawTool; pts: DrawPt[]; color: string; text?: string; sym?: string }

export interface Theme {
  up: string; down: string; upBody: string; upBorder: string; upWick: string; downBody: string; downBorder: string; downWick: string; grid: string; text: string; textStrong: string;
  accent: string; cross: string; axisBg: string; panel: string;
}

export interface ActiveIndicator { id: string; title: string; overlay: boolean; result: PineResult }

export interface RenderState {
  data: Candles;
  raw: Candles;
  type: ChartType;
  step: number;
  indicators: ActiveIndicator[];
  drawings: Drawing[];
  theme: Theme;
  log: boolean;
  volume: boolean;
  grid: boolean;
  magnet: boolean;
  tool: DrawTool;
  news: NewsMark[];
  calendar: CalMark[];
  trades: TradeMark[];
  boxes: TradeBox[];
  lines: PriceLine[];
}

export interface Hooks {
  onHover(idx: number | null, t: number | null, yFrac: number | null): void;
  onViewChange(): void;
  onNeedHistory(): void;
  onDrawings(d: Drawing[]): void;
  onToolDone(): void;
  onSelect(id: string | null): void;
  onNewsClick(mark: NewsMark): void;
  onCalClick(mark: CalMark): void;
  /** Open the inline text editor at a screen position (px, relative to the chart). */
  onEditText(id: string, x: number, y: number, text: string): void;
  /** Replay start chosen: time of the bar that stays the last visible one. */
  onReplayPick(t: number): void;
}

const AXIS_W = 66, TIME_H = 26;
const FIB = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1];
const FIBX = [0, 0.382, 0.618, 1, 1.272, 1.618, 2.618];
const BAR_MIN = 0.03, BAR_MAX = 80;
/** Empty bars allowed to the right of the newest candle (hard stop). */
const RIGHT_PAD = 10;

export function fmtPrice(p: number): string {
  const a = Math.abs(p);
  return p.toFixed(a >= 1 ? 2 : a >= 0.1 ? 4 : 6);
}

/** Charts that are on screen: with sync on they follow each other's time window and crosshair in the same frame (no reactive round trip). */
const live = new Set<ChartRenderer>();
if (import.meta.env?.DEV) (globalThis as Record<string, unknown>).__ovLive = live; // dev only: lets browser tests read the charts
/**
 * With sync on, one chart leads (the one the user touched last) and the others take over its view every frame:
 * the same time window, and a price range scaled to their own last close so the last-price line sits at the same height everywhere.
 */
export const chartSync: { on: boolean; leader: ChartRenderer | null; last: SyncView | null } = { on: true, leader: null, last: null };
/** `end`: the leader shows its newest bars at the right stop, so followers do the same (their own right padding, whatever their bar step) */
interface SyncView { l: number; r: number; rlo: number; rhi: number; /** seconds of empty space right of the leader's newest bar */ gap: number }
export function setChartSync(on: boolean) {
  chartSync.on = on;
  if (on) return;
  for (const c of live) { c.setExternal(null, null); c.releaseFollow(); }
}

interface Pane { kind: 'main' | 'sub'; y0: number; y1: number; ind?: ActiveIndicator; lo: number; hi: number }

export class ChartRenderer {
  start = 0;
  barW = 9;
  s!: RenderState;
  manual: { lo: number; hi: number } | null = null;
  selected: string | null = null;
  externalT: number | null = null;
  externalY: number | null = null;
  private hoverNews: NewsMark | null = null;
  private hoverCal: CalMark | null = null;
  /** markers that fit on screen right now (see declutter) */
  private shownNews: NewsMark[] = [];
  private shownCal: CalMark[] = [];
  /** Drawing whose text is being edited in the HTML overlay (not painted on the canvas meanwhile). */
  editingId: string | null = null;
  /** Replay start selection: a scissors line follows the cursor, a click picks the bar. */
  replayPick = false;
  /** Wheel animation target: wheel input moves this, a rAF loop eases the view toward it. */
  private tgt: null | { start: number; barW: number; a: number; span: number; zoomT: boolean; ax: number; aIdx: number; price: boolean; pZoom: boolean; pFrac: number; pAnchor: number } = null;
  private animRaf = 0; private lastAnim = 0;
  /** Eased auto price range (glides instead of jumping while bars enter or leave the view). */
  private autoSm: { lo: number; hi: number } | null = null;
  private easing = false; private easeT = 0;
  private range: { key: Float64Array | null; n: number; lo: number; hi: number } = { key: null, n: -1, lo: 0, hi: 1 };

  private ctx: CanvasRenderingContext2D;
  private octx: CanvasRenderingContext2D;
  private w = 0; private h = 0; private dpr = 1;
  private plotW = 0;
  private panes: Pane[] = [];
  private raf = 0; private oraf = 0;
  private mx = -1; private my = -1;
  private draft: Drawing | null = null;
  private drag: null | { kind: 'pan' | 'paxis' | 'taxis' | 'move' | 'point' | 'brush'; idx?: number; moved?: boolean; x: number; y: number; lo?: number; hi?: number; s0?: number; orig?: DrawPt[] } = null;
  private cleanup: Array<() => void> = [];

  constructor(private main: HTMLCanvasElement, private over: HTMLCanvasElement, private hooks: Hooks, s: RenderState) {
    this.ctx = main.getContext('2d')!;
    this.octx = over.getContext('2d')!;
    this.s = s;
    live.add(this);
    this.bind();
  }

  private select(id: string | null) {
    if (this.selected === id) return;
    this.selected = id;
    this.hooks.onSelect(id);
  }

  // ---------- public ----------
  setState(patch: Partial<RenderState>) {
    this.s = { ...this.s, ...patch };
    if (patch.tool && patch.tool !== 'cursor') this.select(null);
    if (patch.tool === 'cursor') this.draft = null;
    this.invalidate();
  }

  private pendingReset = false;

  resize(w: number, h: number) {
    this.dpr = window.devicePixelRatio || 1;
    // a narrower / wider chart keeps the bar width and the newest bars at the right edge (the left side gives or gains room)
    if (this.w > 100 && w > 100 && w !== this.w && !this.pendingReset) {
      this.start += (this.w - w) / this.barW;
      if (this.tgt) { this.tgt.start += (this.w - w) / this.barW; this.tgt.zoomT = false; }
      this.clampStart();
    }
    this.w = w; this.h = h;
    // assigning a canvas size clears it: only when it changed, and repaint in the same task so no blank frame is shown (that was the flicker while resizing)
    for (const c of [this.main, this.over]) {
      const cw = Math.round(w * this.dpr), ch = Math.round(h * this.dpr);
      if (c.width !== cw) c.width = cw;
      if (c.height !== ch) c.height = ch;
    }
    if (this.pendingReset && w > 100) { this.pendingReset = false; if (!this.followLeader()) { this.resetView(); if (!chartSync.leader) chartSync.leader = this; } }
    else if (chartSync.on && chartSync.last && chartSync.leader && chartSync.leader !== this && live.has(this)) this.applyView(chartSync.last); // synced charts of a new size show the leader's time window again
    this.drawNow();
  }

  /** Visible time window [left, right] in unix seconds. */
  getTimeRange(): [number, number] {
    const bars = (this.w - AXIS_W) / this.barW;
    return [this.idxToTime(this.start - 0.5), this.idxToTime(this.start - 0.5 + bars)];
  }

  /** The user (or a reset / replay step) changed this chart's view: it leads from now on, and the other charts follow in its next draw. */
  viewChanged() {
    chartSync.leader = this;
    this.hooks.onViewChange();
    this.invalidate();
  }

  private followed = false;

  /** Hand the chart back to its own auto scale (sync was switched off). */
  releaseFollow() {
    if (!this.followed) return;
    this.followed = false; this.manual = null; this.autoSm = null;
    this.invalidate();
  }

  /** Take over the leader's view: same dates at the left and right edge (clamped to this chart's own scroll limits) and its price range in multiples of the last close. */
  private applyView(v: SyncView) {
    const d = this.s.data;
    if (this.w < 100 || !d.n || v.r <= v.l) return;
    const plot = this.w - AXIS_W;
    this.tgt = null;
    // exactly the leader's dates at the left and right edge (the span is measured in this chart's own bars, so gaps such as weekends do not skew it);
    // only if that would leave more empty space at the right than RIGHT_PAD bars (this chart's data ends much earlier) it is pulled back, and the chart's own scroll limits always hold
    const l = this.timeToIdx(v.l), r = this.timeToIdx(v.r);
    this.barW = Math.min(Math.max(plot / Math.max(r - l, 1e-6), BAR_MIN), BAR_MAX);
    this.start = this.clampStartV(l + 0.5, this.barW);
    const c = d.c[d.n - 1];
    if (c > 0 && Number.isFinite(v.rlo) && Number.isFinite(v.rhi) && v.rhi > v.rlo) {
      this.manual = { lo: v.rlo * c, hi: v.rhi * c };
      this.autoSm = null; this.followed = true;
    }
    this.checkHistory();
    this.drawNow();
  }

  /** The leader's current view, computed after its ranges are known (end of its draw). */
  private pushView() {
    const d = this.s.data, m = this.panes[0];
    if (!d.n || !m) return;
    const c = d.c[d.n - 1];
    const [l, r] = this.getTimeRange();
    const view: SyncView = { l, r, rlo: c > 0 ? m.lo / c : NaN, rhi: c > 0 ? m.hi / c : NaN, gap: (this.start + (this.w - AXIS_W) / this.barW - d.n) * this.s.step };
    chartSync.last = view;
    for (const p of live) if (p !== this) p.applyView(view);
  }

  /** Join the leader's view (a chart that just loaded, or came back from an empty state). False when there is nothing to follow. */
  followLeader(): boolean {
    if (!chartSync.on || !chartSync.last || !chartSync.leader || chartSync.leader === this) return false;
    this.applyView(chartSync.last);
    return true;
  }

  /** Crosshair of another chart: time of its hovered bar and the height as a fraction of its main pane. */
  setExternal(t: number | null, y: number | null) {
    if (this.externalT === t && this.externalY === y) return;
    this.externalT = t; this.externalY = y;
    this.invalidateOver();
  }

  private broadcastCross(t: number | null, y: number | null) {
    if (!chartSync.on) return;
    for (const p of live) if (p !== this) p.setExternal(t, y);
  }

  resetView(bars = 120) {
    if (this.w < 100) { this.pendingReset = true; return; }
    this.tgt = null;
    this.barW = Math.max(2, Math.min(40, (this.w - AXIS_W) / bars));
    this.start = Math.max(-5, this.s.data.n + RIGHT_PAD - (this.w - AXIS_W) / this.barW);
    this.manual = null;
    this.autoSm = null;
    this.drawNow();
  }

  scrollToEnd() {
    this.tgt = null;
    const vis = (this.w - AXIS_W) / this.barW;
    this.start = this.s.data.n + RIGHT_PAD - vis;
    this.viewChanged();
  }

  /** History was prepended: keep the view (and any running wheel animation) on the same bars. */
  shiftIndex(added: number) {
    this.start += added;
    if (this.tgt) { this.tgt.start += added; this.tgt.aIdx += added; }
    if (this.drag?.kind === 'pan' && this.drag.s0 !== undefined) this.drag.s0 += added;
  }

  visible(): [number, number] {
    const n = this.s.data.n;
    return [Math.max(0, Math.floor(this.start)), Math.min(n - 1, Math.ceil(this.start + (this.w - AXIS_W) / this.barW))];
  }

  invalidate() {
    if (this.raf) return;
    this.raf = requestAnimationFrame(() => { this.raf = 0; this.draw(); this.drawOver(); });
  }
  private invalidateOver() {
    if (this.oraf || this.raf) return;
    this.oraf = requestAnimationFrame(() => { this.oraf = 0; this.drawOver(); });
  }

  destroy() {
    live.delete(this);
    if (chartSync.leader === this) chartSync.leader = null;
    if (live.size === 1) for (const c of live) c.releaseFollow(); // a single chart scales itself again
    cancelAnimationFrame(this.raf); cancelAnimationFrame(this.oraf); cancelAnimationFrame(this.animRaf);
    this.cleanup.forEach((f) => f());
  }

  // ---------- coordinates ----------
  private xOf(i: number) { return (i - this.start) * this.barW + this.barW / 2; }
  private idxOf(x: number) { return (x - this.barW / 2) / this.barW + this.start; }

  private timeToIdx(t: number): number {
    const { t: ts, n } = this.s.data;
    if (!n) return 0;
    if (t <= ts[0]) return (t - ts[0]) / this.s.step;
    if (t >= ts[n - 1]) return n - 1 + (t - ts[n - 1]) / this.s.step;
    let lo = 0, hi = n - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (ts[m] <= t) lo = m; else hi = m; }
    return lo + (t - ts[lo]) / Math.max(1, ts[hi] - ts[lo]);
  }
  private idxToTime(i: number): number {
    const { t: ts, n } = this.s.data;
    if (!n) return 0;
    if (i <= 0) return ts[0] + i * this.s.step;
    if (i >= n - 1) return ts[n - 1] + (i - (n - 1)) * this.s.step;
    const lo = Math.floor(i);
    return ts[lo] + (ts[lo + 1] - ts[lo]) * (i - lo);
  }
  private tx(v: number) { return this.s.log ? Math.log(Math.max(v, 1e-9)) : v; }
  private main_(): Pane { return this.panes[0]; }
  private py(p: number, pane = this.main_()) {
    const a = pane.kind === 'main' ? this.tx(pane.lo) : pane.lo, b = pane.kind === 'main' ? this.tx(pane.hi) : pane.hi;
    const v = pane.kind === 'main' ? this.tx(p) : p;
    return pane.y1 - ((v - a) / (b - a || 1)) * (pane.y1 - pane.y0);
  }
  private priceOf(y: number, pane = this.main_()) {
    const a = this.tx(pane.lo), b = this.tx(pane.hi);
    const v = a + ((pane.y1 - y) / (pane.y1 - pane.y0 || 1)) * (b - a);
    return this.s.log ? Math.exp(v) : v;
  }
  private paneAt(y: number) { return this.panes.find((p) => y >= p.y0 && y <= p.y1); }

  // ---------- layout ----------
  private layout() {
    const subs = this.s.indicators.filter((i) => !i.overlay);
    const total = this.h - TIME_H;
    const subH = subs.length ? Math.min(total * 0.22, 150) : 0;
    const mainH = total - subH * subs.length;
    this.panes = [{ kind: 'main', y0: 6, y1: mainH - 4, lo: 0, hi: 1 }];
    subs.forEach((ind, k) => {
      this.panes.push({ kind: 'sub', ind, y0: mainH + subH * k + 4, y1: mainH + subH * (k + 1) - 4, lo: 0, hi: 1 });
    });
    this.plotW = this.w - AXIS_W;
  }

  private computeRanges() {
    let [a, b] = this.visible();
    const d = this.s.data;
    const m = this.panes[0];
    // Few bars on screen (view moved into the empty future): fit the last bars so the scale stays put.
    const minBars = Math.max(30, Math.ceil(((this.w - AXIS_W) / this.barW) * 0.3));
    if (b - a + 1 < minBars) a = Math.max(0, b - minBars + 1);
    let lo = Infinity, hi = -Infinity;
    for (let i = a; i <= b; i++) {
      if (this.s.type === 'line' || this.s.type === 'area' || this.s.type === 'baseline') {
        lo = Math.min(lo, d.c[i]); hi = Math.max(hi, d.c[i]);
      } else { lo = Math.min(lo, d.l[i]); hi = Math.max(hi, d.h[i]); }
    }
    if (!Number.isFinite(lo)) { lo = 0; hi = 1; }
    const pad = (hi - lo) * 0.1 || Math.abs(hi) * 0.01 || 1;
    const tl = lo - pad, th = hi + pad + (this.s.volume ? (hi - lo) * 0.12 : 0);
    if (this.manual) { m.lo = this.manual.lo; m.hi = this.manual.hi; this.autoSm = null; }
    else {
      const now = performance.now();
      if (this.easing && this.autoSm) {
        const k = 1 - Math.exp(-Math.min(50, now - this.easeT) / 90);
        const c = this.autoSm, sp = Math.max(c.hi - c.lo, 1e-12);
        c.lo += (tl - c.lo) * k; c.hi += (th - c.hi) * k;
        if (Math.abs(tl - c.lo) < sp * 0.002 && Math.abs(th - c.hi) < sp * 0.002) {
          c.lo = tl; c.hi = th;
          if (!this.drag && !this.tgt) this.easing = false;
        } else this.invalidate();
      } else this.autoSm = { lo: tl, hi: th };
      this.easeT = now;
      m.lo = this.autoSm!.lo; m.hi = this.autoSm!.hi;
    }
    if (this.s.log && m.lo <= 0) m.lo = Math.max(1e-6, lo * 0.9);
    for (const p of this.panes.slice(1)) {
      const r = p.ind!.result;
      let l = Infinity, h = -Infinity;
      for (const pl of r.plots) {
        const base = pl.style === 'histogram' || pl.style === 'columns' || pl.style === 'area' || pl.style === 'areabr';
        if (base) { l = Math.min(l, pl.histbase); h = Math.max(h, pl.histbase); }
        for (let j = a; j <= b + 1; j++) {
          const v = pl.values[j - pl.offset];
          if (v === undefined || Number.isNaN(v)) continue;
          if (v < l) l = v; if (v > h) h = v;
        }
      }
      for (const hl of r.hlines) { l = Math.min(l, hl.price); h = Math.max(h, hl.price); }
      if (!Number.isFinite(l)) { l = 0; h = 1; }
      const pd = (h - l) * 0.1 || 1;
      p.lo = l - pd; p.hi = h + pd;
    }
  }

  // ---------- drawing ----------
  /** Hold-and-drag: place the view from the latest cursor position, once per frame, 1:1 with the cursor. */
  private applyPan() {
    const d = this.drag;
    if (!d || d.kind !== 'pan' || this.mx < 0) return;
    const dx = Math.round(this.mx - d.x), dy = Math.round(this.my - d.y);
    this.start = this.clampStartV(d.s0! - dx / this.barW, this.barW);
    if (dy !== 0) {
      const m = this.panes[0]; const a0 = this.tx(d.lo!), b0 = this.tx(d.hi!);
      const shift = (dy / (m.y1 - m.y0)) * (b0 - a0);
      this.manual = { lo: this.itx(a0 + shift), hi: this.itx(b0 + shift) };
    } else if (this.manual) this.manual = { lo: d.lo!, hi: d.hi! };
    this.checkHistory();
    this.viewChanged();
  }

  get dragging() { return this.drag?.kind === 'pan'; }

  private draw() {
    this.applyPan();
    const { ctx, w, h, dpr } = this;
    const { theme, data } = this.s;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    if (w < 80 || h < 80) return;
    this.layout();
    this.computeRanges();
    if (chartSync.on && chartSync.leader === this && live.size > 1) this.pushView();
    const [a, b] = this.visible();
    ctx.font = '11px ui-monospace, "JetBrains Mono", monospace';
    ctx.textBaseline = 'middle';

    this.drawGrid();
    if (data.n) {
      ctx.save();
      ctx.beginPath(); ctx.rect(0, 0, this.plotW, this.panes[0].y1 + 4); ctx.clip();
      if (this.s.volume) this.drawVolume(a, b);
      this.drawSeries(a, b);
      this.drawOverlays(a, b);
      this.drawBoxes();
      this.drawDrawings();
      this.drawLines();
      this.drawTrades();
      this.shownNews = this.declutter(this.s.news, (m) => this.newsPos(m).x, (m) => m.ids.length);
      this.shownCal = this.declutter(this.s.calendar, (m) => this.calPos(m).x, (m) => ({ high: 3, medium: 2, low: 1 } as Record<string, number>)[m.impact] * 1000 + m.titles.length);
      this.drawNews();
      this.drawCalendar();
      ctx.restore();
      for (const p of this.panes.slice(1)) this.drawSub(p, a, b);
      this.drawLastPrice();
    }
    this.drawTimeAxis();
    void theme;
  }

  private drawGrid() {
    const { ctx } = this;
    const { theme } = this.s;
    ctx.strokeStyle = theme.grid; ctx.fillStyle = theme.text; ctx.lineWidth = 1;
    ctx.textAlign = 'left';
    for (const p of this.panes) {
      const rows = p.kind === 'main' ? Math.max(3, Math.floor((p.y1 - p.y0) / 70)) : 2;
      ctx.beginPath();
      for (let g = 0; g <= rows; g++) {
        const y = p.y0 + ((p.y1 - p.y0) * g) / rows;
        const yy = Math.round(y) + 0.5;
        if (this.s.grid) { ctx.moveTo(0, yy); ctx.lineTo(this.plotW, yy); }
        const val = p.kind === 'main' ? this.priceOf(y, p) : p.lo + ((p.y1 - y) / (p.y1 - p.y0)) * (p.hi - p.lo);
        ctx.fillText(p.kind === 'main' ? fmtPrice(val) : val.toFixed(Math.abs(val) < 10 ? 2 : 0), this.plotW + 8, yy);
      }
      ctx.stroke();
      // separator between panes
      ctx.strokeStyle = theme.cross; ctx.globalAlpha = 0.5;
      ctx.beginPath(); ctx.moveTo(0, p.y1 + 4.5); ctx.lineTo(this.w, p.y1 + 4.5); ctx.stroke();
      ctx.globalAlpha = 1; ctx.strokeStyle = theme.grid;
    }
    // vertical grid at time labels
    if (this.s.grid) {
      ctx.beginPath();
      for (const { x } of this.timeTicks()) { ctx.moveTo(Math.round(x) + 0.5, 0); ctx.lineTo(Math.round(x) + 0.5, this.h - TIME_H); }
      ctx.stroke();
    }
    ctx.strokeStyle = theme.cross;
    ctx.beginPath(); ctx.moveTo(this.plotW + 0.5, 0); ctx.lineTo(this.plotW + 0.5, this.h - TIME_H); ctx.stroke();
  }

  private drawVolume(a: number, b: number) {
    const { ctx } = this; const d = this.s.data; const m = this.panes[0];
    let mx = 0;
    for (let i = a; i <= b; i++) mx = Math.max(mx, d.v[i]);
    if (!mx) return;
    const H = (m.y1 - m.y0) * 0.14;
    const bw = Math.max(1, Math.floor(this.barW * 0.72));
    for (const up of [true, false]) {
      ctx.fillStyle = (up ? this.s.theme.up : this.s.theme.down) + '55';
      ctx.beginPath();
      for (let i = a; i <= b; i++) {
        if ((d.c[i] >= d.o[i]) !== up) continue;
        const hh = (d.v[i] / mx) * H;
        ctx.rect(Math.round(this.xOf(i) - bw / 2), m.y1 - hh, bw, hh);
      }
      ctx.fill();
    }
  }

  private drawSeries(a: number, b: number) {
    const { ctx } = this; const d = this.s.data; const { theme, type } = this.s;
    const y = (p: number) => this.py(p);
    if (type === 'line' || type === 'area' || type === 'baseline') {
      const trace = () => { ctx.beginPath(); for (let i = a; i <= b; i++) { const X = this.xOf(i), Y = y(d.c[i]); i === a ? ctx.moveTo(X, Y) : ctx.lineTo(X, Y); } };
      if (type === 'baseline') {
        const base = d.c[a]; const by = y(base);
        for (const up of [true, false]) {
          ctx.save(); ctx.beginPath();
          ctx.rect(0, up ? 0 : by, this.plotW, up ? by : this.h); ctx.clip();
          ctx.strokeStyle = up ? theme.up : theme.down; ctx.lineWidth = 2; trace(); ctx.stroke(); ctx.restore();
        }
        ctx.strokeStyle = theme.cross; ctx.setLineDash([4, 4]); ctx.beginPath(); ctx.moveTo(0, by); ctx.lineTo(this.plotW, by); ctx.stroke(); ctx.setLineDash([]);
        return;
      }
      if (type === 'area') {
        trace(); ctx.lineTo(this.xOf(b), this.panes[0].y1); ctx.lineTo(this.xOf(a), this.panes[0].y1); ctx.closePath();
        ctx.fillStyle = theme.accent + '26'; ctx.fill();
      }
      ctx.strokeStyle = theme.accent; ctx.lineWidth = 2; ctx.lineJoin = 'round'; trace(); ctx.stroke(); ctx.lineWidth = 1;
      return;
    }
    const bw = Math.max(1, Math.floor(this.barW * 0.72)) | 1;
    if (type === 'bars') {
      for (const up of [true, false]) {
        ctx.strokeStyle = up ? theme.upWick : theme.downWick; ctx.beginPath();
        for (let i = a; i <= b; i++) {
          if ((d.c[i] >= d.o[i]) !== up) continue;
          const X = Math.round(this.xOf(i)) + 0.5, t = Math.max(2, this.barW * 0.3);
          ctx.moveTo(X, y(d.h[i])); ctx.lineTo(X, y(d.l[i]));
          ctx.moveTo(X - t, y(d.o[i])); ctx.lineTo(X, y(d.o[i]));
          ctx.moveTo(X, y(d.c[i])); ctx.lineTo(X + t, y(d.c[i]));
        }
        ctx.stroke();
      }
      return;
    }
    if (this.barW < 1.5 && type !== 'hollow') { this.drawDenseCandles(a, b); return; }
    for (const up of [true, false]) {
      const wick = up ? theme.upWick : theme.downWick, body = up ? theme.upBody : theme.downBody, border = up ? theme.upBorder : theme.downBorder;
      ctx.strokeStyle = wick;
      ctx.beginPath();
      for (let i = a; i <= b; i++) {
        if ((d.c[i] >= d.o[i]) !== up) continue;
        const X = Math.round(this.xOf(i)) + 0.5;
        ctx.moveTo(X, y(d.h[i])); ctx.lineTo(X, y(d.l[i]));
      }
      ctx.stroke();
      const hollow = type === 'hollow' && up;
      if (!hollow) {
        ctx.fillStyle = body; ctx.beginPath();
        for (let i = a; i <= b; i++) {
          if ((d.c[i] >= d.o[i]) !== up) continue;
          const yo = y(d.o[i]), yc = y(d.c[i]);
          ctx.rect(Math.round(this.xOf(i) - bw / 2), Math.min(yo, yc), bw, Math.max(1, Math.abs(yo - yc)));
        }
        ctx.fill();
      }
      if (bw >= 3) {
        ctx.strokeStyle = border; ctx.beginPath();
        for (let i = a; i <= b; i++) {
          if ((d.c[i] >= d.o[i]) !== up) continue;
          const yo = y(d.o[i]), yc = y(d.c[i]);
          ctx.rect(Math.round(this.xOf(i) - bw / 2) + 0.5, Math.min(yo, yc) + 0.5, bw - 1, Math.max(1, Math.abs(yo - yc)) - 1);
        }
        ctx.stroke();
      }
    }
  }

  /** Zoomed far out (more than one bar per pixel): one high-low line per pixel column instead of every candle. */
  private drawDenseCandles(a: number, b: number) {
    const { ctx } = this; const d = this.s.data; const { theme } = this.s;
    const cols: number[] = []; // x, high, low, up
    let cx = NaN, hi = 0, lo = 0, o = 0, c = 0;
    for (let i = a; i <= b; i++) {
      const X = Math.round(this.xOf(i));
      if (X !== cx) {
        if (cx === cx) cols.push(cx, hi, lo, c >= o ? 1 : 0);
        cx = X; hi = d.h[i]; lo = d.l[i]; o = d.o[i];
      } else { if (d.h[i] > hi) hi = d.h[i]; if (d.l[i] < lo) lo = d.l[i]; }
      c = d.c[i];
    }
    if (cx === cx) cols.push(cx, hi, lo, c >= o ? 1 : 0);
    for (const up of [1, 0]) {
      ctx.strokeStyle = up ? theme.upBody : theme.downBody; ctx.lineWidth = 1; ctx.beginPath();
      for (let k = 0; k < cols.length; k += 4) {
        if (cols[k + 3] !== up) continue;
        const X = cols[k] + 0.5;
        ctx.moveTo(X, this.py(cols[k + 1])); ctx.lineTo(X, this.py(cols[k + 2]));
      }
      ctx.stroke();
    }
  }

  // ---------- Pine indicator output ----------
  private pineRange(): [number, number] {
    return [Math.floor(this.start) - 1, Math.ceil(this.start + (this.w - AXIS_W) / this.barW) + 1];
  }

  private drawOverlays(_a: number, _b: number) {
    for (const ind of this.s.indicators) if (ind.overlay) this.drawPine(ind, this.panes[0]);
  }

  private drawSub(p: Pane, _a: number, _b: number) {
    const { ctx } = this;
    ctx.save(); ctx.beginPath(); ctx.rect(0, p.y0, this.plotW, p.y1 - p.y0); ctx.clip();
    this.drawPine(p.ind!, p);
    ctx.restore(); ctx.lineWidth = 1;
  }

  private drawPine(ind: ActiveIndicator, pane: Pane) {
    const { ctx } = this; const r = ind.result;
    if (r.error) return;
    const [a, b] = this.pineRange();
    const bw = Math.max(1, this.barW * 0.7);
    // background colors
    for (let j = Math.max(0, a); j <= b; j++) {
      const c = r.bgcolors[j];
      if (c) { ctx.fillStyle = c; ctx.fillRect(this.xOf(j) - this.barW / 2, pane.y0, this.barW, pane.y1 - pane.y0); }
    }
    // horizontal lines
    for (const hl of r.hlines) {
      const y = Math.round(this.py(hl.price, pane)) + 0.5;
      ctx.strokeStyle = hl.color; ctx.lineWidth = hl.linewidth; ctx.setLineDash(hl.style === 'solid' ? [] : hl.style === 'dotted' ? [2, 3] : [5, 4]);
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(this.plotW, y); ctx.stroke();
    }
    ctx.setLineDash([]);
    // fills between two plots / hlines
    for (const f of r.fills) {
      const va = (j: number) => (f.a.kind === 'hline' ? r.hlines[f.a.id]?.price ?? NaN : (r.plots[f.a.id]?.values[j - (r.plots[f.a.id]?.offset ?? 0)] ?? NaN));
      const vb = (j: number) => (f.b.kind === 'hline' ? r.hlines[f.b.id]?.price ?? NaN : (r.plots[f.b.id]?.values[j - (r.plots[f.b.id]?.offset ?? 0)] ?? NaN));
      let start = -1;
      const flush = (end: number) => {
        if (start < 0) return;
        ctx.beginPath();
        for (let j = start; j <= end; j++) ctx.lineTo(this.xOf(j), this.py(va(j), pane));
        for (let j = end; j >= start; j--) ctx.lineTo(this.xOf(j), this.py(vb(j), pane));
        ctx.closePath();
        ctx.fillStyle = f.colors?.[start] ?? f.color; ctx.fill();
        start = -1;
      };
      for (let j = Math.max(0, a); j <= b; j++) {
        const ok = !Number.isNaN(va(j)) && !Number.isNaN(vb(j));
        const cut = ok && start >= 0 && f.colors && f.colors[j] !== f.colors[start];
        if (cut) { flush(j - 1); }
        if (ok) { if (start < 0) start = j; } else flush(j - 1);
      }
      flush(b);
    }
    // plots
    for (const pl of r.plots) this.drawPlot(pl, pane, a, b, bw);
    this.drawShapes(r, pane, a, b);
  }

  private drawPlot(pl: PlotOut, pane: Pane, a: number, b: number, bw: number) {
    const { ctx } = this;
    const val = (j: number) => { const v = pl.values[j - pl.offset]; return v === undefined ? NaN : v; };
    const col = (j: number) => pl.colors?.[j - pl.offset] ?? pl.color;
    const lw = Math.max(1.3, pl.linewidth);
    const base = this.py(pl.histbase, pane);
    const lo = Math.max(0, a);
    if (pl.style === 'histogram' || pl.style === 'columns') {
      const w = pl.style === 'columns' ? bw : Math.max(1, this.barW * 0.25);
      for (let j = lo; j <= b; j++) {
        const v = val(j); if (Number.isNaN(v)) continue;
        const y = this.py(v, pane);
        ctx.fillStyle = col(j);
        ctx.fillRect(Math.round(this.xOf(j) - w / 2), Math.min(y, base), Math.max(1, w), Math.max(1, Math.abs(y - base)));
      }
      return;
    }
    if (pl.style === 'circles' || pl.style === 'cross') {
      for (let j = lo; j <= b; j++) {
        const v = val(j); if (Number.isNaN(v)) continue;
        const x = this.xOf(j), y = this.py(v, pane);
        ctx.fillStyle = ctx.strokeStyle = col(j);
        if (pl.style === 'circles') { ctx.beginPath(); ctx.arc(x, y, Math.max(1.5, lw), 0, 7); ctx.fill(); }
        else { ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(x - 3, y); ctx.lineTo(x + 3, y); ctx.moveTo(x, y - 3); ctx.lineTo(x, y + 3); ctx.stroke(); }
      }
      return;
    }
    if (pl.style === 'area' || pl.style === 'areabr') {
      let start = -1;
      const flush = (end: number) => {
        if (start < 0) return;
        ctx.beginPath(); ctx.moveTo(this.xOf(start), base);
        for (let j = start; j <= end; j++) ctx.lineTo(this.xOf(j), this.py(val(j), pane));
        ctx.lineTo(this.xOf(end), base); ctx.closePath();
        ctx.globalAlpha = 0.22; ctx.fillStyle = col(start); ctx.fill(); ctx.globalAlpha = 1;
        start = -1;
      };
      for (let j = lo; j <= b; j++) { if (Number.isNaN(val(j))) flush(j - 1); else if (start < 0) start = j; }
      flush(b);
    }
    // line / stepline / linebr / (area outline)
    let pen = false, curCol = '', py = 0, lastPx = NaN;
    const dense = this.barW < 1;
    ctx.lineWidth = lw; ctx.lineJoin = 'round';
    for (let j = lo; j <= b; j++) {
      const v = val(j);
      if (Number.isNaN(v)) { if (pen) ctx.stroke(); pen = false; continue; }
      const X = this.xOf(j);
      if (dense && pen) { const px = Math.round(X); if (px === lastPx) continue; lastPx = px; } else lastPx = Math.round(X); // more than one bar per pixel: one point per pixel column
      const Y = this.py(v, pane), c = col(j);
      if (!pen) { ctx.beginPath(); ctx.strokeStyle = c; ctx.moveTo(X, Y); pen = true; curCol = c; }
      else if (c !== curCol) { ctx.lineTo(X, Y); ctx.stroke(); ctx.beginPath(); ctx.strokeStyle = c; ctx.moveTo(X, Y); curCol = c; }
      else { if (pl.style === 'stepline') ctx.lineTo(X, py); ctx.lineTo(X, Y); }
      py = Y;
    }
    if (pen) ctx.stroke();
    ctx.lineWidth = 1;
  }

  private drawShapes(r: PineResult, pane: Pane, a: number, b: number) {
    const { ctx } = this; const d = this.s.data;
    if (this.barW < 1.2) return; // markers would only pile up
    const above = new Map<number, number>(), below = new Map<number, number>();
    const SZ: Record<string, number> = { auto: 6, tiny: 4, small: 6, normal: 8, large: 11, huge: 15 };
    for (const sh of r.shapes) {
      const s = SZ[sh.size] ?? 6;
      for (let j = Math.max(0, a); j <= b; j++) {
        const i = j - sh.offset;
        if (i < 0 || i >= sh.flags.length || !sh.flags[i]) continue;
        const col = sh.colors?.[i] ?? sh.color;
        const main = pane.kind === 'main';
        const hasBar = j >= 0 && j < d.n;
        let loc = sh.location;
        if (loc === 'absolute') loc = 'abovebar';
        let y: number;
        if (loc === 'top') y = pane.y0 + s + 4;
        else if (loc === 'bottom') y = pane.y1 - s - 4;
        else if (loc === 'belowbar') {
          const k = below.get(j) ?? 0; below.set(j, k + s * 2 + 3);
          y = (main && hasBar ? this.py(d.l[j], pane) : pane.y1 - 6) + s + 6 + k;
        } else {
          const k = above.get(j) ?? 0; above.set(j, k + s * 2 + 3);
          y = (main && hasBar ? this.py(d.h[j], pane) : pane.y0 + 6) - s - 6 - k;
        }
        this.drawShape(sh.style, this.xOf(j), y, s, col, sh.text, sh.textColor, loc === 'belowbar' || loc === 'bottom');
      }
    }
  }

  private drawShape(style: string, x: number, y: number, s: number, color: string, text: string, textColor: string, below: boolean) {
    const { ctx } = this;
    ctx.fillStyle = color; ctx.strokeStyle = color; ctx.lineWidth = 1.5;
    switch (style) {
      case 'triangleup': case 'arrowup': ctx.beginPath(); ctx.moveTo(x, y - s); ctx.lineTo(x + s, y + s); ctx.lineTo(x - s, y + s); ctx.closePath(); ctx.fill(); break;
      case 'triangledown': case 'arrowdown': ctx.beginPath(); ctx.moveTo(x, y + s); ctx.lineTo(x + s, y - s); ctx.lineTo(x - s, y - s); ctx.closePath(); ctx.fill(); break;
      case 'circle': ctx.beginPath(); ctx.arc(x, y, s, 0, 7); ctx.fill(); break;
      case 'square': ctx.fillRect(x - s, y - s, s * 2, s * 2); break;
      case 'diamond': ctx.beginPath(); ctx.moveTo(x, y - s); ctx.lineTo(x + s, y); ctx.lineTo(x, y + s); ctx.lineTo(x - s, y); ctx.closePath(); ctx.fill(); break;
      case 'cross': ctx.beginPath(); ctx.moveTo(x - s, y); ctx.lineTo(x + s, y); ctx.moveTo(x, y - s); ctx.lineTo(x, y + s); ctx.stroke(); break;
      case 'xcross': ctx.beginPath(); ctx.moveTo(x - s, y - s); ctx.lineTo(x + s, y + s); ctx.moveTo(x + s, y - s); ctx.lineTo(x - s, y + s); ctx.stroke(); break;
      case 'flag': ctx.beginPath(); ctx.moveTo(x, y + s); ctx.lineTo(x, y - s); ctx.lineTo(x + s * 1.4, y - s * 0.4); ctx.lineTo(x, y + s * 0.2); ctx.stroke(); ctx.fill(); break;
      case 'labelup': case 'labeldown': {
        const t = text || ''; ctx.font = '10px system-ui, sans-serif';
        const tw = Math.max(t ? ctx.measureText(t).width + 8 : 0, s * 2);
        const bh = s * 2 + 6, up = style === 'labelup';
        const top = up ? y - 2 : y - bh + 2;
        ctx.fillRect(x - tw / 2, top, tw, bh);
        ctx.beginPath(); if (up) { ctx.moveTo(x - 4, top); ctx.lineTo(x, top - 5); ctx.lineTo(x + 4, top); } else { ctx.moveTo(x - 4, top + bh); ctx.lineTo(x, top + bh + 5); ctx.lineTo(x + 4, top + bh); } ctx.fill();
        if (t) { ctx.fillStyle = textColor; ctx.textAlign = 'center'; ctx.fillText(t, x, top + bh / 2 + 1); ctx.textAlign = 'left'; }
        ctx.font = '11px ui-monospace, "JetBrains Mono", monospace';
        return;
      }
      case 'char': ctx.font = `${s * 2 + 4}px system-ui, sans-serif`; ctx.textAlign = 'center'; ctx.fillText(text || '•', x, y); ctx.textAlign = 'left'; ctx.font = '11px ui-monospace, "JetBrains Mono", monospace'; return;
      default: ctx.beginPath(); ctx.arc(x, y, s, 0, 7); ctx.fill();
    }
    void below;
    if (text && style !== 'labelup' && style !== 'labeldown') {
      ctx.fillStyle = textColor; ctx.font = '10px system-ui, sans-serif'; ctx.textAlign = 'center';
      ctx.fillText(text, x, below ? y + s + 10 : y - s - 4); ctx.textAlign = 'left';
      ctx.font = '11px ui-monospace, "JetBrains Mono", monospace';
    }
  }

  private drawLastPrice() {
    const { ctx } = this; const d = this.s.data; const { theme } = this.s;
    const i = d.n - 1; const price = d.c[i]; const up = d.c[i] >= d.o[i];
    const y = this.py(price); const m = this.panes[0];
    if (y < m.y0 - 20 || y > m.y1 + 20) return;
    const col = up ? theme.up : theme.down;
    ctx.strokeStyle = col; ctx.globalAlpha = 0.6; ctx.setLineDash([2, 3]);
    ctx.beginPath(); ctx.moveTo(0, Math.round(y) + 0.5); ctx.lineTo(this.plotW, Math.round(y) + 0.5); ctx.stroke();
    ctx.setLineDash([]); ctx.globalAlpha = 1;
    this.axisLabel(fmtPrice(price), y, col, '#000');
  }

  private axisLabel(text: string, y: number, bg: string, fg: string) {
    const { ctx } = this;
    ctx.fillStyle = bg; ctx.fillRect(this.plotW + 1, Math.round(y) - 10, AXIS_W - 1, 20);
    ctx.fillStyle = fg; ctx.textAlign = 'left'; ctx.fillText(text, this.plotW + 8, Math.round(y) + 1);
  }

  /** daily and longer bars are labelled with their calendar day (the same in every zone); intraday bars with the zone chosen in the settings */
  private axisZone() { return this.s.step >= 86400 ? 'UTC' : activeZone(); }

  private timeTicks(): Array<{ x: number; label: string; major: boolean }> {
    const out: Array<{ x: number; label: string; major: boolean }> = [];
    const d = this.s.data; if (!d.n) return out;
    const nice = [1, 2, 3, 5, 10, 15, 20, 30, 60, 120, 240, 480, 1000, 2000, 5000];
    const need = Math.ceil(110 / this.barW);
    const stepBars = nice.find((n) => n >= need) ?? 10000;
    const a = Math.floor(this.start), b = Math.ceil(this.start + (this.w - AXIS_W) / this.barW);
    const intraday = this.s.step < 86400;
    const tz = this.axisZone();
    let prev: Parts | null = null;
    for (let i = Math.floor(a / stepBars) * stepBars; i <= b + stepBars; i += stepBars) {
      const p = zonedParts(tz, this.idxToTime(i));
      let label: string, major = false;
      if (intraday) {
        if (!prev || prev.day !== p.day) { label = String(p.day); major = true; }
        else label = `${pad2(p.hour)}:${pad2(p.minute)}`;
      } else if (!prev || prev.year !== p.year) { label = String(p.year); major = true; }
      else if (prev.month !== p.month) { label = MONTHS[p.month - 1]; major = true; }
      else label = String(p.day);
      prev = p;
      out.push({ x: this.xOf(i), label, major });
    }
    return out;
  }

  private drawTimeAxis() {
    const { ctx } = this; const { theme } = this.s;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (const t of this.timeTicks()) {
      if (t.x < 10 || t.x > this.plotW - 10) continue;
      ctx.fillStyle = t.major ? theme.textStrong : theme.text;
      ctx.fillText(t.label, t.x, this.h - TIME_H / 2);
    }
    ctx.textAlign = 'left';
  }

  // ---------- trade arrows and price lines ----------
  private drawTrades() {
    const { ctx } = this; const { theme } = this.s;
    for (const m of this.s.trades) {
      const x = this.xOf(this.timeToIdx(m.t));
      if (x < -10 || x > this.plotW + 10) continue;
      const y = this.py(m.price);
      const buy = m.side === 'buy';
      const col = buy ? theme.up : theme.down;
      ctx.fillStyle = col; ctx.strokeStyle = '#000'; ctx.lineWidth = 1;
      ctx.beginPath();
      // buy: arrow below the fill price pointing up; sell: arrow above pointing down
      if (buy) { ctx.moveTo(x, y + 1); ctx.lineTo(x + 6, y + 11); ctx.lineTo(x + 2.5, y + 11); ctx.lineTo(x + 2.5, y + 17); ctx.lineTo(x - 2.5, y + 17); ctx.lineTo(x - 2.5, y + 11); ctx.lineTo(x - 6, y + 11); }
      else { ctx.moveTo(x, y - 1); ctx.lineTo(x + 6, y - 11); ctx.lineTo(x + 2.5, y - 11); ctx.lineTo(x + 2.5, y - 17); ctx.lineTo(x - 2.5, y - 17); ctx.lineTo(x - 2.5, y - 11); ctx.lineTo(x - 6, y - 11); }
      ctx.closePath(); ctx.fill(); ctx.stroke();
      if (m.text) { ctx.font = '10px ui-monospace, monospace'; ctx.fillStyle = col; ctx.textAlign = 'center'; ctx.fillText(m.text, x, buy ? y + 28 : y - 24); ctx.textAlign = 'left'; ctx.font = '11px ui-monospace, "JetBrains Mono", monospace'; }
    }
  }

  private drawBoxes() {
    const { ctx } = this; const { theme } = this.s;
    for (const b of this.s.boxes ?? []) {
      const x0 = this.xOf(this.timeToIdx(b.t0)), x1 = Math.max(x0 + 6, this.xOf(this.timeToIdx(b.t1)));
      if (x1 < -10 || x0 > this.plotW + 10) continue;
      const ya = this.py(b.p0), yb = this.py(b.p1);
      const top = Math.min(ya, yb) - (Math.abs(ya - yb) < 2 ? 1 : 0), hgt = Math.max(2, Math.abs(ya - yb));
      const col = b.win ? theme.up : theme.down;
      ctx.globalAlpha = 0.18; ctx.fillStyle = col; ctx.fillRect(x0, top, x1 - x0, hgt);
      ctx.globalAlpha = 1; ctx.strokeStyle = col; ctx.lineWidth = 1; ctx.setLineDash(b.open ? [4, 3] : []);
      ctx.strokeRect(Math.round(x0) + 0.5, Math.round(top) + 0.5, x1 - x0, hgt);
      ctx.setLineDash([]);
      ctx.beginPath(); ctx.moveTo(x0, Math.round(ya) + 0.5); ctx.lineTo(x1, Math.round(ya) + 0.5); ctx.stroke();
      if (b.text && x1 - x0 > 14) this.labelBox(b.text, (x0 + x1) / 2, top - 13);
    }
  }

  private drawLines() {
    const { ctx } = this; const { theme } = this.s; const m = this.panes[0];
    for (const l of this.s.lines) {
      const y = this.py(l.price);
      if (y < m.y0 - 4 || y > m.y1 + 4) continue;
      const yy = Math.round(y) + 0.5;
      ctx.strokeStyle = l.color; ctx.lineWidth = 1; ctx.setLineDash(l.dash ? [6, 4] : []);
      ctx.beginPath(); ctx.moveTo(0, yy); ctx.lineTo(this.plotW, yy); ctx.stroke(); ctx.setLineDash([]);
      ctx.font = '10.5px ui-monospace, monospace';
      const tw = ctx.measureText(l.label).width + 12;
      const x0 = this.plotW - tw - 6;
      ctx.fillStyle = theme.panel; ctx.fillRect(x0, yy - 17, tw, 15);
      ctx.strokeStyle = l.color; ctx.strokeRect(x0 + 0.5, yy - 16.5, tw - 1, 14);
      ctx.fillStyle = l.color; ctx.textBaseline = 'middle'; ctx.fillText(l.label, x0 + 6, yy - 9);
      ctx.font = '11px ui-monospace, "JetBrains Mono", monospace';
    }
  }

  /** Zoomed out, markers that would overlap collapse to the most important one (higher priority first); zooming in brings the others back. */
  private declutter<T>(marks: T[], x: (m: T) => number, prio: (m: T) => number, gap = 17): T[] {
    const vis = marks.filter((m) => { const px = x(m); return px >= -10 && px <= this.plotW + 10; }).sort((a, b) => prio(b) - prio(a));
    const placed: number[] = [], out: T[] = [];
    for (const m of vis) {
      const px = x(m);
      if (placed.some((q) => Math.abs(q - px) < gap)) continue;
      placed.push(px); out.push(m);
    }
    return out;
  }

  // ---------- news markers ----------
  private newsPos(m: NewsMark) { return { x: this.xOf(this.timeToIdx(m.t)), y: this.panes[0].y1 - 11 }; }

  private drawNews() {
    const { ctx } = this; const { theme } = this.s;
    for (const m of this.shownNews) {
      const { x, y } = this.newsPos(m);
      const hot = m === this.hoverNews;
      ctx.fillStyle = hot ? theme.accent : '#000';
      ctx.strokeStyle = theme.accent; ctx.lineWidth = 1;
      ctx.fillRect(x - 7, y - 7, 14, 14); ctx.strokeRect(x - 6.5, y - 6.5, 13, 13);
      ctx.strokeStyle = hot ? '#fff' : theme.accent;
      ctx.beginPath(); ctx.moveTo(x - 4, y - 3.5); ctx.lineTo(x + 4, y - 3.5); ctx.moveTo(x - 4, y); ctx.lineTo(x + 4, y); ctx.moveTo(x - 4, y + 3.5); ctx.lineTo(x + 1, y + 3.5); ctx.stroke();
      if (m.ids.length > 1) {
        ctx.fillStyle = theme.accent; ctx.fillRect(x + 4, y - 12, 12, 10);
        ctx.fillStyle = '#fff'; ctx.font = '9px ui-monospace, monospace'; ctx.textAlign = 'center';
        ctx.fillText(String(Math.min(m.ids.length, 99)), x + 10, y - 6.5); ctx.textAlign = 'left';
        ctx.font = '11px ui-monospace, "JetBrains Mono", monospace';
      }
    }
    ctx.lineWidth = 1;
  }

  private newsAt(x: number, y: number): NewsMark | null {
    if (!this.panes.length) return null;
    for (const m of this.shownNews) {
      const p = this.newsPos(m);
      if (Math.abs(x - p.x) <= 9 && Math.abs(y - p.y) <= 9) return m;
    }
    return null;
  }

  // ---------- economic calendar markers ----------
  private calPos(m: CalMark) { return { x: this.xOf(this.timeToIdx(m.t)), y: this.panes[0].y1 - 31 }; }
  private calColor(m: CalMark) { return m.kind !== 'macro' ? this.s.theme.accent : m.impact === 'high' ? this.s.theme.down : m.impact === 'medium' ? '#ff9800' : this.s.theme.text; }

  /** Square tag like the news marker: black, 1px border in the impact colour (accent for company events), a header strip on top, the count or the type letter inside. No glow. */
  private drawCalendar() {
    const { ctx } = this;
    for (const m of this.shownCal) {
      const { x, y } = this.calPos(m);
      const col = this.calColor(m), hot = m === this.hoverCal;
      ctx.fillStyle = '#000'; ctx.fillRect(x - 7, y - 7, 14, 14);
      if (hot) { ctx.globalAlpha = 0.35; ctx.fillStyle = col; ctx.fillRect(x - 7, y - 7, 14, 14); ctx.globalAlpha = 1; }
      ctx.strokeStyle = col; ctx.lineWidth = 1; ctx.strokeRect(x - 6.5, y - 6.5, 13, 13);
      ctx.fillStyle = col; ctx.fillRect(x - 6, y - 6, 12, 3.5);
      ctx.fillStyle = hot ? '#fff' : col; ctx.font = '700 9px ui-monospace, monospace'; ctx.textAlign = 'center';
      const letter = ({ earnings: 'E', dividend: 'D', split: 'S', ipo: 'I' } as Record<string, string>)[m.kind];
      ctx.fillText(m.titles.length > 1 ? String(Math.min(m.titles.length, 9)) : letter ?? '', x, y + 3);
      if (!letter && m.titles.length === 1) { ctx.fillRect(x - 3.5, y, 2, 2); ctx.fillRect(x + 0.5, y, 2, 2); ctx.fillRect(x - 3.5, y + 3, 2, 2); ctx.fillRect(x + 0.5, y + 3, 2, 2); }
      ctx.textAlign = 'left';
      ctx.font = '11px ui-monospace, "JetBrains Mono", monospace';
    }
    ctx.lineWidth = 1;
  }

  private calAt(x: number, y: number): CalMark | null {
    if (!this.panes.length) return null;
    for (const m of this.shownCal) { const p = this.calPos(m); if (Math.abs(x - p.x) <= 9 && Math.abs(y - p.y) <= 10) return m; }
    return null;
  }

  // ---------- drawings ----------
  private allDrawings(): Drawing[] { return this.draft ? [...this.s.drawings, this.draft] : this.s.drawings; }

  private screen(pt: DrawPt) { return { x: this.xOf(this.timeToIdx(pt.t)), y: this.py(pt.p) }; }

  /** Screen points of a drawing. Position tools only use the price of their third point (stop), anchored at the target's x. */
  private screenPts(dr: Drawing): Array<{ x: number; y: number }> {
    const P = dr.pts.map((p) => this.screen(p));
    if ((dr.type === 'longpos' || dr.type === 'shortpos') && P[2] && P[1]) P[2] = { x: P[1].x, y: P[2].y };
    return P;
  }

  private rayEnd(ax: number, ay: number, bx: number, by: number): [number, number] {
    const dx = bx - ax, dy = by - ay;
    if (!dx && !dy) return [bx, by];
    if (Math.abs(dx) < 1e-9) return [ax, ay + Math.sign(dy) * 6000];
    const tx = dx > 0 ? this.plotW + 60 : -60;
    return [tx, ay + dy * ((tx - ax) / dx)];
  }

  private segDist(px: number, py: number, ax: number, ay: number, bx: number, by: number) {
    const dx = bx - ax, dy = by - ay; const l2 = dx * dx + dy * dy || 1;
    const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l2));
    return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
  }

  private fmtDur(sec: number) {
    const d = Math.floor(sec / 86400), h = Math.floor((sec % 86400) / 3600), m = Math.floor((sec % 3600) / 60);
    return d ? `${d}d${h ? ' ' + h + 'h' : ''}` : h ? `${h}h${m ? ' ' + m + 'm' : ''}` : `${m}m`;
  }

  /** Box of a text or callout drawing in screen px (top-left anchored at its anchor point). */
  private textBox(dr: Drawing, P: Array<{ x: number; y: number }>) {
    const ctx = this.ctx; ctx.font = '13px system-ui, sans-serif';
    const o = dr.type === 'callout' ? P[1] ?? P[0] : P[0];
    const lines = (dr.text ?? '').split('\n');
    const w = Math.max(40, ...lines.map((l) => ctx.measureText(l).width + 14));
    return { x: o.x, y: o.y, w, h: lines.length * 17 + 10, lines };
  }

  private labelBox(text: string, cx: number, cy: number) {
    const { ctx } = this; const { theme } = this.s;
    ctx.font = '11px ui-monospace, monospace';
    const tw = ctx.measureText(text).width + 14;
    ctx.shadowBlur = 0;
    ctx.fillStyle = theme.panel; ctx.fillRect(cx - tw / 2, cy - 10, tw, 20);
    ctx.fillStyle = theme.textStrong; ctx.textAlign = 'center'; ctx.fillText(text, cx, cy + 1); ctx.textAlign = 'left';
  }

  private arrowHead(x: number, y: number, ang: number, size = 9) {
    const { ctx } = this;
    ctx.beginPath(); ctx.moveTo(x, y);
    ctx.lineTo(x - size * Math.cos(ang - 0.4), y - size * Math.sin(ang - 0.4));
    ctx.lineTo(x - size * Math.cos(ang + 0.4), y - size * Math.sin(ang + 0.4));
    ctx.closePath(); ctx.fill();
  }

  private drawDrawings() {
    const { ctx } = this; const { theme } = this.s;
    for (const dr of this.allDrawings()) {
      if (dr.id === this.editingId) continue;
      const sel = dr.id === this.selected;
      const P = this.screenPts(dr);
      ctx.strokeStyle = dr.color; ctx.fillStyle = dr.color; ctx.lineWidth = sel ? 2.5 : 1.5;
      ctx.shadowColor = dr.color; ctx.shadowBlur = sel ? 16 : 10;
      const x1 = P[0]?.x, y1 = P[0]?.y, x2 = P[1]?.x, y2 = P[1]?.y;
      const top = this.panes[0].y0, bottom = this.panes[0].y1;
      const line = (ax: number, ay: number, bx: number, by: number) => { ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke(); };
      switch (dr.type) {
        case 'trend': case 'arrow': case 'ray': case 'extline': {
          if (!P[1]) break;
          let sx = x1, sy = y1, ex = x2, ey = y2;
          if (dr.type === 'ray') [ex, ey] = this.rayEnd(x1, y1, x2, y2);
          if (dr.type === 'extline') { [sx, sy] = this.rayEnd(x2, y2, x1, y1); [ex, ey] = this.rayEnd(x1, y1, x2, y2); }
          line(sx, sy, ex, ey);
          if (dr.type === 'arrow') this.arrowHead(x2, y2, Math.atan2(y2 - y1, x2 - x1), 10);
          break;
        }
        case 'arrowpath': if (P.length > 1) {
          ctx.lineJoin = 'round'; ctx.beginPath(); ctx.moveTo(x1, y1);
          for (let i = 1; i < P.length; i++) ctx.lineTo(P[i].x, P[i].y);
          ctx.stroke();
          const a = P[P.length - 2], z = P[P.length - 1];
          this.arrowHead(z.x, z.y, Math.atan2(z.y - a.y, z.x - a.x), 10);
        } break;
        case 'hray': line(x1, y1, this.plotW, y1); ctx.beginPath(); ctx.arc(x1, y1, 3, 0, 7); ctx.fill(); break;
        case 'hline': line(0, y1, this.plotW, y1); break;
        case 'vline': line(x1, 0, x1, bottom); break;
        case 'crossline': line(0, y1, this.plotW, y1); line(x1, 0, x1, bottom); break;
        case 'channel': {
          if (!P[1]) break;
          line(x1, y1, x2, y2);
          if (!P[2]) break;
          const k = x2 !== x1 ? (y2 - y1) / (x2 - x1) : 0;
          const off = P[2].y - (y1 + k * (P[2].x - x1));
          line(x1, y1 + off, x2, y2 + off);
          ctx.globalAlpha = 0.1; ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.lineTo(x2, y2 + off); ctx.lineTo(x1, y1 + off); ctx.closePath(); ctx.fill();
          ctx.globalAlpha = 0.6; ctx.setLineDash([5, 4]); line(x1, y1 + off / 2, x2, y2 + off / 2); ctx.setLineDash([]); ctx.globalAlpha = 1;
          break;
        }
        case 'pitchfork': {
          if (!P[1]) break;
          if (!P[2]) { line(x1, y1, x2, y2); break; }
          const mx = (x2 + P[2].x) / 2, my = (y2 + P[2].y) / 2;
          const dx = mx - x1, dy = my - y1;
          const e0 = this.rayEnd(x1, y1, mx, my), e1 = this.rayEnd(x2, y2, x2 + dx, y2 + dy), e2 = this.rayEnd(P[2].x, P[2].y, P[2].x + dx, P[2].y + dy);
          line(x1, y1, e0[0], e0[1]); line(x2, y2, e1[0], e1[1]); line(P[2].x, P[2].y, e2[0], e2[1]);
          ctx.globalAlpha = 0.5; ctx.setLineDash([4, 4]); line(x2, y2, P[2].x, P[2].y); ctx.setLineDash([]);
          ctx.globalAlpha = 0.08; ctx.beginPath(); ctx.moveTo(x2, y2); ctx.lineTo(e1[0], e1[1]); ctx.lineTo(e2[0], e2[1]); ctx.lineTo(P[2].x, P[2].y); ctx.closePath(); ctx.fill(); ctx.globalAlpha = 1;
          break;
        }
        case 'rect': if (P[1]) { ctx.globalAlpha = 0.14; ctx.fillRect(x1, y1, x2 - x1, y2 - y1); ctx.globalAlpha = 1; ctx.strokeRect(x1, y1, x2 - x1, y2 - y1); } break;
        case 'ellipse': if (P[1]) {
          ctx.beginPath(); ctx.ellipse((x1 + x2) / 2, (y1 + y2) / 2, Math.max(1, Math.abs(x2 - x1) / 2), Math.max(1, Math.abs(y2 - y1) / 2), 0, 0, 7);
          ctx.globalAlpha = 0.14; ctx.fill(); ctx.globalAlpha = 1; ctx.stroke();
        } break;
        case 'circle': if (P[1]) {
          ctx.beginPath(); ctx.arc(x1, y1, Math.max(1, Math.hypot(x2 - x1, y2 - y1)), 0, 7);
          ctx.globalAlpha = 0.14; ctx.fill(); ctx.globalAlpha = 1; ctx.stroke();
        } break;
        case 'triangle': if (P[1]) {
          if (!P[2]) { line(x1, y1, x2, y2); break; }
          ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.lineTo(P[2].x, P[2].y); ctx.closePath();
          ctx.globalAlpha = 0.14; ctx.fill(); ctx.globalAlpha = 1; ctx.stroke();
        } break;
        case 'fib': if (P[1]) {
          const p1 = dr.pts[0].p, p2 = dr.pts[1].p;
          ctx.font = '10px ui-monospace, monospace'; ctx.textAlign = 'left';
          for (const lv of FIB) {
            const price = p2 + (p1 - p2) * lv; const y = this.py(price);
            ctx.globalAlpha = 0.9; line(Math.min(x1, x2), y, Math.max(x1, x2), y);
            ctx.globalAlpha = 1; ctx.fillText(`${lv} (${fmtPrice(price)})`, Math.min(x1, x2) + 4, y - 7);
          }
          ctx.setLineDash([4, 4]); line(x1, y1, x2, y2); ctx.setLineDash([]);
        } break;
        case 'fibext': if (P[1]) {
          ctx.setLineDash([4, 4]); line(x1, y1, x2, y2);
          if (!P[2]) { ctx.setLineDash([]); break; }
          line(x2, y2, P[2].x, P[2].y); ctx.setLineDash([]);
          const move = dr.pts[1].p - dr.pts[0].p, base = dr.pts[2].p;
          const xl = Math.min(x1, x2, P[2].x), xr = Math.max(x1, x2, P[2].x, xl + 80);
          ctx.font = '10px ui-monospace, monospace';
          for (const lv of FIBX) {
            const price = base + move * lv; const y = this.py(price);
            ctx.globalAlpha = 0.9; line(xl, y, xr, y);
            ctx.globalAlpha = 1; ctx.fillText(`${lv} (${fmtPrice(price)})`, xl + 4, y - 7);
          }
        } break;
        case 'longpos': case 'shortpos': if (P[1]) {
          const entry = dr.pts[0].p, target = dr.pts[1].p, stop = dr.pts[2]?.p;
          const xl = Math.min(x1, x2), xr = Math.max(x1, x2, xl + 60), yT = this.py(target);
          ctx.globalAlpha = 0.18; ctx.fillStyle = theme.up; ctx.fillRect(xl, Math.min(y1, yT), xr - xl, Math.abs(yT - y1));
          ctx.globalAlpha = 1; ctx.strokeStyle = theme.up; ctx.strokeRect(xl, Math.min(y1, yT), xr - xl, Math.abs(yT - y1));
          const pct = ((target - entry) / entry) * 100;
          let txt = `Target ${fmtPrice(target)} (${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%)`;
          if (stop !== undefined) {
            const yS = this.py(stop);
            ctx.globalAlpha = 0.18; ctx.fillStyle = theme.down; ctx.fillRect(xl, Math.min(y1, yS), xr - xl, Math.abs(yS - y1));
            ctx.globalAlpha = 1; ctx.strokeStyle = theme.down; ctx.strokeRect(xl, Math.min(y1, yS), xr - xl, Math.abs(yS - y1));
            const risk = Math.abs(entry - stop), reward = Math.abs(target - entry);
            const sp = ((stop - entry) / entry) * 100;
            this.labelBox(`Stop ${fmtPrice(stop)} (${sp >= 0 ? '+' : ''}${sp.toFixed(2)}%)`, (xl + xr) / 2, yS + (yS > y1 ? 16 : -16));
            txt += `  R:R ${risk ? (reward / risk).toFixed(2) : '-'}`;
          }
          ctx.strokeStyle = dr.color; ctx.fillStyle = dr.color; line(xl, y1, xr, y1);
          this.labelBox(txt, (xl + xr) / 2, yT + (yT < y1 ? -16 : 16));
        } break;
        case 'measure': if (P[1]) {
          const dp = dr.pts[1].p - dr.pts[0].p; const pct = (dp / dr.pts[0].p) * 100;
          const bars = Math.round(this.timeToIdx(dr.pts[1].t) - this.timeToIdx(dr.pts[0].t));
          ctx.globalAlpha = 0.16; ctx.fillStyle = dp >= 0 ? theme.up : theme.down; ctx.fillRect(x1, y1, x2 - x1, y2 - y1); ctx.globalAlpha = 1;
          ctx.strokeStyle = dp >= 0 ? theme.up : theme.down; ctx.strokeRect(x1, y1, x2 - x1, y2 - y1);
          this.labelBox(`${dp >= 0 ? '+' : ''}${fmtPrice(dp)} (${pct.toFixed(2)}%)  ${bars} bars`, (x1 + x2) / 2, Math.min(y1, y2) - 16);
        } break;
        case 'pricerange': if (P[1]) {
          const dp = dr.pts[1].p - dr.pts[0].p; const pct = (dp / dr.pts[0].p) * 100;
          const xl = Math.min(x1, x2), xr = Math.max(x1, x2, xl + 40), xm = (xl + xr) / 2;
          ctx.globalAlpha = 0.12; ctx.fillRect(xl, Math.min(y1, y2), xr - xl, Math.abs(y2 - y1)); ctx.globalAlpha = 1;
          ctx.setLineDash([4, 4]); line(xl, y1, xr, y1); line(xl, y2, xr, y2); ctx.setLineDash([]);
          line(xm, y1, xm, y2); this.arrowHead(xm, y2, y2 >= y1 ? Math.PI / 2 : -Math.PI / 2, 8);
          this.labelBox(`${dp >= 0 ? '+' : ''}${fmtPrice(dp)} (${pct.toFixed(2)}%)`, xm, (y1 + y2) / 2);
        } break;
        case 'daterange': if (P[1]) {
          const bars = Math.round(this.timeToIdx(dr.pts[1].t) - this.timeToIdx(dr.pts[0].t));
          const secs = Math.abs(dr.pts[1].t - dr.pts[0].t);
          const xl = Math.min(x1, x2), xr = Math.max(x1, x2), ym = Math.min(Math.max((y1 + y2) / 2, top + 14), bottom - 14);
          ctx.globalAlpha = 0.1; ctx.fillRect(xl, top, xr - xl, bottom - top); ctx.globalAlpha = 1;
          ctx.setLineDash([4, 4]); line(xl, top, xl, bottom); line(xr, top, xr, bottom); ctx.setLineDash([]);
          line(xl, ym, xr, ym); this.arrowHead(xr, ym, x2 >= x1 ? 0 : Math.PI, 8);
          this.labelBox(`${Math.abs(bars)} bars · ${this.fmtDur(secs)}`, (xl + xr) / 2, ym - 16);
        } break;
        case 'brush': if (P.length > 1) {
          ctx.lineJoin = 'round'; ctx.beginPath(); ctx.moveTo(x1, y1);
          for (let i = 1; i < P.length; i++) ctx.lineTo(P[i].x, P[i].y);
          ctx.stroke();
        } break;
        case 'arrowup': case 'arrowdown': {
          const s = dr.type === 'arrowup' ? 1 : -1;
          ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x1 + 8, y1 + 10 * s); ctx.lineTo(x1 + 3, y1 + 10 * s); ctx.lineTo(x1 + 3, y1 + 26 * s);
          ctx.lineTo(x1 - 3, y1 + 26 * s); ctx.lineTo(x1 - 3, y1 + 10 * s); ctx.lineTo(x1 - 8, y1 + 10 * s); ctx.closePath(); ctx.fill();
          break;
        }
        case 'text': case 'callout': {
          const b = this.textBox(dr, P);
          if (dr.type === 'callout' && P[1]) {
            const nx = Math.min(Math.max(x1, b.x), b.x + b.w), ny = Math.min(Math.max(y1, b.y), b.y + b.h);
            if (nx !== x1 || ny !== y1) line(x1, y1, nx, ny);
            ctx.beginPath(); ctx.arc(x1, y1, 3, 0, 7); ctx.fill();
          }
          ctx.shadowBlur = 0;
          ctx.fillStyle = theme.panel; ctx.fillRect(b.x, b.y, b.w, b.h);
          ctx.strokeStyle = dr.color; ctx.lineWidth = sel ? 2 : 1; ctx.strokeRect(b.x + 0.5, b.y + 0.5, b.w - 1, b.h - 1);
          ctx.font = '13px system-ui, sans-serif'; ctx.textAlign = 'left'; ctx.fillStyle = theme.textStrong;
          if (!dr.text) ctx.globalAlpha = 0.45;
          (dr.text ? b.lines : ['Text']).forEach((l, i) => ctx.fillText(l, b.x + 7, b.y + 5 + 8.5 + i * 17));
          ctx.globalAlpha = 1;
          break;
        }
      }
      ctx.shadowBlur = 0;
      if (sel && dr.type !== 'text') { ctx.fillStyle = theme.accent; for (const q of P) { ctx.beginPath(); ctx.arc(q.x, q.y, 4.5, 0, 7); ctx.fill(); } }
      ctx.lineWidth = 1;
    }
  }

  private hit(x: number, y: number): Drawing | null {
    const sd = (ax: number, ay: number, bx: number, by: number) => this.segDist(x, y, ax, ay, bx, by);
    const inBox = (xa: number, ya: number, xb: number, yb: number, pad = 4) => x >= Math.min(xa, xb) - pad && x <= Math.max(xa, xb) + pad && y >= Math.min(ya, yb) - pad && y <= Math.max(ya, yb) + pad;
    for (const dr of [...this.s.drawings].reverse()) {
      const P = this.screenPts(dr);
      if (!P.length) continue;
      const x1 = P[0].x, y1 = P[0].y, x2 = P[1]?.x, y2 = P[1]?.y;
      let ok = false;
      switch (dr.type) {
        case 'trend': case 'arrow': ok = !!P[1] && sd(x1, y1, x2, y2) < 6; break;
        case 'ray': if (P[1]) { const e = this.rayEnd(x1, y1, x2, y2); ok = sd(x1, y1, e[0], e[1]) < 6; } break;
        case 'extline': if (P[1]) { const a = this.rayEnd(x2, y2, x1, y1), b = this.rayEnd(x1, y1, x2, y2); ok = sd(a[0], a[1], b[0], b[1]) < 6; } break;
        case 'hray': ok = Math.abs(y - y1) < 6 && x >= x1 - 6; break;
        case 'hline': ok = Math.abs(y - y1) < 6; break;
        case 'vline': ok = Math.abs(x - x1) < 6; break;
        case 'crossline': ok = Math.abs(y - y1) < 6 || Math.abs(x - x1) < 6; break;
        case 'channel': if (P[1] && P[2]) {
          const k = x2 !== x1 ? (y2 - y1) / (x2 - x1) : 0; const off = P[2].y - (y1 + k * (P[2].x - x1));
          ok = sd(x1, y1, x2, y2) < 6 || sd(x1, y1 + off, x2, y2 + off) < 6;
        } else if (P[1]) ok = sd(x1, y1, x2, y2) < 6; break;
        case 'pitchfork': if (P[1] && P[2]) {
          const mx = (x2 + P[2].x) / 2, my = (y2 + P[2].y) / 2, dx = mx - x1, dy = my - y1;
          const e0 = this.rayEnd(x1, y1, mx, my), e1 = this.rayEnd(x2, y2, x2 + dx, y2 + dy), e2 = this.rayEnd(P[2].x, P[2].y, P[2].x + dx, P[2].y + dy);
          ok = sd(x1, y1, e0[0], e0[1]) < 6 || sd(x2, y2, e1[0], e1[1]) < 6 || sd(P[2].x, P[2].y, e2[0], e2[1]) < 6;
        } break;
        case 'rect': case 'fib': case 'measure': case 'pricerange': ok = !!P[1] && inBox(x1, y1, x2, y2); break;
        case 'daterange': ok = !!P[1] && x >= Math.min(x1, x2) - 4 && x <= Math.max(x1, x2) + 4 && y <= this.panes[0].y1; break;
        case 'ellipse': if (P[1]) { const rx = Math.max(1, Math.abs(x2 - x1) / 2) + 4, ry = Math.max(1, Math.abs(y2 - y1) / 2) + 4; ok = ((x - (x1 + x2) / 2) / rx) ** 2 + ((y - (y1 + y2) / 2) / ry) ** 2 <= 1; } break;
        case 'circle': ok = !!P[1] && Math.hypot(x - x1, y - y1) <= Math.hypot(x2 - x1, y2 - y1) + 4; break;
        case 'triangle': if (P[1] && P[2]) {
          const s = (ax: number, ay: number, bx: number, by: number) => (x - bx) * (ay - by) - (ax - bx) * (y - by);
          const d1 = s(x1, y1, x2, y2), d2 = s(x2, y2, P[2].x, P[2].y), d3 = s(P[2].x, P[2].y, x1, y1);
          ok = !((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0)) || sd(x1, y1, x2, y2) < 5 || sd(x2, y2, P[2].x, P[2].y) < 5 || sd(P[2].x, P[2].y, x1, y1) < 5;
        } break;
        case 'fibext': if (P[1] && P[2]) {
          const move = dr.pts[1].p - dr.pts[0].p, base = dr.pts[2].p;
          const ys = FIBX.map((lv) => this.py(base + move * lv));
          const xl = Math.min(x1, x2, P[2].x), xr = Math.max(x1, x2, P[2].x, xl + 80);
          ok = x >= xl - 4 && x <= xr + 4 && ys.some((yy) => Math.abs(y - yy) < 6);
        } break;
        case 'longpos': case 'shortpos': if (P[1]) {
          const xl = Math.min(x1, x2), xr = Math.max(x1, x2, xl + 60);
          const yt = this.py(dr.pts[1].p), ys = P[2] ? P[2].y : y1;
          ok = x >= xl - 4 && x <= xr + 4 && y >= Math.min(y1, yt, ys) - 4 && y <= Math.max(y1, yt, ys) + 4;
        } break;
        case 'arrowpath': case 'brush': for (let i = 1; i < P.length && !ok; i++) ok = sd(P[i - 1].x, P[i - 1].y, P[i].x, P[i].y) < 6; break;
        case 'arrowup': ok = x >= x1 - 9 && x <= x1 + 9 && y >= y1 - 2 && y <= y1 + 28; break;
        case 'arrowdown': ok = x >= x1 - 9 && x <= x1 + 9 && y <= y1 + 2 && y >= y1 - 28; break;
        case 'text': case 'callout': {
          const b = this.textBox(dr, P);
          ok = x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h;
          if (!ok && dr.type === 'callout' && P[1]) ok = Math.hypot(x - x1, y - y1) < 7;
        } break;
      }
      if (ok) return dr;
    }
    return null;
  }

  /** Handle (control point) of the selected drawing under the cursor. */
  private handleAt(x: number, y: number): { idx: number } | null {
    const dr = this.s.drawings.find((q) => q.id === this.selected);
    if (!dr || dr.pts.length < 2 || dr.type === 'brush') return null;
    const P = this.screenPts(dr);
    for (let i = 0; i < P.length; i++) {
      if (Math.hypot(P[i].x - x, P[i].y - y) <= 9) return { idx: i };
    }
    return null;
  }

  private rawPt(x: number, y: number): DrawPt { return { t: this.idxToTime(this.idxOf(x)), p: this.priceOf(y) }; }

  private snap(x: number, y: number): DrawPt {
    let i = this.idxOf(x); let p = this.priceOf(y);
    if (this.s.magnet) {
      const k = Math.max(0, Math.min(this.s.data.n - 1, Math.round(i)));
      const d = this.s.data;
      const cand = [d.o[k], d.h[k], d.l[k], d.c[k]];
      p = cand.reduce((best, c) => (Math.abs(this.py(c) - y) < Math.abs(this.py(best) - y) ? c : best), cand[0]);
      i = k;
    }
    return { t: this.idxToTime(i), p };
  }

  // ---------- overlay (crosshair) ----------
  private drawOver() {
    const { octx: c, w, h, dpr } = this; const { theme, data } = this.s;
    c.setTransform(dpr, 0, 0, dpr, 0, 0); c.clearRect(0, 0, w, h);
    if (!this.panes.length || !data.n) return;
    c.font = '11px ui-monospace, "JetBrains Mono", monospace'; c.textBaseline = 'middle';
    let x = -1, y = -1, own = false;
    if (this.mx >= 0 && this.mx < this.plotW && this.my >= 0 && this.my < this.h - TIME_H) { x = this.mx; y = this.my; own = true; }
    else if (this.externalT !== null) {
      x = this.xOf(this.timeToIdx(this.externalT));
      const m0 = this.panes[0];
      if (this.externalY !== null && m0) y = m0.y0 + this.externalY * (m0.y1 - m0.y0);
    }
    if (this.hoverNews && this.mx >= 0) {
      const p = this.newsPos(this.hoverNews);
      const txt = this.hoverNews.titles[0].slice(0, 90) + (this.hoverNews.ids.length > 1 ? `  (+${this.hoverNews.ids.length - 1})` : '');
      const tw = Math.min(c.measureText(txt).width + 18, this.plotW - 8);
      const bx = Math.min(Math.max(p.x - tw / 2, 4), this.plotW - tw - 4), by = p.y - 40;
      c.fillStyle = theme.panel; c.fillRect(bx, by, tw, 22);
      c.strokeStyle = theme.accent; c.strokeRect(bx + 0.5, by + 0.5, tw - 1, 21);
      c.fillStyle = theme.textStrong; c.textAlign = 'left'; c.save(); c.beginPath(); c.rect(bx, by, tw, 22); c.clip(); c.fillText(txt, bx + 9, by + 11); c.restore();
    }
    if (this.hoverCal && this.mx >= 0) {
      const p = this.calPos(this.hoverCal);
      const txt = this.hoverCal.titles[0].slice(0, 90) + (this.hoverCal.titles.length > 1 ? `  (+${this.hoverCal.titles.length - 1})` : '');
      const tw = Math.min(c.measureText(txt).width + 18, this.plotW - 8);
      const bx = Math.min(Math.max(p.x - tw / 2, 4), this.plotW - tw - 4), by = p.y - 36;
      c.fillStyle = theme.panel; c.fillRect(bx, by, tw, 22);
      c.strokeStyle = this.calColor(this.hoverCal); c.strokeRect(bx + 0.5, by + 0.5, tw - 1, 21);
      c.fillStyle = theme.textStrong; c.textAlign = 'left'; c.save(); c.beginPath(); c.rect(bx, by, tw, 22); c.clip(); c.fillText(txt, bx + 9, by + 11); c.restore();
    }
    if (x < 0) return;
    const i = Math.round(this.idxOf(x));
    // the view may have moved under a resting mouse (replay, wheel animation): keep the other charts' crosshair on this bar
    if (own) { const m0 = this.panes[0]; this.broadcastCross(this.s.data.t[Math.max(0, Math.min(data.n - 1, i))], m0 && y >= m0.y0 && y <= m0.y1 ? (y - m0.y0) / (m0.y1 - m0.y0) : null); }
    x = Math.round(this.xOf(i)) + 0.5;
    if (this.replayPick) {
      c.strokeStyle = theme.accent; c.lineWidth = 2; c.beginPath(); c.moveTo(x, 0); c.lineTo(x, this.h - TIME_H); c.stroke(); c.lineWidth = 1;
      c.fillStyle = theme.accent; c.fillRect(x - 13, 8, 26, 22); c.fillStyle = '#fff'; c.font = '15px system-ui, sans-serif'; c.textAlign = 'center'; c.fillText('\u2702', x, 20); c.textAlign = 'left';
      c.font = '11px ui-monospace, "JetBrains Mono", monospace';
    }
    c.strokeStyle = theme.cross; c.setLineDash([4, 4]); c.lineWidth = 1;
    c.beginPath(); c.moveTo(x, 0); c.lineTo(x, this.h - TIME_H); if (y >= 0) { c.moveTo(0, Math.round(y) + 0.5); c.lineTo(this.plotW, Math.round(y) + 0.5); } c.stroke();
    c.setLineDash([]);
    // time label
    const zp = zonedParts(this.axisZone(), this.idxToTime(i));
    const dayLbl = `${pad2(zp.day)} ${MONTHS[zp.month - 1]}`;
    const lbl = this.s.step >= 86400 ? `${dayLbl} ${zp.year}` : `${dayLbl} ${pad2(zp.hour)}:${pad2(zp.minute)}`;
    const tw = c.measureText(lbl).width + 16;
    c.fillStyle = theme.accent; c.fillRect(Math.min(Math.max(x - tw / 2, 0), this.plotW - tw), this.h - TIME_H + 2, tw, 20);
    c.fillStyle = '#fff'; c.textAlign = 'center'; c.fillText(lbl, Math.min(Math.max(x, tw / 2), this.plotW - tw / 2), this.h - TIME_H + 13); c.textAlign = 'left';
    if (y >= 0) {
      const pane = this.paneAt(y);
      if (pane) {
        const val = pane.kind === 'main' ? this.priceOf(y, pane) : pane.lo + ((pane.y1 - y) / (pane.y1 - pane.y0)) * (pane.hi - pane.lo);
        c.fillStyle = theme.accent; c.fillRect(this.plotW + 1, Math.round(y) - 10, AXIS_W - 1, 20);
        c.fillStyle = '#fff'; c.fillText(pane.kind === 'main' ? fmtPrice(val) : val.toFixed(2), this.plotW + 8, Math.round(y) + 1);
      }
    }
  }

  // ---------- input ----------
  private bind() {
    const el = this.over;
    const on = <K extends keyof HTMLElementEventMap>(t: K, f: (e: HTMLElementEventMap[K]) => void, opts?: AddEventListenerOptions) => {
      el.addEventListener(t, f as EventListener, opts); this.cleanup.push(() => el.removeEventListener(t, f as EventListener));
    };
    const pos = (e: MouseEvent) => { const r = el.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
    const region = (x: number, y: number) => (x > this.plotW ? 'paxis' : y > this.h - TIME_H ? 'taxis' : 'plot');

    // touch: two fingers pinch-zoom (time and price together, like Ctrl+wheel), three fingers zoom towards the newest candles (like Ctrl+Shift+wheel); one finger pans, a tap shows the crosshair
    const touches = new Map<number, { x: number; y: number }>();
    let pinch: { d: number } | null = null;
    const spread = () => {
      const p = [...touches.values()], cx = p.reduce((s, q) => s + q.x, 0) / p.length, cy = p.reduce((s, q) => s + q.y, 0) / p.length;
      return { d: (p.reduce((s, q) => s + Math.hypot(q.x - cx, q.y - cy), 0) / p.length) * 2 || 1, cx, cy }; // twice the mean distance from the centre = the finger distance for two fingers
    };
    on('pointerdown', (e) => {
      const { x, y } = pos(e);
      if (e.pointerType === 'touch') {
        touches.set(e.pointerId, { x, y });
        if (touches.size >= 2) { this.drag = null; this.draft = null; chartSync.leader = this; pinch = { d: spread().d }; return; }
      }
      if (e.button === 1) {
        // Middle click deletes the drawing under the cursor.
        e.preventDefault();
        const h = this.hit(x, y);
        if (h) { this.hooks.onDrawings(this.s.drawings.filter((d) => d.id !== h.id)); if (this.selected === h.id) this.select(null); }
        return;
      }
      if (this.replayPick && region(x, y) === 'plot' && this.s.data.n) {
        const k = Math.max(0, Math.min(this.s.data.n - 1, Math.round(this.idxOf(x))));
        this.hooks.onReplayPick(this.s.data.t[k]);
        return;
      }
      chartSync.leader = this; // whatever is dragged here (time, price axis, drawings) is mirrored by the other charts
      el.setPointerCapture(e.pointerId);
      this.tgt = null;
      const reg = region(x, y);
      if (reg === 'paxis') { const m = this.panes[0]; this.drag = { kind: 'paxis', x, y, lo: m.lo, hi: m.hi }; return; }
      if (reg === 'taxis') { this.drag = { kind: 'taxis', x, y }; return; }
      const nm = this.newsAt(x, y);
      if (nm && this.s.tool === 'cursor') { this.hooks.onNewsClick(nm); return; }
      const cm = this.s.tool === 'cursor' ? this.calAt(x, y) : null;
      if (cm) { this.hooks.onCalClick(cm); return; }
      const tool = this.s.tool;
      if (tool !== 'cursor') {
        if (tool === 'brush') {
          this.draft = { id: crypto.randomUUID(), type: tool, pts: [this.rawPt(x, y)], color: this.s.theme.accent };
          this.drag = { kind: 'brush', x, y };
          this.invalidate(); return;
        }
        const pt = this.snap(x, y);
        if (tool === 'arrowpath') {
          // every click adds a vertex; the last point follows the cursor until Enter / Esc / double click
          if (!this.draft) this.draft = { id: crypto.randomUUID(), type: tool, pts: [pt, { ...pt }], color: this.s.theme.accent };
          else { this.draft.pts[this.draft.pts.length - 1] = pt; this.draft.pts.push({ ...pt }); }
          this.invalidate(); return;
        }
        if (!this.draft) {
          this.draft = { id: crypto.randomUUID(), type: tool, pts: [pt], color: this.s.theme.accent };
          if (POINTS[tool] === 1) this.finishDraft();
          else this.draft.pts.push({ ...pt });
        } else {
          this.draft.pts[this.draft.pts.length - 1] = pt;
          if (this.draft.pts.length >= POINTS[tool]) this.finishDraft();
          else this.draft.pts.push({ ...pt });
        }
        this.invalidate(); return;
      }
      const handle = this.handleAt(x, y);
      if (handle) { this.drag = { kind: 'point', idx: handle.idx, x, y }; this.invalidate(); return; }
      const hit = this.hit(x, y);
      this.select(hit?.id ?? null);
      if (hit) this.drag = { kind: 'move', x, y, orig: hit.pts.map((p) => ({ ...p })) };
      else { const m = this.panes[0]; this.mx = x; this.my = y; this.drag = { kind: 'pan', x, y, lo: m.lo, hi: m.hi, s0: this.start }; this.easing = true; this.easeT = performance.now(); }
      this.invalidate();
    });
    on('pointermove', (e) => {
      const { x, y } = pos(e);
      if (e.pointerType === 'touch' && touches.has(e.pointerId)) {
        touches.set(e.pointerId, { x, y });
        if (pinch && touches.size >= 2) {
          const sp = spread();
          const w = Math.log(sp.d / pinch.d) / 0.003; // the wheel zoom takes this amount: positive = zoom in
          pinch.d = sp.d;
          if (Math.abs(w) > 0.01) this.wheelZoom(w, Math.min(sp.cx, this.plotW), sp.cy, touches.size >= 3);
          return;
        }
      }
      this.mx = x; this.my = y;
      const i = Math.max(0, Math.min(this.s.data.n - 1, Math.round(this.idxOf(x))));
      const inPlot = x < this.plotW && y < this.h - TIME_H;
      const m0 = this.panes[0];
      const yf = inPlot && m0 && y >= m0.y0 && y <= m0.y1 ? (y - m0.y0) / (m0.y1 - m0.y0) : null;
      if (!this.drag) this.hooks.onHover(inPlot ? i : null, this.s.data.n ? this.s.data.t[i] : null, yf);
      this.broadcastCross(inPlot && this.s.data.n ? this.s.data.t[i] : null, yf);
      const hn = this.drag ? null : this.newsAt(x, y);
      if (hn !== this.hoverNews) { this.hoverNews = hn; this.invalidate(); }
      const hc = this.drag || hn ? null : this.calAt(x, y);
      if (hc !== this.hoverCal) { this.hoverCal = hc; this.invalidate(); }
      el.style.cursor = hn || hc ? 'pointer' : this.drag ? (this.drag.kind === 'move' || this.drag.kind === 'pan' ? 'grabbing' : el.style.cursor)
        : this.s.tool === 'cursor' && this.handleAt(x, y) ? 'move'
        : x > this.plotW ? 'ns-resize' : y > this.h - TIME_H ? 'ew-resize' : this.s.tool !== 'cursor' ? 'crosshair' : this.hit(x, y) ? 'pointer' : 'crosshair';
      if (this.draft?.type === 'brush') {
        const last = this.screen(this.draft.pts[this.draft.pts.length - 1]);
        if (this.drag?.kind === 'brush' && Math.hypot(x - last.x, y - last.y) >= 2) this.draft.pts.push(this.rawPt(x, y));
        this.invalidate(); return;
      }
      if (this.draft) { this.draft.pts[this.draft.pts.length - 1] = this.snap(x, y); this.invalidate(); return; }
      const d = this.drag;
      if (d) {
        if (d.kind === 'pan') {
          // applied once per frame in draw() (applyPan) from the latest cursor position
        } else if (d.kind === 'paxis') {
          const f = Math.exp((y - d.y) * 0.006); const mid = (d.hi! + d.lo!) / 2; const half = ((d.hi! - d.lo!) / 2) * f;
          this.manual = { lo: mid - half, hi: mid + half };
        } else if (d.kind === 'taxis') {
          this.zoomBars(Math.exp(e.movementX * 0.006), this.plotW / 2);
        } else if (d.kind === 'point' && this.selected) {
          const dr = this.s.drawings.find((q) => q.id === this.selected);
          if (dr && d.idx !== undefined) dr.pts[d.idx] = this.snap(x, y);
        } else if (d.kind === 'move' && this.selected) {
          if (Math.hypot(x - d.x, y - d.y) > 3) d.moved = true;
          const dr = this.s.drawings.find((q) => q.id === this.selected);
          if (dr && d.orig) {
            const di = this.idxOf(x) - this.idxOf(d.x); const dp = this.priceOf(y) - this.priceOf(d.y);
            dr.pts = d.orig.map((p) => ({ t: this.idxToTime(this.timeToIdx(p.t) + di), p: p.p + dp }));
          }
        }
      }
      this.invalidate();
    });
    const lift = (e: PointerEvent) => {
      if (e.pointerType === 'touch') { touches.delete(e.pointerId); if (pinch) { pinch = touches.size < 2 ? null : { d: spread().d }; this.drag = null; return; } }
      this.applyPan();
      const d = this.drag; this.drag = null;
      if (d?.kind === 'brush') { if (this.draft && this.draft.pts.length > 1) this.finishDraft(); else this.draft = null; this.invalidate(); return; }
      if (d?.kind === 'move' || d?.kind === 'point') this.hooks.onDrawings([...this.s.drawings]);
      if (d?.kind === 'move' && !d.moved) {
        const dr = this.s.drawings.find((q) => q.id === this.selected);
        if (dr && (dr.type === 'text' || dr.type === 'callout')) this.startEdit(dr);
      }
    };
    on('pointerup', lift);
    on('pointercancel', lift);
    on('pointerleave', () => { this.mx = -1; this.my = -1; this.hoverNews = null; this.hoverCal = null; this.hooks.onHover(null, null, null); this.broadcastCross(null, null); this.invalidateOver(); });
    on('dblclick', (e) => {
      const { x, y } = pos(e);
      if (this.draft?.type === 'arrowpath') { this.finishPath(); return; }
      if (region(x, y) === 'paxis') { this.manual = null; this.invalidate(); }
      else if (region(x, y) === 'taxis') { this.resetView(); this.viewChanged(); }
    });
    on('wheel', (e) => {
      e.preventDefault();
      chartSync.leader = this;
      const { x, y } = pos(e);
      const unit = e.deltaMode === 1 ? 33 : e.deltaMode === 2 ? this.h : 1;
      const dX = e.deltaX * unit, dY = e.deltaY * unit;
      if (e.ctrlKey) this.wheelZoom(-(dY || dX), Math.min(x, this.plotW), y, e.shiftKey);
      else if (e.altKey) this.wheelBars(dY || dX);
      else if (e.shiftKey) this.wheelPrice(dY || dX);
      else this.wheelTime(dX + dY);
    }, { passive: false });
  }

  private finishDraft() {
    if (!this.draft) return;
    const d = this.draft; this.draft = null;
    this.hooks.onDrawings([...this.s.drawings, d]);
    this.select(d.id);
    this.hooks.onToolDone();
    if (d.type === 'text' || d.type === 'callout') this.startEdit(d);
  }

  /** Open the inline text editor for a text or callout drawing. */
  private startEdit(dr: Drawing) {
    const P = this.screenPts(dr);
    const o = dr.type === 'callout' ? P[1] ?? P[0] : P[0];
    this.editingId = dr.id;
    this.hooks.onEditText(dr.id, o.x, o.y, dr.text ?? '');
    this.invalidate();
  }

  /** Finish editing. text === null cancels (a drawing that never got text is removed). */
  endEdit(id: string, text: string | null) {
    if (this.editingId === id) this.editingId = null;
    const cur = this.s.drawings.find((d) => d.id === id);
    const val = text === null ? cur?.text ?? '' : text.replace(/\s+$/, '');
    if (!val) {
      if (cur) { this.hooks.onDrawings(this.s.drawings.filter((d) => d.id !== id)); if (this.selected === id) this.select(null); }
    } else if (cur && cur.text !== val) {
      this.hooks.onDrawings(this.s.drawings.map((d) => (d.id === id ? { ...d, text: val } : d)));
    }
    this.invalidate();
  }

  /** Finish a multi-click arrow path: drops the cursor-following point and clicks that landed on the same spot. */
  finishPath() {
    const d = this.draft;
    if (!d || d.type !== 'arrowpath') return false;
    const pts = d.pts.slice(0, -1);
    while (pts.length > 1) {
      const a = this.screen(pts[pts.length - 1]), b = this.screen(pts[pts.length - 2]);
      if (Math.hypot(a.x - b.x, a.y - b.y) < 4) pts.pop(); else break;
    }
    if (pts.length < 2) { this.draft = null; this.invalidate(); return true; }
    d.pts = pts;
    this.finishDraft();
    return true;
  }

  /** Esc: a started arrow path with at least one segment is kept, anything else is dropped. */
  cancelDraft() { if (this.finishPath()) return; this.draft = null; this.invalidate(); }

  deleteSelected() {
    if (!this.selected) return false;
    this.hooks.onDrawings(this.s.drawings.filter((d) => d.id !== this.selected));
    this.select(null); return true;
  }

  private clampStartV(start: number, barW: number) { const vis = (this.w - AXIS_W) / barW; return Math.min(Math.max(start, -vis * 0.9), this.s.data.n + RIGHT_PAD - vis); }
  private clampStart() { this.start = this.clampStartV(this.start, this.barW); }

  private checkHistory() { if (this.start < Math.max(30, ((this.w - AXIS_W) / this.barW) * 0.6)) this.hooks.onNeedHistory(); }

  // ---------- wheel navigation (eased) ----------
  private itx(v: number) { return this.s.log ? Math.exp(v) : v; }

  private ensureTgt() {
    if (this.tgt) return this.tgt;
    return (this.tgt = { start: this.start, barW: this.barW, a: 0, span: 1, zoomT: false, ax: 0, aIdx: 0, price: false, pZoom: false, pFrac: 0, pAnchor: 0 });
  }

  /** Switch the price axis to manual and start tracking it in the target. */
  private ensurePrice() {
    const T = this.ensureTgt(); const m = this.panes[0];
    if (!this.manual) this.manual = { lo: m.lo, hi: m.hi };
    if (!T.price) {
      T.a = this.tx(this.manual.lo); T.span = this.tx(this.manual.hi) - T.a || 1;
      T.price = true; T.pZoom = false;
    }
    return T;
  }

  /** Whole-data price span limits, in axis (log or linear) units. */
  private spanLimits(): [number, number] {
    const d = this.s.data;
    if (this.range.key !== d.h || this.range.n !== d.n) {
      let lo = Infinity, hi = -Infinity;
      for (let i = 0; i < d.n; i++) { if (d.l[i] < lo) lo = d.l[i]; if (d.h[i] > hi) hi = d.h[i]; }
      this.range = { key: d.h, n: d.n, lo: Number.isFinite(lo) ? lo : 0, hi: Number.isFinite(hi) ? hi : 1 };
    }
    const a = this.tx(this.range.lo), b = this.tx(this.range.hi);
    const full = Math.max(b - a, 1e-9);
    return [Math.max(Math.abs((a + b) / 2) * 1e-4, 1e-9), full * 4];
  }

  private kick() { this.easing = true; if (!this.animRaf) this.animRaf = requestAnimationFrame(this.animate); }

  private drawNow() {
    if (this.raf) { cancelAnimationFrame(this.raf); this.raf = 0; }
    this.draw(); this.drawOver();
  }

  private animate = (now: number) => {
    const T = this.tgt;
    if (!T) { this.animRaf = 0; this.lastAnim = 0; return; }
    const dt = Math.min(50, this.lastAnim ? now - this.lastAnim : 16); this.lastAnim = now;
    const k = 1 - Math.exp(-dt / 65);
    this.barW *= Math.pow(T.barW / this.barW, k);
    if (T.zoomT) this.start = this.clampStartV(T.aIdx - (T.ax - this.barW / 2) / this.barW, this.barW);
    else this.start += (T.start - this.start) * k;
    let settled = Math.abs(T.barW / this.barW - 1) < 0.001 && (T.zoomT || Math.abs(T.start - this.start) < 0.01);
    if (T.price && this.manual) {
      const ca = this.tx(this.manual.lo); let span = this.tx(this.manual.hi) - ca;
      if (span > 0 && T.span > 0) {
        span *= Math.pow(T.span / span, k);
        const na = T.pZoom ? T.pAnchor - T.pFrac * span : ca + (T.a - ca) * k;
        this.manual = { lo: this.itx(na), hi: this.itx(na + span) };
        settled = settled && Math.abs(T.span / span - 1) < 0.001 && (T.pZoom || Math.abs(T.a - na) < T.span * 1e-4);
      }
    }
    if (settled) {
      this.barW = T.barW;
      this.start = T.zoomT ? this.clampStartV(T.aIdx - (T.ax - T.barW / 2) / T.barW, T.barW) : T.start;
      if (T.price) this.manual = { lo: this.itx(T.pZoom ? T.pAnchor - T.pFrac * T.span : T.a), hi: this.itx((T.pZoom ? T.pAnchor - T.pFrac * T.span : T.a) + T.span) };
      this.tgt = null;
    }
    this.checkHistory();
    this.viewChanged();
    this.drawNow();
    if (this.tgt) this.animRaf = requestAnimationFrame(this.animate);
    else { this.animRaf = 0; this.lastAnim = 0; }
  };

  /** Scroll: move through time. */
  private wheelTime(delta: number) {
    const T = this.ensureTgt();
    T.zoomT = false;
    // the price scale follows the visible candles again: hand the manual range over to the eased auto scale
    if (this.manual) { this.autoSm = { ...this.manual }; this.manual = null; this.easing = true; this.easeT = performance.now(); }
    T.price = false;
    T.start = this.clampStartV(T.start + (delta * 0.6) / T.barW, T.barW);
    this.kick();
  }

  /** Shift+scroll: stretch or squeeze the price axis around its centre (same as dragging the price axis). */
  private wheelPrice(delta: number) {
    const m = this.panes[0]; if (!m || !this.s.data.n) return;
    const T = this.ensurePrice();
    const [smin, smax] = this.spanLimits();
    const center = T.a + T.span / 2;
    T.span = Math.min(smax, Math.max(smin, T.span * Math.exp(delta * 0.002)));
    T.pZoom = true; T.pFrac = 0.5; T.pAnchor = center;
    T.a = center - T.span / 2;
    this.kick();
  }

  /** Alt+scroll: stretch or squeeze the time axis around the middle of the plot (the counterpart of Shift+scroll on the price axis). */
  private wheelBars(delta: number) {
    if (!this.s.data.n) return;
    const T = this.ensureTgt();
    const ax = this.plotW / 2;
    T.zoomT = true; T.ax = ax; T.aIdx = this.idxOf(ax);
    T.barW = Math.min(BAR_MAX, Math.max(BAR_MIN, T.barW * Math.exp(-delta * 0.002)));
    T.start = this.clampStartV(T.aIdx - (ax - T.barW / 2) / T.barW, T.barW);
    this.kick();
  }

  /** Ctrl+scroll: zoom time and price by the same factor (the x / y ratio never changes) around the cursor; with `toStart` (Ctrl+Shift) with the hard right stop pinned to the right edge (the Reset chart framing). */
  private wheelZoom(amount: number, cx: number, cy: number, toStart = false) {
    const m = this.panes[0]; if (!m || !this.s.data.n) return;
    const T = this.ensurePrice();
    const [smin, smax] = this.spanLimits();
    const f0 = Math.exp(amount * 0.003);
    // one factor for both axes, limited by whichever axis reaches its limit first
    const fl = Math.max(BAR_MIN / T.barW, T.span / smax), fh = Math.min(BAR_MAX / T.barW, T.span / smin);
    let ft: number, f: number;
    if (fl <= fh) {
      ft = f = Math.min(fh, Math.max(fl, f0));
      if ((f0 < 1 && f > 1) || (f0 > 1 && f < 1)) return;
    } else { // a view that is already beyond a limit (dragged / synced): clamp the axes on their own
      ft = Math.min(BAR_MAX, Math.max(BAR_MIN, T.barW * f0)) / T.barW;
      f = T.span / Math.min(smax, Math.max(smin, T.span / f0));
    }
    if (Math.abs(ft - 1) < 1e-4 && Math.abs(f - 1) < 1e-4) return;
    let ax = cx, ay = cy, aIdx = this.idxOf(cx);
    if (toStart) { // like Reset chart: the newest candles at the hard right stop, which stays pinned to the right edge while zooming
      const d = this.s.data;
      ax = this.plotW;
      aIdx = d.n + RIGHT_PAD;
      ay = this.py(d.c[d.n - 1], m);
    }
    // time: keep the anchor bar fixed
    T.zoomT = true; T.ax = ax; T.aIdx = aIdx;
    T.barW *= ft;
    T.start = this.clampStartV(aIdx - (ax - T.barW / 2) / T.barW, T.barW);
    // price: keep the anchor price fixed
    const frac = (m.y1 - Math.min(Math.max(ay, m.y0), m.y1)) / (m.y1 - m.y0 || 1);
    const ca = this.tx(this.manual!.lo), cs = this.tx(this.manual!.hi) - ca;
    T.pZoom = true; T.pFrac = frac; T.pAnchor = ca + frac * cs;
    T.span = T.span / f; T.a = T.pAnchor - frac * T.span;
    this.kick();
  }

  zoomBars(factor: number, anchorPx: number) {
    this.tgt = null;
    const anchor = this.idxOf(anchorPx);
    this.barW = Math.min(Math.max(this.barW * factor, BAR_MIN), BAR_MAX);
    this.start = anchor - (anchorPx - this.barW / 2) / this.barW;
    this.clampStart();
    this.invalidate();
    this.viewChanged();
  }

  panBars(n: number) { this.tgt = null; this.start += n; this.clampStart(); this.checkHistory(); this.invalidate(); this.viewChanged(); }
}
