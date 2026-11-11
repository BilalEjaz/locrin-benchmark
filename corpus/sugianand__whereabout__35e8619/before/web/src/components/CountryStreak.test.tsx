import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { PICK_LAYER } from "@/lib/basemap";
import { countryName } from "@/lib/countries";
import { seededShuffle } from "@/lib/game/daily";
import type { GameRecord } from "@/lib/game/deck";
import { BEST_STREAK_KEY, bestStreakKey } from "@/lib/game/streak";
import type { CatalogPhoto } from "@/lib/game/types";
import { gameFor } from "@/test/deck";
import { FakeMap, resetFakes } from "@/test/maplibre-mock";

import CountryStreak from "./CountryStreak";

vi.mock("maplibre-gl", async () => (await import("@/test/maplibre-mock")).maplibreMock);

function record(id: string, country: string, lng: number, lat: number): GameRecord {
  const photo: CatalogPhoto = {
    id,
    imageUrl: `https://upload.wikimedia.org/${id}.jpg`,
    lng,
    lat,
    place: `Somewhere ${id}`,
    country,
    credit: { author: "A. Photographer", license: "CC BY 4.0", sourceUrl: `https://c/${id}` },
  };
  return {
    photo,
    atlas: { lng, lat, confidence: 0.6, topCountries: [{ country: "FR", p: 0.6 }], clues: [] },
  };
}

// Three photos in big countries, and one in Singapore, too small for the globe to draw.
const RECORDS = [
  record("p1", "FR", 2.35, 48.86),
  record("p2", "JP", 139.69, 35.69),
  record("p3", "BR", -47.88, -15.79),
  record("p4", "SG", 103.82, 1.35),
];
const byId = new Map(RECORDS.map((r) => [r.photo.id, r.photo]));
// random() = 0 shuffles with seed 0.
const ORDER = seededShuffle(["p1", "p2", "p3"], 0).map((id) => byId.get(id)!);
const WRONG = { lng: -100, lat: 40 }; // the United States, never one of the answers

beforeEach(() => {
  window.history.replaceState(null, "", "/streak");
  resetFakes();
  localStorage.clear();
  window.matchMedia = vi.fn().mockReturnValue({ matches: true }) as typeof window.matchMedia;
});

async function setup(records: GameRecord[] = RECORDS) {
  const game = gameFor(records);
  const loadRecords = vi.fn(game.loadRecords);
  render(<CountryStreak deck={game.deck} loadRecords={loadRecords} random={() => 0} />);
  await waitFor(() => expect(FakeMap.instances.length).toBeGreaterThan(0));
  const map = FakeMap.instances.at(-1)!;
  act(() => map.emit("load"));
  await screen.findByRole("button", { name: "Zoom in on the photo" });
  return { map, loadRecords };
}

const streakValue = () => screen.getByText("Streak").nextElementSibling!.textContent;

