import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createDrawing,
  DASHED,
  DrawingBuilder,
  DrawingError,
  HIDDEN,
  lint,
  toDXF,
  toSVG,
  type Drawing,
} from "../src/index.ts";

// Each `@ts-expect-error` below proves the compiler rejects the literal. The
// `assert.throws` around it proves the same mistake is caught when the code runs.
test("literal mistakes are compile errors and runtime errors", () => {
  const r12 = createDrawing({ dxf: "R12" });
  const r2018 = createDrawing();

  // @ts-expect-error: R12 layer names cannot contain spaces.
  assert.throws(() => r12.layer("A WALL"), /R12 layer names can only use/);
  // @ts-expect-error: R12 layer names cannot contain dots.
  assert.throws(() => r12.layer("A.WALL"), /R12 layer names can only use/);
  // @ts-expect-error: 32 characters is one too many for R12.
  assert.throws(() => r12.layer("A2345678901234567890123456789012"), /31 characters/);
  r12.layer("A234567890123456789012345678901");
  r12.layer("a-WALL_$1");

  r2018.layer("A WALL");
  r2018.layer("CAFÉ 日本 #1 (new).v2");
  r2018.layer("A2345678901234567890123456789012");
  // @ts-expect-error: no DXF version allows a comma.
  assert.throws(() => r2018.layer("A,B"), /cannot contain/);
  // @ts-expect-error: a caret starts an escape in DXF.
  assert.throws(() => r2018.layer("A^B"), /cannot contain/);
  // @ts-expect-error: a line break would inject records into the file.
  assert.throws(() => r2018.layer("A\r\n0\r\nEOF"), /cannot contain/);
  // @ts-expect-error: AutoCAD rejects a leading space.
  assert.throws(() => r2018.layer(" A"), /start or end/);
  // @ts-expect-error: AutoCAD rejects a trailing space.
  assert.throws(() => r2018.layer("A "), /start or end/);
  // @ts-expect-error: a name is required.
  assert.throws(() => r2018.layer(""), /empty/);

  // @ts-expect-error: colors run from 1 to 255.
  assert.throws(() => r2018.layer("X", { color: 0 }), /Color Index/);
  // @ts-expect-error: colors run from 1 to 255.
  assert.throws(() => r2018.layer("X", { color: 256 }), /Color Index/);
  // @ts-expect-error: colors are integers.
  assert.throws(() => r2018.layer("X", { color: 1.5 }), /Color Index/);
  r2018.layer("X", { color: 255 });

  // @ts-expect-error: a radius must be positive.
  assert.throws(() => r2018.circle([0, 0], -1), /radius/);
  // @ts-expect-error: a radius must be positive.
  assert.throws(() => r2018.arc([0, 0], 0, 0, 90), /radius/);
  // @ts-expect-error: a rectangle needs a height.
  assert.throws(() => r2018.rect([0, 0], 5, 0), /height/);
  // @ts-expect-error: text needs a height.
  assert.throws(() => r2018.text([0, 0], "x", { height: 0 }), /height/);

  // tsdraft writes 6 decimals, so a size under 0.0000005 would be written as 0.
  // @ts-expect-error: AutoCAD gives text of height 0 its default height.
  assert.throws(() => r2018.text([0, 0], "x", { height: 4e-7 }), /height: .*written as 0/);
  // @ts-expect-error: the same number written out in full.
  assert.throws(() => r2018.circle([0, 0], 0.0000004), /radius: .*written as 0/);
  // @ts-expect-error: 5e-7 is stored a little under a half, so it rounds down.
  assert.throws(() => r2018.arc([0, 0], 5e-7, 0, 90), /radius: .*written as 0/);
  // @ts-expect-error: a width far below what is written.
  assert.throws(() => r2018.rect([0, 0], 1e-12, 5), /width: .*written as 0/);
  // @ts-expect-error: a height just under the half.
  assert.throws(() => r2018.rect([0, 0], 5, 4.999e-7), /height: .*written as 0/);
  r2018.circle([0, 0], 5.001e-7);
  r2018.circle([0, 0], 6e-7);
  r2018.text([0, 0], "x", { height: 0.000001 });
  r2018.rect([0, 0], 1e21, 9.5e-7);

  // AutoCAD reads two exponent digits from DXF, so it would take 1e+100 for 1e+10.
  // @ts-expect-error: a radius of 1e100 would be read as 10000000000.
  assert.throws(() => r2018.circle([0, 0], 1e100), /radius: .*under 1e100/);
  // @ts-expect-error: the same for any number that prints with three exponent digits.
  assert.throws(() => r2018.text([0, 0], "x", { height: 1.5e300 }), /height: .*under 1e100/);
  // @ts-expect-error: and for a rectangle's sides.
  assert.throws(() => r2018.rect([0, 0], 5, 2.5e101), /height: .*under 1e100/);
  r2018.circle([0, 0], 9.999999e99);
  r2018.circle([0, 0], 1e99);
  r2018.text([0, 0], "x", { height: 1e21 });

  // @ts-expect-error: AutoCAD discards a drawing over an ohm sign in a layer name.
  assert.throws(() => r2018.layer("10 k\u2126"), /AutoCAD rejects.*This name has U\+2126/);
  // @ts-expect-error: and over a zero-width space, which no one can see.
  assert.throws(() => r2018.layer("A\u200bB"), /AutoCAD rejects.*This name has U\+200B/);
  // @ts-expect-error: and over Coptic letters.
  assert.throws(() => r2018.layer("\u2c80\u2c81"), /AutoCAD rejects/);
  // @ts-expect-error: AutoCAD replaces these private-use characters.
  assert.throws(() => r2018.layer("A\ue8ffB"), /AutoCAD rejects or replaces/);
  // @ts-expect-error: the R12 rule comes second, so the message is the one for the character.
  assert.throws(() => r12.layer("\u2126"), /AutoCAD rejects/);
  // AutoCAD refuses only the ASCII space at the ends of a name.
  r2018.layer("\u00a0A\u3000");
  r2018.layer("10 k\u03a9");
  r2018.layer("A\u00a0B \ue7ff\ue900 \u2116");
});

