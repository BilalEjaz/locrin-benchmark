import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { expect, test, type Page } from "@playwright/test";

import { continentOf } from "../src/lib/continents";
import { countryAt } from "../src/lib/countryHit";
import { nudge, type LngLat } from "../src/lib/geo";

const PHOTO = readFileSync(resolve(process.cwd(), "e2e/fixtures/photo.png"));
const CATALOG = new Map(
  (
    JSON.parse(readFileSync(resolve(process.cwd(), "src/data/photos.json"), "utf8")) as {
      id: string;
      country: string;
    }[]
  ).map((p) => [p.id, p.country]),
);

test.beforeEach(async ({ page }) => {
  await page.route(/wikimedia\.org/, (route) =>
    route.fulfill({ body: PHOTO, contentType: "image/png" }),
  );
});

type Keys = { key: string; times: number }[];

/** Arrow presses from `from` (Shift moves 10°) to the closest whole-degree point `wanted` holds. */
function keysTo(from: LngLat, wanted: (country: string | null) => boolean): Keys {
  let best: { cost: number; keys: Keys } | null = null;
  for (let dy = Math.ceil(-89 - from.lat); dy <= Math.floor(89 - from.lat); dy++) {
    for (let dx = -180; dx <= 180; dx++) {
      const keys: Keys = [
        {
          key: dx < 0 ? "Shift+ArrowLeft" : "Shift+ArrowRight",
          times: Math.floor(Math.abs(dx) / 10),
        },
        { key: dx < 0 ? "ArrowLeft" : "ArrowRight", times: Math.abs(dx) % 10 },
        { key: dy < 0 ? "Shift+ArrowDown" : "Shift+ArrowUp", times: Math.floor(Math.abs(dy) / 10) },
        { key: dy < 0 ? "ArrowDown" : "ArrowUp", times: Math.abs(dy) % 10 },
      ];
      const cost = keys.reduce((n, k) => n + k.times, 0);
      if (best && cost >= best.cost) continue;
      // Walk the pin exactly as the globe's keyboard handler does.
      let at = from;
      for (const { key, times } of keys) {
        const direction = key.endsWith("Left")
          ? "west"
          : key.endsWith("Right")
            ? "east"
            : key.endsWith("Up")
              ? "north"
              : "south";
        for (let i = 0; i < times; i++) at = nudge(at, direction, key.startsWith("Shift") ? 10 : 1);
      }
      if (wanted(countryAt(at))) best = { cost, keys };
    }
  }
  if (!best) throw new Error("No point on the globe matches");
  return best.keys;
}

/** Drop a pin with the keyboard and walk it into a country `wanted` accepts. */
async function pickWithKeyboard(page: Page, wanted: (country: string | null) => boolean) {
  const globe = page.getByRole("application", { name: /Globe/ });
  await globe.focus();
  await page.keyboard.press("Enter");
  const status = await page.getByText(/^Your pin: /).innerText();
  const m = status.match(/([\d.]+)° ([NS]), ([\d.]+)° ([EW])/)!;
  const from = {
    lat: Number(m[1]) * (m[2] === "S" ? -1 : 1),
    lng: Number(m[3]) * (m[4] === "W" ? -1 : 1),
  };
  for (const { key, times } of keysTo(from, wanted)) {
    for (let i = 0; i < times; i++) await page.keyboard.press(key);
  }
}

async function currentCountry(page: Page): Promise<string> {
  await expect(page.getByRole("button", { name: "Zoom in on the photo" })).toBeVisible();
  const id = await page.locator("main[data-photo]").getAttribute("data-photo");
  return CATALOG.get(id!)!;
}