describe("CountryStreak", () => {
  it("never deals a photo whose country can't be tapped", () => {
    expect(gameFor(RECORDS).deck.streakIds).toEqual(["p1", "p2", "p3"]);
  });

  it("names the tapped country, and treats the sea as no answer", async () => {
    const { map } = await setup();
    expect(screen.getByRole("button", { name: "Tap the country on the globe" })).toBeDisabled();
    act(() => map.click(-30, 30));
    expect(screen.getByRole("button", { name: "That's the sea. Tap a country" })).toBeDisabled();
    act(() => map.click(2.35, 48.86));
    expect(screen.getByRole("button", { name: "It's France" })).toBeEnabled();
    // The pick is filled in on the globe.
    expect(map.paint[PICK_LAYER]["fill-opacity"]).toEqual(["match", ["get", "n"], ["250"], 0.5, 0]);
  });

  it("counts right answers in a row and ends the run on the first miss", async () => {
    const { map } = await setup();
    for (let i = 0; i < 2; i++) {
      const photo = ORDER[i];
      act(() => map.click(photo.lng, photo.lat));
      fireEvent.click(screen.getByRole("button", { name: /^It's / }));
      const card = await screen.findByRole("region");
      expect(within(card).getByText("Right!")).toBeInTheDocument();
      expect(within(card).getByText(photo.place)).toBeInTheDocument();
      expect(streakValue()).toBe(String(i + 1));
      expect(within(card).getByRole("button", { name: "Next photo" })).toHaveFocus();
      fireEvent.click(within(card).getByRole("button", { name: "Next photo" }));
    }
    act(() => map.click(WRONG.lng, WRONG.lat));
    fireEvent.click(screen.getByRole("button", { name: "It's United States" }));
    const card = await screen.findByRole("region");
    expect(within(card).getByText("Not United States.")).toBeInTheDocument();
    expect(within(card).getByText(/Your streak ends at 2 photos\. That's your new best!/)).toBeInTheDocument();
    expect(localStorage.getItem(BEST_STREAK_KEY)).toBe("2");

    // A new run starts from zero, with the best kept.
    fireEvent.click(within(card).getByRole("button", { name: "Start a new streak" }));
    await waitFor(() => expect(screen.queryByRole("region")).toBeNull());
    expect(streakValue()).toBe("0");
    expect(screen.getByText("Best").nextElementSibling).toHaveTextContent("2");
  });

  it("does not call a shorter run a new best", async () => {
    localStorage.setItem(BEST_STREAK_KEY, "5");
    const { map } = await setup();
    act(() => map.click(WRONG.lng, WRONG.lat));
    fireEvent.click(screen.getByRole("button", { name: /^It's / }));
    const card = await screen.findByRole("region");
    expect(within(card).getByText(`It was ${countryName(ORDER[0].country)}`)).toBeInTheDocument();
    expect(within(card).getByText(/Your streak ends at 0 photos\. Your best is 5\./)).toBeInTheDocument();
    expect(localStorage.getItem(BEST_STREAK_KEY)).toBe("5");
  });

  it("says whether Atlas named the right country", async () => {
    const { map } = await setup();
    act(() => map.click(ORDER[0].lng, ORDER[0].lat));
    fireEvent.click(screen.getByRole("button", { name: /^It's / }));
    const card = await screen.findByRole("region");
    const right = ORDER[0].country === "FR";
    expect(card).toHaveTextContent(right ? "Atlas said France, and it was right." : "Atlas said France.");
  });

  it("fetches only the photo on screen and the next one", async () => {
    const { loadRecords } = await setup();
    const asked = loadRecords.mock.calls.flatMap(([ids]) => ids);
    expect(asked).toEqual(ORDER.slice(0, 2).map((p) => p.id));
  });

  describe("on one continent", () => {
    // Six European photos (with p1, in France), enough for a continent run, and three from
    // elsewhere.
    const EUROPE = [
      RECORDS[0],
      record("e1", "FR", 2.35, 48.86),
      record("e2", "DE", 13.4, 52.52),
      record("e3", "ES", -3.7, 40.42),
      record("e4", "PL", 21.01, 52.23),
      record("e5", "IT", 12.5, 41.9),
    ];
    const MIXED = [...EUROPE, ...RECORDS.slice(1)];
    const europeIds = new Set(EUROPE.map((r) => r.photo.id));
    const shown = () => document.querySelector("main")!.getAttribute("data-photo");
    const picker = () =>
      screen.getByRole("combobox", { name: /^Which photos/ }) as HTMLSelectElement;

    it("offers only continents with enough tappable photos to deal a run", async () => {
      await setup(MIXED);
      const options = Array.from(picker().options).map((o) => o.textContent);
      // Asia and South America have one photo each here; Singapore can't be tapped at all.
      expect(options).toEqual(["Anywhere", "Europe"]);
    });

    it("deals only that continent's photos and keeps a best of its own", async () => {
      localStorage.setItem(BEST_STREAK_KEY, "7");
      const { map } = await setup(MIXED);
      expect(picker().value).toBe("any");
      expect(screen.getByText("Best").nextElementSibling).toHaveTextContent("7");

      fireEvent.change(picker(), { target: { value: "europe" } });
      await waitFor(() => expect(window.location.search).toBe("?region=europe"));
      expect(screen.getByText("Country Streak in Europe: 6 photos")).toBeInTheDocument();
      // The run's best is Europe's own, not the one from every continent.
      expect(screen.getByText("Best in Europe").nextElementSibling).toHaveTextContent("0");

      const order = seededShuffle([...europeIds], 0);
      for (let i = 0; i < 2; i++) {
        await waitFor(() => expect(shown()).toBe(order[i]));
        await screen.findByRole("button", { name: "Zoom in on the photo" });
        const photo = EUROPE.find((r) => r.photo.id === order[i])!.photo;
        act(() => map.click(photo.lng, photo.lat));
        fireEvent.click(screen.getByRole("button", { name: /^It's / }));
        const card = await screen.findByRole("region");
        fireEvent.click(within(card).getByRole("button", { name: "Next photo" }));
      }
      await waitFor(() => expect(europeIds.has(shown()!)).toBe(true));
      await screen.findByRole("button", { name: "Zoom in on the photo" });
      act(() => map.click(WRONG.lng, WRONG.lat));
      fireEvent.click(screen.getByRole("button", { name: "It's United States" }));
      const card = await screen.findByRole("region");
      expect(
        within(card).getByText(/Your streak ends at 2 photos\. That's your new best in Europe!/),
      ).toBeInTheDocument();
      expect(localStorage.getItem(bestStreakKey("europe"))).toBe("2");
      expect(localStorage.getItem(BEST_STREAK_KEY)).toBe("7");
    });

    it("opens on the continent a link names, and ignores one it can't deal from", async () => {
      window.history.replaceState(null, "", "/streak?region=europe");
      await setup(MIXED);
      expect(picker().value).toBe("europe");
      expect(europeIds.has(shown()!)).toBe(true);

      resetFakes();
      document.body.innerHTML = "";
      window.history.replaceState(null, "", "/streak?region=asia");
      await setup(MIXED);
      expect(picker().value).toBe("any");
      await waitFor(() => expect(window.location.search).toBe(""));
    });
  });
});
