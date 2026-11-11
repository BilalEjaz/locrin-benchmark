// The rules a drawing must follow for AutoCAD to open its DXF. Each rule exists
// twice: as a type, so a literal mistake is an error in the editor, and as a
// runtime check, for values the compiler can't see. The messages are shared.
//
// AutoCAD discards the whole drawing over most names that break the name rules.
import type { DxfVersion } from "./drawing.ts";
import { isTooLarge, written, writtenAngle } from "./format.ts";
import { BUILT_IN_LINETYPES, builtInLinetype, LINEWEIGHTS, patternLength } from "./linetypes.ts";
import {
  layerAuditKey,
  layerKey,
  rejectedNameCharacter,
  type REJECTED_COPTIC,
  type REJECTED_FORMAT,
  type REJECTED_GEORGIAN,
  type REJECTED_GLAGOLITIC,
  type REJECTED_LETTERLIKE,
  type REJECTED_PRIVATE,
} from "./layers.ts";

// AutoCAD holds layer names and linetype names to the same rules, so each rule has a message
// for each kind of name.
const LAYER_NAMES = {
  empty: "Layer names cannot be empty",
  chars: 'Layer names cannot contain < > / \\ " : ; ? * | = ` ^ , or line breaks',
  rejected:
    "Layer names cannot contain a character AutoCAD rejects or replaces in names, such as a zero-width space or the ohm sign U+2126. docs/layer-names.md in the tsdraft repository lists them",
  edge: "Layer names cannot start or end with a space",
  length: "Layer names cannot be longer than 255 characters",
} as const;
const LINETYPE_NAMES = {
  empty: "Linetype names cannot be empty",
  chars: 'Linetype names cannot contain < > / \\ " : ; ? * | = ` ^ , or line breaks',
  rejected:
    "Linetype names cannot contain a character AutoCAD rejects or replaces in names, such as a zero-width space or the ohm sign U+2126. docs/layer-names.md in the tsdraft repository lists them",
  edge: "Linetype names cannot start or end with a space",
  length: "Linetype names cannot be longer than 255 characters",
} as const;
type NameMessages = typeof LAYER_NAMES | typeof LINETYPE_NAMES;
const NAME_R12_CHARS =
  'R12 layer names can only use letters, digits, $, - and _. Use DXF version "R2018" for other characters';
const NAME_R12_LENGTH =
  'R12 layer names cannot be longer than 31 characters. Use DXF version "R2018" for longer names';
const COLOR = "A layer color must be an AutoCAD Color Index integer from 1 to 255";
const POSITIVE = "This value must be greater than 0";
const WRITTEN_AS_ZERO =
  "This value is written as 0, because tsdraft writes 6 decimals. Use 0.000001 or more";
const TOO_LARGE =
  "This value must be under 1e100, because AutoCAD reads only two exponent digits from DXF and would take 1e+100 for 1e+10";
const ARC_LOST =
  "An arc of nearly a full turn cannot be written: its angles are the same once rounded to 6 decimals, so AutoCAD would hold an arc of no length. Draw a circle instead";
const TEXT_CONTROL = "Text must be a single line with no control characters";
const TEXT_PRIVATE_USE =
  "Text cannot contain the private-use characters U+E800 to U+E8FF, because AutoCAD replaces them when it reads DXF";
const R12_LINETYPES =
  'R12 drawings have no linetypes but Continuous, and no linetype scale. Use DXF version "R2018" for linetypes';
const R12_LINEWEIGHTS = 'R12 drawings have no lineweights. Use DXF version "R2018" for lineweights';
const R12_ENTITY_STYLE =
  'R12 entities take no linetype or lineweight of their own. Use DXF version "R2018" for an entity linetype or lineweight';
const R12_LAYER_STATES =
  'tsdraft writes no layer states to R12 drawings. Use DXF version "R2018" for layers that are off, frozen, locked or not plotted';
const LINEWEIGHT =
  "A lineweight must be one of AutoCAD's, in millimetres: 0, 0.05, 0.09, 0.13, 0.15, 0.18, 0.2, 0.25, 0.3, 0.35, 0.4, 0.5, 0.53, 0.6, 0.7, 0.8, 0.9, 1, 1.06, 1.2, 1.4, 1.58, 2 or 2.11";
