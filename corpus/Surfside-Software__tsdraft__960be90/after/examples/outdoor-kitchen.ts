// An outdoor kitchen wall on a covered patio, drawn as an elevation and a section through the
// grill. Run with `pnpm example`. It writes examples/out/outdoor-kitchen.dxf (AutoCAD 2018 DXF)
// and outdoor-kitchen.svg.
//
// Every size comes from the parameters below. The dimensions, leaders, stipple and hatch are
// functions in lib/drafting.ts that draw them with lines and text.
import { mkdirSync, writeFileSync } from "node:fs";
import { createDrawing, toDXF, toSVG, type Point } from "../src/index.ts";
import {
  breakLine,
  dashedLine,
  dimension,
  dimensionChain,
  earth,
  gridLines,
  hatch,
  insulation,
  leader,
  lineOutside,
  sectionMark,
  stipple,
  viewTitle,
  type Box,
} from "./lib/drafting.ts";

// Parameters, in inches.
const wall = { width: 132, height: 108, thickness: 8, stucco: 0.75 };
const slab = { thickness: 4, step: 4 }; // the house floor is a step above the patio slab
const footing = { width: 20, depth: 20 }; // depth below the house floor
const ceiling = { finish: 0.5, chord: 3.5, insulation: 8 };
const counter = { height: 36, depth: 30, thickness: 1.5, overhang: 1.5 };
const toeKick = { height: 4, depth: 3 };
const backsplash = { height: 12, tile: 4 };
const shelves = { above: [26, 40], thickness: 1.75 };
const hood = {
  clearance: 36,
  depth: 24,
  lip: 3,
  canopy: 11,
  chimney: 12,
  chimneyDepth: 10,
  duct: 8,
};
const windowSize = { width: 22, height: 36 };

type Kind = "refrigerator" | "filler" | "grill" | "sink";
const run: { kind: Kind; width: number }[] = [
  { kind: "refrigerator", width: 24 },
  { kind: "filler", width: 3 },
  { kind: "grill", width: 36 },
  { kind: "filler", width: 3 },
  { kind: "sink", width: 30 },
];

// The sheet plots at 3/8" = 1'-0", so an inch on paper is 32 inches in the model.
const scale = { label: `3/8" = 1'-0"`, factor: 32 };
const noteHeight = (1 / 8) * scale.factor;
const titleHeight = (3 / 16) * scale.factor;
const dims = { text: noteHeight, tick: 1, gap: 1.5, extend: 1.5 };

// Positions worked out from the parameters.
const runWidth = run.reduce((sum, item) => sum + item.width, 0);
const runLeft = (wall.width - runWidth) / 2;
const runRight = runLeft + runWidth;
let nextX = runLeft;
const cabinets = run.map((item) => {
  const placed = { ...item, x: nextX };
  nextX += item.width;
  return placed;
});
function only(kind: Kind) {
  const found = cabinets.find((c) => c.kind === kind);
  if (!found) throw new Error(`The run needs a ${kind}`);
  return found;
}
const fridge = only("refrigerator");
const grill = only("grill");
const sink = only("sink");

const top = counter.height; // the countertop surface
const under = top - counter.thickness; // the underside of the countertop
const counterLeft = runLeft - counter.overhang;
const counterWidth = runWidth + counter.overhang * 2;

const grillCenter = grill.x + grill.width / 2;
const panel = { bottom: top - 9, top: top + 1 }; // the grill's control panel
const lid = { left: grill.x + 1, width: grill.width - 2, bottom: panel.top, top: panel.top + 13 };
const lidBox: Box = [lid.left, lid.bottom, lid.width, lid.top - lid.bottom];

