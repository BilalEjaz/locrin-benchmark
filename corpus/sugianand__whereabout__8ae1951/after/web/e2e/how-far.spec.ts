import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { expect, test, type Locator } from "@playwright/test";

const PHOTO = readFileSync(resolve(process.cwd(), "e2e/fixtures/photo.png"));

test.beforeEach(async ({ page }) => {
  await page.route(/wikimedia\.org/, (route) =>
    route.fulfill({ body: PHOTO, contentType: "image/png" }),
  );
});

async function expectOnScreen(locator: Locator) {
  const { width, height } = locator.page().viewportSize()!;
  const box = (await locator.boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(width + 1);
  expect(box.y + box.height).toBeLessThanOrEqual(height + 1);
  return box;
}

// A kilometre region, so the slider's ends read 10 km and 20,000 km.
test.use({ locale: "de-DE" });

const points = (text: string | null) => Number((text ?? "").replace(/[^\d]/g, ""));

test("How far apart? plays five pairs on a log-scale slider, against Atlas, and keeps the best", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));

  await page.goto("./how-far");
  await expect(page.getByText("How far apart? Pair 1 of 5")).toBeVisible();

  const slider = page.getByRole("slider", { name: "How far apart were these taken?" });
  const lock = page.getByRole("button", { name: "Lock it in" });
  const estimate = page.getByTestId("how-far-estimate");
  const card = page.getByRole("region").filter({ has: page.getByRole("heading", { level: 2 }) });

  let total = 0;
  for (let i = 0; i < 5; i++) {
    await expect(page.getByText(`How far apart? Pair ${i + 1} of 5`)).toBeVisible();
    await expect(lock).toBeEnabled();
    // Both photos, the slider and its button fit the screen, side by side or stacked.
    for (const n of [1, 2]) {
      const box = await expectOnScreen(page.getByTestId(`how-far-photo-${n}`));
      expect(box.height).toBeGreaterThan(120);
    }
    await expectOnScreen(lock);

    // The ends of the slider are 10 km and 20,000 km; the pick reads back in kilometres.
    await slider.fill("0");
    await expect(estimate).toHaveText("10 km");
    await slider.fill("400");
    await expect(estimate).toHaveText("20,000 km");
    await slider.fill(String(100 + i * 50));
    const said = await estimate.textContent();
    await lock.click();

    await expect(card).toBeVisible();
    await expectOnScreen(card);
    await expect(card).toContainText(`You said ${said}.`);
    await expect(card).toContainText(/ are [\d,.]+ (km|m) apart\./);
    await expect(card).toContainText(/Atlas (said [\d,.]+ (km|m) from its two guesses|hasn't)/);
    await expect(page.getByTestId("how-far-mark-actual")).toBeVisible();
    await expect(page.getByTestId("how-far-mark-you")).toBeVisible();
    // The places are named only now.
    await expect(page.getByTestId("how-far-photo-1")).not.toHaveText(/^1$/);
    total += points(await card.locator("h2 + span").textContent());
    await card.getByRole("button", { name: i === 4 ? "See your score" : "Next pair" }).click();
  }

  const heading = page.getByRole("heading", { level: 1 });
  await expect(heading).toHaveText(/ points$/);
  expect(points(await heading.textContent())).toBe(total);
  await expect(page.getByRole("list", { name: "Your pairs" }).getByRole("listitem")).toHaveCount(5);
  expect(await page.evaluate(() => localStorage.getItem("whereabout:how-far-best"))).toBe(
    total > 0 ? String(total) : null,
  );

  // The best survives a reload, in the header of a new game.
  await page.reload();
  await expect(page.getByText("Best", { exact: true }).locator("+ dd")).toHaveText(
    total.toLocaleString("en-US"),
  );
  expect(errors).toEqual([]);
});

test("How far apart? is in the Games menu, with its best", async ({ page }) => {
  await page.goto("./further-north");
  await page.evaluate(() => localStorage.setItem("whereabout:how-far-best", "3120"));
  await page.reload();
  await page.getByRole("button", { name: "Games" }).click();
  const sheet = page.getByRole("dialog");
  await expect(sheet.getByTestId("best-how-far")).toHaveText("Best: 3,120 points");
  await sheet.getByRole("link", { name: /^How far apart\?/ }).click();
  await expect(page).toHaveURL(/\/how-far\/?$/);
  await expect(page.getByRole("slider")).toBeVisible();
});

