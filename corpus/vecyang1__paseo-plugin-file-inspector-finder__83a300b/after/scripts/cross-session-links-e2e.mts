/**
 * End-to-end check that cross-session references in a message open the other session, in the
 * real Paseo web app, against the plugin the daemon has loaded right now:
 *   - a commit hash another session made becomes a commit pill (client/commit-origin-web.ts);
 *   - a session id written as plain text is highlighted and clickable (client/session-ref-text-web.ts).
 * Run it after `paseo plugin reload file-inspector-finder` and after every Paseo update (both read
 * Paseo's message DOM, which is what breaks first):
 *
 *   node --experimental-strip-types --no-warnings --import ./test/register-ts.mjs \
 *     scripts/cross-session-links-e2e.mts --agent <agentId> --sha <hash made by another session> \
 *     [--expect <origin agent id prefix>] [--own <hash made by --agent itself>] \
 *     [--text-ref <session id written as plain text in --agent>] [--server srv_x] [--port 6798] [--shots <dir>]
 *
 * Read-only: opens the session, checks the pill and the own-commit hash, clicks the pill and
 * checks it lands on the origin; with --text-ref, goes back and clicks the plain-text id.
 * Screenshots show this machine's real host page, so they go to a temp dir, never the repo.
 * Exit 0 = every check passed, 1 = a check failed, 3 = setup missing (see paseo-harness.mts).
 */
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ensureHarness, resolveHarnessSetup, sleep } from "./paseo-harness.mts";

const args = process.argv.slice(2);
const argValue = (flag: string) => (args.includes(flag) ? args[args.indexOf(flag) + 1] : undefined);
const PORT = Number(argValue("--port") || 6798) || 6798;
const AGENT = argValue("--agent");
const SHA = argValue("--sha")?.toLowerCase();
const EXPECT = argValue("--expect")?.toLowerCase();
const OWN = argValue("--own")?.toLowerCase();
const TEXT_REF = argValue("--text-ref")?.toLowerCase();
const SERVER = argValue("--server");
const SHOTS = argValue("--shots") ?? path.join(os.tmpdir(), "paseo-cross-session-links-e2e");

type Page = any;
const results: Array<{ name: string; ok: boolean }> = [];
function check(name: string, ok: unknown, detail = ""): void {
  results.push({ name, ok: Boolean(ok) });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  -- ${detail}` : ""}`);
}

