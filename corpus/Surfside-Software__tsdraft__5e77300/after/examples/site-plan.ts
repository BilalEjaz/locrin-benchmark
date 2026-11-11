// A permit-style site plan: a lot from its plat dimensions, with setbacks, a building footprint,
// the street, labels, dimensions, site data and notes. Copy this file to start a drawing.
//
// Sheet: ARCH D, 36 x 24 in, landscape. Scale: 1" = 10', a ratio of 120. The plan and its notes
// take about 20 x 21 in of the sheet. Units are feet, in model space. There is no border and no
// title block.
//
// Run with `pnpm example`. It writes examples/out/site-plan.dxf (AutoCAD 2018 DXF) and
// site-plan.svg. The drawing is also the default export, for a tool that takes a drawing file.
//
// How it is put together:
// - The parameters come first, and every position is worked out from them.
// - Each layer sets a linetype and a pen weight, and its entities draw ByLayer.
// - The site is in feet. Text, symbols, dashes and every annotation offset are sized by how
//   large they plot: `paper` turns inches on paper into drawing units for the ratio in `view`,
//   so the sheet still reads when the ratio changes.
// - Text is placed by the left end of its baseline, so `label` centers it from an estimated width.
import { mkdirSync, writeFileSync } from "node:fs";
import {
  CENTER,
  createDrawing,
  DASHED,
  fromPaper,
  PHANTOM,
  toDXF,
  toSVG,
  type Point,
} from "../src/index.ts";
import {
  arrowhead,
  dimensionChain,
  label,
  textWidth,
  type DimensionStyle,
} from "./lib/drafting.ts";

// The scale the sheet plots at, as a ratio, and the drawing's units. A foot is 12 inches, so an
// inch on paper is `ratio / 12` feet.
const view = { ratio: 120, units: "ft" } as const;
const feetPerInch = view.ratio / 12;
const scaleLabel = `1" = ${feetPerInch}'`;

/** A length on paper, in inches, as drawing units. Every annotation size and offset uses it. */
const paper = (inches: number) => fromPaper(inches, "in", view);

// The site, in feet. The lot's front left corner is the origin.
const lot = { name: "LOT 12, BLOCK 3", width: 100, depth: 140 };
const zoning = { district: "R-1 SINGLE-FAMILY", maxCoverage: 40 }; // percent
const setbacks = { front: 25, side: 7.5, rear: 20 }; // required
const house = { width: 52, depth: 44, frontYard: 30, floor: 12.5 }; // the yard is to the garage
const garage = { width: 22, projection: 5 }; // at the right end of the front wall
const driveway = { width: 18, flare: 5 };
const street = { name: "OAK STREET", rightOfWay: 50, pavement: 24 };
const sidewalk = { width: 5, fromLot: 2 };
const trees: { at: Point; radius: number }[] = [
  { at: [20, 106], radius: 6 },
  { at: [50, 130], radius: 6 },
  { at: [80, 104], radius: 6 },
  { at: [28, 12], radius: 5 },
];

// Plotted sizes, in drawing units.
const text = {
  note: paper(3 / 32),
  label: paper(1 / 8),
  heading: paper(3 / 16),
  title: paper(1 / 4),
};
const gap = paper(1 / 16); // between a line and its text
const clear = paper(1 / 8); // between a heavy line and its text
const tick = paper(1 / 16); // half a dimension tick
const monument = paper(1 / 16); // radius of a property corner
const leading = text.note * 1.8; // from one line of notes to the next

// Positions worked out from the site.
const houseX = (lot.width - house.width) / 2;
const houseY = house.frontYard + garage.projection;
const garageX = houseX + house.width - garage.width;
const footprint: Point[] = [
  [houseX, houseY],
  [garageX, houseY],
  [garageX, house.frontYard],
  [houseX + house.width, house.frontYard],
  [houseX + house.width, houseY + house.depth],
  [houseX, houseY + house.depth],
];
const bounds = {
  left: Math.min(...footprint.map((p) => p[0])),
  right: Math.max(...footprint.map((p) => p[0])),
  front: Math.min(...footprint.map((p) => p[1])),
  rear: Math.max(...footprint.map((p) => p[1])),
};
const provided = {
  front: bounds.front,
  side: Math.min(bounds.left, lot.width - bounds.right),
  rear: lot.depth - bounds.rear,
};
const footprintArea = house.width * house.depth + garage.width * garage.projection;
const lotArea = lot.width * lot.depth;
const centerline = -street.rightOfWay / 2;
const pavement = { near: centerline + street.pavement / 2, far: centerline - street.pavement / 2 };
const driveX = garageX + (garage.width - driveway.width) / 2;
// The street and the adjoining lot lines run this far past the lot.
const ends = { left: -paper(2), right: lot.width + paper(2) };

