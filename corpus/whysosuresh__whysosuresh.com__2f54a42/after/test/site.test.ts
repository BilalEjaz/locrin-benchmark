// The site's checks: what is served, that every page is valid HTML with the head a shared link needs,
// that every internal link reaches a file without a redirect, that nothing loads from elsewhere but
// the allowed player and the scripts' allowed resources, that the headers match the pages and the
// scripts, that the stylesheet carries no dead rules, that nothing opens the talk flow yet, and that
// the Worker's config routes the one domain to the code only under /api/. `wrangler deploy --dry-run`
// does not read site/_headers, so this file parses it. The Worker itself is test/talk.test.ts's.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { HtmlValidate, Parser, type HtmlElement } from "html-validate";
import { describe, expect, it } from "vitest";

const root = fileURLToPath(new URL("..", import.meta.url));
const siteDir = join(root, "site");

/** Every file the Worker serves. A file not listed here fails the suite, so nothing ships by accident. */
const SERVED = [
  "404.html",
  "_headers",
  "feedback.html",
  "img/apple-touch-icon.png",
  "img/avatar.webp",
  "img/icon-192.png",
  "img/share.jpg",
  "index.html",
  "robots.txt",
  "style.css",
  "talk-recorder.js",
  "talk.js",
];

/** The only resources a page may load from another origin. */
const EXTERNAL_RESOURCES = ["https://www.youtube-nocookie.com/embed/videoseries?list=UUkdfCh9gN60s_h_nfTYEwyg"];

/**
 * The only addresses on another origin a site script names. A resource a script loads is invisible to
 * the page checks, so it is allowed here instead. Turnstile's script also opens its own frame.
 */
const SCRIPT_RESOURCES = ["https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"];

const originsOf = (urls: string[]): string => [...new Set(urls.map((url) => new URL(url).origin))].join(" ");

/** The pages a link can be shared to, which carry a description and a preview picture. */
const SHARED_PAGES = ["index.html", "feedback.html"];

const ORIGIN = "https://whysosuresh.com";

const EXPECTED_HEADERS: Record<string, string> = {
  "Content-Security-Policy": [
    "default-src 'none'",
    `script-src 'self' ${originsOf(SCRIPT_RESOURCES)}`,
    "style-src 'self'",
    "img-src 'self'",
    // "Listen back" plays the recording from the page's own memory.
    "media-src blob:",
    "connect-src 'self'",
    `frame-src ${originsOf([...EXTERNAL_RESOURCES, ...SCRIPT_RESOURCES])}`,
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
  ].join("; "),
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "X-Content-Type-Options": "nosniff",
  "Permissions-Policy": "camera=(), microphone=(self), geolocation=()",
  "Strict-Transport-Security": "max-age=31536000",
};

function listFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? listFiles(path) : [relative(siteDir, path).split(sep).join("/")];
  });
}

const served = listFiles(siteDir).sort();
const pages = served.filter((file) => file.endsWith(".html"));
const scripts = served.filter((file) => file.endsWith(".js"));
const read = (file: string): string => readFileSync(join(siteDir, file), "utf8");

const validator = new HtmlValidate({
  extends: ["html-validate:recommended", "html-validate:document"],
  rules: {
    // A hash on the site's own stylesheet would guard nothing the CSP doesn't; anything loaded from
    // another origin still needs one.
    "require-sri": ["error", { target: "crossorigin" }],
  },
});

async function parse(file: string): Promise<HtmlElement> {
  const config = await validator.getConfigFor(join(siteDir, file));
  return new Parser(config).parseHtml(read(file));
}

function attr(element: HtmlElement, name: string): string {
  const value = element.getAttributeValue(name);
  if (value === null) throw new Error(`<${element.tagName}> has no ${name}`);
  return value;
}

/**
 * Where an internal path lands under assets' `auto-trailing-slash` handling, or why it would cost a
 * redirect or miss. `/` serves index.html, `/name` serves name.html, a file with another extension
 * serves itself; `/name.html`, `/index.html` and a trailing slash on a file all answer a 307.
 */
function resolveInternal(path: string): { file: string } | { error: string } {
  if (!path.startsWith("/")) return { error: "is not root-absolute" };
  if (path.endsWith(".html")) return { error: "names an .html file, which redirects to its clean address" };
  if (path.endsWith("/")) {
    const index = `${path.slice(1)}index.html`;
    return served.includes(index) ? { file: index } : { error: "has no index.html under it" };
  }
  const exact = path.slice(1);
  if (served.includes(exact)) return { file: exact };
  if (served.includes(`${exact}.html`)) return { file: `${exact}.html` };
  return { error: "reaches no file" };
}