// Doors and drawer fronts, with a reveal around each.
const reveal = 0.5;
const doorBottom = toeKick.height + reveal;
const grillDoorWidth = (grill.width - reveal * 3) / 2;
const grillDoorHeight = panel.bottom - reveal - doorBottom;
const grillDoors: [Box, Box] = [
  [grill.x + reveal, doorBottom, grillDoorWidth, grillDoorHeight],
  [grillCenter + reveal / 2, doorBottom, grillDoorWidth, grillDoorHeight],
];
const sinkPanel: Box = [sink.x + reveal, under - 7.75, sink.width - reveal * 2, 7.25];
const sinkDoor: Box = [
  sink.x + reveal,
  doorBottom,
  sink.width - reveal * 2,
  sinkPanel[1] - reveal - doorBottom,
];

const hoodWidth = grill.width + 2;
const hoodLeft = grillCenter - hoodWidth / 2;
const hoodBottom = top + hood.clearance;
const canopyBottom = hoodBottom + hood.lip;
const canopyTop = canopyBottom + hood.canopy;

const sinkCenter = sink.x + sink.width / 2;
const faucet = { column: sinkCenter - 3.5, bend: top + 11 };
// The faucet's outline as boxes, to stop the tile joints and stucco behind it.
const faucetBoxes: Box[] = [
  [faucet.column - 1.5, top, 3, 11],
  [sinkCenter - 4.5, faucet.bend - 0.5, 9, 5],
  [sinkCenter + 2.5, faucet.bend - 3.5, 2, 3],
  [faucet.column - 4.5, top + 3.5, 4, 4],
];
const inFrontOfBacksplash = [lidBox, ...faucetBoxes];
const windowLeft = sinkCenter - windowSize.width / 2;
const sillBottom = top + 17;
const windowBottom = sillBottom + 1.5;
const windowTop = windowBottom + windowSize.height;

const shelfLeft = runLeft - 3;
const shelfWidth = hoodLeft - 5 - shelfLeft;
const shelfBoxes: Box[] = shelves.above.map((h) => [
  shelfLeft,
  top + h,
  shelfWidth,
  shelves.thickness,
]);
// Jars on each shelf, placed from the shelf's left end.
const jarsOnShelves = [
  [
    { at: 2, width: 3.5, height: 7 },
    { at: 6.5, width: 3.5, height: 5.5 },
    { at: 11, width: 3.5, height: 6.5 },
  ],
  [
    { at: 3, width: 4, height: 8 },
    { at: 15, width: 5.5, height: 4.5 },
  ],
];
const jars: Box[] = shelfBoxes.flatMap(([x, y, , h], i) =>
  (jarsOnShelves[i] ?? []).map((jar): Box => [x + jar.at, y + h, jar.width, jar.height]),
);

const d = createDrawing({ units: "in" });
// Lineweights in millimetres: heavy for cut and profile lines, medium for casework and
// equipment, fine for annotation and the finest for patterns.
d.layer("A-WALL", { color: 7, lineweight: 0.7 });
d.layer("A-WALL-PATT", { color: 8, lineweight: 0.18 });
d.layer("A-FLOR-CASE", { color: 3, lineweight: 0.35 });
d.layer("A-EQPM", { color: 6, lineweight: 0.35 });
d.layer("A-GLAZ", { color: 5, lineweight: 0.25 });
d.layer("A-FURN", { color: 30, lineweight: 0.25 });
d.layer("A-DETL", { color: 7, lineweight: 0.25 });
d.layer("A-DETL-HIDN", { color: 8, lineweight: 0.25 });
d.layer("A-ANNO-DIMS", { color: 1, lineweight: 0.25 });
d.layer("A-ANNO-NOTE", { color: 2, lineweight: 0.25 });
d.layer("A-ANNO-SYMB", { color: 4, lineweight: 0.25 });
d.layer("A-ANNO-TITL", { color: 7, lineweight: 0.35 });

const rect = ([x, y, w, h]: Box) => d.rect([x, y], w, h);

// ---------------------------------------------------------------------------------------------
// View 1: the elevation. The wall's lower-left corner is at 0,0 and the slab is at y = 0.

