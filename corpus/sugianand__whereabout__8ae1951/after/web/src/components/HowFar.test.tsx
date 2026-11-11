import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { seededShuffle } from "@/lib/game/daily";
import type { GameRecord } from "@/lib/game/deck";
import { encodeFarChallenge, type FarChallenge } from "@/lib/game/farChallenge";
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

beforeEach(() => {
  window.history.replaceState(null, "", "/how-far");
  localStorage.clear();
});

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

function useClipboard() {
  const sent = { text: "" };
  Object.defineProperty(navigator, "share", { value: undefined, configurable: true });
  Object.defineProperty(navigator, "clipboard", {
    value: { writeText: async (t: string) => void (sent.text = t) },
    configurable: true,
  });
  return sent;
}

/** Lock in every pair at slider step `step`, and return the points each scored. */
async function playAll(step: number, pairs: readonly (readonly [string, string])[]) {
  const scored: number[] = [];
  for (let i = 0; i < pairs.length; i++) {
    await waitFor(() => expect(lockButton()).toBeEnabled());
    expect(screen.getByTestId("how-far-photo-1")).toHaveAttribute("data-photo", pairs[i]![0]);
    expect(screen.getByTestId("how-far-photo-2")).toHaveAttribute("data-photo", pairs[i]![1]);
    fireEvent.change(slider(), { target: { value: String(step) } });
    fireEvent.click(lockButton());
    const [a, b] = [byId.get(pairs[i]![0])!, byId.get(pairs[i]![1])!];
    scored.push(judgeEstimate(stepToKm(step), haversineKm(a.photo, b.photo)).points);
    fireEvent.click(
      await screen.findByRole("button", { name: i === 4 ? "See your score" : "Next pair" }),
    );
  }
  return scored;
}