/** The headers set for each pattern in a Cloudflare `_headers` file. */
function parseHeaders(text: string): Map<string, Map<string, string>> {
  const rules = new Map<string, Map<string, string>>();
  let current: Map<string, string> | undefined;
  for (const line of text.split("\n")) {
    if (line.trim() === "" || line.trimStart().startsWith("#")) continue;
    if (!/^\s/.test(line)) {
      current = new Map();
      rules.set(line.trim(), current);
      continue;
    }
    const colon = line.indexOf(":");
    if (current === undefined || colon < 0) throw new Error(`unparsed _headers line: ${line}`);
    current.set(line.slice(0, colon).trim(), line.slice(colon + 1).trim());
  }
  return rules;
}

describe("the served folder", () => {
  it("holds exactly the allowlisted files", () => {
    expect(served).toEqual([...SERVED].sort());
  });

  it("carries no record shapes", () => {
    const text = served.filter((file) => !file.startsWith("img/")).map(read);
    for (const content of text) {
      expect(content).not.toMatch(/_projects|T0\d_|DD-\d/);
    }
  });
});

describe.each(pages)("%s", (page) => {
  it("is valid HTML under the recommended and document presets", async () => {
    const report = await validator.validateString(read(page), join(siteDir, page));
    const messages = report.results.flatMap((result) =>
      result.messages.map((m) => `${m.line}:${m.column} ${m.ruleId}: ${m.message}`),
    );
    expect(messages).toEqual([]);
  });

  it("opens with its intent comment", () => {
    expect(read(page)).toMatch(/^<!DOCTYPE html>\n<!-- \S/);
  });

  it("has a language, a viewport that reaches the screen's edges, and a title", async () => {
    const doc = await parse(page);
    const html = doc.querySelectorAll("html")[0];
    expect(html && attr(html, "lang")).toBe("en");
    const viewport = doc.querySelectorAll('meta[name="viewport"]')[0];
    expect(viewport && attr(viewport, "content")).toContain("viewport-fit=cover");
    expect(doc.querySelectorAll("title")[0]?.textContent.trim()).not.toBe("");
  });

  it("writes every internal link and resource as a clean, root-absolute address that reaches a file", async () => {
    const doc = await parse(page);
    const refs = [
      ...doc.querySelectorAll("a[href]").map((el) => attr(el, "href")),
      ...doc.querySelectorAll("link[href]").filter((el) => attr(el, "rel") !== "canonical").map((el) => attr(el, "href")),
      ...doc.querySelectorAll("img[src], iframe[src], script[src], source[src]").map((el) => attr(el, "src")),
    ];
    const misses = refs
      .filter((ref) => !/^[a-z]+:/i.test(ref))
      .map((ref) => ({ ref, result: resolveInternal(ref) }))
      .flatMap(({ ref, result }) => ("error" in result ? [`${ref} ${result.error}`] : []));
    expect(misses).toEqual([]);
  });

  it("loads nothing from another origin but the allowlisted resources", async () => {
    const doc = await parse(page);
    const loaded = [
      ...doc.querySelectorAll("link[href]")
        .filter((el) => !["canonical"].includes(attr(el, "rel")))
        .map((el) => attr(el, "href")),
      ...doc.querySelectorAll("img[src], iframe[src], script[src], source[src], video[src], audio[src], embed[src], object[data]")
        .map((el) => el.getAttributeValue("src") ?? attr(el, "data")),
    ];
    const foreign = loaded.filter((url) => /^[a-z]+:|^\/\//i.test(url) && !EXTERNAL_RESOURCES.includes(url));
    expect(foreign).toEqual([]);
  });

  it("never asks for no-referrer", () => {
    expect(read(page)).not.toMatch(/no-referrer"/);
  });
});

describe.each(scripts)("%s", (script) => {
  it("is type-checked and opens with its intent comment", () => {
    expect(read(script)).toMatch(/^\/\/ @ts-check\n\/\/ \S/);
  });

  it("names no address on another origin but the allowlisted resources", () => {
    const named = [...read(script).matchAll(/\b(?:https?:)?\/\/[^\s'"`)]+/g)].map((m) => m[0]);
    expect(named.filter((url) => !SCRIPT_RESOURCES.includes(url))).toEqual([]);
  });

  it("imports only served files, and links only to clean root-absolute addresses", () => {
    const text = read(script);
    const imports = [...text.matchAll(/^import [^'"]*['"]([^'"]+)['"]/gm)].map((m) => m[1] ?? "");
    expect(imports.filter((path) => !served.includes(new URL(path, `${ORIGIN}/${script}`).pathname.slice(1)))).toEqual([]);
    const links = [...text.matchAll(/href="([^"$]+)"/g)].map((m) => m[1] ?? "");
    expect(links.flatMap((ref) => { const result = resolveInternal(ref); return "error" in result ? [`${ref} ${result.error}`] : []; })).toEqual([]);
  });
});

describe("the talk flow", () => {
  it("is opened by no element yet: only /#talk reaches it until its inbox exists", async () => {
    for (const page of pages) expect((await parse(page)).querySelectorAll("[data-talk]")).toEqual([]);
  });

  it("is loaded by the home page", async () => {
    const loaded = (await parse("index.html")).querySelectorAll('script[type="module"]').map((el) => attr(el, "src"));
    expect(loaded).toEqual(["/talk.js"]);
  });

  it("carries the production widget's site key", () => {
    expect(read("talk-recorder.js")).toMatch(/^const SITE_KEY = '0x[0-9A-Za-z_-]{20,}';$/m);
  });
});

describe.each(SHARED_PAGES)("%s, as a shared link", (page) => {
  it("carries a description, a canonical address and a preview picture that exists", async () => {
    const doc = await parse(page);
    const description = doc.querySelectorAll('meta[name="description"]')[0];
    expect(description && attr(description, "content")).not.toBe("");
    const canonical = doc.querySelectorAll('link[rel="canonical"]')[0];
    const canonicalPath = new URL(canonical ? attr(canonical, "href") : "", ORIGIN);
    expect(canonicalPath.origin).toBe(ORIGIN);
    expect(resolveInternal(canonicalPath.pathname)).toEqual({ file: page });
    const image = doc.querySelectorAll('meta[property="og:image"]')[0];
    const imageUrl = new URL(image ? attr(image, "content") : "", ORIGIN);
    expect(imageUrl.origin).toBe(ORIGIN);
    expect(served).toContain(imageUrl.pathname.slice(1));
  });
});

describe("_headers", () => {
  const rules = parseHeaders(read("_headers"));

  it("sets exactly the expected headers on every path, the CSP allowing just the player's origin", () => {
    expect([...rules.keys()]).toEqual(["/*"]);
    expect(Object.fromEntries(rules.get("/*") ?? [])).toEqual(EXPECTED_HEADERS);
  });

  it("never asks for no-referrer", () => {
    const values = [...rules.values()].flatMap((headers) => [...headers.values()]);
    expect(values.filter((value) => value.includes("no-referrer"))).toEqual([]);
  });
});

describe("style.css", () => {
  const css = read("style.css").replace(/\/\*[\s\S]*?\*\//g, "");
  const preludes = [...css.matchAll(/([^{}]+)\{/g)].map((m) => (m[1] ?? "").trim()).filter((p) => !p.startsWith("@"));

  it("has no class selector that no served page or script uses", async () => {
    const used = new Set<string>();
    for (const page of pages) {
      for (const el of (await parse(page)).querySelectorAll("[class]")) {
        for (const name of attr(el, "class").split(/\s+/)) used.add(name);
      }
    }
    // The talk flow draws its sheet from a template in its script, and names the dialog's class there.
    for (const script of scripts) {
      for (const match of read(script).matchAll(/class(?:Name)?\s*=\s*["']([^"'$]+)["']/g)) {
        for (const name of (match[1] ?? "").split(/\s+/)) used.add(name);
      }
    }
    const selected = new Set(preludes.flatMap((p) => [...p.matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)].map((m) => m[1] ?? "")));
    expect([...selected].filter((name) => !used.has(name))).toEqual([]);
  });

  it("has no custom property that nothing reads", () => {
    const defined = new Set([...css.matchAll(/(--[\w-]+)\s*:/g)].map((m) => m[1] ?? ""));
    const readProps = new Set([...css.matchAll(/var\((--[\w-]+)/g)].map((m) => m[1] ?? ""));
    expect([...defined].filter((name) => !readProps.has(name))).toEqual([]);
  });
});

describe("wrangler.jsonc", () => {
  const text = readFileSync(join(root, "wrangler.jsonc"), "utf8");

  it("names the account by its 32-character id", () => {
    expect(text).toMatch(/"account_id": "[0-9a-f]{32}"/);
  });

  it("routes the apex, and only the apex, to the Worker", () => {
    expect(text).toContain('"routes": [{ "pattern": "whysosuresh.com/*", "zone_name": "whysosuresh.com" }]');
    expect(text.match(/"pattern"/g)).toHaveLength(1);
    expect(text).not.toContain("custom_domain");
  });

  it("runs the code only under /api/, and every page comes straight from site/", () => {
    expect(text).toContain('"run_worker_first": ["/api/*"]');
    expect(text.match(/"run_worker_first"/g)).toHaveLength(1);
  });

  it("binds the database Planton created, by a real id", () => {
    const id = /"database_id": "([0-9a-f-]+)"/.exec(text)?.[1] ?? "";
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(id).not.toMatch(/^[0-]+$/);
  });

  it("keeps Cloudflare's automatic request records off", () => {
    expect(text).toContain('"observability": { "enabled": true, "logs": { "invocation_logs": false } }');
  });
});