test("values the compiler cannot see are checked when the code runs", () => {
  const name: string = ["A", "WALL"].join(" ");
  const color: number = 300;
  assert.throws(() => createDrawing({ dxf: "R12" }).layer(name), /R12 layer names can only use/);
  createDrawing().layer(name);
  assert.throws(() => createDrawing().layer("X", { color }), /Color Index/);
  assert.throws(() => createDrawing().text([0, 0], "two\nlines"), /single line/);
  assert.throws(() => createDrawing().text([0, 0], "a\u0000b"), /control characters/);
  assert.throws(() => createDrawing().text([0, 0], "smile 😀"), /emoji/);
  assert.throws(() => createDrawing().text([0, 0], "a\ue800b"), /private-use/);
  const huge: number = 1e100;
  assert.throws(() => createDrawing().circle([0, 0], huge), /radius: .*under 1e100/);
  assert.throws(() => createDrawing().line([0, 0], [huge, 0]), /x: .*under 1e100/);
  assert.throws(
    () =>
      createDrawing().polyline([
        [0, 0],
        [0, -huge],
      ]),
    /y: .*under 1e100/,
  );
  assert.throws(() => createDrawing().text([0, 0], "x", { rotation: huge }), /rotation: .*under/);
  assert.throws(() => createDrawing().rect([9e99, 0], 9e99, 1), /x: .*under 1e100/);
  // An arc's angles are brought into 0 to 360 before they are stored, so their size is no matter.
  const [arc] = createDrawing().arc([0, 0], 1, huge, 90).build().entities;
  assert.ok(arc?.kind === "arc" && arc.startAngle >= 0 && arc.startAngle < 360);
  const tiny: number = 4e-7;
  assert.throws(() => createDrawing().circle([0, 0], tiny), /radius: .*written as 0/);
  assert.throws(
    () => createDrawing().text([0, 0], "x", { height: tiny }),
    /height: .*written as 0/,
  );
  const ohm: string = String.fromCharCode(0x2126);
  assert.throws(() => createDrawing({ dxf: "R2018" }).layer(ohm), /This name has U\+2126/);
  // @ts-expect-error: unknown units are a compile error too.
  assert.throws(() => createDrawing({ units: "yd" }), /Unknown units/);
  // @ts-expect-error: unknown DXF versions are a compile error too.
  assert.throws(() => createDrawing({ dxf: "R14" }), /Unsupported DXF version/);
});

test("lint checks a drawing against another DXF version", () => {
  const b = createDrawing({ dxf: "R2018" });
  b.layer("A WALL", { color: 1 }, () => {
    b.line([0, 0], [10, 0]);
  });
  const d = b.build();

  assert.deepEqual(lint(d), []);
  const [problem, ...rest] = lint(d, { version: "R12" });
  assert.deepEqual(rest, []);
  assert.equal(problem?.rule, "layer-name");
  assert.equal(problem?.severity, "error");
  assert.equal(problem?.layer, "A WALL");
  assert.match(problem?.message ?? "", /R12 layer names can only use/);

  assert.match(toDXF(d), /AC1032/);
  assert.throws(
    () => toDXF(d, { version: "R12" }),
    (e) => e instanceof DrawingError && e.diagnostics.length === 1 && /A WALL/.test(e.message),
  );
});

test("lint checks a drawing that was not made with the builder", () => {
  const d: Drawing = {
    units: "ft",
    dxf: "R2018",
    layers: [
      { name: "0", color: 7 },
      { name: "wall", color: 1 },
      { name: "WALL", color: 300 },
    ],
    entities: [
      { kind: "line", layer: "wall", from: [0, 0], to: [0, 0] },
      { kind: "line", layer: "missing", from: [0, 0], to: [1, 0] },
      { kind: "arc", layer: "0", center: [0, 0], radius: 1, startAngle: -90, endAngle: 450 },
      { kind: "circle", layer: "0", center: [0, 0], radius: 0 },
      { kind: "text", layer: "0", at: [0, 0], height: 1, rotation: 0, value: "😀" },
    ],
  };
  const found = lint(d).map((p) => `${p.severity} ${p.rule} ${p.entity ?? p.layer}`);
  assert.deepEqual(found, [
    "error layer-color WALL",
    "error duplicate-layer WALL",
    "warning zero-length 0",
    "error undefined-layer 1",
    "error geometry 2",
    "error geometry 3",
    "error text 4",
  ]);
  assert.throws(() => toDXF(d), DrawingError);
});

