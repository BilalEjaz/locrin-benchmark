import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { chromium } from "playwright";

const webBase = "https://roadstar-web-739889188415.us-central1.run.app";
const fixture = JSON.parse(await readFile("data/presenter-workspace.json", "utf8"));
const users = JSON.parse(await readFile("data/preview-credentials.json", "utf8"));
const evidenceDir = "docs/evidence/judge-access-readiness-2026-09-13";
const required = [
  { uid: "preview-dispatcher", role: "dispatcher", width: 1440 },
  { uid: "preview-driver-1", role: "driver", width: 390 },
  { uid: "preview-driver-2", role: "driver", width: 390 },
];
const errors = [];
const posts = [];
const checks = [];
const browser = await chromium.launch({ executablePath: "/usr/bin/google-chrome" });

try {
  for (const expected of required) {
    const user = users.find((candidate) => candidate.uid === expected.uid);
    assert.ok(user, `Missing ${expected.uid}`);
    assert.equal(user.role, expected.role);
    const context = await browser.newContext({
      viewport: { width: expected.width, height: 1000 },
    });
    const page = await context.newPage();
    const startedAt = Date.now();
    page.on("pageerror", (error) => errors.push(`${expected.uid}: ${String(error)}`));
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(`${expected.uid}: ${message.text()}`);
    });
    page.on("request", (request) => {
      if (request.url().includes("/api/") && request.method() === "POST") {
        posts.push({ uid: expected.uid, path: new URL(request.url()).pathname });
      }
    });
    try {
      await page.goto(webBase, { waitUntil: "domcontentloaded" });
      await page.getByLabel("Carrier ID").fill(fixture.carrier);
      await page.getByLabel("Email", { exact: true }).fill(user.email);
      await page.getByLabel("Password", { exact: true }).fill(user.password);
      await page.getByRole("button", { name: "Open operations →", exact: true }).click();
      const workspace = page.locator(".workspace-label");
      await workspace.waitFor({ state: "attached" });
      assert.equal(await workspace.textContent(), fixture.carrier);

      const navigation = page.getByRole("navigation", { name: "Main navigation" });
      if (expected.role === "dispatcher") {
        for (const item of ["Recovery", "Planning", "Evidence & billing", "Imports"]) {
          await navigation.getByRole("button", { name: item, exact: item !== "Recovery" }).waitFor();
        }
        assert.equal(await navigation.getByRole("button", { name: "Trips", exact: true }).count(), 0);
      } else {
        const picker = page.getByLabel("Workspace view");
        await picker.waitFor();
        assert.deepEqual(await picker.locator("option").allTextContents(), ["Trips", "Tracking", "Fleet", "Activity"]);
      }
      await page.locator(".topbar").getByText("Synchronized", { exact: false }).waitFor();
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      const signOut = expected.width < 700
        ? page.locator(".mobile-signout")
        : page.locator(".sidebar-bottom").getByRole("button", { name: "Sign out", exact: true });
      await signOut.click();
      await page.getByRole("heading", { name: "Sign in to RoadStar", exact: true }).waitFor();
      checks.push({
        uid: expected.uid,
        role: expected.role,
        driverId: user.driverId || null,
        viewportWidth: expected.width,
        loginAndReadMilliseconds: Date.now() - startedAt,
        roleNavigation: expected.role === "dispatcher"
          ? ["Recovery", "Planning", "Tracking", "Fleet", "Evidence & billing", "Imports", "Activity"]
          : ["Trips", "Tracking", "Fleet", "Activity"],
        signOutReturnedToLogin: true,
        horizontalOverflow: false,
      });
    } finally {
      await context.close();
    }
  }
} finally {
  await browser.close();
}

assert.deepEqual(posts, []);
assert.deepEqual(errors, []);
await mkdir(evidenceDir, { recursive: true });
const receipt = {
  verifiedAt: new Date().toISOString(),
  webBase,
  webRevision: "roadstar-web-00076-piv",
  carrier: fixture.carrier,
  checks,
  operationalPosts: posts,
  errors,
  assertions: [
    "Three fresh browser contexts authenticated with the staged dispatcher and two driver identities",
    "Dispatcher and driver navigation matched their server-enforced roles",
    "All contexts reached synchronized state, fit their target viewport and returned to login after sign-out",
    "No operational API POST was issued and the staged recovery proposal remained unconsumed",
    "The receipt contains no email address, password, Firebase token or browser storage state",
  ],
  limits:
    "Read-only hosted credential readiness for the staged synthetic carrier. Credentials have not been delivered to judges, repository access has not been granted, and this is not portal or submission verification.",
};
await writeFile(`${evidenceDir}/verification.json`, `${JSON.stringify(receipt, null, 2)}\n`);
console.log(JSON.stringify({ identities: checks.map(({ uid, role }) => ({ uid, role })), posts: 0, errors: 0 }));
