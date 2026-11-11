import type { Drawing, Entity, Units } from "./drawing.ts";
import { fmt } from "./format.ts";

/** $INSUNITS codes. */
const INSUNITS: Record<Units, number> = { in: 1, ft: 2, mm: 4, cm: 5, m: 6 };

/**
 * Writes an ASCII DXF (AC1009, R12). R12 is the most widely readable DXF:
 * AutoCAD, BricsCAD, LibreCAD, QCAD and most converters open it.
 */
export function toDXF(drawing: Drawing): string {
  const out: string[] = [];
  const g = (code: number, value: string | number) => {
    out.push(String(code), typeof value === "number" ? fmt(value) : value);
  };

  g(0, "SECTION");
  g(2, "HEADER");
  g(9, "$ACADVER");
  g(1, "AC1009");
  g(9, "$INSUNITS");
  g(70, String(INSUNITS[drawing.units]));
  g(0, "ENDSEC");

  g(0, "SECTION");
  g(2, "TABLES");
  g(0, "TABLE");
  g(2, "LTYPE");
  g(70, "1");
  g(0, "LTYPE");
  g(2, "CONTINUOUS");
  g(70, "0");
  g(3, "Solid line");
  g(72, "65");
  g(73, "0");
  g(40, "0.0");
  g(0, "ENDTAB");
  g(0, "TABLE");
  g(2, "LAYER");
  g(70, String(drawing.layers.length));
  for (const layer of drawing.layers) {
    g(0, "LAYER");
    g(2, layer.name);
    g(70, "0");
    g(62, String(layer.color));
    g(6, "CONTINUOUS");
  }
  g(0, "ENDTAB");
  g(0, "ENDSEC");

  g(0, "SECTION");
  g(2, "ENTITIES");
  for (const entity of drawing.entities) writeEntity(entity, g);
  g(0, "ENDSEC");
  g(0, "EOF");

  return out.join("\r\n") + "\r\n";
}

function writeEntity(e: Entity, g: (code: number, value: string | number) => void): void {
  switch (e.kind) {
    case "line":
      g(0, "LINE");
      g(8, e.layer);
      g(10, e.from[0]);
      g(20, e.from[1]);
      g(30, 0);
      g(11, e.to[0]);
      g(21, e.to[1]);
      g(31, 0);
      return;
    case "polyline":
      g(0, "POLYLINE");
      g(8, e.layer);
      g(66, "1");
      g(10, 0);
      g(20, 0);
      g(30, 0);
      g(70, e.closed ? "1" : "0");
      for (const [x, y] of e.points) {
        g(0, "VERTEX");
        g(8, e.layer);
        g(10, x);
        g(20, y);
        g(30, 0);
      }
      g(0, "SEQEND");
      g(8, e.layer);
      return;
    case "circle":
      g(0, "CIRCLE");
      g(8, e.layer);
      g(10, e.center[0]);
      g(20, e.center[1]);
      g(30, 0);
      g(40, e.radius);
      return;
    case "arc":
      g(0, "ARC");
      g(8, e.layer);
      g(10, e.center[0]);
      g(20, e.center[1]);
      g(30, 0);
      g(40, e.radius);
      g(50, e.startAngle);
      g(51, e.endAngle);
      return;
    case "text":
      g(0, "TEXT");
      g(8, e.layer);
      g(10, e.at[0]);
      g(20, e.at[1]);
      g(30, 0);
      g(40, e.height);
      g(1, e.value);
      if (e.rotation !== 0) g(50, e.rotation);
      return;
  }
}