// The wall, the slab and the ceiling.
d.layer("A-WALL", {}, () => {
  d.rect([0, 0], wall.width, wall.height);
  d.line([-8, 0], [wall.width + 8, 0]);
  d.line([-8, wall.height], [wall.width + 8, wall.height]);
});

// The base cabinets, the countertop, the backsplash and the shelves.
d.layer("A-FLOR-CASE", {}, () => {
  d.rect([runLeft, 0], runWidth, toeKick.height);
  for (const c of cabinets) {
    const faceTop = c.kind === "grill" ? panel.bottom : under;
    d.rect([c.x, toeKick.height], c.width, faceTop - toeKick.height);
  }

  // The countertop stops at the grill, whose control panel sits in the cutout.
  d.rect([counterLeft, under], grill.x - counterLeft, counter.thickness);
  d.rect(
    [grill.x + grill.width, under],
    runRight + counter.overhang - grill.x - grill.width,
    counter.thickness,
  );

  // The backsplash, with its top edge broken where the grill lid and faucet stand in front.
  const splashTop = top + backsplash.height;
  const counterRight = counterLeft + counterWidth;
  d.line([counterLeft, top], [counterLeft, splashTop]);
  d.line([counterRight, top], [counterRight, splashTop]);
  lineOutside(d, [counterLeft, splashTop], [counterRight, splashTop], inFrontOfBacksplash);

  for (const shelf of shelfBoxes) rect(shelf);

  // Doors and the sink's drawer front, with pulls by the edges that open.
  for (const front of [...grillDoors, sinkPanel, sinkDoor]) rect(front);
  const pull = (x: number, y: number) => d.rect([x - 0.3, y - 3], 0.6, 6);
  pull(grillCenter - 2.2, doorBottom + grillDoorHeight / 2);
  pull(grillCenter + 2.2, doorBottom + grillDoorHeight / 2);
  pull(sink.x + 2.8, doorBottom + sinkDoor[3] - 6);
});

// Tile joints in the backsplash.
d.layer("A-WALL-PATT", {}, () => {
  const area: Box = [counterLeft, top, counterWidth, backsplash.height];
  gridLines(d, area, backsplash.tile, inFrontOfBacksplash);
});

// Door swings, and the undermount sink below the countertop, drawn dashed.
d.layer("A-DETL-HIDN", {}, () => {
  // Two lines from the corners of the edge that opens to the middle of the hinged edge.
  const swing = ([x, y, w, h]: Box, hinge: "left" | "right") => {
    const middle: Point = [hinge === "left" ? x : x + w, y + h / 2];
    const opens = hinge === "left" ? x + w : x;
    dashedLine(d, [opens, y + h], middle, 1.5, 1);
    dashedLine(d, [opens, y], middle, 1.5, 1);
  };
  swing(grillDoors[0], "left");
  swing(grillDoors[1], "right");
  swing(sinkDoor, "right");

  const bowl = { left: sinkCenter - 11, right: sinkCenter + 11, bottom: under - 8 };
  dashedLine(d, [bowl.left, under], [bowl.left, bowl.bottom], 1.5, 1);
  dashedLine(d, [bowl.left, bowl.bottom], [bowl.right, bowl.bottom], 1.5, 1);
  dashedLine(d, [bowl.right, bowl.bottom], [bowl.right, under], 1.5, 1);
});