const LAYER_LINEWEIGHT = `${LINEWEIGHT}, or "Default"`;
const ENTITY_LINEWEIGHT = `${LINEWEIGHT}, or "ByLayer", "ByBlock" or "Default"`;
const FROZEN_CURRENT =
  'Layer "0" cannot be frozen: it is the current layer, and AutoCAD does not freeze the current layer';
const LAYER_LINETYPE =
  "A layer's linetype cannot be ByLayer or ByBlock. AutoCAD's AUDIT reports a layer with either";
const BUILT_IN =
  "Continuous, ByLayer and ByBlock are in every drawing and cannot be defined. AutoCAD keeps its own and drops the definition";
const PATTERN_COUNT =
  "A linetype pattern has 2 to 12 lengths, or none for a solid line. AutoCAD's AUDIT reports a pattern of one length, and AutoCAD discards a drawing with a pattern of more than 12";
const PATTERN_WRITTEN_AS_ZERO =
  "A dash or gap of this length is written as 0, because tsdraft writes 6 decimals, and would draw as a dot. Use 0 for a dot, or a length of 0.000001 or more";
const PATTERN_TOTAL =
  "A linetype pattern's lengths, added up without their signs, must be under 1e100. The total is written too, and AutoCAD reads only two exponent digits from DXF";
const PATTERN_TYPE = "A linetype's pattern must be an array of finite numbers";
const DESCRIPTION_LENGTH =
  "A linetype description cannot be longer than 249 characters, because AutoCAD cuts it there when it reads DXF";
const TEXT_PERCENT =
  'AutoCAD reads "%%" in text as the start of a control code: it draws "%%d" as a degree sign and "%%%" as one percent sign. The text is stored as written';

type ForbiddenChar =
  | "<"
  | ">"
  | "/"
  | "\\"
  | '"'
  | ":"
  | ";"
  | "?"
  | "*"
  | "|"
  | "="
  | "`"
  | "^"
  | ","
  | "\n"
  | "\r"
  | "\t";

type Chars<S extends string, Found = never> = S extends `${infer C}${infer Rest}`
  ? Chars<Rest, Found | C>
  : Found;
type R12Char = Chars<"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789$_-">;
type RejectedChar =
  | Chars<typeof REJECTED_FORMAT>
  | Chars<typeof REJECTED_LETTERLIKE>
  | Chars<typeof REJECTED_GLAGOLITIC>
  | Chars<typeof REJECTED_COPTIC>
  | Chars<typeof REJECTED_GEORGIAN>
  | Chars<typeof REJECTED_PRIVATE>;

/** Walks the name one character at a time, counting, so it can check both the characters and the length. */
type R12Name<
  N extends string,
  Rest extends string = N,
  Count extends 0[] = [],
> = Count["length"] extends 32
  ? typeof NAME_R12_LENGTH
  : Rest extends `${infer C}${infer Tail}`
    ? C extends R12Char
      ? R12Name<N, Tail, [...Count, 0]>
      : typeof NAME_R12_CHARS
    : N;

/** Resolves to `Valid` when `N` passes the rules layer and linetype names share, and to the message otherwise. */
type NameCheck<N extends string, M extends NameMessages, Valid> = N extends ""
  ? M["empty"]
  : N extends `${string}${ForbiddenChar}${string}`
    ? M["chars"]
    : N extends `${string}${RejectedChar}${string}`
      ? M["rejected"]
      : N extends ` ${string}` | `${string} `
        ? M["edge"]
        : Valid;

/**
 * Resolves to `N` when it is a valid layer name for DXF version `V`, and to the
 * error message otherwise, so the compiler reports the reason. Names that are
 * not literals pass the compiler and are checked when the code runs.
 */
export type LayerName<N extends string, V extends DxfVersion> = string extends N
  ? N
  : NameCheck<N, typeof LAYER_NAMES, V extends "R12" ? R12Name<N> : N>;

/**
 * Resolves to `N` when it is a valid name for a linetype to be used by, and to
 * the error message otherwise. AutoCAD holds linetype names to the rules of
 * layer names, apart from R12's, since R12 drawings have no linetypes.
 */
export type LinetypeName<N extends string> = string extends N
  ? N
  : NameCheck<N, typeof LINETYPE_NAMES, N>;

type Enumerate<N extends number, A extends number[] = []> = A["length"] extends N
  ? A[number]
  : Enumerate<N, [...A, A["length"]]>;

