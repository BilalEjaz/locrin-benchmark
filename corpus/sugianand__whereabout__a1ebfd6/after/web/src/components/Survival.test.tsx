import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { seededShuffle } from "@/lib/game/daily";
import type { GameRecord } from "@/lib/game/deck";
import { BEST_SURVIVAL_KEY, HEAL_POINTS, SURVIVAL_HEALTH, biteFor } from "@/lib/game/survival";
import { encodeSurvivalChallenge } from "@/lib/game/survivalChallenge";
import type { CatalogPhoto } from "@/lib/game/types";
import { formatPoints } from "@/lib/geo";
import { gameFor } from "@/test/deck";
import { FakeMap, resetFakes } from "@/test/maplibre-mock";

import Survival, { SURVIVAL_CHALLENGE_NOTICE } from "./Survival";

vi.mock("maplibre-gl", async () => (await import("@/test/maplibre-mock")).maplibreMock);

function record(id: string, lng: number, lat: number): GameRecord {
  const photo: CatalogPhoto = {
    id,
    imageUrl: `https://upload.wikimedia.org/${id}.jpg`,
    lng,
    lat,
    place: `Somewhere ${id}`,
    country: "FR",
    credit: { author: "A. Photographer", license: "CC BY 4.0", sourceUrl: `https://c/${id}` },
  };
  // Atlas always guesses Paris.
  return {
    photo,
    atlas: { lng: 2.35, lat: 48.86, confidence: 0.6, topCountries: [], clues: [] },
  };
}

const RECORDS = [
  record("p1", 2.35, 48.86),
  record("p2", 139.69, 35.69),
  record("p3", -47.88, -15.79),
  record("p4", 151.21, -33.87),
];
const byId = new Map(RECORDS.map((r) => [r.photo.id, r.photo]));
// random() = 0 shuffles with seed 0.
const ORDER = seededShuffle(
  RECORDS.map((r) => r.photo.id),
  0,
).map((id) => byId.get(id)!);

/** The point on the globe furthest from `p`: a miss that scores 0 and bites half the bar. */
const antipode = (p: CatalogPhoto) => ({ lng: p.lng > 0 ? p.lng - 180 : p.lng + 180, lat: -p.lat });

beforeEach(() => {
  window.history.replaceState(null, "", "/survival");
  resetFakes();
  localStorage.clear();
  window.matchMedia = vi.fn().mockReturnValue({ matches: true }) as typeof window.matchMedia;
});

async function setup() {
  const game = gameFor(RECORDS);
  const loadRecords = vi.fn(game.loadRecords);
  render(<Survival deck={game.deck} loadRecords={loadRecords} random={() => 0} />);
  await waitFor(() => expect(FakeMap.instances.length).toBeGreaterThan(0));
  const map = FakeMap.instances.at(-1)!;
  act(() => map.emit("load"));
  await screen.findByRole("button", { name: "Zoom in on the photo" });
  return { map, loadRecords };
}

const health = () => screen.getByRole("meter", { name: "Health" });

async function pinAndGuess(map: FakeMap, at: { lng: number; lat: number }) {
  act(() => map.click(at.lng, at.lat));
  fireEvent.click(screen.getByRole("button", { name: "Guess here" }));
  return screen.findByRole("region");
}