// The refrigerator, the grill, the faucet and the vent hood.
d.layer("A-EQPM", {}, () => {
  const door: Box = [fridge.x + 0.5, toeKick.height + 0.5, fridge.width - 1, under - 5];
  rect(door);
  rect([door[0] + 1.5, door[1] + 1.5, door[2] - 3, door[3] - 6]);
  d.rect([fridge.x + 3, under - 3.25], fridge.width - 6, 0.9);
  d.rect([fridge.x + 1, 0.75], fridge.width - 2, toeKick.height - 1.5);
  for (let x = fridge.x + 2.25; x < fridge.x + fridge.width - 1.5; x += 1.25) {
    d.line([x, 1.25], [x, toeKick.height - 1.25]);
  }

  // The grill: a control panel with a row of knobs, and a lid with a handle and a thermometer.
  d.rect([grill.x, panel.bottom], grill.width, panel.top - panel.bottom);
  const knobs = Math.round((grill.width - 8) / 7);
  const spacing = (grill.width - 8) / knobs;
  for (let i = 0; i < knobs; i++) {
    d.circle([grill.x + 4 + spacing * (i + 0.5), (panel.bottom + top) / 2], 1.3);
  }
  const lidRight = lid.left + lid.width;
  d.polyline(
    [
      [lid.left, lid.bottom],
      [lid.left, lid.top - 2.5],
      [lid.left + 2.5, lid.top],
      [lidRight - 2.5, lid.top],
      [lidRight, lid.top - 2.5],
      [lidRight, lid.bottom],
    ],
    true,
  );
  d.rect([lid.left + 5, lid.bottom + 6.5], lid.width - 10, 1);
  d.circle([grillCenter, lid.bottom + 10], 1.2);

  // A gooseneck faucet: a column, an arc and a spout, with a lever on the side.
  const { column, bend } = faucet;
  d.rect([column - 1.5, top], 3, 1.5);
  d.line([column - 0.5, top + 1.5], [column - 0.5, bend]);
  d.line([column + 0.5, top + 1.5], [column + 0.5, bend]);
  d.arc([sinkCenter, bend], 4, 0, 180);
  d.arc([sinkCenter, bend], 3, 0, 180);
  d.polyline([
    [sinkCenter + 3, bend],
    [sinkCenter + 3, bend - 3],
    [sinkCenter + 4, bend - 3],
    [sinkCenter + 4, bend],
  ]);
  d.polyline([
    [column - 0.5, top + 5],
    [column - 4, top + 7],
    [column - 4.3, top + 6.3],
    [column - 0.5, top + 4],
  ]);

  // The hood: a lip, a tapered canopy and a chimney up to the ceiling.
  d.rect([hoodLeft, hoodBottom], hoodWidth, hood.lip);
  d.polyline(
    [
      [hoodLeft + 1, canopyBottom],
      [hoodLeft + hoodWidth - 1, canopyBottom],
      [grillCenter + hood.chimney / 2 + 1, canopyTop],
      [grillCenter - hood.chimney / 2 - 1, canopyTop],
    ],
    true,
  );
  d.rect([grillCenter - hood.chimney / 2, canopyTop], hood.chimney, wall.height - canopyTop);
  d.circle([hoodLeft + hoodWidth - 4, hoodBottom + hood.lip / 2], 0.6);
  d.circle([hoodLeft + hoodWidth - 6, hoodBottom + hood.lip / 2], 0.6);
});

// Jars with lids on the shelves.
d.layer("A-FURN", {}, () => {
  for (const [x, y, w, h] of jars) {
    d.rect([x, y], w, h - 1);
    d.rect([x - 0.25, y + h - 1], w + 0.5, 1);
  }
});

// The window over the sink: frame, sash, muntins and sill.
d.layer("A-GLAZ", {}, () => {
  const { width, height } = windowSize;
  d.rect([windowLeft, windowBottom], width, height);
  d.rect([windowLeft + 1.5, windowBottom + 1.5], width - 3, height - 3);
  d.line([sinkCenter, windowBottom + 1.5], [sinkCenter, windowTop - 1.5]);
  d.line(
    [windowLeft + 1.5, windowBottom + height / 2],
    [windowLeft + width - 1.5, windowBottom + height / 2],
  );
  d.rect([windowLeft - 1.5, sillBottom], width + 3, 1.5);
});

