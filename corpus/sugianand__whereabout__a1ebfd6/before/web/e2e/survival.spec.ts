import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { expect, test, type Page } from "@playwright/test";

const PHOTO = readFileSync(resolve(process.cwd(), "e2e/fixtures/photo.png"));

test.beforeEach(async ({ page }) => {
  await page.route(/wikimedia\.org/, (route) =>
    route.fulfill({ body: PHOTO, contentType: "image/png" }),
  );
});

const meter = (page: Page) => page.getByRole("meter", { name: "Health" });

async function health(page: Page): Promise<number> {
  return Number(await meter(page).getAttribute("aria-valuenow"));
}

test("Survival plays photo after photo until the health bar runs out, and keeps the best", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));

  await page.goto("./survival");
  await expect(page.getByText("Survival: last as long as you can")).toBeVisible();
  await expect(meter(page)).toHaveAttribute("aria-valuenow", "5000");
  await expect(page.getByRole("button", { name: "Place your pin on the globe" })).toBeDisabled();

  const globe = page.getByRole("application", { name: /Globe/ });
  let rounds = 0;
  for (; rounds < 15; rounds++) {
    await expect(page.getByRole("button", { name: "Zoom in on the photo" })).toBeVisible();
    const before = await health(page);
    // Enter drops the pin where the globe is looking: a guess, wherever the photo was.
    await globe.focus();
    await page.keyboard.press("Enter");
    await page.getByRole("button", { name: "Guess here" }).click();

    const card = page
      .getByRole("region")
      .filter({ has: page.getByRole("heading", { name: / away$/ }) });
    await expect(card).toBeVisible();
    await expect(card.getByRole("link", { name: /^Photo: / })).toHaveAttribute(
      "href",
      /^https:\/\/commons\.wikimedia\.org\//,
    );
    // The card says what the round did to the bar, and the bar shows it.
    const after = await health(page);
    const change = after - before;
    if (change < 0)
      await expect(card).toContainText(`−${(-change).toLocaleString("en-US")} health`);
    else await expect(card).toContainText(/Within \d+ (km|mi)/);

    // The card sits inside the screen, phone or desktop.
    const box = (await card.boundingBox())!;
    const width = page.viewportSize()!.width;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(width + 1);

    if (after === 0) break;
    await card.getByRole("button", { name: "Next photo" }).click();
  }

  const end = page.getByRole("region").filter({ hasText: "Out of health" });
  await expect(end).toBeVisible();
  await expect(end).toContainText(`You survived ${rounds} photo`);
  await expect(end).toContainText("That's your new best!");
  const kept = JSON.parse(
    (await page.evaluate(() => localStorage.getItem("whereabout:survival-best")))!,
  ) as { survived: number };
  expect(kept.survived).toBe(rounds);

  // A new run starts with a full bar, and the best survives a reload.
  await end.getByRole("button", { name: "Start a new run" }).click();
  await expect(meter(page)).toHaveAttribute("aria-valuenow", "5000");
  await page.reload();
  await expect(page.getByText("Best", { exact: true }).locator("+ dd")).toHaveText(String(rounds));
  expect(errors).toEqual([]);
});
