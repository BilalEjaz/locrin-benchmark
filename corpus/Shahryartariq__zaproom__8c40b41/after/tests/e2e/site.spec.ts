import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { ROOM_ID, mockApi, watchErrors } from "./fixtures";

test.describe("lobby", () => {
  test("lists live rooms and counts people", async ({ page }) => {
    const errors = watchErrors(page);
    await mockApi(page);
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Rooms with the lights on.");
    await expect(page.getByText("people in rooms now")).toContainText("9");
    await expect(page.getByText("waiting to meet someone")).toContainText("2");
    const rows = page.locator(".room-row");
    await expect(rows).toHaveCount(2);
    await expect(rows.first()).toContainText("3 inside");
    await expect(rows.nth(1)).toContainText("Empty");
    await rows.first().getByRole("link").click();
    await expect(page).toHaveURL(`/r/${ROOM_ID}`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Next.js help desk");
    expect(errors).toEqual([]);
  });

  test("says when calls aren't configured", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("status").filter({ hasText: "Calls are switched off" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Start room" })).toBeDisabled();
    await expect(page.getByText("No open rooms right now.")).toBeVisible();
  });

  test("checks the form before creating a room", async ({ page }) => {
    await mockApi(page);
    await page.goto("/");
    const form = page.locator("form.start-form");
    await form.getByRole("button", { name: "Start room" }).click();
    await expect(form.getByRole("alert")).toHaveText("Enter a name so people know who you are.");

    await form.getByLabel("Your name").fill("Sherry");
    await form.getByRole("button", { name: "Start room" }).click();
    await expect(form.getByRole("alert")).toHaveText("Give the room a name of at least 2 characters.");

    await form.getByLabel("Room name").fill("Friday standup");
    await form.getByText("Link only").click();
    await form.getByText("Voice only").click();
    const request = page.waitForRequest((r) => r.url().endsWith("/api/rooms") && r.method() === "POST");
    await form.getByRole("button", { name: "Start room" }).click();
    expect((await request).postDataJSON()).toEqual({ title: "Friday standup", topic: "", visibility: "private", kind: "voice" });
    await expect(page).toHaveURL(`/r/${ROOM_ID}?new=1`);
  });

  test("remembers your name and colour", async ({ page }) => {
    await mockApi(page);
    await page.goto("/");
    const form = page.locator("form.start-form");
    await form.getByLabel("Your name").fill("  Sherry   T ");
    await form.locator("label[for$='-sky']").click();
    await form.getByLabel("Room name").fill("Standup");
    await form.getByRole("button", { name: "Start room" }).click();
    await expect(page).toHaveURL(/\/r\//);
    await expect(page.getByLabel("Your name")).toHaveValue("Sherry T");
    await expect(page.locator(".prejoin .you .avatar")).toHaveClass(/c-sky/);
    await expect(page.locator(".prejoin .you .avatar")).toHaveText("ST");
  });
});

test.describe("pre-join", () => {
  test("shows a camera preview with mic and camera switches", async ({ page }) => {
    const errors = watchErrors(page);
    await mockApi(page);
    await page.goto(`/r/${ROOM_ID}`);
    await expect(page.getByText("3 people inside")).toBeVisible();
    await expect(page.locator(".preview video")).toBeVisible();
    await page.getByRole("button", { name: "Turn camera off" }).click();
    await expect(page.locator(".preview video")).toHaveCount(0);
    await expect(page.locator(".preview .avatar")).toBeVisible();
    await page.getByRole("button", { name: "Turn microphone off" }).click();
    await expect(page.getByRole("button", { name: "Turn microphone on" })).toHaveAttribute("aria-pressed", "false");
    expect(errors).toEqual([]);
  });

  test("explains a closed or unknown room", async ({ page }) => {
    await page.route("**/api/rooms/abc-defg-hjk", (r) => r.fulfill({ status: 404, json: { error: "This room doesn't exist or has closed." } }));
    await page.goto("/r/abc-defg-hjk");
    await expect(page.getByRole("heading", { name: "Room not available" })).toBeVisible();
    await expect(page.getByText("This room doesn't exist or has closed.")).toBeVisible();
  });

  test("404s malformed room links", async ({ page }) => {
    const res = await page.goto("/r/not-a-room");
    expect(res?.status()).toBe(404);
    await expect(page.getByRole("heading", { name: "Nothing here" })).toBeVisible();
  });
});

test.describe("strangers", () => {
  test("needs a name before matching", async ({ page }) => {
    await page.goto("/strangers");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Meet a stranger");
    await page.getByRole("button", { name: "Start matching" }).click();
    await expect(page.locator("form").getByRole("alert")).toHaveText("Enter a name so people know who you are.");
  });

  test("shows the server's error when calls are off", async ({ page }) => {
    await page.goto("/strangers");
    await page.getByLabel("Your name").fill("Sherry");
    await page.getByRole("button", { name: "Start matching" }).click();
    await expect(page.locator("form").getByRole("alert")).toContainText("Calls aren't switched on");
  });
});

test.describe("theme", () => {
  test("defaults to dark and remembers a choice without a flash", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await page.locator(".theme-switch label[title='Light']").click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    // The head script must apply the saved theme before any app code runs.
    await page.route("**/_next/static/**/*.js", (r) => r.abort());
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  });

  test("can follow the device", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "light" });
    await page.goto("/");
    await page.locator(".theme-switch label[title='Match device']").click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    await page.emulateMedia({ colorScheme: "dark" });
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  });
});