test("warnings do not stop an export", () => {
  const d = createDrawing().line([1, 1], [1, 1]).build();
  assert.deepEqual(
    lint(d).map((p) => p.severity),
    ["warning"],
  );
  assert.match(toDXF(d), /LINE/);
});

test("sizes, lines and arcs that rounding would collapse", () => {
  const b = createDrawing();
  // Each side is big enough alone, but the far corner rounds onto the near one.
  assert.throws(() => b.rect([0.0000006, 0], 0.0000006, 5), /width: .*x = 0.000001/);
  assert.throws(() => b.rect([0, 1e17], 5, 1), /height: .*y = 100000000000000000/);
  // All but a full circle: both angles are written as 180, which AutoCAD holds as no arc at all.
  assert.throws(() => b.arc([0, 0], 1, 180.0000004, 180), /nearly a full turn/);
  assert.throws(() => b.arc([0, 0], 1, 0, 359.9999996), /nearly a full turn/);
  assert.throws(() => b.arc([0, 0], 1, 0.0000004, 0), /nearly a full turn/);
  b.arc([0, 0], 1, 0, 359.999999);

  // These lose their length to rounding, which is close to what was drawn: a warning each.
  b.arc([0, 0], 1, 180, 180.0000004);
  b.arc([0, 0], 1, 359.9999996, 0.0000004);
  b.line([1, 1], [1.0000001, 1]);
  b.polyline([
    [2, 2],
    [2.0000004, 2],
    [2, 1.9999996],
  ]);
  b.polyline([
    [3, 3],
    [3, 3],
  ]);
  // These do not: one point is written apart from the others.
  b.line([1, 1], [1.0000005, 1]);
  b.polyline([
    [2, 2],
    [2, 2],
    [2.000001, 2],
  ]);
  const d = b.build();
  assert.deepEqual(
    lint(d).map((p) => `${p.severity} ${p.rule} ${p.message}`),
    [
      "warning zero-length arc #1: the arc has no length once it is rounded to the 6 decimals tsdraft writes",
      "warning zero-length arc #2: the arc has no length once it is rounded to the 6 decimals tsdraft writes",
      "warning zero-length line #3: the line has no length once it is rounded to the 6 decimals tsdraft writes",
      "warning zero-length polyline #4: the polyline has no length once it is rounded to the 6 decimals tsdraft writes",
      "warning zero-length polyline #5: the polyline has no length",
    ],
  );
  assert.match(toDXF(d), /ARC/);

  const byHand: Drawing = {
    units: "in",
    dxf: "R2018",
    layers: [{ name: "0", color: 7 }],
    entities: [
      { kind: "text", layer: "0", at: [0, 0], height: 4e-7, rotation: 0, value: "x" },
      { kind: "circle", layer: "0", center: [0, 0], radius: 4e-7 },
      { kind: "arc", layer: "0", center: [0, 0], radius: 4e-7, startAngle: 0, endAngle: 90 },
      {
        kind: "arc",
        layer: "0",
        center: [0, 0],
        radius: 1,
        startAngle: 180.0000004,
        endAngle: 180,
      },
      { kind: "text", layer: "0", at: [0, 0], height: Number.NaN, rotation: 0, value: "x" },
    ],
  };
  assert.deepEqual(
    lint(byHand).map((p) => `${p.severity} ${p.rule} ${p.entity}`),
    [
      "error geometry 0",
      "error geometry 1",
      "error geometry 2",
      "error geometry 3",
      "error geometry 4",
    ],
  );
  assert.match(lint(byHand)[0]?.message ?? "", /^text #0: height: This value is written as 0/);
  assert.match(lint(byHand)[4]?.message ?? "", /^text #4: height: This value must be finite/);
  assert.throws(() => toDXF(byHand), DrawingError);
});

test("layer names are compared the way AutoCAD compares them", () => {
  const drawing = (layers: string[], used: string[]): Drawing => ({
    units: "in",
    dxf: "R2018",
    layers: [{ name: "0", color: 7 }, ...layers.map((name) => ({ name, color: 1 }))],
    entities: used.map((layer) => ({ kind: "line", layer, from: [0, 0], to: [1, 1] })),
  });
  const found = (d: Drawing) => lint(d).map((p) => `${p.rule} ${p.entity ?? p.layer}`);

  // AutoCAD puts each of these lines on the declared layer.
  const declared = ["MixedCase", "CAFÉ", "ΑΒΓ", "Слой", "ǄURO", "ＡＢＣ"];
  assert.deepEqual(
    found(drawing(declared, ["mixedcase", "café", "αβγ", "СЛОЙ", "ǆuro", "ａｂｃ"])),
    [],
  );
  // AutoCAD makes a new layer for each of these, because its table does not pair the letters.
  assert.deepEqual(
    found(
      drawing(
        ["ΟΔΟΣ", "STRASSE", "TITLE", "ŸVES", "ǅ", "İ", "ᲐᲑ"],
        ["οδος", "οδοσ", "straße", "tıtle", "ÿves", "ǆ", "i", "აბ"],
      ),
    ),
    [
      "undefined-layer 0",
      "undefined-layer 2",
      "undefined-layer 3",
      "undefined-layer 4",
      "undefined-layer 5",
      "undefined-layer 6",
      "undefined-layer 7",
    ],
  );

  // One layer to AutoCAD, which keeps only the first.
  assert.deepEqual(found(drawing(["ΑΒΓ", "αβγ", "Αβγ"], [])), [
    "duplicate-layer αβγ",
    "duplicate-layer Αβγ",
  ]);
  // Two layers to AutoCAD, and one duplicate name to its AUDIT.
  const twins = lint(drawing(["ΟΔΟΣ", "οδος", "ŸVES", "ÿves", "ǅ", "ǆ", "STRAẞE", "straße"], []));
  assert.deepEqual(
    twins.map((p) => `${p.severity} ${p.rule} ${p.layer}`),
    [
      "error duplicate-layer οδος",
      "error duplicate-layer ÿves",
      "error duplicate-layer ǆ",
      "error duplicate-layer straße",
    ],
  );
  assert.match(twins[0]?.message ?? "", /"οδος": AutoCAD keeps this layer and "ΟΔΟΣ" as two/);
  // Neither AutoCAD nor its AUDIT takes these for the same.
  assert.deepEqual(found(drawing(["µm", "μm", "TITLE", "tıtle", "ᲐᲑ", "აბ"], [])), []);

  const b = createDrawing({ dxf: "R2018" });
  b.layer("ΟΔΟΣ", { color: 1 });
  b.layer("οδοσ", { color: 2 }, () => {
    b.line([0, 0], [1, 1]);
  });
  assert.throws(() => b.layer("οδος"), /AUDIT reports them as one duplicate name/);
  assert.deepEqual(b.build().layers, [
    { name: "0", color: 7 },
    { name: "ΟΔΟΣ", color: 2 },
  ]);
  assert.equal(b.build().entities[0]?.layer, "ΟΔΟΣ");
});

test("lint handles text AutoCAD would change or draw differently", () => {
  const d: Drawing = {
    units: "in",
    dxf: "R2018",
    layers: [{ name: "0", color: 7 }],
    entities: [
      { kind: "text", layer: "0", at: [0, 0], height: 1, rotation: 0, value: "\\U+00B0 kept" },
      { kind: "text", layer: "0", at: [0, 0], height: 1, rotation: 0, value: "45%%d" },
      { kind: "text", layer: "0", at: [0, 0], height: 1, rotation: 0, value: "100% of 5%" },
      { kind: "text", layer: "0", at: [0, 0], height: 1, rotation: 0, value: "a\ue800b" },
    ],
  };
  assert.deepEqual(
    lint(d).map((p) => `${p.severity} ${p.rule} ${p.entity}`),
    ["warning text 1", "error text 3"],
  );
  assert.match(lint(d)[0]?.message ?? "", /draws "%%d" as a degree sign/);
});

test("lint takes a polyline too long to pass as arguments", () => {
  const points = Array.from({ length: 250_000 }, (_, i): [number, number] => [i, i % 7]);
  const d: Drawing = {
    units: "in",
    dxf: "R12",
    layers: [{ name: "0", color: 7 }],
    entities: [{ kind: "polyline", layer: "0", points, closed: false }],
  };
  assert.deepEqual(lint(d), []);
  assert.equal(toDXF(d).match(/VERTEX/g)?.length, points.length);
  assert.match(toDXF(d, { version: "R2018" }), /\r\n90\r\n250000\r\n/);
  assert.match(toSVG(d), /<polyline points="0,0 1,1 /);
  const broken: Drawing = {
    ...d,
    entities: [
      { kind: "polyline", layer: "0", points: [...points, [0, Number.NaN]], closed: false },
    ],
  };
  assert.deepEqual(
    lint(broken).map((p) => p.message),
    ["polyline #0: its points must be finite numbers"],
  );
});

test("a DrawingError names no file format", () => {
  const one = new DrawingError([{ rule: "text", severity: "error", message: "text #0: bad" }]);
  assert.equal(one.message, "The drawing has 1 problem:\n- text #0: bad");
  assert.equal(one.name, "DrawingError");
  const many = new DrawingError(
    Array.from({ length: 12 }, (_, i) => ({
      rule: "geometry" as const,
      severity: "error" as const,
      message: `circle #${i}: bad`,
    })),
  );
  assert.match(many.message, /^The drawing has 12 problems:\n- circle #0: bad\n/);
  assert.match(many.message, /\n- and 2 more$/);
  assert.equal(many.diagnostics.length, 12);
  assert.doesNotMatch(many.message, /DXF/);
});

test("lint refuses a number AutoCAD would misread", () => {
  const d: Drawing = {
    units: "in",
    dxf: "R2018",
    layers: [{ name: "0", color: 7 }],
    entities: [
      { kind: "line", layer: "0", from: [0, 0], to: [1e100, 1] },
      {
        kind: "polyline",
        layer: "0",
        points: [
          [0, 0],
          [1, -1e100],
        ],
        closed: false,
      },
      { kind: "circle", layer: "0", center: [0, 1.5e300], radius: 1 },
      { kind: "circle", layer: "0", center: [0, 0], radius: 1e100 },
      { kind: "arc", layer: "0", center: [-1e100, 0], radius: 1e101, startAngle: 0, endAngle: 90 },
      { kind: "text", layer: "0", at: [0, 0], height: 1e100, rotation: 0, value: "x" },
      { kind: "text", layer: "0", at: [0, 0], height: 1, rotation: 1e100, value: "x" },
      // Under 1e100 everything is written as AutoCAD reads it.
      { kind: "line", layer: "0", from: [0, 9e99], to: [3, -9e99] },
      { kind: "circle", layer: "0", center: [9.999999e99, 0], radius: 9.999999999999998e99 },
    ],
  };
  assert.deepEqual(
    lint(d).map((p) => `${p.severity} ${p.entity} ${p.message.replace(/, because.*/, "")}`),
    [
      "error 0 line #0: its points: This value must be under 1e100",
      "error 1 polyline #1: its points: This value must be under 1e100",
      "error 2 circle #2: its center: This value must be under 1e100",
      "error 3 circle #3: radius: This value must be under 1e100",
      "error 4 arc #4: its center: This value must be under 1e100",
      "error 4 arc #4: radius: This value must be under 1e100",
      "error 5 text #5: height: This value must be under 1e100",
      "error 6 text #6: its position and rotation: This value must be under 1e100",
    ],
  );
  assert.throws(() => toDXF(d), DrawingError);
  assert.throws(() => toDXF(d, { version: "R12" }), DrawingError);
});

test("lint refuses layer names that AUDIT would report as duplicates", () => {
  const drawing = (layers: string[], used: string[] = []): Drawing => ({
    units: "in",
    dxf: "R2018",
    layers: [{ name: "0", color: 7 }, ...layers.map((name) => ({ name, color: 1 }))],
    entities: used.map((layer) => ({ kind: "line", layer, from: [0, 0], to: [1, 1] })),
  });
  const duplicates = (layers: string[]) =>
    lint(drawing(layers)).map((p) => `${p.severity} ${p.rule} ${p.layer}`);
  const softHyphen = "\u00ad";

  // A letter and the letters it stands for, in either letter case and inside longer names.
  for (const [name, other] of [
    ["straße", "strasse"],
    ["Hauptstraße 12", "HAUPTSTRASSE 12"],
    ["Maßstab", "Massstab"],
    ["æ", "ae"],
    ["Cæsar", "CAESAR"],
    ["Œuvre", "oeuvre"],
    ["Ĳssel", "ijssel"],
    ["ﬁre wall", "FIRE WALL"],
    ["ǆ", "DŽ"],
    ["ǅ", "dž"],
    ["Þórr", "thórr"],
    // A composed character and its decomposed form, whatever the order of the marks.
    ["café", "cafe\u0301"],
    ["CAFÉ", "cafe\u0301"],
    ["\u1ead", "a\u0302\u0323"],
    ["a\u0323\u0302", "a\u0302\u0323"],
    // A soft hyphen inside a name or in front of it.
    [`co${softHyphen}op`, "coop"],
    [`${softHyphen}Co${softHyphen}${softHyphen}op`, "coop"],
    // Two names that both end with one are compared like any others.
    [`co${softHyphen}op${softHyphen}`, `coop${softHyphen}`],
    [`Straße${softHyphen}`, `STRASSE${softHyphen}`],
    // The kinds together.
    [`Haupt${softHyphen}straße`, "HAUPTSTRASSE"],
    ["ǽ", "ae\u0301"],
  ] as const) {
    assert.deepEqual(duplicates([name, other]), [`error duplicate-layer ${other}`], name);
    assert.deepEqual(duplicates([other, name]), [`error duplicate-layer ${name}`], other);
  }
  const [problem] = lint(drawing(["straße", "STRASSE"]));
  assert.equal(
    problem?.message,
    'Layer "STRASSE": AutoCAD keeps this layer and "straße" as two layers, but its AUDIT reports them as one duplicate name',
  );

  // AUDIT reports none of these, so they are no error.
  for (const [name, other] of [
    ["Maßstab", "Masstab"],
    ["ß", "sz"],
    ["ǆ", "dz"],
    ["ö", "oe"],
    ["ø", "oe"],
    ["cafe", "café"],
    ["한", "\u1112\u1161\u11ab"],
    ["\u09cb", "\u09c7\u09be"],
    // A soft hyphen between a letter and its accent is not ignored, and neither is one at the end.
    ["É", `E${softHyphen}\u0301`],
    [`coop${softHyphen}`, "coop"],
    ["co-op", "coop"],
  ] as const) {
    assert.deepEqual(duplicates([name, other]), [], name);
  }

  // An entity on the other spelling is on no declared layer: AutoCAD would add one for it.
  const strays = lint(drawing(["straße", "café"], ["STRASSE", "cafe\u0301", "strase"]));
  assert.deepEqual(
    strays.map((p) => `${p.severity} ${p.rule} ${p.entity}`),
    ["error undefined-layer 0", "error undefined-layer 1", "error undefined-layer 2"],
  );
  assert.equal(
    strays[0]?.message,
    'line #0: layer "STRASSE" is not defined. AutoCAD does not take it for layer "straße": it would add a layer, and its AUDIT would report a duplicate name',
  );
  assert.equal(strays[2]?.message, 'line #2: layer "strase" is not defined');

  const b = createDrawing({ dxf: "R2018" });
  b.layer("Hauptstraße");
  assert.throws(() => b.layer("HAUPTSTRASSE"), /AUDIT reports them as one duplicate name/);
  assert.throws(() => b.layer(`Haupt${softHyphen}straße`), /AUDIT reports them as one duplicate/);
  b.layer("Hauptstrase");
});

test("linetype, lineweight and layer state mistakes are compile errors and runtime errors", () => {
  const r12 = createDrawing({ dxf: "R12" });
  const d = createDrawing();

  // @ts-expect-error: R12 drawings have no linetypes.
  assert.throws(() => r12.linetype(DASHED), /R12 drawings have no linetypes/);
  // @ts-expect-error: nor a linetype on a layer or an entity.
  assert.throws(() => r12.layer("A", { linetype: "DASHED" }), /R12 drawings have no linetypes/);
  // @ts-expect-error: nor an entity linetype other than ByLayer.
  assert.throws(() => r12.line([0, 0], [1, 1], { linetype: "Continuous" }), /R12 entities take no/);
  // @ts-expect-error: nor an entity lineweight.
  assert.throws(() => r12.circle([0, 0], 1, { lineweight: 0.5 }), /R12 entities take no/);
  // @ts-expect-error: nor layer states.
  assert.throws(() => r12.layer("A", { frozen: true }), /no layer states to R12/);
  // @ts-expect-error: nor a linetype scale.
  assert.throws(() => createDrawing({ dxf: "R12", linetypeScale: 2 }), /linetype scale/);
  r12.layer("A", { linetype: "CONTINUOUS", lineweight: "Default", off: false, plot: true });
  r12.line([0, 0], [1, 1], { linetype: "ByLayer", lineweight: "ByLayer" });

  // @ts-expect-error: AutoCAD discards a drawing with an entity of another lineweight.
  assert.throws(() => d.line([0, 0], [1, 1], { lineweight: 0.33 }), /one of AutoCAD's/);
  // @ts-expect-error: and gives a layer of another lineweight the default.
  assert.throws(() => d.layer("A", { lineweight: 2.5 }), /one of AutoCAD's/);
  // @ts-expect-error: a layer's lineweight cannot be ByLayer.
  assert.throws(() => d.layer("A", { lineweight: "ByLayer" }), /or "Default"$/);
  // @ts-expect-error: AutoCAD does not freeze the current layer.
  assert.throws(() => d.layer("0", { frozen: true }), /current layer/);
  // @ts-expect-error: AUDIT reports a layer whose linetype is ByLayer.
  assert.throws(() => d.layer("A", { linetype: "ByLayer" }), /cannot be ByLayer or ByBlock/);
  // @ts-expect-error: a linetype name follows the rules of layer names.
  assert.throws(() => d.line([0, 0], [1, 1], { linetype: "A,B" }), /Linetype names cannot/);
  // @ts-expect-error: Continuous, ByLayer and ByBlock cannot be defined.
  assert.throws(() => d.linetype({ name: "CONTINUOUS", pattern: [1, -1] }), /in every drawing/);
  // @ts-expect-error: AUDIT reports a pattern of one length.
  assert.throws(() => d.linetype({ name: "ONE", pattern: [1] }), /2 to 12 lengths/);
  const thirteen = [1, -1, 1, -1, 1, -1, 1, -1, 1, -1, 1, -1, 1] as const;
  // @ts-expect-error: AutoCAD discards a drawing with a pattern of 13.
  assert.throws(() => d.linetype({ name: "LONG", pattern: thirteen }), /2 to 12/);
  // @ts-expect-error: the linetype scale is a size.
  assert.throws(() => createDrawing({ linetypeScale: 0 }), /linetypeScale: .*greater than 0/);
  // @ts-expect-error: and AutoCAD reads one written as 0 as 1.
  assert.throws(() => createDrawing({ linetypeScale: 1e-7 }), /linetypeScale: .*written as 0/);
  // @ts-expect-error: the constructor checks it the same way.
  assert.throws(() => new DrawingBuilder({ linetypeScale: 0 }), /linetypeScale: .*greater than 0/);
  // @ts-expect-error: a dash written as 0 would draw as a dot.
  assert.throws(() => d.linetype({ name: "T", pattern: [4e-7, -1] }), /pattern: .*written as 0/);
  // @ts-expect-error: and so would a gap.
  assert.throws(() => d.linetype({ name: "T", pattern: [1, -0.0000004] }), /written as 0/);
  // @ts-expect-error: AutoCAD reads two exponent digits from DXF.
  assert.throws(() => d.linetype({ name: "T", pattern: [1e100, -1] }), /pattern: .*under 1e100/);
  // @ts-expect-error: with two problems, the first length's is the one reported.
  assert.throws(() => d.linetype({ name: "T", pattern: [1e-7, 1e100] }), /pattern: .*written as 0/);
  // @ts-expect-error: a description is a single line.
  assert.throws(() => d.linetype({ name: "T", pattern: [], description: "a\nb" }), /single line/);
  // @ts-expect-error: with none of the private-use characters AutoCAD replaces.
  assert.throws(() => d.linetype({ name: "T", pattern: [], description: "\ue800" }), /private-use/);
  // @ts-expect-error: a definition given to a layer is checked as linetype() checks one.
  assert.throws(() => d.layer("A", { linetype: { name: "Continuous", pattern: [] } }), /in every/);
  // @ts-expect-error: and so is one given to an entity.
  assert.throws(() => d.line([0, 0], [1, 1], { linetype: { name: "T", pattern: [1] } }), /2 to 12/);
  const dashed: boolean = false;
  assert.throws(
    // @ts-expect-error: and so is one in a conditional with a name.
    () => d.line([0, 0], [1, 1], { linetype: dashed ? "DASHED" : { name: "T", pattern: [1] } }),
    /2 to 12/,
  );

  d.linetype({ name: "Fence", pattern: [1, -0.5, 0, -0.5] });
  d.linetype({ name: "SOLID2", pattern: [] });
  d.layer("0", { off: true, locked: true, plot: false, linetype: "fence", lineweight: 0.3 });
  d.layer("B", { linetype: HIDDEN, lineweight: 2.11 }, () => {
    d.line([0, 0], [1, 1], { linetype: "ByBlock", lineweight: "Default" });
    d.text([0, 0], "x", { linetype: DASHED, lineweight: 0 });
  });
  const built = d.build();
  assert.deepEqual(
    built.linetypes?.map((t) => t.name),
    ["Fence", "SOLID2", "HIDDEN", "DASHED"],
  );
  assert.deepEqual(built.layers[0], {
    name: "0",
    color: 7,
    off: true,
    locked: true,
    plot: false,
    linetype: "Fence",
    lineweight: 0.3,
  });
  assert.deepEqual(lint(built), []);
});

test("linetype mistakes the compiler cannot see are checked when the code runs", () => {
  const d = createDrawing();
  const weight: number = 0.33;
  const name: string = "NOPE";
  const pattern: number[] = [1];
  assert.throws(() => d.line([0, 0], [1, 1], { lineweight: weight }), /one of AutoCAD's/);
  assert.throws(() => d.line([0, 0], [1, 1], { linetype: name }), /"NOPE" is not defined/);
  assert.throws(() => d.linetype({ name: "P", pattern }), /2 to 12 lengths/);
  assert.throws(
    () => d.linetype({ name: "D", pattern: [1, -1], description: "x".repeat(250) }),
    /249/,
  );
  d.linetype({ name: "ΟΔΟΣ", pattern: [1, -1] });
  // A final sigma is no capital sigma to AutoCAD, but its AUDIT calls the two one name.
  assert.throws(() => d.linetype({ name: "οδος", pattern: [1, -1] }), /AUDIT reports them as one/);
  assert.throws(() => d.line([0, 0], [1, 1], { linetype: "οδος" }), /not defined/);
  // The total of the lengths is written too, and the compiler cannot add.
  assert.throws(() => d.linetype({ name: "T", pattern: [9e99, -9e99] }), /added up/);
  // AUDIT reports a twin of a built-in linetype as a duplicate.
  assert.throws(
    () => d.linetype({ name: "Conti\u00adnuous", pattern: [1, -1] }),
    /and "Continuous" as two linetypes/,
  );
  // A definition given to a layer or an entity must match the drawing's of that name.
  const fence = { name: "fence", pattern: [1, -1] };
  d.linetype({ name: "FENCE", pattern: [1, -1] }).line([0, 0], [1, 1], { linetype: fence });
  assert.throws(
    () => d.line([0, 0], [1, 1], { linetype: { ...fence, pattern: [2, -1] } }),
    /another pattern or description/,
  );
  assert.throws(
    () => d.layer("A", { linetype: { ...fence, description: "x" } }),
    /another pattern or description/,
  );
});

test("lint checks the linetypes, lineweights and layer states of a drawing", () => {
  const drawing: Drawing = {
    units: "in",
    dxf: "R2018",
    linetypeScale: -1,
    linetypes: [
      { name: "DASHED", description: "", pattern: [0.5, -0.25] },
      { name: "dashed", description: "", pattern: [1, -1] },
      { name: "ByLayer", description: "", pattern: [1, -1] },
      { name: "ONE", description: "", pattern: [1] },
    ],
    layers: [
      { name: "0", color: 7, frozen: true },
      { name: "A", color: 1, linetype: "NOPE", lineweight: 0.33 },
      { name: "B", color: 1, linetype: "ByBlock" },
    ],
    entities: [
      { kind: "line", layer: "A", from: [0, 0], to: [1, 1], linetype: "MISSING" },
      { kind: "line", layer: "A", from: [0, 0], to: [1, 1], lineweight: 2.12 },
      { kind: "line", layer: "A", from: [0, 0], to: [1, 1], linetype: "dashed", lineweight: 2.11 },
    ],
  };
  assert.deepEqual(
    lint(drawing).map((p) => `${p.rule} ${p.linetype ?? p.layer ?? p.entity ?? ""}`),
    [
      "linetype ",
      "duplicate-linetype dashed",
      "linetype ByLayer",
      "linetype ONE",
      "layer-state 0",
      "undefined-linetype A",
      "lineweight A",
      "linetype B",
      "undefined-linetype 0",
      "lineweight 1",
    ],
  );
  assert.match(lint(drawing)[8]?.message ?? "", /AutoCAD discards a drawing that uses a linetype/);

  const r12: Drawing = {
    ...drawing,
    dxf: "R12",
    linetypeScale: 1,
    linetypes: [{ name: "DASHED", description: "", pattern: [0.5, -0.25] }],
    layers: [{ name: "0", color: 7, off: true, lineweight: "Default", linetype: "Continuous" }],
    entities: [{ kind: "line", layer: "0", from: [0, 0], to: [1, 1], lineweight: 0.5 }],
  };
  assert.deepEqual(
    lint(r12).map((p) => `${p.rule} ${p.message.replace(/\. Use.*/, "")}`),
    [
      'linetype Linetype "DASHED": R12 drawings have no linetypes but Continuous, and no linetype scale',
      'layer-state Layer "0": tsdraft writes no layer states to R12 drawings',
      "lineweight line #0: R12 entities take no linetype or lineweight of their own",
    ],
  );

  // lint reports the new rules, and fields of the wrong type in a drawing built by hand.
  const odd = {
    units: "in",
    dxf: "R2018",
    linetypes: [
      { name: "TOTAL", description: "", pattern: [9e99, -9e99] },
      { name: "TINY", description: "", pattern: [1, -4e-7] },
      { name: "Conti\u00adnuous", description: "", pattern: [1, -1] },
      { name: "NO DESCRIPTION", pattern: [1, -1] },
      { name: "NOT AN ARRAY", description: "", pattern: "1,-1" },
      { name: 7, description: "", pattern: [] },
    ],
    layers: [{ name: "0", color: 7, off: "yes", linetype: 5, lineweight: "thick" }],
    entities: [
      { kind: "line", layer: "0", from: [0, 0], to: [1, 1], linetype: 3, lineweight: null },
    ],
  } as unknown as Drawing;
  assert.deepEqual(
    lint(odd).map((p) => p.message),
    [
      `Linetype "TOTAL": its pattern: A linetype pattern's lengths, added up without their signs, must be under 1e100. The total is written too, and AutoCAD reads only two exponent digits from DXF`,
      'Linetype "TINY": its pattern: A dash or gap of this length is written as 0, because tsdraft writes 6 decimals, and would draw as a dot. Use 0 for a dot, or a length of 0.000001 or more',
      'Linetype "Conti\u00adnuous": AutoCAD keeps this linetype and "Continuous" as two linetypes, but its AUDIT reports them as one duplicate name',
      `Linetype "NO DESCRIPTION": A linetype's description must be a string`,
      `Linetype "NOT AN ARRAY": A linetype's pattern must be an array of finite numbers`,
      "Linetype 7: A linetype's name must be a string",
      'Layer "0": a linetype is named by a string',
      'Layer "0": A lineweight must be one of AutoCAD\'s, in millimetres: 0, 0.05, 0.09, 0.13, 0.15, 0.18, 0.2, 0.25, 0.3, 0.35, 0.4, 0.5, 0.53, 0.6, 0.7, 0.8, 0.9, 1, 1.06, 1.2, 1.4, 1.58, 2 or 2.11, or "Default"',
      'Layer "0": off must be true or false',
      "line #0: a linetype is named by a string",
      'line #0: A lineweight must be one of AutoCAD\'s, in millimetres: 0, 0.05, 0.09, 0.13, 0.15, 0.18, 0.2, 0.25, 0.3, 0.35, 0.4, 0.5, 0.53, 0.6, 0.7, 0.8, 0.9, 1, 1.06, 1.2, 1.4, 1.58, 2 or 2.11, or "ByLayer", "ByBlock" or "Default"',
    ],
  );
});
