/**
 * Which ```mermaid fences Paseo may render, and why it refused one.
 *
 * Paseo 0.15.3 renders a mermaid fence only when `containsUnsafeMermaidSource`
 * (`packages/app/src/components/markdown/fence/mermaid/source-policy.ts`) passes it. That policy
 * allows `<br>` and `<i>` and nothing else, and a refusal is silent: the reader sees the source
 * as a code block with no reason. Agents bold a label line with `<b>` all the time, so most
 * generated diagrams never render, although Paseo's own runtime draws them correctly.
 *
 * This module keeps every Paseo guard (shape metadata `@{`, `url(`, `@import`, `themeCSS`, numeric
 * entities `&#`, escape-smuggled tags) and widens one thing: attribute-free inline formatting
 * tags. A tag with any attribute is still refused, so no tag can carry a URL. The runtime also
 * draws inside a sandboxed iframe whose CSP has `connect-src 'none'`.
 *
 * Shared by the client hook, the settings screen and tests, so the verdict a human sees in
 * Settings is the verdict the chat used.
 */

/** Copied verbatim from Paseo 0.15.3 so a verdict can say whether the widening was needed. */
export const PASEO_NATIVE_UNSAFE_MERMAID_SOURCE =
  /@\s*\{|url\s*\(|@import\b|themeCSS|&#|<(?!\/?(?:br|i)\s*\/?>)[a-z!/]/i;

/**
 * Attribute-free tags that change only how label text looks. Each one was rendered through the
 * Paseo 0.15.3 iframe runtime on 2026-11-10 and drew its text without printing the tag.
 */
export const MERMAID_FORMATTING_TAGS = [
  "br",
  "i",
  "b",
  "strong",
  "em",
  "u",
  "s",
  "del",
  "sub",
  "sup",
  "small",
  "code",
  "mark",
  "span",
] as const;

const TAG_ALTERNATION = MERMAID_FORMATTING_TAGS.join("|");
const DISALLOWED_TAG = new RegExp(`<(?!\\/?(?:${TAG_ALTERNATION})\\s*\\/?>)[a-z!/]`, "i");
const FORMATTING_TAG = new RegExp(`<\\/?(${TAG_ALTERNATION})\\s*\\/?>`, "gi");

export type MermaidRejectReason =
  | "shape-metadata"
  | "css-url"
  | "css-import"
  | "theme-css"
  | "numeric-entity"
  | "html-tag"
  | "invalid-escape";

/** Ordered like Paseo's alternation, so the first guard that fires names the reason. */
const GUARDS: ReadonlyArray<{ reason: MermaidRejectReason; pattern: RegExp }> = [
  { reason: "shape-metadata", pattern: /@\s*\{/i },
  { reason: "css-url", pattern: /url\s*\(/i },
  { reason: "css-import", pattern: /@import\b/i },
  { reason: "theme-css", pattern: /themeCSS/i },
  { reason: "numeric-entity", pattern: /&#/i },
  { reason: "html-tag", pattern: DISALLOWED_TAG },
];

export interface MermaidSourceVerdict {
  /** native: Paseo renders it as is. widened: renders only with the formatting-tag allowlist. */
  verdict: "native" | "widened" | "rejected";
  reason: MermaidRejectReason | null;
  /** The text that tripped the guard, at most 40 characters. */
  match: string | null;
  /** Lower-case formatting tags Paseo alone would have refused. */
  widenedTags: string[];
}

function firstGuardHit(code: string): { reason: MermaidRejectReason; match: string } | null {
  for (const guard of GUARDS) {
    const hit = guard.pattern.exec(code);
    if (hit) {
      const tail = code.slice(hit.index, hit.index + 40);
      const match = guard.reason === "html-tag" ? tail.slice(0, (tail.indexOf(">") + 1) || 40) : hit[0];
      return { reason: guard.reason, match };
    }
  }
  return null;
}

function decodeCodePoint(value: number): string {
  if (!Number.isInteger(value) || value < 0 || value > 0x10ffff) {
    throw new RangeError("Invalid Unicode code point");
  }
  return String.fromCodePoint(value);
}

/** Paseo's escape decoding, so `<img>` is judged as `<img>`. Null = invalid escape. */
function normalizeEscapes(code: string): string | null {
  try {
    return code
      .replace(/\\u\{([0-9a-fA-F]{1,6})\}/g, (_, hex: string) =>
        decodeCodePoint(Number.parseInt(hex, 16)),
      )
      .replace(/\\u([0-9a-fA-F]{4})/g, (_, hex: string) =>
        String.fromCharCode(Number.parseInt(hex, 16)),
      )
      .replace(/\\x([0-9a-fA-F]{2})/g, (_, hex: string) =>
        String.fromCharCode(Number.parseInt(hex, 16)),
      )
      .replace(/["'`\\]/g, "");
  } catch {
    return null;
  }
}

function widenedTagsIn(code: string): string[] {
  const tags = new Set<string>();
  for (const hit of code.matchAll(FORMATTING_TAG)) {
    const tag = hit[1].toLowerCase();
    if (tag !== "br" && tag !== "i") tags.add(tag);
  }
  return [...tags];
}

export function explainMermaidSource(code: string): MermaidSourceVerdict {
  const direct = firstGuardHit(code);
  if (direct) return { verdict: "rejected", ...direct, widenedTags: [] };
  const normalized = normalizeEscapes(code);
  if (normalized === null) {
    return { verdict: "rejected", reason: "invalid-escape", match: null, widenedTags: [] };
  }
  const decoded = firstGuardHit(normalized);
  if (decoded) return { verdict: "rejected", ...decoded, widenedTags: [] };

  const nativeUnsafe =
    PASEO_NATIVE_UNSAFE_MERMAID_SOURCE.test(code) ||
    PASEO_NATIVE_UNSAFE_MERMAID_SOURCE.test(normalized);
  if (!nativeUnsafe) return { verdict: "native", reason: null, match: null, widenedTags: [] };
  return {
    verdict: "widened",
    reason: null,
    match: null,
    widenedTags: [...new Set([...widenedTagsIn(code), ...widenedTagsIn(normalized)])],
  };
}

/** Drop-in for Paseo's `containsUnsafeMermaidSource`. */
export function isUnsafeMermaidSource(code: string): boolean {
  return explainMermaidSource(code).verdict === "rejected";
}

/** Fence languages that mean Mermaid but are not spelled `mermaid`. */
export const MERMAID_LANGUAGE_ALIASES = new Set(["mmd", "mermaidjs", "mermaid-js"]);

const DIRECTED = /^(?:flowchart|graph)\s+(?:TD|TB|BT|RL|LR)\s*;?\s*$/;
const BARE_HEADER =
  /^(?:sequenceDiagram|classDiagram(?:-v2)?|stateDiagram(?:-v2)?|erDiagram|journey|gitGraph|mindmap|quadrantChart|requirementDiagram|C4Context|C4Container|C4Component|C4Dynamic|C4Deployment|sankey-beta|xychart-beta|block-beta|packet-beta|kanban|architecture-beta|radar-beta|treemap-beta)\s*$/;
const TITLED_HEADER = /^(?:pie|gantt|timeline)(?:\s+(?:showData|title\s+\S.*))?\s*$/;

/** First line that is not blank, a `%%` comment, or part of a leading `---` front matter. */
function diagramHeaderLine(code: string): { header: string; bodyLines: number } | null {
  const lines = code.split(/\r?\n/);
  let index = 0;
  while (index < lines.length && lines[index].trim() === "") index++;
  if (lines[index]?.trim() === "---") {
    const close = lines.findIndex((line, i) => i > index && line.trim() === "---");
    if (close === -1) return null;
    index = close + 1;
  }
  for (; index < lines.length; index++) {
    const trimmed = lines[index].trim();
    if (trimmed === "" || trimmed.startsWith("%%")) continue;
    const bodyLines = lines.slice(index + 1).filter((line) => line.trim() !== "").length;
    return { header: trimmed, bodyLines };
  }
  return null;
}

/** True when an unlabelled fence starts like a Mermaid diagram and has a body. */
export function looksLikeMermaid(code: string): boolean {
  const found = diagramHeaderLine(code);
  if (!found || found.bodyLines === 0) return false;
  return DIRECTED.test(found.header) || BARE_HEADER.test(found.header) || TITLED_HEADER.test(found.header);
}

export interface MermaidFenceDecision {
  render: boolean;
  via: "tag" | "alias" | "detected" | null;
}

export function resolveMermaidFence(
  code: string,
  language: string | null | undefined,
  options: { detectUntagged?: boolean } = {},
): MermaidFenceDecision {
  const lang = (language ?? "").trim().toLowerCase();
  if (lang === "mermaid") return { render: true, via: "tag" };
  if (MERMAID_LANGUAGE_ALIASES.has(lang)) return { render: true, via: "alias" };
  if (lang === "" && options.detectUntagged !== false && looksLikeMermaid(code)) {
    return { render: true, via: "detected" };
  }
  return { render: false, via: null };
}
