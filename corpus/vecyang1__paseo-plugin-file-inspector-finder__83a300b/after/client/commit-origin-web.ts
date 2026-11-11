// Commit pills: a commit hash in a message (`714efcf`) that another session made becomes a
// clickable pill that opens that session, the same way a session id becomes a session pill
// (client/session-lineage-web.ts). Works for every provider: the hash is resolved from git and
// the transcripts on disk (server/commit-origin.ts), not from how the agent phrased the message.
//
// React owns the message DOM, so the pill never touches the code element's children: it adds
// attributes, a stylesheet with ::before / ::after, and listeners. Copying the message still
// copies the bare hash.
import type { RpcInput, RpcOutput } from "@getpaseo/plugin";
import {
  COMMIT_SHA_TOKEN_RE,
  type CommitOriginResult,
  type CommitOriginSession,
  resolveCommitOriginRpc,
} from "../shared/commit-origin-contracts";
import { isChineseLocale } from "./i18n";
import {
  cleanSessionDisplayTitle,
  extractCurrentWorkspaceAndAgent,
  navigateToLineageNode,
  resolveSessionReference,
} from "./session-lineage-web";
import { syncPaseoThemeCssVariables } from "./theme-web";

export interface CommitOriginWebClient {
  call(
    def: typeof resolveCommitOriginRpc,
    input: RpcInput<typeof resolveCommitOriginRpc>,
  ): Promise<RpcOutput<typeof resolveCommitOriginRpc>>;
  getLocale?: () => string | null | undefined;
}

export const COMMIT_PILL_ATTR = "data-vec-commit-pill";
const CHECKED_ATTR = "data-vec-commit-checked";
/** Which install owns an element's listeners; a plugin reload hands elements to the new install. */
const BOUND_ATTR = "data-vec-commit-bound";
const META_ATTR = "data-vec-commit-meta";
const STYLE_ID = "paseo-finder-commit-pill-style";
const MESSAGE_SELECTOR = '[data-testid="assistant-message"], [data-testid="user-message"]';
const SKIP_SELECTOR =
  'pre, [data-testid="agent-composer"], [data-testid="message-input-root"], [data-testid="paseo-finder-session-lineage-bar"]';
const BATCH_MAX = 40;
const LOOKUP_DEBOUNCE_MS = 350;
const FAILED_RETRY_MS = 60_000;
/** "No Paseo session made it" may only be true for now (transcript not flushed, repo not yet seen). */
const NON_ATTRIBUTED_TTL_MS = 5 * 60_000;

const STYLE_TEXT = `
code[${COMMIT_PILL_ATTR}] {
  display: inline-flex !important;
  align-items: center;
  gap: 5px;
  padding: 1px 7px !important;
  margin: 0 2px;
  border-radius: 5px !important;
  border: 1px solid var(--paseo-finder-border) !important;
  background-color: var(--paseo-finder-surface-1) !important;
  color: var(--paseo-finder-fg) !important;
  font-weight: 600;
  line-height: 1.4;
  vertical-align: baseline;
  cursor: pointer;
}
code[${COMMIT_PILL_ATTR}]::before {
  content: "";
  width: 5px;
  height: 5px;
  border-radius: 999px;
  flex-shrink: 0;
  background-color: var(--vec-commit-dot, var(--paseo-finder-fg-muted));
}
code[${COMMIT_PILL_ATTR}]::after {
  content: attr(${META_ATTR});
  font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  font-size: 0.88em;
  font-weight: 400;
  color: var(--paseo-finder-fg-muted);
}
code[${COMMIT_PILL_ATTR}]:hover {
  border-color: var(--paseo-finder-border-accent) !important;
  background-color: var(--paseo-finder-surface-2) !important;
}
code[${COMMIT_PILL_ATTR}]:focus-visible {
  outline: 2px solid var(--paseo-finder-accent);
  outline-offset: 1px;
}
`;

// ---------------------------------------------------------------------------
// Pure helpers (tested in test/commit-origin.test.ts)

export function commitTokenOf(text: string | null | undefined): string | null {
  const token = (text ?? "").trim().toLowerCase();
  return COMMIT_SHA_TOKEN_RE.test(token) ? token : null;
}