test("Country Streak counts countries named in a row and ends on the first miss", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));

  await page.goto("./");
  await page.getByRole("button", { name: "Games" }).click();
  await page
    .getByRole("dialog", { name: "Ways to play" })
    .getByRole("link", { name: /^Country Streak/ })
    .click();
  await expect(page).toHaveURL(/\/streak\/?$/);
  await expect(page.getByText("Country Streak: name the country")).toBeVisible();
  await expect(page.getByRole("button", { name: "Tap the country on the globe" })).toBeDisabled();

  for (let round = 1; round <= 2; round++) {
    const truth = await currentCountry(page);
    await pickWithKeyboard(page, (c) => c === truth);
    await page.getByRole("button", { name: /^It's / }).click();
    const card = page.getByRole("region").filter({ hasText: "Right!" });
    await expect(card).toBeVisible();
    await expect(page.getByText("Streak").locator("+ dd")).toHaveText(String(round));
    await expect(card.getByRole("link", { name: /^Photo: / })).toHaveAttribute(
      "href",
      /^https:\/\/commons\.wikimedia\.org\//,
    );
    await page.keyboard.press("Enter");
  }

  const truth = await currentCountry(page);
  await pickWithKeyboard(page, (c) => c !== null && c !== truth);
  await page.getByRole("button", { name: /^It's / }).click();
  const card = page.getByRole("region").filter({ hasText: "Your streak ends at 2 photos" });
  await expect(card).toBeVisible();
  await expect(card).toContainText("That's your new best!");
  expect(await page.evaluate(() => localStorage.getItem("whereabout:country-streak-best"))).toBe(
    "2",
  );

  // A new run starts at zero and the best survives a reload.
  await card.getByRole("button", { name: "Start a new streak" }).click();
  await expect(page.getByText("Streak").locator("+ dd")).toHaveText("0");
  await page.reload();
  await expect(page.getByText("Best").locator("+ dd")).toHaveText("2");
  expect(errors).toEqual([]);
});

test("a tap on the sea is not a guess", async ({ page }) => {
  await page.goto("./streak");
  await currentCountry(page);
  await pickWithKeyboard(page, (c) => c === null);
  await expect(page.getByRole("button", { name: "That's the sea. Tap a country" })).toBeDisabled();
});

test("a streak can be dealt from one continent, with its own best", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));

  // From a Europe game, Country Streak opens on Europe too.
  await page.goto("./?region=europe");
  await expect(page.getByText("Europe game", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Games" }).click();
  await page
    .getByRole("dialog", { name: "Ways to play" })
    .getByRole("link", { name: /^Country Streak/ })
    .click();
  await expect(page).toHaveURL(/\/streak\/?\?region=europe$/);
  await expect(page.getByText(/^Country Streak in Europe: [\d,]+ photos$/)).toBeVisible();
  await expect(page.getByRole("combobox", { name: /^Which photos/ })).toHaveValue("europe");

  const truth = await currentCountry(page);
  expect(continentOf(truth)).toBe("Europe");
  await pickWithKeyboard(page, (c) => c === truth);
  await page.getByRole("button", { name: /^It's / }).click();
  await expect(page.getByRole("region").filter({ hasText: "Right!" })).toBeVisible();
  await page.keyboard.press("Enter");

  const next = await currentCountry(page);
  expect(continentOf(next)).toBe("Europe");
  await pickWithKeyboard(page, (c) => c !== null && c !== next);
  await page.getByRole("button", { name: /^It's / }).click();
  const card = page.getByRole("region").filter({ hasText: "Your streak ends at 1 photo." });
  await expect(card).toContainText("That's your new best in Europe!");
  const stored = await page.evaluate(() => ({
    europe: localStorage.getItem("whereabout:country-streak-best:europe"),
    anywhere: localStorage.getItem("whereabout:country-streak-best"),
  }));
  expect(stored).toEqual({ europe: "1", anywhere: null });

  // Back to photos from anywhere: that best is separate, and the address follows.
  await page.getByRole("combobox", { name: /^Which photos/ }).selectOption("any");
  await expect(page.getByText("Country Streak: name the country")).toBeVisible();
  await expect(page).toHaveURL(/\/streak\/?$/);
  await expect(page.getByText("Best", { exact: true }).locator("+ dd")).toHaveText("0");
  expect(errors).toEqual([]);
});