// Stucco everywhere on the wall except behind what stands in front of it.
d.layer("A-WALL-PATT", {}, () => {
  const holes: Box[] = [
    [counterLeft, 0, counterWidth, top + backsplash.height],
    ...inFrontOfBacksplash,
    [windowLeft - 1.5, sillBottom, windowSize.width + 3, windowTop - sillBottom],
    ...shelfBoxes,
    ...jars,
    [hoodLeft, hoodBottom, hoodWidth, hood.lip],
    [grillCenter - hood.chimney / 2, canopyTop, hood.chimney, wall.height - canopyTop],
  ];
  // The canopy tapers, so it is kept clear as a stack of bands, each as wide as the canopy at
  // its bottom.
  const bands = 8;
  for (let i = 0; i < bands; i++) {
    const y = canopyBottom + (hood.canopy * i) / bands;
    const widthHere = hoodWidth - 2 - ((hoodWidth - hood.chimney - 4) * i) / bands;
    holes.push([grillCenter - widthHere / 2, y, widthHere, hood.canopy / bands]);
  }
  stipple(d, [0, 0, wall.width, wall.height], holes, {
    spacing: 1.5,
    stroke: 1,
    seed: 7,
    margin: 0.8,
  });
});

// Dimensions: the cabinet widths and the run below, the heights on the left.
d.layer("A-ANNO-DIMS", {}, () => {
  const edges: Point[] = [...cabinets.map((c): Point => [c.x, 0]), [runRight, 0]];
  dimensionChain(d, edges, "x", -9, dims);
  dimension(d, [runLeft, 0], [runRight, 0], "x", -23, dims);
  dimensionChain(
    d,
    [
      [0, 0],
      [0, top],
      [0, hoodBottom],
    ],
    "y",
    -8,
    dims,
  );
  dimension(d, [0, 0], [0, wall.height], "y", -16, dims);
});

// Notes. Sizes in the notes come from the parameters.
d.layer("A-ANNO-NOTE", {}, () => {
  const h = noteHeight;
  const left = -26;
  const right = wall.width + 8;
  leader(d, [7, 98], [left, 102], ["STUCCO FINISH,", "PAINTED"], h);
  const upperShelf = top + Math.max(...shelves.above) + shelves.thickness / 2;
  leader(d, [shelfLeft, upperShelf], [left, 84], ["FLOATING", "SHELVES"], h);
  leader(d, [lid.left + 4, lid.top], [left, 66], [`${grill.width}" BUILT-IN`, "GAS GRILL"], h);
  leader(d, [counterLeft + 2, top + 6], [left, 44], ["TILE BACKSPLASH"], h);
  leader(d, [counterLeft, under + 0.75], [left, 32], ["STONE COUNTERTOP"], h);
  leader(d, [fridge.x + 5, 16], [left, 9], [`${fridge.width}" UNDERCOUNTER`, "REFRIGERATOR"], h);
  leader(d, [grillCenter + hood.chimney / 2, 98], [right, 100], ["STAINLESS", "VENT HOOD"], h);
  leader(
    d,
    [windowLeft + windowSize.width, windowBottom + 26],
    [right, 76],
    ["ALUMINUM", "WINDOW"],
    h,
  );
  leader(d, [sinkCenter + 11, under - 4], [right, 30], ["UNDERMOUNT", "SINK"], h);
});

// The cut for view 2, through the grill and looking toward the sink.
const cutX = grill.x + 8;
d.layer("A-ANNO-SYMB", {}, () => {
  sectionMark(d, [cutX, wall.height + 12], [cutX, wall.height + 2], "2", 1, noteHeight);
});

d.layer("A-ANNO-TITL", {}, () => {
  viewTitle(d, [-10, -42], {
    number: "1",
    title: "OUTDOOR KITCHEN ELEVATION",
    scale: scale.label,
    width: 150,
    height: titleHeight,
  });
});