const feet = (n: number) => `${n.toFixed(1)}'`;
const squareFeet = (n: number) => `${Math.round(n).toLocaleString("en-US")} SF`;
const acres = (n: number) => `${(n / 43560).toFixed(2)} AC`;

// AutoCAD's linetype patterns are sized for paper: DASHED is a 0.5 dash and a 0.25 gap. At this
// linetype scale they plot at half that, a 1/4 in dash.
const d = createDrawing({ units: view.units, linetypeScale: paper(1 / 2) });

d.layer("C-PROP", { color: 7, linetype: PHANTOM, lineweight: 0.7 });
d.layer("C-PROP-ADJC", { color: 8, linetype: PHANTOM, lineweight: 0.18 });
d.layer("C-PROP-MONU", { color: 7, lineweight: 0.25 });
d.layer("C-SETB", { color: 1, linetype: DASHED, lineweight: 0.25 });
d.layer("C-BLDG", { color: 5, lineweight: 0.7 });
d.layer("C-PAVE", { color: 8, lineweight: 0.35 });
d.layer("C-ROAD-CNTR", { color: 8, linetype: CENTER, lineweight: 0.18 });
d.layer("V-TREE", { color: 3, lineweight: 0.18 });
d.layer("C-ANNO-DIMS", { color: 8, lineweight: 0.18 });
d.layer("C-ANNO-TEXT", { color: 7, lineweight: 0.25 });
d.layer("C-ANNO-SYMB", { color: 7, lineweight: 0.35 });
d.layer("C-ANNO-TITL", { color: 7, lineweight: 0.5 });

d.layer("C-PROP", {}, () => d.rect([0, 0], lot.width, lot.depth));
d.layer("C-PROP-ADJC", {}, () => {
  for (const y of [0, lot.depth]) {
    d.line([ends.left, y], [0, y]);
    d.line([lot.width, y], [ends.right, y]);
  }
  // The far side of the street's right-of-way.
  d.line([ends.left, -street.rightOfWay], [ends.right, -street.rightOfWay]);
});
d.layer("C-PROP-MONU", {}, () => {
  for (const x of [0, lot.width]) for (const y of [0, lot.depth]) d.circle([x, y], monument);
});
d.layer("C-SETB", {}, () => {
  const { front, side, rear } = setbacks;
  d.rect([side, front], lot.width - side * 2, lot.depth - front - rear);
});
d.layer("C-BLDG", {}, () => d.polyline(footprint, true));

d.layer("C-PAVE", {}, () => {
  // The driveway, flared to the street with a quarter circle on each side.
  const flareY = pavement.near + driveway.flare;
  d.line([driveX, bounds.front], [driveX, flareY]);
  d.arc([driveX - driveway.flare, flareY], driveway.flare, 270, 0);
  d.line([driveX + driveway.width, bounds.front], [driveX + driveway.width, flareY]);
  d.arc([driveX + driveway.width + driveway.flare, flareY], driveway.flare, 180, 270);
  // The near edge of pavement and the sidewalk stop at the driveway.
  const open = { from: driveX - driveway.flare, to: driveX + driveway.width + driveway.flare };
  d.line([ends.left, pavement.near], [open.from, pavement.near]);
  d.line([open.to, pavement.near], [ends.right, pavement.near]);
  d.line([ends.left, pavement.far], [ends.right, pavement.far]);
  for (const y of [-sidewalk.fromLot, -sidewalk.fromLot - sidewalk.width]) {
    d.line([ends.left, y], [driveX, y]);
    d.line([driveX + driveway.width, y], [ends.right, y]);
  }
});
d.layer("C-ROAD-CNTR", {}, () => d.line([ends.left, centerline], [ends.right, centerline]));
d.layer("V-TREE", {}, () => {
  for (const tree of trees) drawTree(tree.at, tree.radius);
});

