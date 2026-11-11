import assert from "node:assert/strict";
import { test } from "node:test";
import { createDrawing, sweep } from "../src/index.ts";

test("layer() scopes entities and restores the previous layer", () => {
  const d = createDrawing().layer("A-WALL", { color: 1 }).build();
  assert.deepEqual(
    d.layers.map((l) => l.name),
    ["0", "A-WALL"],
  );

  const b = createDrawing();
  b.layer("A-WALL", { color: 1 }, () => {
    b.line([0, 0], [10, 0]);
  });
  b.circle([0, 0], 1);
  const [wall, circle] = b.build().entities;
  assert.equal(wall?.layer, "A-WALL");
  assert.equal(circle?.layer, "0");
});

test("rect() makes a closed four-point polyline", () => {
  const [rect] = createDrawing().rect([1, 2], 3, 4).build().entities;
  assert.deepEqual(rect, {
    kind: "polyline",
    layer: "0",
    closed: true,
    points: [
      [1, 2],
      [4, 2],
      [4, 6],
      [1, 6],
    ],
  });
});

test("rejects bad geometry and names", () => {
  const b = createDrawing();
  assert.throws(() => b.circle([0, 0], 0), /radius/);
  assert.throws(() => b.line([0, Number.NaN], [1, 1]), /finite/);
  assert.throws(() => b.arc([0, 0], 1, 90, 450), /differ/);
  assert.throws(() => b.text([0, 0], "two\nlines"), /single line/);
  assert.throws(() => b.layer("bad:name"), /Invalid layer/);
  assert.throws(() => b.layer("X", { color: 0 }), /ACI/);
});

test("sweep() measures counterclockwise", () => {
  assert.equal(sweep(0, 90), 90);
  assert.equal(sweep(270, 90), 180);
  assert.equal(sweep(90, 0), 270);
});
