/**
 * Mermaid diagrams in Paseo chat: render the ones Paseo refuses for no good reason, and say why
 * when a diagram still shows as source.
 *
 * Paseo 0.15.3 already ships a sandboxed Mermaid runtime (`MermaidFence`). Two things keep most
 * agent diagrams out of it:
 *  1. `containsUnsafeMermaidSource` allows only `<br>` and `<i>` in labels, so a `<b>` sends the
 *     whole diagram back to a code block. Hooked here with `shared/mermaid-policy.ts`, which keeps
 *     every Paseo guard and also allows attribute-free formatting tags.
 *  2. `WEB_RENDERERS.codeBlock` renders a diagram only for the exact language `mermaid`. Hooked to
 *     also route `mmd` / `mermaidjs` fences and unlabelled fences that start with a diagram header.
 * Both refusals were silent. A blocked diagram now carries a one-line reason under its source,
 * and a diagram Mermaid cannot parse says so too.
 *
 * Read / test / tune: `Settings -> Plugins -> File Inspector & Finder -> Mermaid diagrams`
 * (`client/mermaid-settings-section.tsx`). Agents and e2e scripts read `getMermaidStatus()` via
 * `globalThis.__paseoFinderMermaid`.
 */
import { createElement, Fragment, type ComponentType, type ReactNode } from "react";
import { Text } from "react-native";
import {
  type MermaidRejectReason,
  type MermaidSourceVerdict,
  PASEO_NATIVE_UNSAFE_MERMAID_SOURCE,
  explainMermaidSource,
  resolveMermaidFence,
} from "../shared/mermaid-policy";
import { type MetroWindow, requireMetroExport } from "./metro-registry";

export interface MermaidPrefs {
  widenFormattingTags: boolean;
  detectUntaggedFences: boolean;
  explainBlocked: boolean;
}

export const DEFAULT_MERMAID_PREFS: MermaidPrefs = {
  widenFormattingTags: true,
  detectUntaggedFences: true,
  explainBlocked: true,
};

export type MermaidEventKind = "native" | "widened" | "rejected" | "detected" | "render-error";

export interface MermaidEvent {
  at: string;
  kind: MermaidEventKind;
  detail: string;
  preview: string;
}

export interface MermaidStatus {
  policyHook: { installed: boolean; moduleId: number | null };
  renderersHook: { installed: boolean; moduleId: number | null };
  hostFenceAvailable: boolean;
  counts: Record<MermaidEventKind, number>;
  recent: MermaidEvent[];
  prefs: MermaidPrefs;
}

export const MERMAID_STATUS_EVENT = "paseo-finder:mermaid-status";
const PREFS_KEY = "paseo:finder-plugin:mermaid-prefs";
const RECENT_LIMIT = 12;
const SEEN_LIMIT = 300;
const RENDER_ERROR_SETTLE_MS = 1500;
const CAPTION_ATTR = "data-paseo-finder-mermaid-caption";

type CodeBlockProps = { code?: string; language?: string } & Record<string, unknown>;
type CodeBlockFn = (props: CodeBlockProps) => ReactNode;
type PolicyFn = (code: string) => boolean;

const state = {
  prefs: { ...DEFAULT_MERMAID_PREFS },
  status: {
    policyHook: { installed: false, moduleId: null },
    renderersHook: { installed: false, moduleId: null },
    hostFenceAvailable: false,
    counts: { native: 0, widened: 0, rejected: 0, detected: 0, "render-error": 0 },
    recent: [],
    prefs: { ...DEFAULT_MERMAID_PREFS },
  } as MermaidStatus,
  seen: new Set<string>(),
  getLocale: (() => "en") as () => string,
};

function storage(): Storage | null {
  try {
    return typeof localStorage !== "undefined" ? localStorage : null;
  } catch {
    return null;
  }
}

export function loadMermaidPrefs(): MermaidPrefs {
  const raw = storage()?.getItem(PREFS_KEY);
  if (!raw) return { ...DEFAULT_MERMAID_PREFS };
  try {
    const parsed = JSON.parse(raw) as Partial<MermaidPrefs>;
    return {
      widenFormattingTags: parsed.widenFormattingTags !== false,
      detectUntaggedFences: parsed.detectUntaggedFences !== false,
      explainBlocked: parsed.explainBlocked !== false,
    };
  } catch {
    return { ...DEFAULT_MERMAID_PREFS };
  }
}

function emitStatus(): void {
  state.status = { ...state.status, prefs: { ...state.prefs } };
  if (typeof window !== "undefined" && typeof CustomEvent === "function") {
    window.dispatchEvent(new CustomEvent(MERMAID_STATUS_EVENT, { detail: getMermaidStatus() }));
  }
}

export function syncMermaidPrefs(next: Partial<MermaidPrefs>): MermaidPrefs {
  state.prefs = { ...state.prefs, ...next };
  storage()?.setItem(PREFS_KEY, JSON.stringify(state.prefs));
  emitStatus();
  return { ...state.prefs };
}

