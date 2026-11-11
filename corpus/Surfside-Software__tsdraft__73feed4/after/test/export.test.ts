import assert from "node:assert/strict";
import { test } from "node:test";
import { createDrawing, toDXF, toSVG } from "../src/index.ts";

/** Parses DXF text into [code, value] pairs. */
function pairs(dxf: string): [number, string][] {
  const lines = dxf.split("\r\n");
  assert.equal(lines.pop(), "", "DXF ends with CRLF");
  assert.equal(lines.length % 2, 0, "DXF has whole group-code pairs");
  const out: [number, string][] = [];
  for (let i = 0; i < lines.length; i += 2) out.push([Number(lines[i]), lines[i + 1] ?? ""]);
  return out;
}

function sample() {
  const b = createDrawing({ units: "ft" });
  b.layer("C-PROP", { color: 3 }, () => {
    b.rect([0, 0], 100, 0.1 + 0.2);
    b.arc([50, 0], 5, 0, 180);
  });
  b.text([1, 1], "LOT 1 <A&B>", { height: 2, rotation: 90 });
  return b.build();
}

test("DXF is well-formed R12 with layers and entities", () => {
  const p = pairs(toDXF(sample()));
  const has = (code: number, value: string) => p.some(([c, v]) => c === code && v === value);

  assert.deepEqual(p.at(-1), [0, "EOF"]);
  assert.ok(has(1, "AC1009"));
  const headerVars = p.filter(([c]) => c === 9).map(([, v]) => v);
  assert.deepEqual(headerVars, ["$ACADVER"], "only R12 header variables");
  assert.ok(has(2, "C-PROP") && has(62, "3"), "layer table entry");
  for (const kind of ["POLYLINE", "VERTEX", "SEQEND", "ARC", "TEXT"]) assert.ok(has(0, kind), kind);
  assert.equal(p.filter(([c, v]) => c === 0 && v === "VERTEX").length, 4);
  assert.ok(has(20, "0.3"), "no float noise in coordinates");
  assert.ok(has(1, "LOT 1 <A&B>"));
  assert.ok(has(50, "90"), "text rotation");
});

test("SVG flips Y, escapes text and colors by layer", () => {
  const svg = toSVG(sample(), { margin: 0 });
  assert.match(svg, /<g transform="scale\(1 -1\)"/);
  assert.match(svg, /<polygon points="0,0 100,0 100,0.3 0,0.3" stroke="#00ff00"/);
  assert.match(svg, /<path d="M 55 0 A 5 5 0 0 1 45 0"/);
  assert.match(svg, />LOT 1 &lt;A&amp;B&gt;<\/text>/);
  assert.match(svg, /rotate\(-90\)/);
});

test("empty drawing still exports", () => {
  const d = createDrawing().build();
  assert.deepEqual(pairs(toDXF(d)).at(-1), [0, "EOF"]);
  assert.match(toSVG(d), /^<svg /);
});
