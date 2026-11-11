// Drafting helpers for the examples. tsdraft draws lines, polylines, circles, arcs and text, and
// these functions compose them into dimensions, leaders, patterns and symbols. In CAD they arrive
// as the plain lines and text they are made of.
import type { DrawingBuilder, Point } from "../../src/index.ts";

/** The builder methods the helpers draw with. */
export type Pen = Pick<DrawingBuilder, "line" | "polyline" | "circle" | "arc" | "text">;

/** A rectangle as its lower-left corner, width and height. */
export type Box = readonly [x: number, y: number, width: number, height: number];

/** Writes inches the way architects do: `27` is `2'-3"`, `36` is `3'-0"`, `1.5` is `1 1/2"`. */
export function feetInches(inches: number): string {
  const sixteenths = Math.round(inches * 16);
  const feet = Math.floor(sixteenths / 192);
  const rest = sixteenths - feet * 192;
  const whole = Math.floor(rest / 16);
  const fraction = reduce(rest % 16, 16);
  let inchText = String(whole);
  if (fraction) inchText = whole ? `${whole} ${fraction}` : fraction;
  return feet > 0 ? `${feet}'-${inchText}"` : `${inchText}"`;
}

function reduce(numerator: number, denominator: number): string {
  if (numerator === 0) return "";
  let top = numerator;
  let bottom = denominator;
  while (top % 2 === 0 && bottom % 2 === 0) {
    top /= 2;
    bottom /= 2;
  }
  return `${top}/${bottom}`;
}

/**
 * The estimated width of a line of text. tsdraft places text by the left end of its baseline, so
 * centered and right-aligned text is placed from this estimate. The README picture renders text
 * in a monospace font, where each character is about 0.6 of the text height wide.
 */
export function textWidth(value: string, height: number): number {
  return value.length * 0.6 * height;
}

export type Align = "left" | "center" | "right";

/** Text with its baseline through `at`, aligned on `at` along the baseline. */
export function label(
  d: Pen,
  at: Point,
  value: string,
  height: number,
  align: Align = "left",
  rotation = 0,
): void {
  const shift = { left: 0, center: 0.5, right: 1 }[align] * textWidth(value, height);
  const angle = (rotation * Math.PI) / 180;
  const start: Point = [at[0] - shift * Math.cos(angle), at[1] - shift * Math.sin(angle)];
  d.text(start, value, rotation ? { height, rotation } : { height });
}

export interface DimensionStyle {
  /** Text height. */
  readonly text: number;
  /** Half the width of a tick mark. */
  readonly tick: number;
  /** The gap between the object and the start of an extension line. */
  readonly gap: number;
  /** How far an extension line runs past the dimension line. */
  readonly extend: number;
}

/**
 * A chained string of linear dimensions between `points`, measured along `axis`. The dimension
 * line runs at `at` on the other axis: a y for horizontal dimensions, an x for vertical ones. Each
 * text is the measured distance, centered above its line, and reads from below or from the right.
 * A text too wide for its space goes below the line instead.
 */
export function dimensionChain(
  d: Pen,
  points: readonly Point[],
  axis: "x" | "y",
  at: number,
  style: DimensionStyle,
): void {
  // Work in (along, across) coordinates so one routine draws both directions.
  const along = axis === "x" ? 0 : 1;
  const toPoint = (a: number, c: number): Point => (axis === "x" ? [a, c] : [c, a]);
  const sorted = [...points].sort((p, q) => p[along] - q[along]);
  const first = sorted[0];
  const last = sorted.at(-1);
  if (!first || !last || sorted.length < 2) throw new Error("A dimension needs two points");

  for (const p of sorted) {
    const a = p[along];
    const c = p[1 - along] ?? 0;
    const direction = Math.sign(at - c);
    if (Math.abs(at - c) > style.gap) {
      d.line(toPoint(a, c + direction * style.gap), toPoint(a, at + direction * style.extend));
    }
    d.line(toPoint(a - style.tick, at - style.tick), toPoint(a + style.tick, at + style.tick));
  }
  d.line(toPoint(first[along], at), toPoint(last[along], at));

  for (let i = 1; i < sorted.length; i++) {
    const a0 = sorted[i - 1]?.[along] ?? 0;
    const a1 = sorted[i]?.[along] ?? 0;
    const value = feetInches(a1 - a0);
    const middle = (a0 + a1) / 2;
    // Text that does not fit between the extension lines goes on the other side of the line.
    const fits = textWidth(value, style.text) + style.text < a1 - a0;
    const lift = fits ? style.text * 0.5 : -style.text * 1.5;
    if (axis === "x") label(d, [middle, at + lift], value, style.text, "center");
    else label(d, [at - lift, middle], value, style.text, "center", 90);
  }
}