describe("Survival", () => {
  it("starts with a full bar and needs a pin before a guess", async () => {
    await setup();
    expect(health()).toHaveAttribute("aria-valuenow", String(SURVIVAL_HEALTH));
    expect(screen.getByRole("button", { name: "Place your pin on the globe" })).toBeDisabled();
  });

  it("bites the bar for a miss, heals it for a pin within 25 km, and ends when it empties", async () => {
    const { map } = await setup();
    const bite = biteFor(0);

    let card = await pinAndGuess(map, antipode(ORDER[0]));
    expect(within(card).getByText(`−${formatPoints(bite)} health`)).toBeInTheDocument();
    expect(health()).toHaveAttribute("aria-valuenow", String(SURVIVAL_HEALTH - bite));
    expect(within(card).getByRole("button", { name: "Next photo" })).toHaveFocus();
    fireEvent.click(within(card).getByRole("button", { name: "Next photo" }));

    card = await pinAndGuess(map, ORDER[1]);
    expect(
      within(card).getByText(`Within 25 km: +${formatPoints(HEAL_POINTS)} health`),
    ).toBeInTheDocument();
    expect(within(card).getByText("0 m away")).toBeInTheDocument();
    expect(health()).toHaveAttribute("aria-valuenow", String(SURVIVAL_HEALTH - bite + HEAL_POINTS));
    fireEvent.click(within(card).getByRole("button", { name: "Next photo" }));

    card = await pinAndGuess(map, antipode(ORDER[2]));
    fireEvent.click(within(card).getByRole("button", { name: "Next photo" }));
    card = await pinAndGuess(map, antipode(ORDER[3]));
    expect(health()).toHaveAttribute("aria-valuenow", "0");
    expect(
      within(card).getByText(
        /Out of health\. You survived 3 photos, 5,000 points\. That's your new best!/,
      ),
    ).toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem(BEST_SURVIVAL_KEY)!)).toEqual({
      survived: 3,
      total: 5000,
    });

    // A new run starts with a full bar, the best kept.
    fireEvent.click(within(card).getByRole("button", { name: "Start a new run" }));
    await waitFor(() => expect(screen.queryByRole("region")).toBeNull());
    expect(health()).toHaveAttribute("aria-valuenow", String(SURVIVAL_HEALTH));
    expect(screen.getByText("Best").nextElementSibling).toHaveTextContent("3");
  });

  it("shows Atlas's distance, and does not call a shorter run a new best", async () => {
    localStorage.setItem(BEST_SURVIVAL_KEY, JSON.stringify({ survived: 9, total: 30000 }));
    const { map } = await setup();
    let card = await pinAndGuess(map, antipode(ORDER[0]));
    expect(card).toHaveTextContent(/Atlas was .+ away, closer than you\./);
    fireEvent.click(within(card).getByRole("button", { name: "Next photo" }));
    card = await pinAndGuess(map, antipode(ORDER[1]));
    expect(
      within(card).getByText(
        /Out of health\. You survived 1 photo, 0 points\. Your best is 9 photos, 30,000 points\./,
      ),
    ).toBeInTheDocument();
  });

  it("fetches only the photo on screen and the next one", async () => {
    const { loadRecords } = await setup();
    const asked = loadRecords.mock.calls.flatMap(([ids]) => ids);
    expect(asked).toEqual(ORDER.slice(0, 2).map((p) => p.id));
  });
});

