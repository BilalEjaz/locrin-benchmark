/** A model-space point, in drawing units. Y points up, as in CAD. */
export type Point = readonly [x: number, y: number];

/**
 * The unit one drawing unit stands for. It is kept on the drawing for callers;
 * the DXF R12 writer has no field for it, so set units in CAD after opening.
 */
export type Units = "in" | "ft" | "mm" | "cm" | "m";

export interface Layer {
  readonly name: string;
  /** AutoCAD Color Index, 1 to 255. 7 is white on dark backgrounds, black on light. */
  readonly color: number;
}

interface EntityBase {
  readonly layer: string;
}

export interface Line extends EntityBase {
  readonly kind: "line";
  readonly from: Point;
  readonly to: Point;
}

export interface Polyline extends EntityBase {
  readonly kind: "polyline";
  readonly points: readonly Point[];
  readonly closed: boolean;
}

export interface Circle extends EntityBase {
  readonly kind: "circle";
  readonly center: Point;
  readonly radius: number;
}

/** Angles are in degrees, counterclockwise from +X, as in DXF. */
export interface Arc extends EntityBase {
  readonly kind: "arc";
  readonly center: Point;
  readonly radius: number;
  readonly startAngle: number;
  readonly endAngle: number;
}

export interface Text extends EntityBase {
  readonly kind: "text";
  /** Left end of the text baseline. */
  readonly at: Point;
  readonly height: number;
  readonly value: string;
  /** Degrees counterclockwise. */
  readonly rotation: number;
}

export type Entity = Line | Polyline | Circle | Arc | Text;

export interface Drawing {
  readonly units: Units;
  readonly layers: readonly Layer[];
  readonly entities: readonly Entity[];
}

export interface DrawingOptions {
  readonly units?: Units;
}

export interface LayerOptions {
  readonly color?: number;
}

export interface TextOptions {
  readonly height?: number;
  readonly rotation?: number;
}

/**
 * Builds a drawing. Entities go on the current layer, which starts as "0".
 * `layer(name, opts, draw)` scopes everything drawn inside `draw` to that layer.
 */
export class DrawingBuilder {
  readonly units: Units;
  readonly #layers = new Map<string, Layer>([["0", { name: "0", color: 7 }]]);
  readonly #entities: Entity[] = [];
  #current = "0";

  constructor(options: DrawingOptions = {}) {
    this.units = options.units ?? "in";
  }

  /** Defines or updates a layer. With `draw`, entities drawn inside it go on this layer. */
  layer(name: string, options: LayerOptions = {}, draw?: () => void): this {
    if (!/^[^<>/\\":;?*|=`]{1,255}$/.test(name)) {
      throw new Error(`Invalid layer name: ${JSON.stringify(name)}`);
    }
    const color = options.color ?? this.#layers.get(name)?.color ?? 7;
    if (!Number.isInteger(color) || color < 1 || color > 255) {
      throw new Error(`Layer ${name}: color must be an ACI integer from 1 to 255`);
    }
    this.#layers.set(name, { name, color });
    if (draw) {
      const previous = this.#current;
      this.#current = name;
      try {
        draw();
      } finally {
        this.#current = previous;
      }
    }
    return this;
  }

  line(from: Point, to: Point): this {
    return this.#add({ kind: "line", layer: this.#current, from: pt(from), to: pt(to) });
  }

  polyline(points: readonly Point[], closed = false): this {
    if (points.length < 2) throw new Error("A polyline needs at least 2 points");
    return this.#add({ kind: "polyline", layer: this.#current, points: points.map(pt), closed });
  }

  /** Closed rectangle from its lower-left corner. */
  rect(corner: Point, width: number, height: number): this {
    const [x, y] = pt(corner);
    num(width, "width");
    num(height, "height");
    return this.polyline(
      [
        [x, y],
        [x + width, y],
        [x + width, y + height],
        [x, y + height],
      ],
      true,
    );
  }

  circle(center: Point, radius: number): this {
    return this.#add({
      kind: "circle",
      layer: this.#current,
      center: pt(center),
      radius: positive(radius, "radius"),
    });
  }

  arc(center: Point, radius: number, startAngle: number, endAngle: number): this {
    num(startAngle, "startAngle");
    num(endAngle, "endAngle");
    if (sweep(startAngle, endAngle) === 0)
      throw new Error("An arc's start and end angles must differ");
    return this.#add({
      kind: "arc",
      layer: this.#current,
      center: pt(center),
      radius: positive(radius, "radius"),
      startAngle,
      endAngle,
    });
  }

  text(at: Point, value: string, options: TextOptions = {}): this {
    if (/[\r\n]/.test(value)) throw new Error("Text must be a single line");
    return this.#add({
      kind: "text",
      layer: this.#current,
      at: pt(at),
      value,
      height: positive(options.height ?? 0.125, "height"),
      rotation: num(options.rotation ?? 0, "rotation"),
    });
  }

  build(): Drawing {
    return { units: this.units, layers: [...this.#layers.values()], entities: [...this.#entities] };
  }

  #add(entity: Entity): this {
    this.#entities.push(entity);
    return this;
  }
}

export function createDrawing(options?: DrawingOptions): DrawingBuilder {
  return new DrawingBuilder(options);
}

/** Counterclockwise sweep from start to end, in degrees, within [0, 360). */
export function sweep(startAngle: number, endAngle: number): number {
  return (((endAngle - startAngle) % 360) + 360) % 360;
}

function num(value: number, label: string): number {
  if (!Number.isFinite(value)) throw new Error(`${label} must be a finite number`);
  return value;
}

function positive(value: number, label: string): number {
  if (num(value, label) <= 0) throw new Error(`${label} must be greater than 0`);
  return value;
}

function pt(point: Point): Point {
  return [num(point[0], "x"), num(point[1], "y")];
}
