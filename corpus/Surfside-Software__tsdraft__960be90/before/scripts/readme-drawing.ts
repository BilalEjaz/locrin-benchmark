// Runs examples/site-plan.ts and writes its SVG, restyled per theme, to docs/assets/site-plan-{light,dark}.svg.
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
execFileSync(process.execPath, ["examples/site-plan.ts"], { cwd: root, stdio: "inherit" });
const svg = readFileSync(`${root}/examples/out/site-plan.svg`, "utf8");

const themes = {
  light: { bg: "#f6f8fa", line: "#1f2328", muted: "#818b98", accent: "#0d7a8c" },
  dark: { bg: "#131315", line: "#f2f2f3", muted: "#8b8b92", accent: "#1aafc8" },
};
const role: Record<string, "muted" | "accent"> = {
  "A-BLDG": "accent",
  "C-SETB": "muted",
  "C-PAVE": "muted",
  "V-TREE": "muted",
};
const pad = 6;
const width = 760;
const weight = 1.5; // widens every line by the same factor, so the pen weights keep their ratios

for (const [name, colors] of Object.entries(themes)) {
  const out = svg
    .replace(/viewBox="([^"]+)">/, (_, box: string) => {
      const [x = 0, y = 0, w = 0, h = 0] = box.split(" ").map(Number);
      const [vx, vy, vw, vh] = [x - pad, y - pad, w + pad * 2, h + pad * 2].map((n) =>
        Number(n.toFixed(6)),
      ) as [number, number, number, number];
      return [
        `viewBox="${vx} ${vy} ${vw} ${vh}" width="${width}" height="${Math.round((width * vh) / vw)}">`,
        `  <rect x="${vx}" y="${vy}" width="${vw}" height="${vh}" rx="2" fill="${colors.bg}"/>`,
      ].join("\n");
    })
    .replace(/ stroke-width="([\d.]+)"/g, (_, w: string) => {
      return ` stroke-width="${Number((Number(w) * weight).toFixed(6))}"`;
    })
    .replace(/^(\s*<g [^>]*stroke-width="[\d.]+")/m, '$1 stroke-linejoin="round"')
    .replace(/^.*data-layer="([^"]+)".*$/gm, (line, layer: string) => {
      const color = colors[role[layer] ?? "line"];
      return line
        .replace(/(stroke|fill)="(?!none)[^"]*"/g, `$1="${color}"`)
        .replace(
          'font-family="monospace"',
          `font-family="ui-monospace, SFMono-Regular, Menlo, Consolas, monospace"`,
        );
    });
  if (
    !out.includes(colors.bg) ||
    !out.includes('stroke-linejoin="round"') ||
    !out.includes(colors.accent)
  ) {
    throw new Error("toSVG's output changed shape, so the restyling no longer applies");
  }
  writeFileSync(`${root}/docs/assets/site-plan-${name}.svg`, out);
}
console.log("Wrote docs/assets/site-plan-light.svg and site-plan-dark.svg");