test.describe("accessibility", () => {
  for (const theme of ["dark", "light"] as const) {
    for (const path of ["/", "/strangers", "/privacy", `/r/${ROOM_ID}`]) {
      test(`${path} has no axe violations in ${theme}`, async ({ page }) => {
        await page.addInitScript((t) => localStorage.setItem("zaproom:theme", t), theme);
        await mockApi(page);
        await page.goto(path);
        await page.waitForLoadState("networkidle");
        const results = await new AxeBuilder({ page }).analyze();
        expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(" | ")}`)).toEqual([]);
      });
    }
  }

  test("pages don't scroll sideways", async ({ page }) => {
    await mockApi(page);
    for (const path of ["/", "/strangers", "/privacy", `/r/${ROOM_ID}`]) {
      await page.goto(path);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(overflow, path).toBeLessThanOrEqual(0);
    }
  });
});

test.describe("security and SEO", () => {
  test("sends a nonce-based CSP and security headers", async ({ request }) => {
    const res = await request.get("/");
    const h = res.headers();
    expect(h["content-security-policy"]).toMatch(/script-src 'self' 'nonce-[A-Za-z0-9+/=]+' 'strict-dynamic'/);
    expect(h["content-security-policy"]).toContain("frame-ancestors 'none'");
    expect(h["content-security-policy"]).toContain("wss://*.livekit.cloud");
    expect(h["x-frame-options"]).toBe("DENY");
    expect(h["permissions-policy"]).toContain("camera=(self)");
    expect(h["x-powered-by"]).toBeUndefined();
  });

  test("keeps rooms out of search engines", async ({ request }) => {
    const robots = await (await request.get("/robots.txt")).text();
    expect(robots).toContain("Disallow: /r/");
    expect(robots).toContain("Disallow: /api/");
    const sitemap = await (await request.get("/sitemap.xml")).text();
    expect(sitemap).toContain("/strangers");
    expect(sitemap).not.toContain("/r/");
  });

  test("room pages are noindex and don't leak the room name in the title", async ({ page }) => {
    await mockApi(page);
    const res = await page.goto(`/r/${ROOM_ID}`);
    const html = (await res?.text()) ?? "";
    expect(html).toContain('<meta name="robots" content="noindex, nofollow"');
    expect(html).toContain("<title>Join a room | Zaproom</title>");
  });

  test("has Open Graph tags and an image", async ({ page, request }) => {
    await page.goto("/");
    await expect(page.locator('meta[property="og:title"]')).toHaveAttribute("content", "Zaproom");
    const img = await request.get("/opengraph-image");
    expect(img.headers()["content-type"]).toBe("image/png");
  });
});

test.describe("API guards", () => {
  test("refuses cross-site requests", async ({ request }) => {
    const res = await request.post("/api/token", {
      headers: { origin: "https://evil.example", "content-type": "application/json" },
      data: { roomId: ROOM_ID, name: "x", color: "mint" },
    });
    expect(res.status()).toBe(403);
  });

  test("reports when LiveKit isn't configured", async ({ request }) => {
    for (const path of ["/api/token", "/api/rooms", "/api/strangers/queue", "/api/strangers/match"]) {
      const res = await request.post(path, { data: {} });
      expect(res.status(), path).toBe(503);
    }
    const lobby = await (await request.get("/api/rooms")).json();
    expect(lobby).toEqual({ configured: false, rooms: [], online: 0, waiting: 0 });
  });

  test("rejects malformed room ids before calling LiveKit", async ({ request }) => {
    expect((await request.get("/api/rooms/..%2F..%2Fadmin")).status()).toBe(404);
    expect((await request.get("/api/rooms/s-0123456789abcdef")).status()).toBe(404);
  });
});