// ---------------------------------------------------------------------------------------------
// View 2: a wall section through the grill, from the footing to the attic. Heights are shared
// with the elevation. Across the page the wall's stucco face is at x = face, the patio is to the
// right and the inside of the house to the left.

const face = wall.width + 77;
const cmuFace = face - wall.stucco;
const back = cmuFace - wall.thickness;
const wallCenter = back + wall.thickness / 2;
const front = face + counter.depth; // the front edge of the countertop
const cabinetFront = front - counter.overhang;
const left = back - 22; // where the section stops on each side
const right = front + 14;

const floor = slab.step; // the house floor
const footingLeft = cmuFace - footing.width;
const footingBottom = floor - footing.depth;
const joint = cmuFace + 0.5; // the patio slab starts past an expansion joint
const insideFace = back - 1.25; // furring and drywall on the inside of the wall

// The truss bottom chord carries both ceilings and bears on a top plate on the wall.
const chordBottom = wall.height + ceiling.finish;
const chordTop = chordBottom + ceiling.chord;
const plateBottom = chordBottom - 1.5;
const bondBeamBottom = plateBottom - 8;
const duct = { left: face + (hood.chimneyDepth - hood.duct) / 2, top: chordTop + 12 };
const ductRight = duct.left + hood.duct;

const grillBack = face + 4;
const panelFront = front; // the grill's control panel is flush with the countertop's edge
const lidFront = cabinetFront - 2;

const bars: Point[] = [
  [footingLeft + 3.5, footingBottom + 3.5],
  [cmuFace - 3.5, footingBottom + 3.5],
  [wallCenter - 1.5, bondBeamBottom + 3],
];

// The wall, the footing and the slabs as cut.
d.layer("A-WALL", {}, () => {
  d.rect([back, floor], wall.thickness, plateBottom - floor);
  d.line([face, 0], [face, wall.height]);

  // The house slab and its footing, poured as one.
  d.line([left, floor], [back, floor]);
  d.polyline([
    [cmuFace, floor],
    [cmuFace, footingBottom],
    [footingLeft, footingBottom],
    [footingLeft, floor - slab.thickness],
    [left, floor - slab.thickness],
  ]);

  // The patio slab, a step down.
  d.line([joint, 0], [right, 0]);
  d.line([joint, -slab.thickness], [right, -slab.thickness]);
});

d.layer("A-ANNO-SYMB", {}, () => {
  breakLine(d, [left, floor + 2], [left, -2], 2);
  breakLine(d, [right, 2], [right, -slab.thickness - 2], 2);
  breakLine(d, [left, wall.height - 2], [left, chordTop + ceiling.insulation + 2], 2);
  breakLine(d, [right, wall.height - 2], [right, chordTop + 2], 1.5);
  breakLine(d, [duct.left - 0.5, duct.top], [ductRight + 0.5, duct.top], 1.5);
});

// Masonry hatch and a grouted bond beam in the wall, concrete in the footing and slabs, earth
// below them, and stone in the countertop.
d.layer("A-WALL-PATT", {}, () => {
  hatch(d, [back, floor, wall.thickness, bondBeamBottom - floor], 3);
  const concrete = { spacing: 1.4, stroke: 0.8, seed: 11, margin: 0.4 };
  const barHoles = bars.map(([x, y]): Box => [x - 0.6, y - 0.6, 1.2, 1.2]);
  stipple(d, [back, bondBeamBottom, wall.thickness, 8], barHoles, concrete);
  stipple(d, [left, 0, footingLeft - left, slab.thickness], [], concrete);
  const footingBox: Box = [footingLeft, footingBottom, footing.width, footing.depth];
  stipple(d, footingBox, barHoles, concrete);
  stipple(d, [joint, -slab.thickness, right - joint, slab.thickness], [], concrete);
  const patioSlab: Box = [cmuFace, -slab.thickness, right - cmuFace, slab.thickness];
  earth(d, [left, footingBottom - 8, right - left, 8 - footingBottom], [footingBox, patioSlab], 3);
  hatch(d, [face, under, grillBack - face, counter.thickness], 0.75, -1);
  hatch(d, [face, top, 0.5, backsplash.height], 0.75, -1);
});