async function run(page: Page, shots: string): Promise<void> {
  await page.goto(`http://localhost:${PORT}/`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-testid="sidebar-footer"]', { timeout: 60_000 });
  let server = SERVER;
  if (!server) {
    await page.locator('[data-testid="sidebar-project-workspace-list-scroll"] [role="button"]').nth(1).click().catch(() => {});
    await sleep(1500);
    server = (page.url().match(/\/h\/(srv_[A-Za-z0-9]+)/) ?? [])[1];
  }
  check("server id resolved", server, server ? "" : "pass --server");
  if (!server || !AGENT || !SHA) return;
  await page.goto(`http://localhost:${PORT}/h/${server}/agent/${AGENT}`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-testid="assistant-message"]', { timeout: 60_000 });

  // 1. The other session's hash becomes a pill (first lookup scans repositories: allow 60 s).
  const pillSel = `[data-testid="paseo-finder-inline-commit-pill-${SHA.slice(0, 7)}"]`;
  const appeared = await page.waitForSelector(pillSel, { timeout: 60_000 }).then(() => true, () => false);
  check(`hash ${SHA.slice(0, 7)} became a commit pill`, appeared);
  if (!appeared) {
    await page.screenshot({ path: path.join(shots, "0-no-pill.png") });
    return;
  }
  const pill = await page.evaluate((sel: string) => {
    const el = document.querySelector(sel) as HTMLElement;
    el.scrollIntoView({ block: "center" });
    const after = getComputedStyle(el, "::after").content;
    return {
      origin: el.getAttribute("data-vec-commit-pill") ?? "",
      text: el.textContent ?? "",
      after,
      title: el.title,
      cursor: getComputedStyle(el).cursor,
      display: getComputedStyle(el).display,
    };
  }, pillSel);
  console.log(`pill: origin=${pill.origin.slice(0, 8)} after=${pill.after} display=${pill.display}`);
  check("pill names an origin session", /^[0-9a-f-]{36}$/.test(pill.origin));
  if (EXPECT) check(`origin is ${EXPECT}`, pill.origin.startsWith(EXPECT), pill.origin.slice(0, 8));
  check("hash text untouched (copy still copies the hash)", pill.text.trim() === SHA.slice(0, pill.text.trim().length));
  check("pill shows the origin title after the hash", pill.after.length > 4 && pill.after !== "none");
  check("pill hover explains commit, session and evidence", /#[0-9a-f]{7}/.test(pill.title) && pill.title.split("\n").length >= 3);
  check("pill looks clickable", pill.cursor === "pointer" && pill.display.includes("flex"));
  await sleep(300);
  await page.screenshot({ path: path.join(shots, "1-pill.png") });

  // 2. A hash this session made itself gets hover text, no pill.
  if (OWN) {
    const own = await page.evaluate((sha: string) => {
      const el = Array.from(document.querySelectorAll("code")).find((c) => (c.textContent ?? "").trim() === sha);
      return el ? { pill: el.hasAttribute("data-vec-commit-pill"), title: (el as HTMLElement).title } : null;
    }, OWN.slice(0, 7));
    check(`own hash ${OWN.slice(0, 7)} present`, own);
    check("own hash is not a pill", own && !own.pill);
    check("own hash hover says this session made it", own && /this session|本会话/.test(own.title), own?.title.split("\n").pop());
  }

  // 3. Clicking the pill opens the origin session.
  const before = page.url();
  await page.click(pillSel);
  const target = pill.origin;
  const landed = await page
    .waitForFunction(
      (id: string) =>
        location.pathname.includes(id) ||
        Boolean(document.querySelector(`[data-testid="workspace-tab-agent_${id}"][aria-selected="true"]`)),
      target,
      { timeout: 15_000 },
    )
    .then(() => true, () => false);
  await sleep(1200);
  check("click opens the origin session", landed, `${before.replace(/srv_[A-Za-z0-9]+/, "<srv>")} -> ${page.url().replace(/srv_[A-Za-z0-9]+/, "<srv>")}`);

  // 4. In the origin session the same hash is its own commit: hover text, no pill. The message
  // DOM can render before the route switches, so this checks the pill is undone, not just absent.
  const settled = await page
    .waitForFunction(
      (sha: string) => {
        const codes = Array.from(document.querySelectorAll("code")).filter((c) => (c.textContent ?? "").trim() === sha);
        return codes.length > 0 && codes.every((c) => !c.hasAttribute("data-vec-commit-pill") && /this session|本会话/.test((c as HTMLElement).title));
      },
      SHA.slice(0, 7),
      { timeout: 15_000 },
    )
    .then(() => true, () => false);
  check("in the origin session the hash is its own commit (no pill)", settled);
  await page.screenshot({ path: path.join(shots, "2-after-click.png") });

  if (TEXT_REF) await checkPlainTextRef(page, shots, server);
}

/** A session id written as plain text: highlighted (no DOM change) and clickable. */
async function checkPlainTextRef(page: Page, shots: string, server: string): Promise<void> {
  const ref = TEXT_REF!;
  await page.goto(`http://localhost:${PORT}/h/${server}/agent/${AGENT}`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-testid="assistant-message"]', { timeout: 60_000 });
  const found = await page
    .waitForFunction(
      (id: string) => {
        const hl = (CSS as unknown as { highlights?: Map<string, Set<Range>> }).highlights?.get("paseo-finder-session-ref");
        return hl ? Array.from(hl).some((r) => r.toString().toLowerCase() === id) : false;
      },
      ref,
      { timeout: 20_000 },
    )
    .then(() => true, () => false);
  check(`plain-text id ${ref} is highlighted`, found);
  if (!found) return;
  // Paseo scrolls the timeline to the bottom after history loads, which can land after any
  // scrollIntoView. Re-locate the id before every pointer action and require it to be the topmost
  // thing at that point, so a click never lands on whatever scrolled into its old place.
  const locate = async () => {
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const at = await page.evaluate((id: string) => {
        const hl = (CSS as unknown as { highlights: Map<string, Set<Range>> }).highlights.get("paseo-finder-session-ref");
        const range = hl ? Array.from(hl).find((r) => r.toString().toLowerCase() === id) : undefined;
        if (!range) return null;
        const host = range.startContainer.parentElement!;
        host.scrollIntoView({ block: "center" });
        const rect = range.getBoundingClientRect();
        const x = rect.left + rect.width / 2;
        const y = rect.top + rect.height / 2;
        const top = document.elementFromPoint(x, y);
        return { x, y, inCode: Boolean(host.closest("code")), onTop: top === host || Boolean(top && host.contains(top)) };
      }, ref);
      if (at?.onTop) {
        await new Promise((r) => setTimeout(r, 250));
        const still = await page.evaluate(({ x, y }: { x: number; y: number }) => document.elementFromPoint(x, y)?.tagName ?? "", at);
        if (still) return at;
      }
      await new Promise((r) => setTimeout(r, 500));
    }
    return null;
  };
  const point = await locate();
  check("plain-text id can be brought on screen", point);
  if (!point) return;
  check("plain-text id is not inside a code span (prose, as Claude writes it)", !point.inCode);
  // Scrolling hides the hover card by design, and locate() scrolls; settle, then hover.
  let tip = false;
  for (let attempt = 0; attempt < 4 && !tip; attempt += 1) {
    const at = (await locate()) ?? point;
    await new Promise((r) => setTimeout(r, 400));
    await page.mouse.move(at.x - 1, at.y);
    await page.mouse.move(at.x, at.y);
    tip = await page
      .waitForSelector('[data-testid="paseo-finder-session-ref-tooltip"]', { timeout: 1500 })
      .then(() => true, () => false);
  }
  check("hover shows where the id leads", tip);
  await page.screenshot({ path: path.join(shots, "3-text-ref-hover.png") });
  const unchanged = await page.evaluate((id: string) => {
    const hl = (CSS as unknown as { highlights: Map<string, Set<Range>> }).highlights.get("paseo-finder-session-ref")!;
    const range = Array.from(hl).find((r) => r.toString().toLowerCase() === id)!;
    return range.startContainer.nodeType === Node.TEXT_NODE && !range.startContainer.parentElement?.hasAttribute("data-vec-session-pill");
  }, ref);
  check("message text node left as React rendered it", unchanged);

  // Something drawn above the id (menu, popover, sticky bar) keeps its own click.
  const urlBefore = page.url();
  const overAt = (await locate()) ?? point;
  await page.evaluate(({ x, y }: { x: number; y: number }) => {
    const overlay = document.createElement("div");
    overlay.id = "e2e-overlay";
    Object.assign(overlay.style, { position: "fixed", left: `${x - 30}px`, top: `${y - 12}px`, width: "60px", height: "24px", zIndex: "2147483647" });
    overlay.addEventListener("click", () => ((window as unknown as { __e2eOverlayHit?: boolean }).__e2eOverlayHit = true));
    document.body.appendChild(overlay);
  }, overAt);
  await page.mouse.click(overAt.x, overAt.y);
  await new Promise((r) => setTimeout(r, 600));
  const overlayHit = await page.evaluate(() => {
    document.getElementById("e2e-overlay")?.remove();
    return (window as unknown as { __e2eOverlayHit?: boolean }).__e2eOverlayHit === true;
  });
  check("an overlay above the id keeps its own click", overlayHit && page.url() === urlBefore);

  // Two clicks on one spot in quick succession are a double-click, which selects the word, and a
  // selection is deliberately not treated as a link click. Let the double-click window pass.
  await new Promise((r) => setTimeout(r, 1200));
  await page.evaluate(() => window.getSelection()?.removeAllRanges());
  const clickAt = await locate();
  check("plain-text id on screen before the click", clickAt);
  if (!clickAt) return;
  await page.mouse.click(clickAt.x, clickAt.y);
  const landed = await page
    .waitForFunction(
      (id: string) => Array.from(document.querySelectorAll('[data-testid^="workspace-tab-agent_"]')).some(
        (t) => t.getAttribute("aria-selected") === "true" && (t.getAttribute("data-testid") ?? "").includes(id),
      ),
      ref,
      { timeout: 15_000 },
    )
    .then(() => true, () => false);
  await new Promise((r) => setTimeout(r, 1000));
  const decision = await page.evaluate(() => document.documentElement.getAttribute("data-paseo-finder-session-ref-last-click"));
  check("clicking the plain-text id opens that session", landed, `${page.url().replace(/srv_[A-Za-z0-9]+/, "<srv>")} · decision=${decision}`);
  await page.screenshot({ path: path.join(shots, "4-text-ref-after-click.png") });
}

const setup = resolveHarnessSetup();
if (!setup) process.exit(3);
if (!AGENT || !SHA) {
  console.error("pass --agent <agentId> --sha <hash made by another session>");
  process.exit(3);
}
fs.mkdirSync(SHOTS, { recursive: true });
const harness = await ensureHarness(PORT);
const { chromium } = createRequire(import.meta.url)(setup.playwrightCore);
const browser = await chromium.launch({ executablePath: setup.chrome, headless: true });
try {
  await run(await browser.newPage({ viewport: { width: 1440, height: 900 } }), SHOTS);
} catch (error) {
  check("run without exception", false, String(error).slice(0, 300));
} finally {
  await browser.close();
  harness?.kill();
}
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} passed · screenshots: ${SHOTS}`);
process.exit(failed ? 1 : 0);