// One string of dimensions across the lot, behind the building, and one up it, outside the east
// line. Each runs through the building's corners.
const across = bounds.rear + paper(3 / 8);
const up = lot.width + paper(5 / 8);
d.layer("C-ANNO-DIMS", {}, () => {
  const style: DimensionStyle = { text: text.note, tick, gap, extend: gap, format: feet };
  dimensionChain(
    d,
    [
      [0, across],
      [bounds.left, bounds.rear],
      [bounds.right, bounds.rear],
      [lot.width, across],
    ],
    "x",
    across,
    style,
  );
  dimensionChain(
    d,
    [
      [lot.width, 0],
      [bounds.right, bounds.front],
      [bounds.right, bounds.rear],
      [lot.width, lot.depth],
    ],
    "y",
    up,
    style,
  );
});

d.layer("C-ANNO-TEXT", {}, () => {
  const { note, label: size, heading } = text;
  const middle = lot.width / 2;

  // Bearings and distances, clockwise from the northwest corner. Each sits outside its line,
  // but for the front one, which is inside the lot, clear of the sidewalk and the driveway.
  const course = (bearing: string, length: number) => `${bearing}  ${length.toFixed(2)}'`;
  const sideMiddle = (across + lot.depth) / 2;
  label(d, [middle, lot.depth + clear], course(`N 90°00'00" E`, lot.width), note, "center");
  label(
    d,
    [lot.width + clear + note, sideMiddle],
    course(`S 00°00'00" E`, lot.depth),
    note,
    "center",
    90,
  );
  label(d, [driveX / 2, clear], course(`S 90°00'00" W`, lot.width), note, "center");
  label(d, [-clear, sideMiddle], course(`N 00°00'00" W`, lot.depth), note, "center", 90);

  // Setbacks, each along its line.
  const { front, side, rear } = setbacks;
  const inset = side + paper(1 / 4);
  d.text([inset, front + gap], `${front}' FRONT SETBACK`, { height: note });
  d.text([inset, lot.depth - rear + gap], `${rear}' REAR SETBACK`, { height: note });
  for (const x of [side, lot.width - side]) {
    label(
      d,
      [x - gap, (across + lot.depth - rear) / 2],
      `${side}' SIDE SETBACK`,
      note,
      "center",
      90,
    );
  }

  // The lot, the building and the pavement.
  stack(
    [middle, (across + lot.depth - rear) / 2],
    [
      [lot.name, heading],
      [`${squareFeet(lotArea)} (${acres(lotArea)})`, size],
    ],
  );
  stack(
    [(bounds.left + bounds.right) / 2, houseY + house.depth / 2],
    [
      ["PROPOSED RESIDENCE", heading],
      [`${squareFeet(footprintArea)} FOOTPRINT`, size],
      [`F.F.E. ${house.floor.toFixed(2)}'`, size],
    ],
  );
  label(
    d,
    [driveX + driveway.width / 2 + note / 2, bounds.front / 2],
    "CONC. DRIVEWAY",
    note,
    "center",
    90,
  );
  d.text(
    [0, -sidewalk.fromLot - sidewalk.width / 2 - note / 2],
    `${sidewalk.width}' CONC. SIDEWALK`,
    { height: note },
  );
  d.text([0, pavement.near - gap - note], "EDGE OF PAVEMENT", { height: note });
  const rightOfWay = `${street.rightOfWay}' PUBLIC RIGHT-OF-WAY`;
  label(d, [middle, centerline + clear], rightOfWay, note, "center");
  label(d, [middle, centerline + clear + note + gap * 1.5], street.name, heading, "center");
  label(d, [ends.right, centerline + gap], "CENTERLINE", note, "right");

  // The adjoining lots.
  label(d, [-paper(1), lot.depth / 2], "LOT 11", size, "center", 90);
  label(d, [up + paper(5 / 8), lot.depth / 2], "LOT 13", size, "center", 90);
  label(d, [middle, lot.depth + paper(1 / 2)], "LOT 27", size, "center");
});

// The panel of site data, notes and legend, to the right of the plan.
const panel = { x: ends.right + paper(1), top: lot.depth, width: paper(5) };
let row = panel.top;