/** AutoCAD Color Index: an integer from 1 to 255. */
export type Aci = Exclude<Enumerate<256>, 0>;

/** Resolves to `C` when it is a valid layer color, and to the error message otherwise. */
export type LayerColor<C extends number> = number extends C ? C : C extends Aci ? C : typeof COLOR;

/**
 * True for a number the writers round to 0, given as the compiler prints it.
 * A number under 0.000001 prints in exponent form, such as `4e-7`, and those
 * under 0.0000005 round to 0. `5e-7` itself is stored a little below a half,
 * so it rounds down too.
 */
type WrittenAsZero<S extends string> = S extends `${infer Mantissa}e-${infer Exponent}`
  ? Exponent extends "7"
    ? Mantissa extends "5"
      ? true
      : Mantissa extends `${5 | 6 | 7 | 8 | 9}${string}`
        ? false
        : true
    : true
  : false;

type Digit = "0" | "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9";

/**
 * Resolves to `N` when it is a size the writers can keep, and to the error
 * message otherwise: `N` must be greater than 0, must not round to 0 at the
 * 6 decimals tsdraft writes, and must be under 1e100, where the compiler
 * prints a third exponent digit as the writers do.
 */
export type Positive<N extends number> = number extends N
  ? N
  : `${N}` extends `-${string}` | "0"
    ? typeof POSITIVE
    : WrittenAsZero<`${N}`> extends true
      ? typeof WRITTEN_AS_ZERO
      : `${N}` extends `${string}e+${Digit}${Digit}${Digit}`
        ? typeof TOO_LARGE
        : N;

type BuiltInName = Lowercase<(typeof BUILT_IN_LINETYPES)[number]>;

/**
 * Resolves to `N` when it is a valid name for a new linetype, and to the error
 * message otherwise: a name that is valid to use, and not one of the linetypes
 * every drawing has.
 */
export type NewLinetypeName<N extends string> = string extends N
  ? N
  : Lowercase<N> extends BuiltInName
    ? typeof BUILT_IN
    : LinetypeName<N>;

/** Resolves to `N` when it is a valid linetype for a layer, and to the error message otherwise. */
export type LayerLinetypeName<N extends string> = string extends N
  ? N
  : Lowercase<N> extends "bylayer" | "byblock"
    ? typeof LAYER_LINETYPE
    : LinetypeName<N>;

type Unsigned<S extends string> = S extends `-${infer A}` ? A : S;

/**
 * The message for each literal pattern length the writers cannot keep: one
 * written as 0 that is not 0, or one of 1e100 or more in size.
 */
type LengthProblem<N extends number> = N extends unknown
  ? number extends N
    ? never
    : Unsigned<`${N}`> extends "0"
      ? never
      : WrittenAsZero<Unsigned<`${N}`>> extends true
        ? typeof PATTERN_WRITTEN_AS_ZERO
        : Unsigned<`${N}`> extends `${string}e+${Digit}${Digit}${Digit}`
          ? typeof TOO_LARGE
          : never
  : never;

/** The message for the first length of `P` with a problem, in the order `linetypeProblem` checks them. */
type FirstLengthProblem<P extends readonly number[]> = P extends readonly [
  infer N extends number,
  ...infer Rest extends readonly number[],
]
  ? [LengthProblem<N>] extends [never]
    ? FirstLengthProblem<Rest>
    : LengthProblem<N>
  : never;

/**
 * Resolves to `P` when it is a pattern AutoCAD accepts, and to the error
 * message otherwise. A pattern that is not a tuple, and the total of the
 * lengths, which the compiler cannot add, are checked when the code runs.
 */
export type Pattern<P extends readonly number[]> = number extends P["length"]
  ? P
  : P["length"] extends 0 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12
    ? [FirstLengthProblem<P>] extends [never]
      ? P
      : FirstLengthProblem<P>
    : typeof PATTERN_COUNT;

type ControlChar =
  Chars<"\u0000\u0001\u0002\u0003\u0004\u0005\u0006\u0007\u0008\u0009\u000a\u000b\u000c\u000d\u000e\u000f\u0010\u0011\u0012\u0013\u0014\u0015\u0016\u0017\u0018\u0019\u001a\u001b\u001c\u001d\u001e\u001f\u007f">;