export interface CommitPillView {
  /** Text after the hash inside the pill (rendered by ::after). */
  meta: string;
  title: string;
  dot: "running" | "failed" | "done";
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

function statusWord(status: string, zh: boolean): string {
  if (status === "running") return zh ? "运行中" : "running";
  if (status === "archived") return zh ? "已归档" : "archived";
  if (status === "failed" || status === "error") return zh ? "失败" : "failed";
  return zh ? "已完成" : "done";
}

function lagPhrase(lagSeconds: number | null, zh: boolean): string {
  if (lagSeconds === null) return "";
  const s = Math.abs(lagSeconds);
  if (zh) return lagSeconds < 0 ? `提交前 ${s} 秒（命令步骤先开始）` : `提交后 ${s} 秒`;
  return lagSeconds < 0 ? `${s}s before the commit time (its step started first)` : `${s}s after the commit time`;
}

/** What a commit pill shows for a resolved origin session. */
export function describeCommitPill(
  result: CommitOriginResult,
  origin: Pick<CommitOriginSession, "agentId" | "agentTitle" | "workspaceTitle" | "status" | "projectName">,
  zh: boolean,
): CommitPillView {
  const short = (result.fullSha ?? result.sha).slice(0, 7);
  const sessionShort = origin.agentId.slice(0, 7);
  const title = cleanSessionDisplayTitle(origin.agentTitle || origin.workspaceTitle) || sessionShort;
  const subject = result.subject ? truncate(result.subject, 90) : "";
  const repo = result.repoName ?? "";
  const lag = lagPhrase(result.lagSeconds, zh);
  const lines = zh
    ? [
        `提交 ${short}${subject ? ` · ${subject}` : ""}${repo ? ` · ${repo}` : ""}`,
        `由会话 #${sessionShort}「${truncate(title, 60)}」提交（${statusWord(origin.status, zh)}${origin.projectName ? ` · ${origin.projectName}` : ""}）`,
        `依据：该会话${lag}首次提到它；提交时在线的 ${result.candidatesChecked} 个会话里有 ${result.mentioningSessions} 个在时间窗内提到，取最早的`,
        "点击跳转到该会话",
      ]
    : [
        `Commit ${short}${subject ? ` · ${subject}` : ""}${repo ? ` · ${repo}` : ""}`,
        `Made by session #${sessionShort} "${truncate(title, 60)}" (${statusWord(origin.status, zh)}${origin.projectName ? ` · ${origin.projectName}` : ""})`,
        `Evidence: that session first mentions it ${lag}; ${result.mentioningSessions} of ${result.candidatesChecked} sessions active then mention it in the window, earliest wins`,
        "Click to open that session",
      ];
  const dot = origin.status === "running" ? "running" : origin.status === "failed" || origin.status === "error" ? "failed" : "done";
  return {
    meta: `· ${zh ? "来自 " : "from "}${truncate(title, 22)} ↗`,
    title: lines.join("\n"),
    dot,
  };
}

/** Hover text for a commit that gets no pill: made in this session, or by no Paseo session. */
export function describeCommitHover(result: CommitOriginResult, isSelf: boolean, zh: boolean): string | null {
  if (result.status !== "attributed" && result.status !== "unattributed") return null;
  const short = (result.fullSha ?? result.sha).slice(0, 7);
  const head = `${zh ? "提交" : "Commit"} ${short}${result.subject ? ` · ${truncate(result.subject, 90)}` : ""}${result.repoName ? ` · ${result.repoName}` : ""}`;
  if (isSelf) return `${head}\n${zh ? "由本会话提交" : "Made in this session"}`;
  if (result.status === "unattributed") {
    return `${head}\n${zh ? "没有找到提交它的 Paseo 会话（可能是手动或在 Paseo 之外提交）" : "No Paseo session made it (committed by hand or outside Paseo)"}`;
  }
  return null;
}

// ---------------------------------------------------------------------------
// DOM

type LookupState =
  | { kind: "pending" }
  | { kind: "failed"; at: number }
  | { kind: "done"; result: CommitOriginResult; at: number };

type PillTarget = Pick<CommitOriginSession, "agentId" | "workspaceId" | "projectId" | "projectName">;

export interface CommitOriginEnhancerState {
  cache: Map<string, LookupState>;
  queued: Set<string>;
  instanceId: string;
  /** Click targets by origin agent id, read when the click happens. */
  targets: Map<string, PillTarget>;
}

export function createCommitOriginState(): CommitOriginEnhancerState {
  return {
    cache: new Map(),
    queued: new Set(),
    instanceId: `cop-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    targets: new Map(),
  };
}

function needsLookup(entry: LookupState | undefined, now: number): boolean {
  if (!entry) return true;
  if (entry.kind === "failed") return now - entry.at > FAILED_RETRY_MS;
  if (entry.kind === "done") return entry.result.status !== "attributed" && now - entry.at > NON_ATTRIBUTED_TTL_MS;
  return false;
}

/** Back to a plain hash: the listeners stay bound but check for the pill attribute first. */
function removePill(code: HTMLElement): void {
  if (!code.hasAttribute(COMMIT_PILL_ATTR)) return;
  code.removeAttribute(COMMIT_PILL_ATTR);
  code.removeAttribute(META_ATTR);
  code.removeAttribute("role");
  code.removeAttribute("tabindex");
  if ((code.getAttribute("data-testid") ?? "").startsWith("paseo-finder-inline-commit-pill-")) {
    code.removeAttribute("data-testid");
  }
  code.style.removeProperty("--vec-commit-dot");
}

function isCandidateCode(el: Element): boolean {
  if (el.closest(SKIP_SELECTOR)) return false;
  if (!el.closest(MESSAGE_SELECTOR)) return false;
  // A session id already became a session pill; leave it to that owner.
  if (el.hasAttribute("data-vec-session-pill")) return false;
  return true;
}

/**
 * Decorates every resolved commit code element and returns the hashes still to look up.
 * Safe to run on every DOM change: decorated elements are skipped by their signature.
 */
export function enhanceCommitOriginPills(
  state: CommitOriginEnhancerState,
  doc: Document,
  win: Window,
  locale?: string | null,
): string[] {
  const zh = isChineseLocale(locale ?? win.navigator?.language);
  const toLookUp = new Set<string>();
  const codes = Array.from(doc.querySelectorAll<HTMLElement>("code"));
  if (!codes.length) return [];
  let tokens: ReturnType<typeof syncPaseoThemeCssVariables> | null = null;
  const currentAgentId = extractCurrentWorkspaceAndAgent(doc, win).agentId;

  const now = Date.now();
  for (const code of codes) {
    // The element's own text, never a cached attribute: React can reuse it for another hash.
    const token = commitTokenOf(code.textContent);
    if (!token || !isCandidateCode(code)) continue;
    const entry = state.cache.get(token);
    if (needsLookup(entry, now)) toLookUp.add(token);
    // An expired answer keeps rendering until the new one arrives.
    if (entry?.kind !== "done") continue;
    const result = entry.result;
    const origin = result.origin;
    const isSelf = Boolean(origin && currentAgentId && origin.agentId === currentAgentId);
    // The current session is part of every signature: the message DOM of the next session can
    // render before the route names it, so a later pass must be able to undo a pill.
    if (!origin || isSelf || result.status !== "attributed") {
      const sig = `hover:${token}:${currentAgentId}:${zh}`;
      if (code.getAttribute(CHECKED_ATTR) === sig) continue;
      code.setAttribute(CHECKED_ATTR, sig);
      removePill(code);
      const hover = describeCommitHover(result, isSelf, zh);
      if (hover) code.title = hover;
      continue;
    }

    // Prefer the live directory node (fresh title and status); the server's node covers
    // sessions the directory does not hold, such as closed ones.
    const live = resolveSessionReference(origin.agentId, null);
    const node = live && live.agentId === origin.agentId ? { ...origin, ...live } : origin;
    const view = describeCommitPill(result, node, zh);
    tokens ??= syncPaseoThemeCssVariables(doc as never, win as never);
    const dotColor =
      view.dot === "running" ? tokens.statusWarning : view.dot === "failed" ? tokens.destructive : tokens.statusSuccess;
    const sig = `${origin.agentId}:${node.status}:${view.meta}:${tokens.name}:${zh}:${currentAgentId}:${state.instanceId}`;
    if (code.getAttribute(CHECKED_ATTR) === sig) continue;

    code.setAttribute(CHECKED_ATTR, sig);
    code.setAttribute(COMMIT_PILL_ATTR, origin.agentId);
    code.setAttribute(META_ATTR, view.meta);
    code.setAttribute("data-testid", `paseo-finder-inline-commit-pill-${token.slice(0, 7)}`);
    code.setAttribute("role", "link");
    code.tabIndex = 0;
    code.title = view.title;
    code.style.setProperty("--vec-commit-dot", dotColor);

    state.targets.set(origin.agentId, node);
    if (code.getAttribute(BOUND_ATTR) !== state.instanceId) {
      code.setAttribute(BOUND_ATTR, state.instanceId);
      const owner = state.instanceId;
      // One listener pair per element and install. It reads the target when clicked, so a pill
      // re-pointed at another session (or undone) never navigates to a stale one.
      const jump = (ev: Event) => {
        if (code.getAttribute(BOUND_ATTR) !== owner) return;
        const agentId = code.getAttribute(COMMIT_PILL_ATTR);
        const target = agentId ? state.targets.get(agentId) : undefined;
        if (!target) return;
        ev.preventDefault();
        ev.stopPropagation();
        navigateToLineageNode(target, doc, win);
      };
      code.addEventListener("click", jump);
      code.addEventListener("keydown", (ke: KeyboardEvent) => {
        if (ke.key === "Enter" || ke.key === " ") jump(ke);
      });
    }
  }
  return Array.from(toLookUp);
}

export function installCommitOriginPills(client: CommitOriginWebClient): () => void {
  if (typeof window === "undefined" || typeof document === "undefined" || !document.body) {
    return () => {};
  }
  const doc = document;
  const win = window;
  const state = createCommitOriginState();
  let scanTimer: ReturnType<typeof setTimeout> | null = null;
  let lookupTimer: ReturnType<typeof setTimeout> | null = null;
  let inFlight = false;
  let disposed = false;

  if (!doc.getElementById(STYLE_ID)) {
    const style = doc.createElement("style");
    style.id = STYLE_ID;
    style.textContent = STYLE_TEXT;
    doc.head.appendChild(style);
  }

  const runLookup = async () => {
    lookupTimer = null;
    if (inFlight || disposed || !state.queued.size) return;
    const batch = Array.from(state.queued).slice(0, BATCH_MAX);
    batch.forEach((t) => {
      state.queued.delete(t);
      state.cache.set(t, { kind: "pending" });
    });
    inFlight = true;
    try {
      const res = await client.call(resolveCommitOriginRpc, { shas: batch, source: "timeline-pill" });
      const byToken = new Map(res.results.map((r) => [r.sha, r]));
      for (const t of batch) {
        const r = byToken.get(t);
        state.cache.set(t, r ? { kind: "done", result: r, at: Date.now() } : { kind: "failed", at: Date.now() });
      }
    } catch {
      batch.forEach((t) => state.cache.set(t, { kind: "failed", at: Date.now() }));
    } finally {
      inFlight = false;
    }
    if (disposed) return;
    scan();
    if (state.queued.size) lookupTimer = setTimeout(runLookup, LOOKUP_DEBOUNCE_MS);
  };

  const scan = () => {
    scanTimer = null;
    if (disposed) return;
    let missing: string[] = [];
    try {
      missing = enhanceCommitOriginPills(state, doc, win, client.getLocale?.());
    } catch {
      return;
    }
    for (const t of missing) {
      if (state.cache.get(t)?.kind !== "pending") state.queued.add(t);
    }
    if (state.queued.size && !lookupTimer) lookupTimer = setTimeout(runLookup, LOOKUP_DEBOUNCE_MS);
  };

  const schedule = () => {
    if (!scanTimer) scanTimer = setTimeout(scan, 250);
  };
  const observer = new MutationObserver(schedule);
  // aria-selected: switching sessions can flip the selected tab without adding nodes. The pill's
  // own attribute writes are not in the filter, so decorating never re-triggers a scan.
  observer.observe(doc.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["aria-selected"] });
  schedule();

  return () => {
    disposed = true;
    observer.disconnect();
    if (scanTimer) clearTimeout(scanTimer);
    if (lookupTimer) clearTimeout(lookupTimer);
    // Hand the elements back plain; a reloaded install decorates and binds them again. The
    // stylesheet stays: it only styles elements carrying the pill attribute.
    for (const el of Array.from(doc.querySelectorAll<HTMLElement>(`[${BOUND_ATTR}="${state.instanceId}"], [${CHECKED_ATTR}]`))) {
      removePill(el);
      el.removeAttribute(BOUND_ATTR);
      el.removeAttribute(CHECKED_ATTR);
      el.removeAttribute("title");
    }
  };
}