function panelHeading(title: string): void {
  row -= text.heading;
  d.layer("C-ANNO-TITL", {}, () => {
    d.text([panel.x, row], title, { height: text.heading });
    d.line([panel.x, row - gap], [panel.x + panel.width, row - gap]);
  });
  row -= gap + leading * 1.2;
}

panelHeading("SITE DATA");
d.layer("C-ANNO-TEXT", {}, () => {
  const coverage = (footprintArea / lotArea) * 100;
  const data: [string, string][] = [
    ["PARCEL", lot.name],
    ["ZONING", zoning.district],
    ["LOT AREA", `${squareFeet(lotArea)} (${acres(lotArea)})`],
    ["BUILDING FOOTPRINT", squareFeet(footprintArea)],
    ["LOT COVERAGE", `${coverage.toFixed(1)}% (${zoning.maxCoverage}% MAX.)`],
    ["FINISHED FLOOR", `ELEV. ${house.floor.toFixed(2)}'`],
  ];
  // Each column starts a gap past the widest text of the one before it.
  const column = paper(1 / 2);
  const values = Math.max(...data.map(([name]) => textWidth(name, text.note))) + column;
  for (const [name, value] of data) {
    d.text([panel.x, row], name, { height: text.note });
    d.text([panel.x + values, row], value, { height: text.note });
    row -= leading;
  }
  row -= leading / 2;
  const columns = [0, values, values + textWidth("REQUIRED", text.note) + column];
  const table: string[][] = [
    ["SETBACK", "REQUIRED", "PROVIDED"],
    ["FRONT", feet(setbacks.front), feet(provided.front)],
    ["SIDE", feet(setbacks.side), feet(provided.side)],
    ["REAR", feet(setbacks.rear), feet(provided.rear)],
  ];
  for (const cells of table) {
    cells.forEach((cell, i) =>
      d.text([panel.x + (columns[i] ?? 0), row], cell, { height: text.note }),
    );
    row -= leading;
  }
});

row -= leading * 1.5;
panelHeading("GENERAL NOTES");
d.layer("C-ANNO-TEXT", {}, () => {
  const notes = [
    "PROPERTY LINES ARE DRAWN FROM THE RECORDED PLAT. NO FIELD SURVEY WAS MADE FOR THIS PLAN.",
    "DIMENSIONS ARE IN FEET, MEASURED TO THE OUTSIDE FACE OF THE FOUNDATION WALL.",
    "SETBACKS ARE MEASURED AT RIGHT ANGLES FROM THE PROPERTY LINE TO THE NEAREST WALL.",
    "LOCATE ALL UNDERGROUND UTILITIES BEFORE DIGGING.",
    "GRADE THE LOT TO DRAIN AWAY FROM THE BUILDING AND TOWARD THE STREET. KEEP RUNOFF OFF THE ADJOINING LOTS.",
    "PROTECT THE EXISTING TREES SHOWN. NO TREE IS TO BE REMOVED.",
  ];
  const indent = textWidth("00. ", text.note);
  notes.forEach((note, i) => {
    d.text([panel.x, row], `${i + 1}.`, { height: text.note });
    for (const line of wrap(note, panel.width - indent)) {
      d.text([panel.x + indent, row], line, { height: text.note });
      row -= leading;
    }
    row -= leading / 3;
  });
});

row -= leading * 1.5;
panelHeading("LEGEND");
const sample = paper(2); // the length of a legend line
function legendRow(layer: Parameters<typeof d.layer>[0], name: string, draw: () => void): void {
  d.layer(layer, {}, draw);
  d.layer("C-ANNO-TEXT", {}, () =>
    d.text([panel.x + sample + paper(3 / 8), row], name, { height: text.note }),
  );
  row -= leading * 1.5;
}
const sampleLine = () =>
  d.line([panel.x, row + text.note / 2], [panel.x + sample, row + text.note / 2]);
const sampleCenter = (): Point => [panel.x + sample / 2, row + text.note / 2];
legendRow("C-PROP", "PROPERTY LINE", sampleLine);
legendRow("C-PROP-ADJC", "ADJOINING LOT LINE", sampleLine);
legendRow("C-SETB", "BUILDING SETBACK LINE", sampleLine);
legendRow("C-BLDG", "BUILDING FOOTPRINT", sampleLine);
legendRow("C-PAVE", "EDGE OF PAVEMENT OR CONCRETE", sampleLine);
legendRow("C-ROAD-CNTR", "STREET CENTERLINE", sampleLine);
legendRow("C-PROP-MONU", "PROPERTY CORNER", () => d.circle(sampleCenter(), monument));
row -= leading;
legendRow("V-TREE", "EXISTING TREE TO REMAIN", () => drawTree(sampleCenter(), paper(3 / 16)));

