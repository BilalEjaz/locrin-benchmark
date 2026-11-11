// Plain-text session ids in messages ("5e55a0d had the same prompt") become clickable, the way a
// session id in backticks becomes a session pill (client/session-lineage-web.ts). Claude tends to
// write ids in prose, Gemini in backticks, so without this a Claude session's cross-session
// mentions could not be clicked.
//
// Zero DOM mutation: React owns the message text, and replacing its text nodes makes a later
// re-render (collapse, edit, stream) throw in removeChild. So the ids are marked with the CSS
// Custom Highlight API and clicks are hit-tested against the highlighted ranges' rectangles.
// Resolution and navigation stay with session-lineage-web.ts (one owner for "which session is
// this id").
import { isChineseLocale } from "./i18n";
import {
  cleanSessionDisplayTitle,
  extractCurrentWorkspaceAndAgent,
  navigateToLineageNode,
  resolveSessionReference,
} from "./session-lineage-web";
import { syncPaseoThemeCssVariables } from "./theme-web";

type LineageNode = NonNullable<ReturnType<typeof resolveSessionReference>>;

export const SESSION_REF_HIGHLIGHT = "paseo-finder-session-ref";
const STYLE_ID = "paseo-finder-session-ref-style";
const TOOLTIP_ID = "paseo-finder-session-ref-tooltip";
const HOVER_ATTR = "data-paseo-finder-session-ref-hover";
/** Last click decision, readable in devtools and by the e2e: hit:<id> or miss:<reason>. */
const LAST_CLICK_ATTR = "data-paseo-finder-session-ref-last-click";
const MESSAGE_SELECTOR = '[data-testid="assistant-message"], [data-testid="user-message"]';
const SKIP_ANCESTORS =
  'code, pre, a, button, [role="button"], textarea, input, [contenteditable="true"], [data-testid="paseo-finder-session-lineage-bar"], [data-testid="message-input-root"]';
/** The session directory fills in without touching the DOM: re-walk everything this often. */
const FULL_REFRESH_MS = 15_000;

const STYLE_TEXT = `
::highlight(${SESSION_REF_HIGHLIGHT}) {
  color: var(--paseo-finder-accent);
  text-decoration: underline dotted;
  text-decoration-color: var(--paseo-finder-accent);
  text-underline-offset: 3px;
}
html[${HOVER_ATTR}] ${MESSAGE_SELECTOR.split(", ").join(`, html[${HOVER_ATTR}] `)} {
  cursor: pointer !important;
}
#${TOOLTIP_ID} {
  position: fixed;
  z-index: 2147483000;
  pointer-events: none;
  max-width: 360px;
  padding: 4px 8px;
  border-radius: 6px;
  border: 1px solid var(--paseo-finder-border);
  background: var(--paseo-finder-surface-2);
  color: var(--paseo-finder-fg);
  font: 12px/1.4 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.18);
}
`;

const TOKEN_RE =
  /(?<![0-9A-Za-z_-])(wks_[0-9a-zA-Z_-]{4,}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[0-9a-f]{7,8})(?![0-9A-Za-z_-])/gi;

export interface SessionRefMatch {
  start: number;
  end: number;
  token: string;
  target: LineageNode;
}

/** Session ids in one run of text that resolve to a known session other than `currentId`. */
export function findSessionRefMatches(
  text: string,
  currentId: string | null,
  resolve: (token: string, currentId: string | null) => LineageNode | null = resolveSessionReference,
): SessionRefMatch[] {
  const out: SessionRefMatch[] = [];
  if (text.length < 7) return out;
  TOKEN_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = TOKEN_RE.exec(text)) !== null) {
    const token = m[1];
    const target = resolve(token, currentId);
    if (target) out.push({ start: m.index, end: m.index + token.length, token, target });
  }
  return out;
}