export function getMermaidStatus(): MermaidStatus {
  return JSON.parse(JSON.stringify({ ...state.status, prefs: state.prefs })) as MermaidStatus;
}

function firstLine(code: string): string {
  return (code.split(/\r?\n/).find((line) => line.trim() !== "") ?? "").trim().slice(0, 60);
}

/** Counts each distinct diagram once per kind, however many times React re-renders it. */
export function recordMermaidEvent(kind: MermaidEventKind, detail: string, code: string): void {
  const key = `${kind}\u0000${code}`;
  if (state.seen.has(key)) return;
  if (state.seen.size >= SEEN_LIMIT) state.seen.clear();
  state.seen.add(key);
  const event: MermaidEvent = { at: new Date().toISOString(), kind, detail, preview: firstLine(code) };
  state.status = {
    ...state.status,
    counts: { ...state.status.counts, [kind]: state.status.counts[kind] + 1 },
    recent: [event, ...state.status.recent].slice(0, RECENT_LIMIT),
  };
  emitStatus();
}

/** The verdict the chat uses under the current prefs. */
export function currentMermaidVerdict(code: string): MermaidSourceVerdict {
  const verdict = explainMermaidSource(code);
  if (state.prefs.widenFormattingTags || verdict.verdict !== "widened") return verdict;
  const tag = /<\/?[a-z]+\s*\/?>/i.exec(code)?.[0] ?? null;
  return { verdict: "rejected", reason: "html-tag", match: tag, widenedTags: [] };
}

const REASON_TEXT: Record<"en" | "zh", Record<MermaidRejectReason | "render-error", string>> = {
  en: {
    "shape-metadata": "it uses @{…} shape data, which Paseo blocks",
    "css-url": "it contains url(…), which Paseo blocks",
    "css-import": "it contains @import, which Paseo blocks",
    "theme-css": "it sets themeCSS, which Paseo blocks",
    "numeric-entity": "it contains an &#… entity, which Paseo blocks",
    "html-tag": "it contains {match}, which Paseo blocks",
    "invalid-escape": "it contains an invalid escape sequence",
    "render-error": "Mermaid could not parse it",
  },
  zh: {
    "shape-metadata": "含 @{…} 形状数据，Paseo 出于安全不渲染",
    "css-url": "含 url(…)，Paseo 出于安全不渲染",
    "css-import": "含 @import，Paseo 出于安全不渲染",
    "theme-css": "设置了 themeCSS，Paseo 出于安全不渲染",
    "numeric-entity": "含 &#… 实体，Paseo 出于安全不渲染",
    "html-tag": "含 {match}，Paseo 出于安全不渲染",
    "invalid-escape": "含无效的转义序列",
    "render-error": "Mermaid 无法解析",
  },
};

export function describeMermaidBlock(
  reason: MermaidRejectReason | "render-error",
  match: string | null,
  locale: string,
): string {
  const zh = /^zh/i.test(locale);
  const body = REASON_TEXT[zh ? "zh" : "en"][reason].replace("{match}", match ?? "HTML");
  return zh ? `图表以源码显示：${body}。` : `Diagram shown as source: ${body}.`;
}

const CAPTION_STYLE = {
  marginTop: 4,
  fontSize: 12,
  lineHeight: 16,
  color: "var(--paseo-finder-fg-muted, currentColor)",
} as const;

function installPolicyHook(win: MetroWindow): () => void {
  const hit = requireMetroExport("containsUnsafeMermaidSource", win);
  const original = hit?.exports.containsUnsafeMermaidSource as PolicyFn | undefined;
  if (!hit || typeof original !== "function") return () => undefined;
  const wrapped: PolicyFn = (code) => {
    const source = String(code ?? "");
    const verdict = explainMermaidSource(source);
    recordMermaidEvent(verdict.verdict, verdict.reason ?? verdict.widenedTags.join(","), source);
    if (!state.prefs.widenFormattingTags) return original(source);
    return verdict.verdict === "rejected";
  };
  hit.exports.containsUnsafeMermaidSource = wrapped;
  state.status.policyHook = { installed: true, moduleId: hit.id };
  return () => {
    if (hit.exports.containsUnsafeMermaidSource === wrapped) hit.exports.containsUnsafeMermaidSource = original;
    state.status.policyHook = { installed: false, moduleId: hit.id };
  };
}

