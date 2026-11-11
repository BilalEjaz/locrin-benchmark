// Runs the examples and writes each one's SVG, restyled per theme, to
// docs/assets/<name>-{light,dark}.svg. Each layer gets a color role. Line widths come from the
// drawing's lineweights, as toSVG writes them, and are made to scale with the picture as
// lineweights do on paper.
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));

type Role = "line" | "muted" | "accent";

interface Picture {
  readonly name: string;
  /** Width of the picture in pixels. */
  readonly width: number;
  /** The margin added around the drawing, in drawing units. */
  readonly pad: number;
  /** The width in pixels, at `width`, of a line of the default lineweight, 0.25 mm. */
  readonly pen: number;
  /** Round line ends, which draw very short lines as dots but close up fine dash patterns. */
  readonly roundCaps: boolean;
  /** The color role of each layer that has entities. */
  readonly roles: Record<string, Role>;
}

const themes = {
  light: { bg: "#f6f8fa", line: "#1f2328", muted: "#818b98", accent: "#0d7a8c" },
  dark: { bg: "#131315", line: "#f2f2f3", muted: "#8b8b92", accent: "#1aafc8" },
};

const pictures: Picture[] = [
  {
    name: "site-plan",
    width: 1100,
    pad: 6,
    pen: 1,
    roundCaps: false,
    roles: {
      "C-PROP": "line",
      "C-PROP-ADJC": "muted",
      "C-PROP-MONU": "line",
      "C-SETB": "muted",
      "C-BLDG": "accent",
      "C-PAVE": "muted",
      "C-ROAD-CNTR": "muted",
      "V-TREE": "muted",
      "C-ANNO-DIMS": "accent",
      "C-ANNO-TEXT": "line",
      "C-ANNO-SYMB": "line",
      "C-ANNO-TITL": "line",
    },
  },
  {
    name: "outdoor-kitchen",
    width: 830,
    pad: 2,
    pen: 0.55,
    roundCaps: true,
    roles: {
      "A-WALL": "line",
      "A-WALL-PATT": "muted",
      "A-FLOR-CASE": "line",
      "A-EQPM": "line",
      "A-GLAZ": "line",
      "A-FURN": "line",
      "A-DETL": "line",
      "A-DETL-HIDN": "muted",
      "A-ANNO-DIMS": "accent",
      "A-ANNO-NOTE": "line",
      "A-ANNO-SYMB": "line",
      "A-ANNO-TITL": "line",
    },
  },
];

// The group toSVG wraps the entities in. A default line is one pixel wide at any size, and an
// entity of another lineweight carries its width in pixels in proportion.
const group =
  '<g transform="scale(1 -1)" fill="none" stroke-width="1" vector-effect="non-scaling-stroke">';

for (const picture of pictures) {
  const { name, width, pad, pen, roundCaps, roles } = picture;
  execFileSync(process.execPath, [`examples/${name}.ts`], { cwd: root, stdio: "inherit" });
  const svg = readFileSync(`${root}/examples/out/${name}.svg`, "utf8");
  if (!svg.includes(group)) {
    throw new Error("toSVG's output changed shape, so the restyling no longer applies");
  }

  for (const [theme, colors] of Object.entries(themes)) {
    let unitsPerPixel = 0;
    const lines = svg
      .replace(/viewBox="([^"]+)">/, (_, box: string) => {
        const [x = 0, y = 0, w = 0, h = 0] = box.split(" ").map(Number);
        const [vx, vy, vw, vh] = [x - pad, y - pad, w + pad * 2, h + pad * 2].map((n) =>
          Number(n.toFixed(6)),
        ) as [number, number, number, number];
        unitsPerPixel = vw / width;
        return [
          `viewBox="${vx} ${vy} ${vw} ${vh}" width="${width}" height="${Math.round((width * vh) / vw)}">`,
          `  <rect x="${vx}" y="${vy}" width="${vw}" height="${vh}" rx="2" fill="${colors.bg}"/>`,
        ].join("\n");
      })
      .replace(
        group,
        `<g transform="scale(1 -1)" fill="none"${roundCaps ? ' stroke-linecap="round"' : ""} stroke-linejoin="round">`,
      )
      .split("\n");
    // Entities drawn alike share one group that carries their color and width, which keeps the
    // file small.
    const body: string[] = [];
    let openGroup = "";
    for (const line of lines) {
      const layer = /data-layer="([^"]+)"/.exec(line)?.[1];
      const role = layer === undefined ? undefined : roles[layer];
      if (layer !== undefined && !role) throw new Error(`Layer ${layer} of ${name} has no role`);
      const relative = Number(/ stroke-width="([\d.]+)"/.exec(line)?.[1] ?? 1);
      const strokeWidth = Number((relative * pen * unitsPerPixel).toFixed(3));
      const groupTag = role ? `    <g stroke="${colors[role]}" stroke-width="${strokeWidth}">` : "";
      if (groupTag !== openGroup) {
        if (openGroup) body.push("    </g>");
        if (groupTag) body.push(groupTag);
        openGroup = groupTag;
      }
      if (!role) {
        body.push(line);
        continue;
      }
      body.push(
        line
          .replace(/ vector-effect="non-scaling-stroke"/, "")
          .replace(/ data-layer="[^"]*"/, "")
          .replace(/ data-entity="[^"]*"/, "")
          .replace(/ stroke-width="[^"]*"/, "")
          .replace(/ stroke="(?!none)[^"]*"/, "")
          .replace(/fill="(?!none)[^"]*"/, `fill="${colors[role]}"`)
          .replace(
            'font-family="monospace"',
            `font-family="ui-monospace, SFMono-Regular, Menlo, Consolas, monospace"`,
          )
          // The examples place centered and right-aligned text for characters 0.6 of the text
          // height wide. textLength holds each text to that width in a narrower or wider font.
          .replace(
            /font-size="([^"]+)"([^>]*)>([^<]*)<\/text>/,
            (_, size: string, rest: string, value: string) => {
              const characters = value.replace(/&[a-z]+;/g, "x").length;
              const length = Number((characters * 0.6 * Number(size)).toFixed(3));
              return `font-size="${size}"${rest} textLength="${length}">${value}</text>`;
            },
          ),
      );
    }
    const out = body.join("\n");
    if (
      !out.includes(colors.bg) ||
      !out.includes(colors.accent) ||
      out.includes("vector-effect") ||
      out.includes("data-layer") ||
      out.includes("data-entity")
    ) {
      throw new Error("toSVG's output changed shape, so the restyling no longer applies");
    }
    writeFileSync(`${root}/docs/assets/${name}-${theme}.svg`, out);
  }
  console.log(`Wrote docs/assets/${name}-light.svg and ${name}-dark.svg`);
}