// Reinforcing, the anchor bolt, the top plate, the expansion joint, the finishes inside the
// house, both ceilings, the truss chord and the insulation over the inside ceiling.
d.layer("A-DETL", {}, () => {
  // The top plate, cut, with the cross that marks cut wood.
  d.rect([back, plateBottom], wall.thickness, 1.5);
  d.line([back, plateBottom], [cmuFace, chordBottom]);
  d.line([back, chordBottom], [cmuFace, plateBottom]);

  for (const bar of bars) d.circle(bar, 0.6);
  const hookY = footingBottom + 5;
  d.polyline([
    [wallCenter - 8, hookY],
    [wallCenter - 0.7, hookY],
    [wallCenter - 0.7, floor + 30],
  ]);
  d.polyline([
    [wallCenter + 0.7, floor + 2],
    [wallCenter + 0.7, plateBottom - 1.5],
    [wallCenter - 3, plateBottom - 1.5],
  ]);
  d.polyline([
    [wallCenter + 2.5, chordBottom + 0.75],
    [wallCenter + 2.5, bondBeamBottom + 1.5],
    [wallCenter + 3.5, bondBeamBottom + 1.5],
  ]);
  d.line([back, bondBeamBottom], [cmuFace, bondBeamBottom]);
  d.rect([cmuFace, -slab.thickness], 0.5, slab.thickness);

  d.line([back - 0.75, floor], [back - 0.75, wall.height]);
  d.line([insideFace, floor], [insideFace, wall.height]);
  d.rect([insideFace - 0.5, floor], 0.5, 3.5);

  d.rect([left, wall.height], insideFace - left, ceiling.finish);
  const soffitLeft = face + hood.chimneyDepth;
  d.rect([soffitLeft, wall.height], right - soffitLeft, ceiling.finish);
  const ductHole: Box = [duct.left, chordBottom - 1, hood.duct, ceiling.chord + 2];
  lineOutside(d, [left, chordBottom], [right, chordBottom], [ductHole]);
  lineOutside(d, [left, chordTop], [right, chordTop], [ductHole]);
  insulation(d, [left, chordTop, insideFace - left, ceiling.insulation]);
});

// The vapor retarder under the house slab, and the duct inside the hood's chimney.
d.layer("A-DETL-HIDN", {}, () => {
  dashedLine(d, [left, -0.4], [footingLeft, -0.4], 1.5, 1);
  dashedLine(d, [duct.left, canopyBottom + 2], [duct.left, wall.height], 1.5, 1);
  dashedLine(d, [ductRight, canopyTop - 3], [ductRight, wall.height], 1.5, 1);
});

// The base cabinet, and the countertop cut behind the grill.
d.layer("A-FLOR-CASE", {}, () => {
  d.rect([face, under], grillBack - face, counter.thickness);
  d.rect([face, top], 0.5, backsplash.height);
  d.line([cabinetFront - toeKick.depth, 0], [cabinetFront - toeKick.depth, toeKick.height]);
  d.line([face, toeKick.height], [cabinetFront, toeKick.height]);
  d.rect([cabinetFront - 0.75, toeKick.height + 0.5], 0.75, panel.bottom - toeKick.height - 1);
  d.line([cabinetFront, toeKick.height], [cabinetFront, toeKick.height + 0.5]);
});

