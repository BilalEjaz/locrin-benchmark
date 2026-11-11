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
