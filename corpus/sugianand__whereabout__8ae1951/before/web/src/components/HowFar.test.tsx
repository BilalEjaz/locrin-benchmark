import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { seededShuffle } from "@/lib/game/daily";
import type { GameRecord } from "@/lib/game/deck";
import { FAR_DAILY_KEY, dailyFarPairs, loadFarDay, rememberFarDay } from "@/lib/game/farDaily";
import {
  BEST_HOW_FAR_KEY,
  SLIDER_STEPS,
  describeEstimate,
  judgeEstimate,
  stepToKm,
} from "@/lib/game/howFar";
import type { CatalogPhoto } from "@/lib/game/types";
import { formatDistance, formatPoints, haversineKm } from "@/lib/geo";
import { gameFor } from "@/test/deck";

import HowFar from "./HowFar";

function record(id: string, lat: number, lng: number, atlas: boolean): GameRecord {
  const photo: CatalogPhoto = {
    id,
    imageUrl: `https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/${id}.jpg/1280px-${id}.jpg`,
    lng,
    lat,
    place: `Place ${id}`,
    country: "FR",
    credit: { author: "A. Photographer", license: "CC BY 4.0", sourceUrl: `https://c/${id}` },
  };
  // Atlas guesses each photo exactly, except where it has no guess at all.
  return {
    photo,
    atlas: atlas ? { lng, lat, confidence: 0.5, topCountries: [], clues: [] } : null,
  };
}

const RECORDS = Array.from({ length: 11 }, (_, i) =>
  record(`p${i}`, -50 + i * 9, -120 + i * 23, i !== 4),
);
const byId = new Map(RECORDS.map((r) => [r.photo.id, r]));

beforeEach(() => localStorage.clear());

async function setup() {
  const game = gameFor(RECORDS);
  const loadRecords = vi.fn(game.loadRecords);
  render(<HowFar deck={game.deck} loadRecords={loadRecords} random={() => 0} />);
  await waitFor(() => expect(lockButton()).toBeEnabled());
  // random() = 0 shuffles with seed 0; pairs are dealt two at a time from that order.
  const order = seededShuffle(game.deck.ids, 0);
  return { loadRecords, order };
}

const lockButton = () => screen.getByRole("button", { name: "Lock it in" });
const slider = () => screen.getByRole("slider", { name: "How far apart were these taken?" });

describe("HowFar", () => {
  it("deals a pair with a log-scale slider that reads in the player's units", async () => {
    const { loadRecords, order } = await setup();
    expect(screen.getByTestId("how-far-photo-1")).toHaveAttribute("data-photo", order[0]);
    expect(screen.getByTestId("how-far-photo-2")).toHaveAttribute("data-photo", order[1]);
    // Only the pair on screen and the next pair are fetched.
    expect(loadRecords.mock.calls.flat(2).sort()).toEqual(order.slice(0, 4).sort());

    const s = slider();
    expect(s).toHaveAttribute("max", String(SLIDER_STEPS));
    fireEvent.change(s, { target: { value: "0" } });
    expect(screen.getByTestId("how-far-estimate")).toHaveTextContent("10 km");
    expect(s).toHaveAttribute("aria-valuetext", "10 km");
    fireEvent.change(s, { target: { value: String(SLIDER_STEPS) } });
    expect(screen.getByTestId("how-far-estimate")).toHaveTextContent("20,000 km");
    // No place is named before the estimate is in.
    expect(screen.queryByText(`Place ${order[0]}`)).toBeNull();
  });

  it("reveals the real distance, your estimate scored and Atlas's from its guesses", async () => {
    const { order } = await setup();
    const [a, b] = [byId.get(order[0])!, byId.get(order[1])!];
    const actual = haversineKm(a.photo, b.photo);
    fireEvent.change(slider(), { target: { value: "300" } });
    fireEvent.click(lockButton());

    const you = judgeEstimate(stepToKm(300), actual);
    const card = await screen.findByRole("region", { name: describeEstimate(you) });
    expect(card).toHaveTextContent(`+${formatPoints(you.points)}`);
    expect(card).toHaveTextContent(
      `Place ${order[0]} and Place ${order[1]} are ${formatDistance(actual, "km")} apart.`,
    );
    expect(card).toHaveTextContent(`You said ${formatDistance(stepToKm(300), "km")}.`);
    if (a.atlas && b.atlas) {
      // Atlas guessed both photos exactly here, so its estimate is the real distance.
      expect(card).toHaveTextContent(`Atlas said ${formatDistance(actual, "km")}`);
      expect(card).toHaveTextContent("spot on, 1,000 points, closer than you");
    }
    expect(screen.getByRole("button", { name: "Next pair" })).toHaveFocus();
    // The score in the header counts the pair.
    expect(screen.getByText("Score").nextElementSibling).toHaveTextContent(
      formatPoints(you.points),
    );
  });

  it("lets Atlas sit out a pair it hasn't guessed both photos of", async () => {
    const game = gameFor(RECORDS);
    // A shuffle that puts p4, the photo Atlas never guessed, in the first pair.
    const seedFor = (r: number) => Math.floor(r * 2 ** 32);
    let r = 0;
    while (!seededShuffle(game.deck.ids, seedFor(r)).slice(0, 2).includes("p4")) r += 0.01;
    render(<HowFar deck={game.deck} loadRecords={game.loadRecords} random={() => r} />);
    await waitFor(() => expect(lockButton()).toBeEnabled());
    fireEvent.click(lockButton());
    const line = "Atlas hasn't guessed both photos, so it sits this pair out.";
    expect(await screen.findByText(line)).toBeVisible();
  });

  it("plays five pairs to a score, and keeps the best game", async () => {
    const { order } = await setup();
    let total = 0;
    for (let i = 0; i < 5; i++) {
      await waitFor(() => expect(lockButton()).toBeEnabled());
      const [a, b] = [byId.get(order[2 * i])!, byId.get(order[2 * i + 1])!];
      fireEvent.click(lockButton());
      total += judgeEstimate(stepToKm(SLIDER_STEPS / 2), haversineKm(a.photo, b.photo)).points;
      fireEvent.click(
        await screen.findByRole("button", { name: i === 4 ? "See your score" : "Next pair" }),
      );
    }
    expect(
      await screen.findByRole("heading", { level: 1, name: `${formatPoints(total)} points` }),
    ).toBeVisible();
    expect(screen.getByText(/Out of 5,000/)).toHaveTextContent("That's your new best!");
    expect(screen.getAllByRole("listitem")).toHaveLength(5);
    expect(localStorage.getItem(BEST_HOW_FAR_KEY)).toBe(total > 0 ? String(total) : null);

    // A new game starts from the first pair with the best in the header.
    fireEvent.click(screen.getByRole("button", { name: "Play again" }));
    await waitFor(() => expect(lockButton()).toBeEnabled());
    expect(screen.getByText("Best").nextElementSibling).toHaveTextContent(formatPoints(total));
  });

  it("locks in from the slider with Enter", async () => {
    await setup();
    fireEvent.keyDown(slider(), { key: "Enter" });
    expect(await screen.findByRole("button", { name: "Next pair" })).toBeVisible();
  });
});