/**
 * Resolves to `D` when it is a linetype description AutoCAD keeps, and to the
 * error message otherwise. Its length, and characters above U+FFFF, are checked
 * when the code runs.
 */
export type Description<D extends string> = string extends D
  ? D
  : D extends `${string}${ControlChar}${string}`
    ? typeof TEXT_CONTROL
    : D extends `${string}${Chars<typeof REJECTED_PRIVATE>}${string}`
      ? typeof TEXT_PRIVATE_USE
      : D;

/** A lineweight AutoCAD offers, in millimetres. */
export type LineweightMm =
  | 0
  | 0.05
  | 0.09
  | 0.13
  | 0.15
  | 0.18
  | 0.2
  | 0.25
  | 0.3
  | 0.35
  | 0.4
  | 0.5
  | 0.53
  | 0.6
  | 0.7
  | 0.8
  | 0.9
  | 1
  | 1.06
  | 1.2
  | 1.4
  | 1.58
  | 2
  | 2.11;

/** Resolves to `W` when it is one of AutoCAD's lineweights, and to the error message otherwise. */
export type LineweightOf<W extends number> = number extends W
  ? W
  : W extends LineweightMm
    ? W
    : typeof LINEWEIGHT;

/** The message for each feature an R12 drawing cannot have, as a type. */
export type R12Linetypes = typeof R12_LINETYPES;
export type R12Lineweights = typeof R12_LINEWEIGHTS;
export type R12EntityStyle = typeof R12_ENTITY_STYLE;
export type R12LayerStates = typeof R12_LAYER_STATES;
export type FrozenCurrent = typeof FROZEN_CURRENT;

/** Returns what is wrong with a layer name for a DXF version, or undefined when it is valid. */
export function layerNameProblem(name: string, version: DxfVersion): string | undefined {
  const problem = nameProblem(name, LAYER_NAMES);
  if (problem) return problem;
  if (version === "R12") {
    if (!/^[A-Za-z0-9$_-]+$/.test(name)) return NAME_R12_CHARS;
    if (name.length > 31) return NAME_R12_LENGTH;
  }
  return undefined;
}

/**
 * Returns what is wrong with a linetype name, or undefined when it is valid.
 * The name may be one of the linetypes every drawing has.
 */
export function linetypeNameProblem(name: string): string | undefined {
  return nameProblem(name, LINETYPE_NAMES);
}