function installRenderersHook(win: MetroWindow): () => void {
  const hit = requireMetroExport("WEB_RENDERERS", win);
  const renderers = hit?.exports.WEB_RENDERERS as { codeBlock?: CodeBlockFn } | undefined;
  const original = renderers?.codeBlock;
  if (!hit || !renderers || typeof original !== "function") return () => undefined;
  const wrapped: CodeBlockFn = (props) => {
    const code = String(props?.code ?? "");
    const decision = resolveMermaidFence(code, props?.language, {
      detectUntagged: state.prefs.detectUntaggedFences,
    });
    // Always call the original exactly once, so its memo-cache hook count never changes.
    const element = original(decision.render ? { ...props, language: "mermaid" } : props);
    if (!decision.render) return element;
    if (decision.via !== "tag") recordMermaidEvent("detected", decision.via ?? "", code);
    if (!state.prefs.explainBlocked) return element;
    const verdict = currentMermaidVerdict(code);
    if (verdict.verdict !== "rejected" || !verdict.reason) return element;
    const caption = createElement(
      Text,
      { style: CAPTION_STYLE, testID: "mermaid-blocked-reason", selectable: true },
      describeMermaidBlock(verdict.reason, verdict.match, state.getLocale()),
    );
    return createElement(Fragment, null, element, caption);
  };
  renderers.codeBlock = wrapped;
  state.status.renderersHook = { installed: true, moduleId: hit.id };
  return () => {
    if (renderers.codeBlock === wrapped) renderers.codeBlock = original;
    state.status.renderersHook = { installed: false, moduleId: hit.id };
  };
}

/** Paseo's own diagram component, for the settings preview. Null if the bundle changed. */
export function getHostMermaidFence(win?: MetroWindow | null): ComponentType<{ code: string }> | null {
  const fence = requireMetroExport("MermaidFence", win)?.exports.MermaidFence;
  return typeof fence === "function" ? (fence as ComponentType<{ code: string }>) : null;
}

/**
 * Paseo hides a diagram that fails to parse and shows its source with no reason. The runtime
 * posts `renderError` to this window from the diagram's iframe; once the failure has held for a
 * moment (a streaming diagram fails on every partial line), caption the visible source.
 */
function installRenderErrorCaptions(doc: Document): () => void {
  const timers = new Set<ReturnType<typeof setTimeout>>();
  const onMessage = (event: MessageEvent) => {
    const data = event.data as { type?: unknown; revision?: unknown } | null;
    if (!data || data.type !== "renderError" || typeof data.revision !== "number") return;
    const iframes = doc.querySelectorAll<HTMLIFrameElement>("iframe");
    let iframe: HTMLIFrameElement | null = null;
    for (let i = 0; i < iframes.length; i += 1) {
      const f = iframes[i];
      if (f && f.contentWindow === event.source) {
        iframe = f;
        break;
      }
    }
    if (!iframe) return;
    const timer = setTimeout(() => {
      timers.delete(timer);
      captionRenderError(doc, iframe);
    }, RENDER_ERROR_SETTLE_MS);
    timers.add(timer);
  };
  doc.defaultView?.addEventListener("message", onMessage);
  return () => {
    doc.defaultView?.removeEventListener("message", onMessage);
    for (const timer of timers) clearTimeout(timer);
  };
}

function captionRenderError(doc: Document, iframe: HTMLIFrameElement): void {
  if (!iframe.isConnected) return;
  // Paseo 0.15.3 mounts the visible source block next to the hidden viewport, in one parent.
  const viewport = iframe.closest('[data-testid="mermaid-viewport"]');
  const source = Array.from(viewport?.parentElement?.children ?? []).find(
    (child) => child !== viewport && child.textContent?.trim(),
  ) as HTMLElement | undefined;
  if (!source || !source.textContent?.trim()) return;
  const code = source.textContent;
  recordMermaidEvent("render-error", "", code);
  if (!state.prefs.explainBlocked || source.querySelector(`[${CAPTION_ATTR}]`)) return;
  const caption = doc.createElement("div");
  caption.setAttribute(CAPTION_ATTR, "render-error");
  caption.setAttribute("data-testid", "mermaid-render-error-reason");
  Object.assign(caption.style, {
    marginTop: "4px",
    fontSize: "12px",
    lineHeight: "16px",
    color: CAPTION_STYLE.color,
  });
  caption.textContent = describeMermaidBlock("render-error", null, state.getLocale());
  source.appendChild(caption);
}

export function installMermaidEnhancer(options: { getLocale?: () => string } = {}): () => void {
  if (typeof window === "undefined" || typeof document === "undefined") return () => undefined;
  if (options.getLocale) state.getLocale = options.getLocale;
  state.prefs = loadMermaidPrefs();
  const win = window as unknown as MetroWindow;
  const cleanups = [
    installPolicyHook(win),
    installRenderersHook(win),
    installRenderErrorCaptions(document),
  ];
  state.status.hostFenceAvailable = getHostMermaidFence(win) !== null;
  (globalThis as Record<string, unknown>).__paseoFinderMermaid = {
    status: getMermaidStatus,
    explain: explainMermaidSource,
    isNativeUnsafe: (code: string) => PASEO_NATIVE_UNSAFE_MERMAID_SOURCE.test(code),
  };
  emitStatus();
  return () => {
    for (const cleanup of cleanups) cleanup();
    delete (globalThis as Record<string, unknown>).__paseoFinderMermaid;
    emitStatus();
  };
}