test("a challenge link deals a friend the same five pairs, with their estimate after yours", async ({
  page,
}) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "share", { value: undefined, configurable: true });
    Object.defineProperty(navigator, "clipboard", {
      value: {
        writeText: async (t: string) => void ((window as unknown as { sent: string }).sent = t),
      },
      configurable: true,
    });
  });
  const slider = page.getByRole("slider", { name: "How far apart were these taken?" });
  const lock = page.getByRole("button", { name: "Lock it in" });
  const card = page.getByRole("region").filter({ has: page.getByRole("heading", { level: 2 }) });
  const shown = async () =>
    Promise.all(
      [1, 2].map((n) => page.getByTestId(`how-far-photo-${n}`).getAttribute("data-photo")),
    );

  // The sender sets every pair to 300 on the slider.
  await page.goto("./how-far");
  const dealt: string[][] = [];
  for (let i = 0; i < 5; i++) {
    await expect(lock).toBeEnabled();
    dealt.push((await shown()) as string[]);
    await slider.fill("300");
    await lock.click();
    await card.getByRole("button", { name: i === 4 ? "See your score" : "Next pair" }).click();
  }
  const heading = page.getByRole("heading", { level: 1 });
  await expect(heading).toHaveText(/^[\d,]+ points$/);
  const total = (await heading.textContent())!.replace(" points", "");
  await page.getByRole("button", { name: "Challenge a friend" }).click();
  await expect(page.getByText(/^Challenge (sent|link copied)/)).toBeVisible();
  const sent = await page.evaluate(() => (window as unknown as { sent: string }).sent);
  expect(sent).toContain(`How far apart?: ${total} of 5,000 points on 5 pairs of photos.`);
  const link = sent.split("\n").at(-1)!;
  expect(link).toMatch(
    new RegExp(
      `/whereabout/how-far/?\\?challenge=${dealt.map((p) => p.join("\\.")).join("-")}_300\\.300\\.300\\.300\\.300$`,
    ),
  );

  // The friend opens it in a browser of their own: the same pairs, with no best kept.
  await page.evaluate(() => localStorage.clear());
  await page.goto(link);
  await expect(page.getByText("Friend's challenge, pair 1 of 5")).toBeVisible();
  for (let i = 0; i < 5; i++) {
    await expect(lock).toBeEnabled();
    expect(await shown()).toEqual(dealt[i]);
    // The friend's estimate stays hidden until this one is in.
    await expect(page.getByTestId("how-far-friend")).toHaveCount(0);
    await slider.fill(String(100 + i * 40));
    await lock.click();
    const friend = page.getByTestId("how-far-friend");
    await expect(friend).toHaveText(/^Your friend said [\d,.]+ (km|m): .+, [\d,]+ points/);
    await expectOnScreen(friend);
    await expect(page.getByTestId("how-far-mark-friend")).toBeVisible();
    await expectOnScreen(
      card.getByRole("button", { name: i === 4 ? "See your score" : "Next pair" }),
    );
    await card.getByRole("button", { name: i === 4 ? "See your score" : "Next pair" }).click();
  }
  await expect(heading).toHaveText(/^[\d,]+ points$/);
  await expect(
    page.getByText(
      new RegExp(
        `(You won the challenge by [\\d,]+ points?\\.|Your friend won by [\\d,]+ points?\\.|A dead heat with your friend\\.) Your friend scored ${total}\\.`,
      ),
    ),
  ).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem("whereabout:how-far-best"))).toBe(null);

  const back = page.getByRole("button", { name: "Send yours back" });
  await back.scrollIntoViewIfNeeded();
  await expectOnScreen(back);
  await back.click();
  const reply = await page.evaluate(() => (window as unknown as { sent: string }).sent);
  expect(reply).toMatch(/_100\.140\.180\.220\.260$/);

  // A fresh game drops the link, so a reload doesn't deal the challenge again.
  await page.getByRole("button", { name: "Play a fresh game" }).click();
  await expect(page.getByText("How far apart? Pair 1 of 5")).toBeVisible();
  expect(new URL(page.url()).search).toBe("");
  expect(errors).toEqual([]);
});

test("a challenge's reveal, with the friend's estimate, fits a 320px phone", async ({ page }) => {
  test.skip((page.viewportSize()?.width ?? 1000) >= 768, "a phone layout check");
  await page.setViewportSize({ width: 320, height: 568 });
  // Make a challenge from whatever a free game deals, so the link names photos in the deck.
  await page.goto("./how-far");
  const lock = page.getByRole("button", { name: "Lock it in" });
  await expect(lock).toBeEnabled();
  const ids = await page.evaluate(() =>
    [...document.querySelectorAll("[data-photo]")].map((e) => e.getAttribute("data-photo")),
  );
  const pairs = [ids.join(".")];
  // Four more pairs from the free game's next deal, so every photo is one the deck can deal.
  for (let i = 0; i < 4; i++) {
    await lock.click();
    await page.getByRole("button", { name: "Next pair" }).click();
    await expect(lock).toBeEnabled();
    pairs.push(
      (
        await page.evaluate(() =>
          [...document.querySelectorAll("[data-photo]")].map((e) => e.getAttribute("data-photo")),
        )
      ).join("."),
    );
  }
  await page.goto(`./how-far?challenge=${pairs.join("-")}_0.400.0.400.0`);
  await expect(page.getByText("Friend's challenge, pair 1 of 5")).toBeVisible();
  await expectOnScreen(page.getByTestId("how-far-friend-score"));
  await expect(lock).toBeEnabled();
  await page.getByRole("slider").fill("400");
  await lock.click();
  for (const id of ["how-far-friend", "how-far-mark-friend", "how-far-mark-you"]) {
    await expectOnScreen(page.getByTestId(id));
  }
  await expectOnScreen(page.getByRole("button", { name: "Next pair" }));
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
});

test("a broken How far apart? challenge says so and deals a fresh game", async ({ page }) => {
  await page.goto("./how-far?challenge=wm001.wm002_1");
  await expect(page.getByText(/That challenge link was cut short/)).toBeVisible();
  await expect(page.getByText("How far apart? Pair 1 of 5")).toBeVisible();
  await expect(page.getByRole("button", { name: "Lock it in" })).toBeEnabled();
});