export interface RectLike {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

/** Index of the first entry whose rectangles contain the point, or -1. */
export function hitTestRects(entries: Array<{ rects: RectLike[] }>, x: number, y: number): number {
  return entries.findIndex(({ rects }) =>
    rects.some((r) => x >= r.left && x <= r.right && y >= r.top && y <= r.bottom),
  );
}

export function describeSessionRef(target: LineageNode, zh: boolean): string {
  const short = target.agentId.slice(0, 7);
  const title = cleanSessionDisplayTitle(target.agentTitle || target.workspaceTitle) || short;
  const status =
    target.status === "running"
      ? zh ? "运行中" : "Running"
      : target.status === "archived"
        ? zh ? "已归档" : "Archived"
        : target.status === "failed" || target.status === "error"
          ? zh ? "失败" : "Failed"
          : zh ? "已完成" : "Done";
  const project = target.projectName ? ` · ${target.projectName}` : "";
  return zh
    ? `点击跳转至会话：${title}（#${short}）${project} · ${status}`
    : `Click to open session: ${title} (#${short})${project} · ${status}`;
}

interface LiveRef {
  range: Range;
  target: LineageNode;
  root: Element;
}

/**
 * Cheap identity of a message's text for the per-message cache. Equal-length edits in the middle
 * can slip past it; the periodic full refresh (epoch) catches those.
 */
function messageTextSignature(text: string): string {
  return `${text.length}:${text.slice(0, 40)}:${text.slice(-40)}`;
}

export function installSessionRefText(options: { getLocale?: () => string | null | undefined } = {}): () => void {
  if (typeof window === "undefined" || typeof document === "undefined" || !document.body) return () => {};
  const doc = document;
  const win = window;
  const highlights = (win as unknown as { CSS?: { highlights?: Map<string, unknown> } }).CSS?.highlights;
  const HighlightCtor = (win as unknown as { Highlight?: new (...ranges: Range[]) => unknown }).Highlight;
  if (!highlights || typeof HighlightCtor !== "function") return () => {};

  if (!doc.getElementById(STYLE_ID)) {
    const style = doc.createElement("style");
    style.id = STYLE_ID;
    style.textContent = STYLE_TEXT;
    doc.head.appendChild(style);
  }

  let refs: LiveRef[] = [];
  let signature = "";
  let epoch = 0;
  let scanTimer: ReturnType<typeof setTimeout> | null = null;
  let moveFrame = 0;
  let hovered: LiveRef | null = null;
  const rootCache = new WeakMap<Element, { sig: string; refs: LiveRef[] }>();
  const zh = () => isChineseLocale(options.getLocale?.() ?? win.navigator?.language);

  const scanRoot = (root: Element, currentId: string | null): LiveRef[] => {
    const found: LiveRef[] = [];
    const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const parent = node.parentElement;
      if (!parent || parent.closest(SKIP_ANCESTORS)) continue;
      for (const match of findSessionRefMatches(node.nodeValue ?? "", currentId)) {
        const range = doc.createRange();
        range.setStart(node, match.start);
        range.setEnd(node, match.end);
        found.push({ range, target: match.target, root });
      }
    }
    return found;
  };

  // Only messages whose text changed are walked again; a streaming reply re-walks one message,
  // not the whole timeline. Hidden (cached) session panels are skipped until shown.
  const scan = () => {
    scanTimer = null;
    const currentId = extractCurrentWorkspaceAndAgent(doc, win).agentId;
    const next: LiveRef[] = [];
    const sigs: string[] = [];
    for (const root of Array.from(doc.querySelectorAll(MESSAGE_SELECTOR))) {
      if (!root.getClientRects().length) continue;
      const sig = `${epoch}:${currentId}:${messageTextSignature(root.textContent ?? "")}`;
      let entry = rootCache.get(root);
      if (!entry || entry.sig !== sig) {
        entry = { sig, refs: scanRoot(root, currentId) };
        rootCache.set(root, entry);
      }
      next.push(...entry.refs);
      if (entry.refs.length) sigs.push(`${sig}#${entry.refs.length}`);
    }
    refs = next;
    const sig = sigs.join("|");
    if (sig === signature) return;
    signature = sig;
    syncPaseoThemeCssVariables(doc as never, win as never);
    if (next.length) highlights.set(SESSION_REF_HIGHLIGHT, new HighlightCtor(...next.map((r) => r.range)));
    else highlights.delete(SESSION_REF_HIGHLIGHT);
  };
  const schedule = () => {
    if (!scanTimer) scanTimer = setTimeout(scan, 300);
  };

