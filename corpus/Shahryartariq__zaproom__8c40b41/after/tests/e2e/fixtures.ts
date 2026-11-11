import type { Page } from "@playwright/test";
import type { LobbySnapshot } from "../../src/lib/rooms";

export const ROOM_ID = "k7f-2qxm-9zd";

export const snapshot: LobbySnapshot = {
  configured: true,
  online: 9,
  waiting: 2,
  rooms: [
    {
      id: ROOM_ID,
      title: "Next.js help desk",
      topic: "Bring your App Router questions",
      kind: "video",
      count: 3,
      createdAt: 3,
      people: [
        { name: "Sara Ahmed", color: "tangerine" },
        { name: "Mike K", color: "sky" },
        { name: "Jo Lee", color: "mint" },
      ],
    },
    { id: "p3d-8hsa-2kq", title: "Late-night lofi", topic: "", kind: "voice", count: 0, createdAt: 2, people: [] },
  ],
};

/** Serves a lobby and one room as if LiveKit were connected. */
export async function mockApi(page: Page) {
  await page.route("**/api/rooms", (route) =>
    route.request().method() === "POST"
      ? route.fulfill({ status: 201, json: { id: ROOM_ID } })
      : route.fulfill({ json: snapshot }),
  );
  await page.route(`**/api/rooms/${ROOM_ID}`, (route) =>
    route.fulfill({
      json: { id: ROOM_ID, title: "Next.js help desk", topic: "Bring your App Router questions", kind: "video", visibility: "public", count: 3 },
    }),
  );
}

/** Fails the test on any console error or uncaught exception. */
export function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errors.push(m.text());
  });
  return errors;
}
