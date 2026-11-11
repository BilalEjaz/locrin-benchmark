import { expect, test, type Browser, type Page } from "@playwright/test";

/**
 * Real calls against a LiveKit server (CI runs `livekit-server --dev` in Docker).
 * Run with LIVEKIT_E2E=1 and LIVEKIT_URL / LIVEKIT_API_KEY / LIVEKIT_API_SECRET set.
 */

async function person(browser: Browser): Promise<Page> {
  const ctx = await browser.newContext({ permissions: ["camera", "microphone"] });
  return ctx.newPage();
}

async function seesVideoFrom(page: Page, name: string) {
  await expect
    .poll(
      () =>
        page.evaluate((n) => {
          const tile = [...document.querySelectorAll(".tile:not(.local)")].find((t) => t.textContent?.includes(n));
          const video = tile?.querySelector("video");
          return Boolean(video && video.videoWidth > 0 && !video.paused);
        }, name),
      { timeout: 30_000 },
    )
    .toBe(true);
}

test("two people share a room: video, audio, chat, reactions and leaving", async ({ browser, request }) => {
  const alice = await person(browser);
  const bob = await person(browser);

  await alice.goto("/");
  const form = alice.locator("form.start-form");
  await form.getByLabel("Your name").fill("Alice");
  await form.getByLabel("Room name").fill("E2E room");
  await form.getByRole("button", { name: "Start room" }).click();
  await expect(alice).toHaveURL(/\/r\/[a-z2-9-]+\?new=1$/);
  const roomPath = new URL(alice.url()).pathname;
  await alice.getByRole("button", { name: "Join room" }).click();
  await expect(alice.locator(".call")).toBeVisible();
  await expect(alice.locator(".tile")).toHaveCount(1);

  await bob.goto(roomPath);
  await expect(bob.getByText("1 person inside")).toBeVisible();
  await bob.getByLabel("Your name").fill("Bob");
  await bob.getByRole("button", { name: "Join room" }).click();

  await expect(alice.locator(".tile")).toHaveCount(2);
  await expect(bob.locator(".tile")).toHaveCount(2);
  await seesVideoFrom(alice, "Bob");
  await seesVideoFrom(bob, "Alice");
  // RoomAudioRenderer attaches one <audio> per remote mic.
  await expect(alice.locator("audio")).toHaveCount(1, { timeout: 15_000 });

  // The lobby lists the room with both people.
  await expect
    .poll(async () => {
      const lobby = (await (await request.get("/api/rooms")).json()) as { rooms: { title: string; count: number }[] };
      return lobby.rooms.find((r) => r.title === "E2E room")?.count;
    }, { timeout: 20_000 })
    .toBe(2);

  // Chat both ways, with an unread badge for the closed panel.
  await alice.getByRole("button", { name: "Chat" }).click();
  await alice.getByLabel("Message").fill("hello bob");
  await alice.getByLabel("Message").press("Enter");
  await expect(bob.getByRole("button", { name: "Chat, 1 unread" })).toBeVisible();
  await bob.getByRole("button", { name: /^Chat/ }).click();
  await expect(bob.locator(".messages")).toContainText("hello bob");
  await bob.getByLabel("Message").fill("hi alice");
  await bob.getByLabel("Message").press("Enter");
  await expect(alice.locator(".messages")).toContainText("hi alice");

  // Muting shows on the other side.
  await bob.getByRole("button", { name: "Mute microphone" }).click();
  await expect(alice.locator(".tile", { hasText: "Bob" }).getByRole("img", { name: "Muted" })).toBeVisible();

  // Reactions float on both screens.
  await bob.getByRole("button", { name: "Send a reaction" }).click();
  await bob.getByRole("button", { name: "Celebrate" }).click();
  await expect(alice.locator(".floater", { hasText: "Bob" })).toContainText("🎉");

  // Leaving.
  await bob.getByRole("button", { name: "Leave" }).click();
  await expect(bob.getByRole("heading", { name: "You left E2E room" })).toBeVisible();
  await expect(alice.locator(".toast", { hasText: "Bob left" })).toBeVisible();
  await expect(alice.locator(".tile")).toHaveCount(1);
});

test("a voice room has no camera", async ({ browser }) => {
  const page = await person(browser);
  await page.goto("/");
  const form = page.locator("form.start-form");
  await form.getByLabel("Your name").fill("Vic");
  await form.getByLabel("Room name").fill("Voice check");
  await form.getByText("Voice only").click();
  await form.getByRole("button", { name: "Start room" }).click();
  await expect(page.getByText("Voice room")).toBeVisible();
  await expect(page.getByRole("button", { name: /camera/ })).toHaveCount(0);
  await page.getByRole("button", { name: "Join room" }).click();
  await expect(page.locator(".call")).toBeVisible();
  await expect(page.getByRole("button", { name: /camera/ })).toHaveCount(0);
  await expect(page.locator(".tile video")).toHaveCount(0);
});

test("two strangers get matched, talk, and one skips", async ({ browser }) => {
  const sam = await person(browser);
  const kim = await person(browser);

  for (const [page, name] of [
    [sam, "Sam"],
    [kim, "Kim"],
  ] as const) {
    await page.goto("/strangers");
    await page.getByLabel("Your name").fill(name);
    await page.getByRole("button", { name: "Start matching" }).click();
  }

  await expect(sam.locator(".call")).toBeVisible({ timeout: 30_000 });
  await expect(kim.locator(".call")).toBeVisible({ timeout: 30_000 });
  await expect(sam.locator(".tile")).toHaveCount(2, { timeout: 20_000 });
  await expect(sam.locator(".tile", { hasText: "Kim" })).toBeVisible();
  // Camera starts off for strangers.
  await expect(sam.locator(".tile video")).toHaveCount(0);

  await sam.getByRole("button", { name: "Chat" }).click();
  await sam.getByLabel("Message").fill("hey stranger");
  await sam.getByLabel("Message").press("Enter");
  await kim.getByRole("button", { name: /^Chat/ }).click();
  await expect(kim.locator(".messages")).toContainText("hey stranger");

  await kim.getByRole("button", { name: "Next" }).click();
  await expect(kim.getByRole("heading", { name: "Looking for someone…" })).toBeVisible();
  await expect(sam.getByRole("heading", { name: "They left the chat" })).toBeVisible({ timeout: 20_000 });

  // Sam goes again and is matched with Kim, who is still waiting.
  await sam.getByRole("button", { name: "Find someone new" }).click();
  await expect(sam.locator(".tile", { hasText: "Kim" })).toBeVisible({ timeout: 30_000 });
  await expect(kim.locator(".tile", { hasText: "Sam" })).toBeVisible({ timeout: 30_000 });
});
