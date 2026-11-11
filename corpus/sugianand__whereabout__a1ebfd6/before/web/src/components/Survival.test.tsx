import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { seededShuffle } from "@/lib/game/daily";
import type { GameRecord } from "@/lib/game/deck";
import { BEST_SURVIVAL_KEY, HEAL_POINTS, SURVIVAL_HEALTH, biteFor } from "@/lib/game/survival";
import type { CatalogPhoto } from "@/lib/game/types";
import { formatPoints } from "@/lib/geo";
import { gameFor } from "@/test/deck";
import { FakeMap, resetFakes } from "@/test/maplibre-mock";

import Survival from "./Survival";

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