describe("a friend's Survival challenge", () => {
  const SEED = 987_654_321;
  // The friend missed p3 by half the globe (down to 2,500), then emptied the bar on p1.
  const FRIEND = { ids: ["p3", "p1"], seed: SEED, healths: [2500, 0], survived: 1, total: 0 };
  const shownPhoto = () => document.querySelector("main")?.getAttribute("data-photo") ?? null;
  const friendStat = () => screen.getByText("Friend").nextElementSibling;
  const friendTick = () => document.querySelector("[data-friend-health]");

  afterEach(() => window.history.replaceState(null, "", "/survival"));

  function clipboard() {
    const box = { sent: "" };
    Object.defineProperty(navigator, "share", { value: undefined, configurable: true });
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: async (t: string) => void (box.sent = t) },
      configurable: true,
    });
    return box;
  }

  /** Pin the photo on screen, on the spot or at its antipode, and return its id and card. */
  async function answer(map: FakeMap, right: boolean) {
    await screen.findByRole("button", { name: "Zoom in on the photo" });
    const id = shownPhoto()!;
    const photo = byId.get(id)!;
    return { id, card: await pinAndGuess(map, right ? photo : antipode(photo)) };
  }

  it("races the friend's bar photo by photo, plays on past them, and answers with yours", async () => {
    window.history.replaceState(
      null,
      "",
      `/survival?challenge=${encodeSurvivalChallenge(FRIEND)}&x=1`,
    );
    const { map } = await setup();
    expect(screen.getByText("A friend's challenge: 1 photo to outlast")).toBeVisible();
    expect(friendStat()).toHaveTextContent("5,000");
    expect(friendTick()).toHaveAttribute("data-friend-health", String(SURVIVAL_HEALTH));

    const played: string[] = [];
    let step = await answer(map, true);
    played.push(step.id);
    expect(step.id).toBe("p3");
    expect(step.card).toHaveTextContent("Your friend had 2,500 health after this photo.");
    expect(friendStat()).toHaveTextContent("2,500");
    expect(friendTick()).toHaveAttribute("data-friend-health", "2500");
    fireEvent.click(within(step.card).getByRole("button", { name: "Next photo" }));

    await waitFor(() => expect(shownPhoto()).toBe("p1"));
    step = await answer(map, true);
    played.push(step.id);
    expect(step.card).toHaveTextContent("Your friend's bar ran out on this photo.");
    expect(step.card).toHaveTextContent("That outlasts your friend's 1 photo!");
    expect(friendStat()).toHaveTextContent("out");
    fireEvent.click(within(step.card).getByRole("button", { name: "Next photo" }));

    // Past the friend's run, it goes on through photos they never saw.
    await waitFor(() => expect(["p2", "p4"]).toContain(shownPhoto()));
    step = await answer(map, false);
    played.push(step.id);
    expect(step.card).toHaveTextContent("Your friend was already out of health by here.");
    fireEvent.click(within(step.card).getByRole("button", { name: "Next photo" }));
    step = await answer(map, false);
    played.push(step.id);
    expect(step.card).toHaveTextContent(
      "Out of health. You survived 3 photos, 10,000 points. You outlasted your friend's 1 photo by 2 photos.",
    );
    // A challenge's photos may have been seen, so it never counts toward the best.
    expect(localStorage.getItem(BEST_SURVIVAL_KEY)).toBeNull();

    const box = clipboard();
    fireEvent.click(within(step.card).getByRole("button", { name: "Send yours back" }));
    await waitFor(() =>
      expect(
        screen.getByText(
          "Challenge link copied. Whoever opens it plays these photos, in this order.",
        ),
      ).toBeInTheDocument(),
    );
    const healths = [SURVIVAL_HEALTH, SURVIVAL_HEALTH, 2500, 0].map((h) => h.toString(36));
    expect(box.sent.split("\n")).toEqual([
      "Whereabout · Survival: I survived 3 photos (10,000 points) on the globe.",
      "That beats your 1 photo. Your turn to last longer.",
      `http://localhost:3000/survival?challenge=${played.join(".")}_${SEED.toString(36)}_${healths.join(".")}_3_10000`,
    ]);

    // A fresh run leaves the link behind.
    fireEvent.click(within(step.card).getByRole("button", { name: "Play a fresh run" }));
    await waitFor(() =>
      expect(screen.getByText("Survival: last as long as you can")).toBeVisible(),
    );
    expect(window.location.search).toBe("?x=1");
    expect(friendTick()).toBeNull();
  });

  it("says when the friend lasted longer", async () => {
    const strong = {
      ids: ["p3", "p1", "p2"],
      seed: SEED,
      healths: [5000, 5000, 0],
      survived: 2,
      total: 10_000,
    };
    window.history.replaceState(null, "", `/survival?challenge=${encodeSurvivalChallenge(strong)}`);
    const { map } = await setup();
    let step = await answer(map, false);
    fireEvent.click(within(step.card).getByRole("button", { name: "Next photo" }));
    step = await answer(map, false);
    expect(step.card).toHaveTextContent(
      "Out of health. You survived 1 photo, 0 points. Your friend's 2 photos wins, by 1 photo.",
    );
    expect(within(step.card).getByRole("button", { name: "Send yours back" })).toBeVisible();
  });

  it("sets a broken link aside for a fresh run, with a reason", async () => {
    window.history.replaceState(null, "", "/survival?challenge=p3.p1_1_0.0_0_0");
    await setup();
    expect(screen.getByRole("status")).toHaveTextContent(SURVIVAL_CHALLENGE_NOTICE.malformed);
    expect(screen.getByText("Survival: last as long as you can")).toBeVisible();
    expect(window.location.search).toBe("");
  });

  it("sets aside a link whose photos have left the game", async () => {
    window.history.replaceState(null, "", "/survival?challenge=zz9_1_0_0_0");
    await setup();
    expect(screen.getByRole("status")).toHaveTextContent(SURVIVAL_CHALLENGE_NOTICE.missing);
  });

  it("offers a challenge from the end of a plain run, carrying its bar", async () => {
    const { map } = await setup();
    let card = await pinAndGuess(map, antipode(ORDER[0]));
    fireEvent.click(within(card).getByRole("button", { name: "Next photo" }));
    card = await pinAndGuess(map, antipode(ORDER[1]));
    const box = clipboard();
    fireEvent.click(within(card).getByRole("button", { name: "Challenge a friend" }));
    await waitFor(() => expect(box.sent).not.toBe(""));
    const healths = [2500, 0].map((h) => h.toString(36)).join(".");
    expect(box.sent.split("\n")).toEqual([
      "Whereabout · Survival: I survived 1 photo (0 points) on the globe.",
      "Same photos, same order: can you last longer?",
      `http://localhost:3000/survival?challenge=${ORDER[0].id}.${ORDER[1].id}_0_${healths}_1_0`,
    ]);
  });
});
