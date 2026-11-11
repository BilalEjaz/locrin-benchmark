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

/** Drop a pin where the globe is looking and guess: wherever the photo was. */
async function guessAnywhere(page: Page) {
  await expect(page.getByRole("button", { name: "Zoom in on the photo" })).toBeVisible();
  const globe = page.getByRole("application", { name: /Globe/ });
  await globe.focus();
  await page.keyboard.press("Enter");
  await page.getByRole("button", { name: "Guess here" }).click();
}

const answerCard = (page: Page) => page.locator('section[aria-labelledby="survival-answer"]');
const shownId = (page: Page) => page.locator("main[data-photo]").getAttribute("data-photo");

/** Play until the bar runs out, returning the photos dealt and the health after each. */
async function playOut(page: Page, onAnswer?: (i: number) => Promise<void>) {
  const dealt: string[] = [];
  const healths: number[] = [];
  for (let i = 0; i < 20; i++) {
    await guessAnywhere(page);
    await expect(answerCard(page)).toBeVisible();
    dealt.push((await shownId(page))!);
    healths.push(await health(page));
    await onAnswer?.(i);
    if (healths.at(-1) === 0) break;
    await answerCard(page).getByRole("button", { name: "Next photo" }).click();
  }
  return { dealt, healths };
}

test("a challenge link deals a friend the same photos, with the sender's bar to race", async ({
  page,
}) => {
  test.setTimeout(240_000);
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
  const sent = () => page.evaluate(() => (window as unknown as { sent: string }).sent);
  const card = answerCard(page);

  // The sender plays a run out and challenges a friend from its last card.
  await page.goto("./survival");
  const sender = await playOut(page);
  await expect(card).toContainText("Out of health");
  const challengeButton = card.getByRole("button", { name: "Challenge a friend" });
  await expect(challengeButton).toBeInViewport();
  await challengeButton.click();
  await expect(page.getByText(/^Challenge (sent|link copied)/)).toBeVisible();
  const message = await sent();
  const survived = sender.dealt.length - 1;
  expect(message).toContain(`I survived ${survived} photo`);
  const link = message.split("\n").at(-1)!;
  const bar = sender.healths.map((h) => h.toString(36)).join("\\.");
  expect(link).toMatch(
    new RegExp(
      `/whereabout/survival/?\\?challenge=${sender.dealt.join("\\.")}_[0-9a-z]+_${bar}_${survived}_\\d+$`,
    ),
  );

  // The friend, with nothing kept, gets the same photos in order, the sender's bar marked on
  // theirs, and what the sender had left after each photo.
  await page.evaluate(() => localStorage.clear());
  await page.goto(link);
  const plural = survived === 1 ? "photo" : "photos";
  await expect(
    page.getByText(`A friend's challenge: ${survived} ${plural} to outlast`),
  ).toBeVisible();
  await expect(page.locator("[data-friend-health]")).toHaveAttribute("data-friend-health", "5000");
  const friend = await playOut(page, async (i) => {
    if (i < sender.dealt.length) {
      expect(await shownId(page)).toBe(sender.dealt[i]);
      const theirs = sender.healths[i];
      await expect(card).toContainText(
        i === sender.dealt.length - 1
          ? "Your friend's bar ran out on this photo."
          : `Your friend had ${theirs.toLocaleString("en-US")} health after this photo.`,
      );
      await expect(page.locator("[data-friend-health]")).toHaveAttribute(
        "data-friend-health",
        String(theirs),
      );
    } else {
      expect(sender.dealt).not.toContain(await shownId(page));
      await expect(card).toContainText("Your friend was already out of health by here.");
    }
  });
  await expect(card).toContainText(
    /You outlasted your friend's|Your friend's \d+ photos? wins|You both survived|A dead heat/,
  );
  expect(await page.evaluate(() => localStorage.getItem("whereabout:survival-best"))).toBeNull();

  const back = card.getByRole("button", { name: "Send yours back" });
  await expect(back).toBeInViewport();
  await back.click();
  await expect(page.getByText(/^Challenge (sent|link copied)/)).toBeVisible();
  const reply = await sent();
  expect(reply).toContain(`I survived ${friend.dealt.length - 1} photo`);
  expect(reply).toMatch(/Your turn to last longer|Try them again\?|Play them again to break it\?/);

  // A fresh run drops the link, so a reload doesn't deal the challenge again.
  await card.getByRole("button", { name: "Play a fresh run" }).click();
  await expect(page.getByText("Survival: last as long as you can")).toBeVisible();
  expect(new URL(page.url()).search).toBe("");
  await expect(page.locator("[data-friend-health]")).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("a broken Survival challenge says so and deals a fresh run", async ({ page }) => {
  await page.goto("./survival?challenge=wm001.wm002_3_0.0_0_0");
  await expect(page.getByText(/That challenge link was cut short/)).toBeVisible();
  await expect(page.getByText("Survival: last as long as you can")).toBeVisible();
  await expect(page.getByRole("button", { name: "Zoom in on the photo" })).toBeVisible();
});

test("the end of a Survival run keeps both its buttons on a 320px phone", async ({ page }) => {
  test.skip((page.viewportSize()?.width ?? 1000) >= 768, "a phone layout check");
  await page.setViewportSize({ width: 320, height: 568 });
  await page.goto("./survival");
  await playOut(page);
  const card = answerCard(page);
  for (const name of ["Start a new run", "Challenge a friend"]) {
    await expect(card.getByRole("button", { name })).toBeInViewport({ ratio: 1 });
  }
  const scroll = await page.evaluate(() => [
    document.documentElement.scrollWidth,
    window.innerWidth,
  ]);
  expect(scroll[0]).toBeLessThanOrEqual(scroll[1]);
});
