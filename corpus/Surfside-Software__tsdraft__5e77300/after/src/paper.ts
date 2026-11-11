import type { Units } from "./drawing.ts";
import { paperLengthProblem, type PaperLength, type Ratio } from "./rules.ts";

/** A unit paper lengths are given in. */
export type PaperUnit = "in" | "mm";

/** The view a paper length is converted for. */
export interface PaperScale<R extends number = number> {
  /**
   * How many times larger the model is than its plot, as a plain number: 96
   * for 1/8" = 1'-0", 240 for 1" = 20', 50 for 1:50.
   */
  readonly ratio: Ratio<R>;
  /** The drawing's units, as given to `createDrawing`. */
  readonly units: Units;
}

/** Inches in one of each imperial unit, and millimetres in one of each metric unit. */
const SIZES = {
  in: ["imperial", 1],
  ft: ["imperial", 12],
  mm: ["metric", 1],
  cm: ["metric", 10],
  m: ["metric", 1000],
} as const satisfies Record<Units, readonly [string, number]>;

const MM_PER_INCH = 25.4;

/**
 * Turns a length on paper into drawing units, for text, symbols and dashes
 * that are sized by how large they plot. A 3/32 inch note on a sheet at
 * 1/8" = 1'-0" is 9 inches in the model, which is 0.75 in a drawing in feet:
 *
 * ```ts
 * fromPaper(3 / 32, "in", { ratio: 96, units: "ft" }); // 0.75
 * ```
 *
 * A length or a ratio of 0 or less is a compile error when it is a literal.
 *
 * @param length - The length as it plots, greater than 0.
 * @param unit - The unit of `length`: `"in"` or `"mm"`.
 * @param view - The ratio the length plots at, and the drawing's units.
 * @returns The length in drawing units.
 * @throws When an argument is not one of the above, or when the result would
 * be written as 0 at the 6 decimals tsdraft writes, or is 1e100 or more.
 */
export function fromPaper<L extends number, R extends number>(
  length: PaperLength<L>,
  unit: PaperUnit,
  view: PaperScale<R>,
): number {
  // The arguments are read as unknown, because a parameter that failed its type is a message.
  const paper: unknown = length;
  const { ratio, units }: { ratio: unknown; units: unknown } = view;
  const from = unit === "in" || unit === "mm" ? SIZES[unit] : undefined;
  const to =
    typeof units === "string" && Object.hasOwn(SIZES, units) ? SIZES[units as Units] : undefined;
  if (!from) throw new Error(`The paper unit must be "in" or "mm", not ${JSON.stringify(unit)}`);
  if (!to) throw new Error(`Unknown units: ${JSON.stringify(units)}`);
  if (typeof paper !== "number" || !Number.isFinite(paper)) {
    throw new Error("The paper length must be a finite number");
  }
  if (typeof ratio !== "number" || !Number.isFinite(ratio)) {
    throw new Error("The ratio must be a finite number");
  }
  // Multiplying before dividing keeps 3/32 in at 96 in feet at exactly 0.75.
  const model = paper * ratio * from[1];
  const sameSystem = from[0] === to[0];
  const converted = sameSystem
    ? model
    : from[0] === "imperial"
      ? model * MM_PER_INCH
      : model / MM_PER_INCH;
  const result = converted / to[1];
  const problem = paperLengthProblem(paper, ratio, result);
  if (problem) throw new Error(problem);
  return result;
}