  // Hit-test only where the id is actually what the pointer is on: the topmost element at the
  // point must be inside the same message and be (or hold) the id's text. An overlay, a sticky
  // header or a menu above the message therefore keeps its own clicks.
  let lastMiss = "";
  const refAt = (x: number, y: number): LiveRef | null => {
    lastMiss = "no-refs";
    if (!refs.length) return null;
    const top = doc.elementFromPoint(x, y);
    const root = top?.closest(MESSAGE_SELECTOR);
    lastMiss = `not-a-message:${top?.tagName.toLowerCase() ?? "none"}`;
    if (!top || !root) return null;
    lastMiss = "no-id-at-point";
    const candidates = refs.filter((r) => {
      if (r.root !== root || !r.range.startContainer.isConnected) return false;
      const parent = r.range.startContainer.parentElement;
      return Boolean(parent && (parent === top || parent.contains(top) || top.contains(parent)));
    });
    const index = hitTestRects(
      candidates.map((r) => ({ rects: Array.from(r.range.getClientRects()) })),
      x,
      y,
    );
    return index >= 0 ? candidates[index] : null;
  };

  const tooltip = (): HTMLElement => {
    let el = doc.getElementById(TOOLTIP_ID);
    if (!el) {
      el = doc.createElement("div");
      el.id = TOOLTIP_ID;
      el.setAttribute("role", "tooltip");
      el.setAttribute("data-testid", "paseo-finder-session-ref-tooltip");
      doc.body.appendChild(el);
    }
    return el;
  };
  const clearHover = () => {
    hovered = null;
    doc.documentElement.removeAttribute(HOVER_ATTR);
    doc.getElementById(TOOLTIP_ID)?.remove();
  };

  const onPointerMove = (ev: PointerEvent) => {
    if (moveFrame) return;
    const { clientX, clientY } = ev;
    moveFrame = win.requestAnimationFrame(() => {
      moveFrame = 0;
      const hit = refAt(clientX, clientY);
      if (!hit) {
        if (hovered) clearHover();
        return;
      }
      hovered = hit;
      doc.documentElement.setAttribute(HOVER_ATTR, hit.target.agentId);
      const tip = tooltip();
      tip.textContent = describeSessionRef(hit.target, zh());
      const rect = hit.range.getBoundingClientRect();
      tip.style.left = `${Math.max(8, Math.min(rect.left, win.innerWidth - 368))}px`;
      tip.style.top = `${rect.bottom + 6}px`;
    });
  };

  const onClick = (ev: MouseEvent) => {
    if (ev.button !== 0 || ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.altKey) return;
    const sel = win.getSelection?.();
    const insideMessage = Boolean((ev.target as Element | null)?.closest?.(MESSAGE_SELECTOR));
    if (sel && !sel.isCollapsed) {
      // the user is selecting text, not following a link
      if (insideMessage) doc.documentElement.setAttribute(LAST_CLICK_ATTR, "miss:selection");
      return;
    }
    const hit = refAt(ev.clientX, ev.clientY);
    if (!hit) {
      if (insideMessage) doc.documentElement.setAttribute(LAST_CLICK_ATTR, `miss:${lastMiss}`);
      return;
    }
    doc.documentElement.setAttribute(LAST_CLICK_ATTR, `hit:${hit.target.agentId.slice(0, 8)}`);
    ev.preventDefault();
    ev.stopPropagation();
    clearHover();
    navigateToLineageNode(hit.target, doc, win);
  };

  const observer = new MutationObserver(schedule);
  observer.observe(doc.body, {
    childList: true,
    subtree: true,
    characterData: true,
    attributes: true,
    attributeFilter: ["aria-selected"],
  });
  const interval = setInterval(() => {
    if (doc.visibilityState === "hidden") return;
    epoch += 1;
    scan();
  }, FULL_REFRESH_MS);
  doc.addEventListener("pointermove", onPointerMove, { passive: true });
  doc.addEventListener("click", onClick, true);
  win.addEventListener("scroll", clearHover, true);
  schedule();

  return () => {
    observer.disconnect();
    clearInterval(interval);
    if (scanTimer) clearTimeout(scanTimer);
    if (moveFrame) win.cancelAnimationFrame(moveFrame);
    doc.removeEventListener("pointermove", onPointerMove);
    doc.removeEventListener("click", onClick, true);
    win.removeEventListener("scroll", clearHover, true);
    highlights.delete(SESSION_REF_HIGHLIGHT);
    clearHover();
  };
}
