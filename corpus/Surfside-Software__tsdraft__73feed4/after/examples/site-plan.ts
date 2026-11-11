// A small parametric site plan. Run with `pnpm example`; it writes examples/out/site-plan.{dxf,svg}.
import { mkdirSync, writeFileSync } from "node:fs";
import { createDrawing, toDXF, toSVG } from "../src/index.ts";

const lot = { width: 75, depth: 120 }; // ft
const setbacks = { front: 25, side: 7.5, rear: 20 };
const house = { width: 40, depth: 50 };

const d = createDrawing({ units: "ft" });

d.layer("C-PROP", { color: 3 }, () => {
  d.rect([0, 0], lot.width, lot.depth);
  d.text([2, -6], `LOT ${lot.width}' x ${lot.depth}'`, { height: 3 });
});

d.layer("C-SETB", { color: 4 }, () => {
  d.rect(
    [setbacks.side, setbacks.front],
    lot.width - setbacks.side * 2,
    lot.depth - setbacks.front - setbacks.rear,
  );
});

d.layer("A-BLDG", { color: 1 }, () => {
  const x = (lot.width - house.width) / 2;
  const y = setbacks.front + 5;
  d.rect([x, y], house.width, house.depth);
  d.text([x + 2, y + house.depth / 2], "PROPOSED RESIDENCE", { height: 2 });
});

d.layer("C-ROAD", { color: 2 }, () => {
  d.line([-10, -12], [lot.width + 10, -12]);
  d.text([lot.width / 2 - 10, -18], "MAIN STREET", { height: 3 });
});

d.layer("V-TREE", { color: 3 }, () => {
  d.circle([12, 100], 6);
  d.arc([62, 100], 6, 200, 340);
});

const drawing = d.build();
const outDir = new URL("./out/", import.meta.url);
mkdirSync(outDir, { recursive: true });
writeFileSync(new URL("site-plan.dxf", outDir), toDXF(drawing));
writeFileSync(new URL("site-plan.svg", outDir), toSVG(drawing));
console.log(
  `Wrote ${drawing.entities.length} entities on ${drawing.layers.length} layers to examples/out/`,
);