// The grill in profile on the counter, and the hood projecting from the wall with its duct
// rising through the soffit.
d.layer("A-EQPM", {}, () => {
  d.polyline([
    [grillBack - 1, top],
    [grillBack - 1, panel.top],
    [panelFront, panel.top],
    [panelFront, panel.bottom],
    [grillBack + 2, panel.bottom],
    [grillBack, panel.bottom + 2],
    [grillBack, top],
  ]);
  d.rect([panelFront, (panel.bottom + top) / 2 - 0.75], 1.5, 1.5); // a knob
  d.polyline([
    [grillBack, lid.bottom],
    [grillBack, lid.top - 4],
    [grillBack + 4, lid.top],
    [lidFront - 2, lid.top],
    [lidFront, lid.top - 2],
    [lidFront, lid.bottom],
  ]);
  d.polyline([
    // The lid handle.
    [lidFront, lid.bottom + 6.5],
    [lidFront + 2, lid.bottom + 6.5],
    [lidFront + 2, lid.bottom + 7.5],
    [lidFront, lid.bottom + 7.5],
  ]);

  d.polyline([
    [face, hoodBottom],
    [face + hood.depth, hoodBottom],
    [face + hood.depth, canopyBottom],
    [face + hood.chimneyDepth, canopyTop],
    [face + hood.chimneyDepth, wall.height],
  ]);
  d.line([face, canopyBottom], [face + hood.depth, canopyBottom]);
  d.line([duct.left, wall.height], [duct.left, duct.top]);
  d.line([ductRight, wall.height], [ductRight, duct.top]);
});

d.layer("A-ANNO-DIMS", {}, () => {
  // The depth is measured above the grill, and the heights start on the slab.
  const depthAt = lid.top + 6;
  dimension(d, [face, depthAt - 4], [front, depthAt - 4], "x", depthAt, dims);
  const tier = front + 10;
  dimensionChain(
    d,
    [
      [tier, 0],
      [front, top],
      [face + hood.depth, hoodBottom],
    ],
    "y",
    tier,
    dims,
  );
});

d.layer("A-ANNO-NOTE", {}, () => {
  const h = noteHeight;
  const x = right + 2;
  const canopyMiddle: Point = [
    face + (hood.depth + hood.chimneyDepth) / 2,
    (canopyBottom + canopyTop) / 2,
  ];
  const insulationTop = chordTop + ceiling.insulation;
  leader(
    d,
    [insideFace - 5, insulationTop - 1],
    [x, insulationTop + 11],
    ["R-30 BATT", "INSULATION"],
    h,
  );
  leader(d, [ductRight, chordTop + 4], [x, chordTop + 2], [`${hood.duct}" DUCT TO`, "ROOF CAP"], h);
  leader(d, canopyMiddle, [x, 96], ["STAINLESS", "VENT HOOD"], h);
  leader(
    d,
    [wallCenter + 0.7, 70],
    [x, 70],
    [`STUCCO ON ${wall.thickness}"`, "CMU W/ #5 VERT.", `@ 48" O.C.`],
    h,
  );
  leader(d, [cabinetFront, 12], [x, 8], ["STAINLESS", "ACCESS DOOR"], h);
  leader(
    d,
    [right - 6, -slab.thickness / 2],
    [x, -7],
    [`${slab.thickness}" CONCRETE`, "PATIO SLAB"],
    h,
  );
  leader(
    d,
    bars[1] ?? [cmuFace, footingBottom],
    [x, -22],
    [`${footing.width}"x${footing.depth}" FOOTING`, "W/ (2) #5 CONT."],
    h,
  );
});

d.layer("A-ANNO-TITL", {}, () => {
  viewTitle(d, [left, -42], {
    number: "2",
    title: "SECTION AT GRILL",
    scale: scale.label,
    width: 100,
    height: titleHeight,
  });
});

const drawing = d.build();
const outDir = new URL("./out/", import.meta.url);
mkdirSync(outDir, { recursive: true });
writeFileSync(new URL("outdoor-kitchen.dxf", outDir), toDXF(drawing));
writeFileSync(new URL("outdoor-kitchen.svg", outDir), toSVG(drawing, { margin: 4 }));
console.log(
  `Wrote ${drawing.entities.length} entities on ${drawing.layers.length} layers to examples/out/`,
);