describe("HowFar, today's game", () => {
  const DAY = "2026-11-03";
  const now = () => new Date(`${DAY}T12:00:00Z`);
  const game = gameFor(RECORDS);
  const pairs = dailyFarPairs(game.deck.ids, game.deck.regions, DAY);
  const answer = (i: number) => {
    const [a, b] = [byId.get(pairs[i][0])!, byId.get(pairs[i][1])!];
    const actualKm = haversineKm(a.photo, b.photo);
    return { actualKm, you: judgeEstimate(1000, actualKm), atlas: null };
  };
  const openDay = () =>
    render(<HowFar deck={game.deck} loadRecords={game.loadRecords} daily now={now} />);

  it("deals the day's pairs and keeps each answer, apart from the free games' best", async () => {
    openDay();
    await waitFor(() => expect(lockButton()).toBeEnabled());
    expect(screen.getByText(`How far apart?, today's game (${DAY}): pair 1 of 5`)).toBeVisible();
    expect(screen.getByRole("link", { name: "Free games" })).toHaveAttribute("href", "/how-far");
    expect(screen.queryByText("Best")).toBeNull();
    expect(screen.getByTestId("how-far-photo-1")).toHaveAttribute("data-photo", pairs[0][0]);
    expect(screen.getByTestId("how-far-photo-2")).toHaveAttribute("data-photo", pairs[0][1]);

    fireEvent.click(lockButton());
    await screen.findByRole("button", { name: "Next pair" });
    expect(loadFarDay(DAY)?.results).toHaveLength(1);
    expect(localStorage.getItem(BEST_HOW_FAR_KEY)).toBeNull();
  });

  it("picks up at the next pair with the score so far", async () => {
    const results = [answer(0), answer(1)];
    rememberFarDay(DAY, { results });
    openDay();
    await waitFor(() => expect(lockButton()).toBeEnabled());
    expect(screen.getByText(`How far apart?, today's game (${DAY}): pair 3 of 5`)).toBeVisible();
    expect(screen.getByTestId("how-far-photo-1")).toHaveAttribute("data-photo", pairs[2][0]);
    expect(screen.getByText("Score").nextElementSibling).toHaveTextContent(
      formatPoints(results[0].you.points + results[1].you.points),
    );
  });

  it("shows a finished day's result, never its pairs again", async () => {
    const results = pairs.map((_, i) => answer(i));
    rememberFarDay(DAY, { results });
    openDay();
    const total = results.reduce((sum, r) => sum + r.you.points, 0);
    expect(
      await screen.findByRole("heading", { level: 1, name: `${formatPoints(total)} points` }),
    ).toBeVisible();
    expect(screen.getByRole("button", { name: "Share today's run" })).toBeVisible();
    expect(screen.getByText(/The next run is dealt in 12h 0m/)).toBeVisible();
    expect(screen.getAllByRole("listitem")).toHaveLength(5);
    expect(screen.queryByRole("button", { name: "Play again" })).toBeNull();
    expect(screen.queryByRole("slider")).toBeNull();
    expect(localStorage.getItem(FAR_DAILY_KEY)).toContain(DAY);
  });
});

it("links the free game to today's", async () => {
  await setup();
  expect(screen.getByRole("link", { name: "Today's game" })).toHaveAttribute(
    "href",
    "/how-far/daily",
  );
});