describe("a friend's How far apart? challenge", () => {
  // Not the pairs random() = 0 deals, so the game must come from the link.
  const FRIEND: FarChallenge = {
    pairs: [
      ["p6", "p4"],
      ["p2", "p5"],
      ["p3", "p8"],
      ["p0", "p1"],
      ["p9", "p10"],
    ],
    steps: [0, 120, 260, 330, 400],
  };
  const truth = (i: number) => {
    const [a, b] = FRIEND.pairs[i]!.map((id) => byId.get(id)!.photo);
    return haversineKm(a!, b!);
  };
  const friendPoints = FRIEND.steps.map((s, i) => judgeEstimate(stepToKm(s), truth(i)).points);

  async function linked(value: string) {
    window.history.replaceState(null, "", `/how-far?challenge=${value}&x=1`);
    return setup();
  }

  it("deals the friend's pairs, and shows their estimate only once yours is in", async () => {
    await linked(encodeFarChallenge(FRIEND));
    expect(screen.getByText("Friend's challenge, pair 1 of 5")).toBeInTheDocument();
    expect(screen.getByTestId("how-far-photo-1")).toHaveAttribute("data-photo", "p6");
    expect(screen.getByTestId("how-far-friend-score")).toHaveTextContent("0");
    expect(screen.queryByText("Best")).toBeNull();
    expect(screen.queryByRole("link", { name: "Today's game" })).toBeNull();
    expect(screen.queryByTestId("how-far-friend")).toBeNull();

    fireEvent.change(slider(), { target: { value: "200" } });
    fireEvent.click(lockButton());
    const friend = judgeEstimate(stepToKm(0), truth(0));
    expect(await screen.findByTestId("how-far-friend")).toHaveTextContent(
      `Your friend said ${formatDistance(stepToKm(0), "km")}: ${describeEstimate(friend).toLowerCase()}, ${formatPoints(friend.points)} points`,
    );
    expect(screen.getByTestId("how-far-mark-friend")).toBeInTheDocument();
    expect(screen.getByTestId("how-far-friend-score")).toHaveTextContent(
      formatPoints(friend.points),
    );
  });

  it("ends with who won, leaves the best alone, and sends one back", async () => {
    await linked(encodeFarChallenge(FRIEND));
    const mine = await playAll(200, FRIEND.pairs);
    const you = mine.reduce((a, b) => a + b, 0);
    const them = friendPoints.reduce((a, b) => a + b, 0);
    expect(
      await screen.findByRole("heading", { level: 1, name: `${formatPoints(you)} points` }),
    ).toBeInTheDocument();
    const gap = Math.abs(you - them);
    const verdict =
      you > them
        ? `You won the challenge by ${formatPoints(gap)} point`
        : you < them
          ? `Your friend won by ${formatPoints(gap)} point`
          : "A dead heat with your friend.";
    expect(screen.getByText(/^Out of 5,000\./)).toHaveTextContent(verdict);
    expect(screen.getByText(/^Out of 5,000\./)).toHaveTextContent(
      `Your friend scored ${formatPoints(them)}. A challenge doesn't count toward your best.`,
    );
    const rows = within(screen.getByRole("list", { name: "Your pairs" })).getAllByRole("listitem");
    rows.forEach((row, i) =>
      expect(row).toHaveTextContent(`, friend ${formatPoints(friendPoints[i]!)}`),
    );
    expect(localStorage.getItem(BEST_HOW_FAR_KEY)).toBeNull();

    const sent = useClipboard();
    fireEvent.click(screen.getByRole("button", { name: "Send yours back" }));
    await waitFor(() =>
      expect(
        screen.getByText("Challenge link copied. Whoever opens it plays these five pairs."),
      ).toBeInTheDocument(),
    );
    expect(sent.text.split("\n").at(-1)).toBe(
      `http://localhost:3000/how-far?challenge=${encodeFarChallenge({ ...FRIEND, steps: [200, 200, 200, 200, 200] })}`,
    );

    // A fresh game is a normal one again, with its own address.
    fireEvent.click(screen.getByRole("button", { name: "Play a fresh game" }));
    expect(await screen.findByText("How far apart? Pair 1 of 5")).toBeInTheDocument();
    expect(window.location.search).toBe("?x=1");
  });

  it("sets a broken link aside for a fresh game, and says so", async () => {
    const { order } = await linked("p6.p4_1");
    expect(screen.getByText(/That challenge link was cut short/)).toBeInTheDocument();
    expect(screen.getByText("How far apart? Pair 1 of 5")).toBeInTheDocument();
    expect(screen.getByTestId("how-far-photo-1")).toHaveAttribute("data-photo", order[0]);
    expect(window.location.search).toBe("?x=1");
  });

  it("says when the photos aren't dealt any more", async () => {
    const gone: FarChallenge = { ...FRIEND, pairs: [...FRIEND.pairs.slice(0, 4), ["p9", "gone"]] };
    await linked(encodeFarChallenge(gone));
    expect(
      screen.getByText(/That challenge's photos aren't in the game any more/),
    ).toBeInTheDocument();
  });

  it("offers a challenge from the end of a free game, carrying its pairs and slider steps", async () => {
    const { order } = await setup();
    const pairs = [0, 1, 2, 3, 4].map((i) => [order[2 * i]!, order[2 * i + 1]!] as const);
    await playAll(57, pairs);
    expect(await screen.findByRole("button", { name: "Challenge a friend" })).toBeVisible();
    const sent = useClipboard();
    fireEvent.click(screen.getByRole("button", { name: "Challenge a friend" }));
    await waitFor(() => expect(sent.text).not.toBe(""));
    expect(sent.text.split("\n").at(-1)).toBe(
      `http://localhost:3000/how-far?challenge=${encodeFarChallenge({ pairs: pairs.map(([a, b]) => [a, b] as const), steps: [57, 57, 57, 57, 57] })}`,
    );
    expect(sent.text).not.toMatch(/Place p/);
  });
});