/** One linear dimension from `from` to `to`. */
export function dimension(
  d: Pen,
  from: Point,
  to: Point,
  axis: "x" | "y",
  at: number,
  style: DimensionStyle,
): void {
  dimensionChain(d, [from, to], axis, at, style);
}

/**
 * A note with a leader. The leader runs from an arrowhead at `target` to `elbow`, then turns into
 * a short horizontal shoulder. The note's lines stack downward beyond the shoulder, on the side
 * away from the target, with the first line centered on the shoulder.
 */
export function leader(
  d: Pen,
  target: Point,
  elbow: Point,
  lines: readonly string[],
  height: number,
): void {
  const side = elbow[0] >= target[0] ? 1 : -1;
  const end: Point = [elbow[0] + side * height, elbow[1]];
  d.polyline([target, elbow, end]);
  arrowhead(d, target, elbow, height * 0.8);
  const x = end[0] + side * height * 0.5;
  lines.forEach((line, i) => {
    const baseline = elbow[1] - height * 0.4 - i * height * 1.5;
    label(d, [x, baseline], line, height, side > 0 ? "left" : "right");
  });
}

/** A slim closed arrowhead with its tip at `tip`, pointing away from `from`. */
export function arrowhead(d: Pen, tip: Point, from: Point, length: number): void {
  const dx = tip[0] - from[0];
  const dy = tip[1] - from[1];
  const size = Math.hypot(dx, dy);
  const [ux, uy] = [dx / size, dy / size];
  const half = length / 6;
  const base: Point = [tip[0] - ux * length, tip[1] - uy * length];
  d.polyline(
    [tip, [base[0] - uy * half, base[1] + ux * half], [base[0] + uy * half, base[1] - ux * half]],
    true,
  );
}

/** A horizontal or vertical line from `from` to `to`, leaving out the parts inside `holes`. */
export function lineOutside(d: Pen, from: Point, to: Point, holes: readonly Box[]): void {
  const along = from[1] === to[1] ? 0 : 1;
  const across = 1 - along;
  const c = from[across] ?? 0;
  const point = (a: number): Point => (along === 0 ? [a, c] : [c, a]);
  const cuts = holes
    .filter((h) => c > (h[across] ?? 0) && c < (h[across] ?? 0) + (h[across + 2] ?? 0))
    .map((h) => [h[along] ?? 0, (h[along] ?? 0) + (h[along + 2] ?? 0)] as const)
    .sort((p, q) => p[0] - q[0]);
  let start = Math.min(from[along], to[along]);
  const end = Math.max(from[along], to[along]);
  for (const [cutStart, cutEnd] of cuts) {
    if (cutStart > start) d.line(point(start), point(Math.min(cutStart, end)));
    start = Math.max(start, cutEnd);
    if (start >= end) return;
  }
  d.line(point(start), point(end));
}

/** The inside lines of a square grid over `area`, such as tile joints, leaving out `holes`. */
export function gridLines(d: Pen, area: Box, size: number, holes: readonly Box[]): void {
  const [x0, y0, w, h] = area;
  for (let x = x0 + size; x < x0 + w - 0.01; x += size) {
    lineOutside(d, [x, y0], [x, y0 + h], holes);
  }
  for (let y = y0 + size; y < y0 + h - 0.01; y += size) {
    lineOutside(d, [x0, y], [x0 + w, y], holes);
  }
}

/** Rounds a point to 0.01 so patterns of many short lines stay small in the files. */
function round(p: Point): Point {
  return [Math.round(p[0] * 100) / 100, Math.round(p[1] * 100) / 100];
}

/** A linear congruential generator: the same seed gives the same numbers on every run. */
function seededRandom(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };
}

function inside(p: Point, box: Box, margin: number): boolean {
  const [x, y, w, h] = box;
  return p[0] > x - margin && p[0] < x + w + margin && p[1] > y - margin && p[1] < y + h + margin;
}

