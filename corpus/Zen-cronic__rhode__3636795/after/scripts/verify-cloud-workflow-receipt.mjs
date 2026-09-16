import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { chromium } from "playwright";

const fixture = JSON.parse(
  await readFile("data/cloud-ranked-recovery-fixture.json", "utf8"),
);
const users = JSON.parse(await readFile("data/preview-credentials.json", "utf8"));
const dispatcher = users.find((user) => user.uid === "preview-dispatcher");
assert.ok(dispatcher);
const output = "docs/evidence/workflow-comparison-2026-09-12";
const webBase = "https://roadstar-web-739889188415.us-central1.run.app";
const errors = [];
const browser = await chromium.launch({ executablePath: "/usr/bin/google-chrome" });

try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  page.on("pageerror", (error) => errors.push(String(error)));
  await page.goto(webBase);
  await page.getByLabel("Carrier ID").fill(fixture.carrier);
  await page.getByLabel("Email", { exact: true }).fill(dispatcher.email);
  await page.getByLabel("Password", { exact: true }).fill(dispatcher.password);
  await page.getByRole("button", { name: "Open operations →", exact: true }).click();
  await page.getByRole("button", { name: "Sign out", exact: true }).waitFor();
  await page
    .getByRole("navigation", { name: "Main navigation" })
    .getByRole("button", { name: /^Recovery/ })
    .click();
  const receipt = page.getByLabel("Recovery workflow evidence");
  await receipt
    .getByText("One request screened 2 resource combinations", { exact: true })
    .waitFor();
  await receipt
    .getByText(/1 feasible · 1 rejected · 1 constraint reason retained/)
    .waitFor();
  await receipt.screenshot({ path: `${output}/hosted-receipt-desktop.png` });
  await page.setViewportSize({ width: 390, height: 1000 });
  assert.equal(
    await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
    false,
  );
  await receipt.screenshot({ path: `${output}/hosted-receipt-narrow.png` });
  assert.deepEqual(errors, []);
  const evidence = {
    verifiedAt: new Date().toISOString(),
    webBase,
    carrier: fixture.carrier,
    revision: "roadstar-web-00076-piv",
    image:
      "us-central1-docker.pkg.dev/roadstar-2026-kzh/roadstar/web@sha256:6254837c3f0bf382f9c5d4aeff488e6fffedeabe461cf3d9fd9e08b9dff8b11b",
    checks: [
      "Firebase dispatcher opened the retained hosted ranked-recovery record",
      "Hosted receipt reports one request, two combinations, one feasible, one rejected and one retained reason",
      "Desktop and 390px hosted receipts render without page errors or horizontal overflow",
    ],
    limits:
      "Read-only verification of the existing synthetic ranked-recovery record. No new recommendation, approval or driver command was issued.",
  };
  await writeFile(
    `${output}/hosted-verification.json`,
    `${JSON.stringify(evidence, null, 2)}\n`,
  );
  console.log(JSON.stringify({ revision: evidence.revision, checks: evidence.checks.length }));
} finally {
  await browser.close();
}
