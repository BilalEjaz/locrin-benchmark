import { expect, test, type Browser, type Page } from "@playwright/test";

/**
 * Captures the README screenshots from real rooms. Runs in the CI "calls" job with
 * SCREENSHOTS=1; the images are uploaded as the "screenshots" artifact.
 */
test.skip(process.env.SCREENSHOTS !== "1", "Only when SCREENSHOTS=1");

const OUT = "test-results/screens";

async function join(browser: Browser, path: string, name: string, color: string, theme = "dark"): Promise<Page> {
  const ctx = await browser.newContext({
    permissions: ["camera", "microphone"],
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 2,
  });
  await ctx.addInitScript(
    ([n, c, t]) => {
      localStorage.setItem("zaproom:profile", JSON.stringify({ name: n, color: c }));
      localStorage.setItem("zaproom:theme", t!);
    },
    [name, color, theme],
  );
  const page = await ctx.newPage();
  await page.goto(path);
  if (path.startsWith("/r/")) {
    await page.getByRole("button", { name: "Turn camera off" }).click();
    await page.getByRole("button", { name: "Join room" }).click();
    await expect(page.locator(".call")).toBeVisible();
  }
  return page;
}

test("README screenshots", async ({ browser }) => {
  test.setTimeout(180_000);
  const host = await join(browser, "/", "Sara Ahmed", "tangerine");
  const form = host.locator("form.start-form");
  await form.getByLabel("Room name").fill("Next.js help desk");
  await form.getByLabel("Topic (optional)").fill("Bring your App Router questions");
  await form.getByRole("button", { name: "Start room" }).click();
  await expect(host).toHaveURL(/\/r\//);
  const path = new URL(host.url()).pathname;
  await host.getByRole("button", { name: "Turn camera off" }).click();
  await host.getByRole("button", { name: "Join room" }).click();
  await expect(host.locator(".call")).toBeVisible();

  const mike = await join(browser, path, "Mike Khan", "sky");
  const jo = await join(browser, path, "Jo Lee", "mint");
  await expect(host.locator(".tile")).toHaveCount(3);

  // A second, voice-only room so the lobby has variety.
  const lofi = await join(browser, "/", "Hina R", "rose");
  const lofiForm = lofi.locator("form.start-form");
  await lofiForm.getByLabel("Room name").fill("Late-night lofi");
  await lofiForm.getByLabel("Topic (optional)").fill("Cameras off, good vibes");
  await lofiForm.getByText("Voice only").click();
  await lofiForm.getByRole("button", { name: "Start room" }).click();
  await lofi.getByRole("button", { name: "Join room" }).click();
  await expect(lofi.locator(".call")).toBeVisible();

  for (const [page, text] of [
    [mike, "Has anyone moved a big app to Cache Components yet?"],
    [jo, "We did last week. Suspense around every session read was the main change."],
    [host, "Same here. Happy to share my screen and walk through it."],
  ] as const) {
    await page.getByRole("button", { name: /^Chat/ }).click();
    await page.getByLabel("Message").fill(text);
    await page.getByLabel("Message").press("Enter");
    await page.waitForTimeout(400);
  }
  await expect(host.locator(".messages .msg, .messages .cont")).toHaveCount(3);
  await mike.getByRole("button", { name: "Send a reaction" }).click();
  await mike.getByRole("button", { name: "Celebrate" }).click();
  await host.waitForTimeout(500);
  await host.screenshot({ path: `${OUT}/call-dark.png` });

  // Light theme view of the same call.
  const viewer = await join(browser, path, "Raza", "lilac", "light");
  await viewer.getByRole("button", { name: /^Chat/ }).click();
  await jo.getByLabel("Message").fill("Welcome Raza!");
  await jo.getByLabel("Message").press("Enter");
  await expect(viewer.locator(".messages")).toContainText("Welcome Raza!");
  await viewer.screenshot({ path: `${OUT}/call-light.png` });

  // Lobby with the live rooms, both themes.
  for (const theme of ["dark", "light"]) {
    const lobby = await join(browser, "/", "Visitor", "teal", theme);
    await expect(lobby.locator(".room-row")).toHaveCount(2, { timeout: 15_000 });
    await expect(lobby.locator(".room-row").first()).toContainText("4 inside", { timeout: 15_000 });
    await lobby.screenshot({ path: `${OUT}/lobby-${theme}.png`, fullPage: true });
  }

  // Pre-join with the camera preview.
  const pre = await join(browser, "/", "Omar Q", "lemon");
  await pre.goto(path);
  await expect(pre.locator(".preview video")).toBeVisible();
  await pre.waitForTimeout(800);
  await pre.screenshot({ path: `${OUT}/prejoin-dark.png` });

  // Phone view of the call.
  const phoneCtx = await browser.newContext({
    permissions: ["camera", "microphone"],
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
  });
  await phoneCtx.addInitScript(() => localStorage.setItem("zaproom:profile", JSON.stringify({ name: "Ali", color: "coral" })));
  const phone = await phoneCtx.newPage();
  await phone.goto(path);
  await phone.getByRole("button", { name: "Turn camera off" }).click();
  await phone.getByRole("button", { name: "Join room" }).click();
  await expect(phone.locator(".tile")).toHaveCount(5);
  await phone.waitForTimeout(500);
  await phone.screenshot({ path: `${OUT}/call-phone.png` });
});