export interface StippleOptions {
  /** The size of the grid cell that gets one mark. Smaller is denser. */
  readonly spacing: number;
  /** The length of the longest stroke. Dots are 0.15 of it. */
  readonly stroke: number;
  /** Chooses the marks. Each seed gives its own pattern, the same on every run. */
  readonly seed: number;
  /** The clear space kept around each hole and inside the edge of the area. */
  readonly margin?: number;
}

/**
 * A stucco stipple: a grid of cells over `area`, with one short stroke or dot at a random spot
 * in each cell, so the marks look scattered but cover the area evenly. A mark that would touch a
 * hole, or come within `margin` of one, is left out.
 */
export function stipple(d: Pen, area: Box, holes: readonly Box[], options: StippleOptions): void {
  const { spacing, stroke, seed, margin = spacing / 2 } = options;
  const random = seededRandom(seed);
  const [x0, y0, w, h] = area;
  const inner: Box = [x0 + margin, y0 + margin, w - margin * 2, h - margin * 2];
  for (let y = y0; y < y0 + h; y += spacing) {
    for (let x = x0; x < x0 + w; x += spacing) {
      const center: Point = [x + random() * spacing, y + random() * spacing];
      const length = random() < 0.6 ? stroke * 0.15 : stroke * (0.4 + 0.6 * random());
      const angle = random() * Math.PI;
      const half: Point = [(Math.cos(angle) * length) / 2, (Math.sin(angle) * length) / 2];
      const a = round([center[0] - half[0], center[1] - half[1]]);
      const b = round([center[0] + half[0], center[1] + half[1]]);
      const clear = (p: Point) =>
        inside(p, inner, 0) && !holes.some((hole) => inside(p, hole, margin));
      if (clear(a) && clear(b)) d.line(a, b);
    }
  }
}

/**
 * Diagonal hatch lines `spacing` apart, clipped to `area`. Slope 1 rises to the right and -1
 * falls. The lines line up across neighboring areas hatched with the same spacing.
 */
export function hatch(d: Pen, area: Box, spacing: number, slope: 1 | -1 = 1): void {
  const [x0, y0, w, h] = area;
  const [x1, y1] = [x0 + w, y0 + h];
  // Each line is y = slope * x + c, and c steps so that the lines are `spacing` apart.
  const step = spacing * Math.SQRT2;
  const [cMin, cMax] = slope === 1 ? [y0 - x1, y1 - x0] : [y0 + x0, y1 + x1];
  for (let c = Math.ceil(cMin / step) * step; c < cMax; c += step) {
    const from = slope === 1 ? Math.max(x0, y0 - c) : Math.max(x0, c - y1);
    const to = slope === 1 ? Math.min(x1, y1 - c) : Math.min(x1, c - y0);
    if (to - from > 0.05) d.line(round([from, slope * from + c]), round([to, slope * to + c]));
  }
}

/**
 * Earth below grade, as the soil pattern CAD programs hatch with: a weave of short line triples
 * set at 45 degrees, each triple turned across its neighbors. Triples that would leave the area or
 * touch a hole are left out.
 */
export function earth(d: Pen, area: Box, holes: readonly Box[], size: number): void {
  const [x0, y0, w, h] = area;
  // Cells are laid out along the diagonals u = (x + y) / sqrt 2 and v = (y - x) / sqrt 2.
  const toXY = (u: number, v: number): Point => [(u - v) / Math.SQRT2, (u + v) / Math.SQRT2];
  const uMin = (x0 + y0) / Math.SQRT2;
  const uMax = (x0 + w + y0 + h) / Math.SQRT2;
  const vMin = (y0 - x0 - w) / Math.SQRT2;
  const vMax = (y0 + h - x0) / Math.SQRT2;
  const clear = (p: Point) =>
    inside(p, area, 0) && !holes.some((hole) => inside(p, hole, size * 0.2));
  for (let i = Math.floor(uMin / size); i * size < uMax; i++) {
    for (let j = Math.floor(vMin / size); j * size < vMax; j++) {
      const u = (i + 0.5) * size;
      const v = (j + 0.5) * size;
      const alongU = (i + j) % 2 === 0;
      for (const k of [-0.25, 0, 0.25]) {
        const [du, dv] = alongU ? [0.3 * size, 0] : [0, 0.3 * size];
        const [ou, ov] = alongU ? [0, k * size] : [k * size, 0];
        const from = round(toXY(u + ou - du, v + ov - dv));
        const to = round(toXY(u + ou + du, v + ov + dv));
        if (clear(from) && clear(to)) d.line(from, to);
      }
    }
  }
}

