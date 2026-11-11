/**
 * End-to-end check of Mermaid diagrams in the real Paseo web app, against the plugin the daemon
 * has loaded right now. Run after `paseo plugin reload file-inspector-finder` and after every
 * Paseo update (the hooks find `containsUnsafeMermaidSource` and `WEB_RENDERERS` by name):
 *
 *   node --experimental-strip-types --no-warnings --import ./test/register-ts.mjs \
 *     scripts/mermaid-e2e.mts --agent <agentId> [--server srv_x] [--port 6796] [--shots <dir>]
 *
 * --agent is a session whose last assistant message holds the four fixtures from the plugin
 * reference (bold labels, unlabelled fence, `@{}` shape data, a syntax error), in that order.
 * Read-only: it sends nothing. Screenshots show this machine's real host page, so they go to a
 * temp dir, never the repo. Exit 0 = every check passed, 1 = a check failed, 3 = setup missing.
 */
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ensureHarness, resolveHarnessSetup, sleep } from "./paseo-harness.mts";

const args = process.argv.slice(2);
const argValue = (flag: string) => (args.includes(flag) ? args[args.indexOf(flag) + 1] : undefined);
const PORT = Number(argValue("--port") || 6796) || 6796;
const AGENT = argValue("--agent");
const SERVER = argValue("--server");
const SHOTS = argValue("--shots") ?? path.join(os.tmpdir(), "paseo-mermaid-e2e");

type Page = any;
const results: Array<{ name: string; ok: boolean }> = [];
function check(name: string, ok: unknown, detail = ""): void {
  results.push({ name, ok: Boolean(ok) });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  -- ${detail}` : ""}`);
}

/** Per diagram in the last assistant message: is the drawn viewport showing, and what caption. */
async function readDiagrams(page: Page) {
  return page.evaluate(() => {
    const messages = Array.from(document.querySelectorAll('[data-testid="assistant-message"]'));
    const last = messages[messages.length - 1];
    if (!last) return [];
    return Array.from(last.querySelectorAll('[data-testid="mermaid-viewport"]')).map((viewport) => {
      const shown = getComputedStyle(viewport as HTMLElement).opacity !== "0";
      // The source block shares the viewport's parent while the diagram is not drawn.
      const box = Array.from(viewport.parentElement?.children ?? []).find(
        (child) => child !== viewport && (child.textContent ?? "").trim(),
      ) as HTMLElement | undefined;
      const sourceText = shown ? "" : (box?.textContent ?? "").slice(0, 60);
      // The blocked-reason line follows the fence; climb until an ancestor's next sibling is it.
      let blocked = "";
      for (let node: Element | null = viewport, depth = 0; node && depth < 6; node = node.parentElement, depth++) {
        const next = node.nextElementSibling;
        if (next?.getAttribute("data-testid") === "mermaid-blocked-reason") {
          blocked = next.textContent ?? "";
          break;
        }
      }
      const parseError = box?.querySelector('[data-testid="mermaid-render-error-reason"]')?.textContent ?? "";
      return { shown, sourceText, blocked, parseError };
    });
  });
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
  check("server id resolved", server, server ?? "pass --server");
  if (!server || !AGENT) return;

  await page.goto(`http://localhost:${PORT}/h/${server}/agent/${AGENT}`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-testid="assistant-message"]', { timeout: 60_000 });
  await page.waitForFunction(
    () => document.querySelectorAll('[data-testid="mermaid-viewport"]').length >= 4,
    undefined,
    { timeout: 30_000 },
  ).catch(() => {});
  await sleep(4000); // render + the 1.5 s parse-error settle

  const status = await page.evaluate(() => (globalThis as any).__paseoFinderMermaid?.status?.() ?? null);
  check("policy hook installed", status?.policyHook?.installed, JSON.stringify(status?.policyHook));
  check("renderer hook installed", status?.renderersHook?.installed, JSON.stringify(status?.renderersHook));

  const diagrams = await readDiagrams(page);
  check("four diagram fences reached MermaidFence", diagrams.length === 4, `found ${diagrams.length}`);
  const [bold, unlabelled, shape, broken] = diagrams;
  check("bold-label diagram renders", bold?.shown, bold?.sourceText);
  check("unlabelled sequenceDiagram renders", unlabelled?.shown, unlabelled?.sourceText);
  check("@{} diagram stays source", shape && !shape.shown);
  check("@{} diagram names its reason", /@\{…\}/.test(shape?.blocked ?? ""), shape?.blocked);
  check("syntax-error diagram stays source", broken && !broken.shown);
  check("syntax-error diagram says it could not parse", /parse|解析/.test(broken?.parseError ?? ""), broken?.parseError);

  const first = page.locator('[data-testid="mermaid-viewport"]').first();
  await first.scrollIntoViewIfNeeded().catch(() => {});
  await page.screenshot({ path: path.join(shots, "1-chat-diagrams.png") });
  await page.locator('[data-testid="mermaid-blocked-reason"]').first().scrollIntoViewIfNeeded().catch(() => {});
  await page.screenshot({ path: path.join(shots, "2-chat-blocked.png") });

  // Settings: read / test / tune surface.
  await page.goto(
    `http://localhost:${PORT}/settings/hosts/${server}/plugins/file-inspector-finder/finder-settings`,
    { waitUntil: "domcontentloaded" },
  );
  const section = await page
    .waitForSelector('[data-testid="mermaid-settings-status"]', { timeout: 60_000 })
    .then(() => true, () => false);
  check("settings section renders", section);
  if (!section) return;
  await page.locator('[data-testid="mermaid-settings-status"]').scrollIntoViewIfNeeded();
  await page.click('[data-testid="mermaid-settings-check"]');
  await sleep(2500);
  const preview = await page.evaluate(() => {
    const result = document.querySelector('[data-testid="mermaid-settings-result"]');
    const viewport = result?.querySelector('[data-testid="mermaid-viewport"]') as HTMLElement | null;
    return { verdict: result?.textContent?.slice(0, 80) ?? "", shown: viewport ? getComputedStyle(viewport).opacity !== "0" : false };
  });
  check("settings check gives the widened verdict", /<b>/.test(preview.verdict), preview.verdict);
  check("settings preview renders through Paseo's MermaidFence", preview.shown);
  await page.locator('[data-testid="mermaid-settings-result"]').scrollIntoViewIfNeeded().catch(() => {});
  await page.screenshot({ path: path.join(shots, "3-settings.png") });
}

const setup = resolveHarnessSetup();
if (!setup) process.exit(3);
if (!AGENT) {
  console.error("pass --agent <agent id holding the four fixtures>");
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