// The north arrow, the view title and the graphic scale, in a row beyond the street. Its top
// is `rowTop`.
const rowTop = -street.rightOfWay - paper(1 / 2);
const arrow = { radius: paper(3 / 8) };
const titleX = arrow.radius * 2 + paper(1 / 2);
const titleWidth = textWidth("SITE PLAN", text.title) + paper(1 / 4);
d.layer("C-ANNO-SYMB", {}, () => {
  // North is up the sheet.
  const { radius } = arrow;
  const center: Point = [radius, rowTop - text.heading - gap - radius];
  label(d, [center[0], rowTop - text.heading], "N", text.heading, "center");
  d.circle(center, radius);
  d.line([center[0], center[1] - radius], [center[0], center[1] + radius * 0.4]);
  arrowhead(d, [center[0], center[1] + radius], center, radius * 0.9);

  // A graphic scale 2 in long on paper, divided at 1/2 in and 1 in, and numbered in feet.
  const bar = { x: titleX + titleWidth + paper(3 / 4), height: paper(1 / 8) };
  const y = rowTop - text.note - gap - bar.height;
  const stops = [0, 1 / 2, 1, 2];
  d.rect([bar.x, y], paper(2), bar.height);
  for (const stop of stops.slice(1, -1)) {
    d.line([bar.x + paper(stop), y], [bar.x + paper(stop), y + bar.height]);
  }
  d.line([bar.x, y + bar.height / 2], [bar.x + paper(1 / 2), y + bar.height / 2]);
  for (const stop of stops) {
    const at: Point = [bar.x + (stop ? paper(stop) : 0), y + bar.height + gap];
    label(d, at, String(stop * feetPerInch), text.note, "center");
  }
  d.text([bar.x + paper(2) + clear, y], "FEET", { height: text.note });
});
d.layer("C-ANNO-TITL", {}, () => {
  const baseline = rowTop - text.title;
  d.text([titleX, baseline], "SITE PLAN", { height: text.title });
  d.line([titleX, baseline - gap], [titleX + titleWidth, baseline - gap]);
  d.text([titleX, baseline - gap * 2 - text.label], `SCALE: ${scaleLabel}`, {
    height: text.label,
  });
});

/** A tree as its canopy and a cross at the trunk. */
function drawTree(at: Point, radius: number): void {
  const [x, y] = at;
  d.circle(at, radius);
  d.line([x - tick, y], [x + tick, y]);
  d.line([x, y - tick], [x, y + tick]);
}

/** Lines of text, each with its height, centered on `center` as one block. */
function stack(center: Point, lines: readonly (readonly [value: string, height: number])[]): void {
  const height = lines.reduce((sum, line) => sum + line[1], 0) + gap * 1.5 * (lines.length - 1);
  let top = center[1] + height / 2;
  for (const [value, size] of lines) {
    label(d, [center[0], top - size], value, size, "center");
    top -= size + gap * 1.5;
  }
}

/** Breaks a sentence into lines no wider than `width`, by the estimated width of its text. */
function wrap(sentence: string, width: number): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of sentence.split(" ")) {
    const longer = line ? `${line} ${word}` : word;
    if (line && textWidth(longer, text.note) > width) {
      lines.push(line);
      line = word;
    } else {
      line = longer;
    }
  }
  return [...lines, line];
}

const drawing = d.build();
export default drawing;

// Run as a script, the example writes its files. Imported, it only hands over the drawing.
if (import.meta.main) {
  const outDir = new URL("./out/", import.meta.url);
  mkdirSync(outDir, { recursive: true });
  writeFileSync(new URL("site-plan.dxf", outDir), toDXF(drawing));
  writeFileSync(new URL("site-plan.svg", outDir), toSVG(drawing));
  console.log(
    `Wrote ${drawing.entities.length} entities on ${drawing.layers.length} layers to examples/out/`,
  );
}