function nameProblem(name: string, messages: NameMessages): string | undefined {
  if (name.length === 0) return messages.empty;
  if (/[<>/\\":;?*|=`^,]/.test(name) || hasControl(name) || hasAstral(name)) return messages.chars;
  const rejected = rejectedNameCharacter(name);
  if (rejected !== undefined) return `${messages.rejected}. This name has ${codePoint(rejected)}`;
  // Only the ASCII space: AutoCAD takes a no-break space or any other at either end.
  if (name.startsWith(" ") || name.endsWith(" ")) return messages.edge;
  if (name.length > 255) return messages.length;
  return undefined;
}

/**
 * Returns what is wrong with a drawing that has both names as layers, or
 * undefined when the two can stand together. AutoCAD looks layers up one way
 * and its AUDIT compares their names another, so some pairs of names are two
 * layers to AutoCAD and one duplicate name to AUDIT: `ΟΔΟΣ` and `οδος`,
 * `straße` and `strasse`, a composed é and a decomposed one, and a name with
 * and without a soft hyphen. `layerAuditKey` lists the kinds this covers,
 * which are not all that AUDIT reports. Names that are one layer to AutoCAD
 * are not this function's concern. The rule compares two names, so it has no
 * type.
 *
 * @param name - The name of the layer being checked.
 * @param other - The name of another layer in the drawing.
 * @param kind - Whether the names are of layers or of linetypes, which AutoCAD compares alike.
 * @returns The problem, or undefined.
 */
export function layerTwinProblem(
  name: string,
  other: string,
  kind: "layer" | "linetype" = "layer",
): string | undefined {
  if (layerKey(name) === layerKey(other) || layerAuditKey(name) !== layerAuditKey(other)) {
    return undefined;
  }
  return `AutoCAD keeps this ${kind} and ${JSON.stringify(other)} as two ${kind}s, but its AUDIT reports them as one duplicate name`;
}

/**
 * Returns what is wrong with a linetype definition, or undefined when it is
 * valid. It takes `unknown`s so that `lint` can report a drawing built by hand
 * with a field of the wrong type.
 */
export function linetypeProblem(
  name: unknown,
  description: unknown,
  pattern: unknown,
): string | undefined {
  if (typeof name !== "string") return "A linetype's name must be a string";
  const nameError = linetypeNameProblem(name);
  if (nameError) return nameError;
  if (builtInLinetype(name)) return BUILT_IN;
  if (typeof description !== "string") return "A linetype's description must be a string";
  const descriptionError = textProblem(description);
  if (descriptionError) return `its description: ${descriptionError}`;
  if (description.length > 249) return DESCRIPTION_LENGTH;
  if (!Array.isArray(pattern)) return PATTERN_TYPE;
  if (pattern.length === 1 || pattern.length > 12) return PATTERN_COUNT;
  for (const length of pattern as unknown[]) {
    if (typeof length !== "number" || !Number.isFinite(length)) return PATTERN_TYPE;
    if (length !== 0 && written(length) === 0) return `its pattern: ${PATTERN_WRITTEN_AS_ZERO}`;
    const problem = magnitudeProblem(length);
    if (problem) return `its pattern: ${problem}`;
  }
  // The writers write the total of the lengths as they write each one, rounded.
  if (isTooLarge(patternLength((pattern as number[]).map(written)))) {
    return `its pattern: ${PATTERN_TOTAL}`;
  }
  return undefined;
}

/**
 * Returns what is wrong with a layer or an entity that names a linetype the
 * drawing does not have. The rule depends on the drawing, so it has no type.
 */
export function undefinedLinetypeProblem(name: string): string {
  return `Linetype ${JSON.stringify(name)} is not defined, and AutoCAD discards a drawing that uses a linetype it does not have`;
}

/** Returns what is wrong with the linetype a layer names, or undefined when it can be a layer's. */
export function layerLinetypeProblem(name: string): string | undefined {
  const builtInName = builtInLinetype(name);
  return builtInName === "ByLayer" || builtInName === "ByBlock" ? LAYER_LINETYPE : undefined;
}

/**
 * Returns what is wrong with a lineweight, or undefined when it is valid. A
 * layer's lineweight may also be "Default", and an entity's "ByLayer",
 * "ByBlock" or "Default". AutoCAD discards a drawing with an entity of any
 * other lineweight, and gives a layer of another lineweight the default.
 *
 * @param value - The lineweight, in millimetres or by name.
 * @param of - Whose lineweight it is.
 * @returns The problem, or undefined.
 */
export function lineweightProblem(value: unknown, of: "layer" | "entity"): string | undefined {
  if (value === "Default" || (of === "entity" && (value === "ByLayer" || value === "ByBlock"))) {
    return undefined;
  }
  if (typeof value === "number" && (LINEWEIGHTS as readonly number[]).includes(value))
    return undefined;
  return of === "layer" ? LAYER_LINEWEIGHT : ENTITY_LINEWEIGHT;
}

/**
 * Returns what is wrong with a layer's states, or undefined when AutoCAD takes
 * them. tsdraft writes layer "0" as the current layer, and AutoCAD's AUDIT
 * reports a drawing whose current layer is frozen.
 */
export function layerStateProblem(name: string, frozen: boolean | undefined): string | undefined {
  return frozen && name === "0" ? FROZEN_CURRENT : undefined;
}

/** Returns what is wrong with the value of a layer's `off`, `frozen`, `locked` or `plot`. */
export function layerFlagProblem(state: string, value: unknown): string | undefined {
  return value === undefined || typeof value === "boolean"
    ? undefined
    : `${state} must be true or false`;
}

/**
 * Returns what is wrong with the global linetype scale, or undefined when it is
 * valid. AutoCAD reads a scale of 0 or less, or one written as 0, as 1.
 */
export function linetypeScaleProblem(value: number): string | undefined {
  if (!Number.isFinite(value)) return "This value must be a finite number";
  return sizeProblem(value);
}

/** The R12 message for a feature, for `lint` and the builder. */
export const R12_ONLY = {
  linetypes: R12_LINETYPES,
  lineweights: R12_LINEWEIGHTS,
  layerStates: R12_LAYER_STATES,
  entityStyle: R12_ENTITY_STYLE,
} as const;

/** Returns what is wrong with a layer color, or undefined when it is valid. */
export function layerColorProblem(color: number): string | undefined {
  return Number.isInteger(color) && color >= 1 && color <= 255 ? undefined : COLOR;
}

/**
 * Returns what is wrong with a radius, a text height or a rectangle size, or
 * undefined when it is valid. A size that is written as 0 is refused like 0
 * itself: AutoCAD gives text of height 0 the drawing's default text height,
 * and a circle of radius 0 is a point. A size of 1e100 or more is refused
 * too, as `magnitudeProblem` explains.
 *
 * @param value - The size, which must be a finite number.
 * @returns The problem, or undefined.
 */
export function sizeProblem(value: number): string | undefined {
  if (!(value > 0)) return POSITIVE;
  return written(value) === 0 ? WRITTEN_AS_ZERO : magnitudeProblem(value);
}

/**
 * Returns what is wrong with the size of a number a drawing holds, or
 * undefined when AutoCAD can read it. This goes for every number that is
 * written: coordinates, sizes and text rotation. Only sizes can be checked as
 * literals, through `Positive`, because points and rotations have no literal
 * types.
 *
 * @param value - The number, which must be finite.
 * @returns The problem, or undefined.
 */
export function magnitudeProblem(value: number): string | undefined {
  return isTooLarge(value) ? TOO_LARGE : undefined;
}

/**
 * Returns what is wrong with an arc's angles once they are rounded for
 * writing, or undefined when the arc can be written. AutoCAD holds an arc
 * whose start and end angles are equal as an arc of no length, so an arc that
 * is all but a full circle would vanish. The compiler cannot subtract two
 * literals, so this rule has no type.
 *
 * @param startAngle - The start angle in degrees, from 0 up to 360.
 * @param endAngle - The end angle in degrees, from 0 up to 360.
 * @returns The problem, or undefined.
 */
export function arcProblem(startAngle: number, endAngle: number): string | undefined {
  return roundsToOneAngle(startAngle, endAngle) && !isShortArc(startAngle, endAngle)
    ? ARC_LOST
    : undefined;
}

/**
 * True for an arc so short that its angles are the same once rounded, which
 * is written as an arc of no length. That is within rounding of what was
 * drawn, so it is worth a warning and not an error.
 *
 * @param startAngle - The start angle in degrees, from 0 up to 360.
 * @param endAngle - The end angle in degrees, from 0 up to 360.
 * @returns Whether the arc is written with no length.
 */
export function arcIsWrittenAsPoint(startAngle: number, endAngle: number): boolean {
  return roundsToOneAngle(startAngle, endAngle) && isShortArc(startAngle, endAngle);
}

/** Returns what is wrong with a single-line text value, or undefined when it is valid. */
export function textProblem(value: string): string | undefined {
  if (hasControl(value)) return TEXT_CONTROL;
  if (hasAstral(value)) {
    return "Text cannot contain emoji or other characters above U+FFFF, because AutoCAD cannot read them from DXF";
  }
  if (/[\ue800-\ue8ff]/.test(value)) return TEXT_PRIVATE_USE;
  return undefined;
}

/**
 * Returns a warning for text that AutoCAD stores as written but draws
 * differently, or undefined when it draws what it stores.
 *
 * @param value - The text value.
 * @returns The warning, or undefined.
 */
export function textWarning(value: string): string | undefined {
  return value.includes("%%") ? TEXT_PERCENT : undefined;
}

function roundsToOneAngle(startAngle: number, endAngle: number): boolean {
  return writtenAngle(startAngle) === writtenAngle(endAngle);
}

/** True when the counterclockwise sweep from start to end is half a turn or less. */
function isShortArc(startAngle: number, endAngle: number): boolean {
  return (((endAngle - startAngle) % 360) + 360) % 360 <= 180;
}

function codePoint(character: string): string {
  return `U+${character.charCodeAt(0).toString(16).toUpperCase().padStart(4, "0")}`;
}

function hasControl(value: string): boolean {
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code < 0x20 || code === 0x7f) return true;
  }
  return false;
}

/** True when the string has a character above U+FFFF, which JavaScript stores as a surrogate pair. */
function hasAstral(value: string): boolean {
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdfff) return true;
  }
  return false;
}