/**
 * Batt insulation: a looping line across `area`, the symbol drafters draw insulation with. Each
 * loop is as tall as the area and half as wide.
 */
export function insulation(d: Pen, area: Box): void {
  const [x0, y0, w, h] = area;
  const radius = h / 2;
  const across = h / 4; // half the width of a loop
  const advance = h * 0.35; // how far the line moves along for each loop
  const loops = Math.max(1, Math.floor((w - across * 2) / advance));
  const start = x0 + (w - loops * advance) / 2;
  const points: Point[] = [];
  for (let i = 0; i <= loops * 24; i++) {
    const t = (i / 24) * 2 * Math.PI;
    const x = start + (advance * t) / (2 * Math.PI) - across * Math.sin(t);
    points.push(round([x, y0 + radius - radius * Math.cos(t)]));
  }
  d.polyline(points);
}

/** A dashed line from `from` to `to`, starting and ending with a dash. */
export function dashedLine(d: Pen, from: Point, to: Point, dash: number, gap: number): void {
  const length = Math.hypot(to[0] - from[0], to[1] - from[1]);
  const count = Math.max(1, Math.round((length + gap) / (dash + gap)));
  const space = count > 1 ? (length - count * dash) / (count - 1) : 0;
  const along = (distance: number): Point => {
    const t = Math.min(distance / length, 1);
    return [from[0] + (to[0] - from[0]) * t, from[1] + (to[1] - from[1]) * t];
  };
  for (let i = 0; i < count; i++) {
    const start = i * (dash + space);
    d.line(round(along(start)), round(along(count > 1 ? start + dash : length)));
  }
}

/** A break line from `from` to `to`, with a zigzag `size` high at its middle. */
export function breakLine(d: Pen, from: Point, to: Point, size: number): void {
  const length = Math.hypot(to[0] - from[0], to[1] - from[1]);
  const [ux, uy] = [(to[0] - from[0]) / length, (to[1] - from[1]) / length];
  const [mx, my] = [(from[0] + to[0]) / 2, (from[1] + to[1]) / 2];
  const at = (a: number, n: number): Point => [mx + ux * a - uy * n, my + uy * a + ux * n];
  d.polyline([
    from,
    at(-size * 0.5, 0),
    at(-size * 0.2, size),
    at(size * 0.2, -size),
    at(size * 0.5, 0),
    to,
  ]);
}

export interface ViewTitleOptions {
  readonly number: string;
  readonly title: string;
  readonly scale: string;
  /** The length of the underline, from the left of the bubble. */
  readonly width: number;
  /** The height of the title. The bubble and the scale are sized from it. */
  readonly height: number;
}

/**
 * A view title: the view number in a bubble, the title above a long underline, and the scale
 * below it. `at` is the left edge of the bubble, level with its center and the underline.
 */
export function viewTitle(d: Pen, at: Point, options: ViewTitleOptions): void {
  const { number, title, scale, width, height } = options;
  const radius = height * 0.9;
  const [x, y] = at;
  d.circle([x + radius, y], radius);
  label(d, [x + radius, y - height * 0.4], number, height, "center");
  d.line([x + radius * 2, y], [x + width, y]);
  const textX = x + radius * 2 + height * 0.5;
  label(d, [textX, y + height * 0.35], title, height);
  label(d, [textX, y - height * 0.9], scale, height / 2);
}

/**
 * A section-cut mark: a bubble with the number of the view the cut is drawn in, an arrow beside it
 * pointing the way the section looks, and a cut line from the bubble to `cut`.
 */
export function sectionMark(
  d: Pen,
  center: Point,
  cut: Point,
  number: string,
  pointing: 1 | -1,
  height: number,
): void {
  const radius = height * 0.9;
  const [x, y] = center;
  d.circle(center, radius);
  label(d, [x, y - height * 0.4], number, height, "center");
  d.line([x, y - radius], cut);
  // The arrow is two lines from its tip that touch the bubble.
  const reach = 2.2;
  const tip: Point = [x + pointing * radius * reach, y];
  const across = (pointing * radius) / reach;
  const up = radius * Math.sqrt(1 - 1 / reach ** 2);
  d.line(tip, [x + across, y + up]);
  d.line(tip, [x + across, y - up]);
}
