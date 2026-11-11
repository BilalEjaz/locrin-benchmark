// A small parametric site plan. Run with `pnpm example`. It writes examples/out/site-plan.dxf
// (AutoCAD 2018 DXF) and site-plan.svg.
//
// The property line, the setbacks and the house are told apart by linetype and pen weight, as on
// a permit sheet: each layer sets them, and its entities draw ByLayer, apart from the residence
// label, which has a lighter pen of its own.
import { mkdirSync, writeFileSync } from "node:fs";
import { createDrawing, DASHED, PHANTOM, toDXF, toSVG } from "../src/index.ts";

const lot = { width: 120, depth: 80 }; // ft
const setbacks = { front: 20, side: 10, rear: 15 };
const house = { width: 56, depth: 32 };
const x = (lot.width - house.width) / 2;
const y = setbacks.front + 5;

// Linetype patterns are in drawing units. At a scale of 4, DASHED draws dashes of 2 ft and
// PHANTOM long dashes of 5 ft.
const d = createDrawing({ units: "ft", linetypeScale: 4 });

d.layer("C-PROP", { color: 3, linetype: PHANTOM, lineweight: 0.5 }, () => {
  d.rect([0, 0], lot.width, lot.depth);
  d.text([2, -6], `LOT ${lot.width}' x ${lot.depth}'`, { height: 3 });
});
d.layer("C-SETB", { color: 4, linetype: DASHED, lineweight: 0.25 }, () => {
  const { front, side, rear } = setbacks;
  d.rect([side, front], lot.width - side * 2, lot.depth - front - rear);
});
d.layer("A-BLDG", { color: 1, lineweight: 0.7 }, () => {
  d.rect([x, y], house.width, house.depth);
  d.text([x + 2, y + house.depth / 2], "PROPOSED RESIDENCE", { height: 3, lineweight: 0.35 });
});
d.layer("C-PAVE", { color: 8, lineweight: 0.25 }, () => {
  d.line([x + 40, y], [x + 40, -12]);
  d.line([x + 52, y], [x + 52, -12]);
});
d.layer("C-ROAD", { color: 2, lineweight: 0.35 }, () => {
  d.line([-10, -12], [lot.width + 10, -12]);
  d.text([lot.width / 2 - 10, -18], "MAIN STREET", { height: 3 });
});
d.layer("V-TREE", { color: 3, lineweight: 0.18 }, () => {
  for (let i = 0; i < 6; i++) d.circle([15 + i * 18, 72], 5);
});

const drawing = d.build();
const outDir = new URL("./out/", import.meta.url);
mkdirSync(outDir, { recursive: true });
writeFileSync(new URL("site-plan.dxf", outDir), toDXF(drawing));
writeFileSync(new URL("site-plan.svg", outDir), toSVG(drawing));
console.log(
  `Wrote ${drawing.entities.length} entities on ${drawing.layers.length} layers to examples/out/`,
);
