// @vitest-environment jsdom
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import HrApp from "@/components/hr/HrApp";
import { createRun } from "@/lib/hr/sim/run";
import { CAREER_STORAGE_KEY, readCareer } from "@/lib/hr/career";
import { PACKS } from "@/lib/hr/sim/balance";
import { readRun, RUN_STORAGE_KEY } from "@/lib/hr/snapshot";
import { generateCoworker, starters } from "@/lib/roster/generate";
import { readSave, ROSTER_STORAGE_KEY } from "@/lib/roster/save";
import { mount } from "../helpers/dom";

beforeEach(() => {
  // No frames: the loop is started but never ticks, so the screen stays put.
  vi.stubGlobal("requestAnimationFrame", vi.fn(() => 0));
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  // No sprite sheet: the hero is drawn as a plain figure.
  vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new Error("offline"))));
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
  localStorage.clear();
});

afterEach(() => {
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function buttons(container: HTMLElement, name: string): HTMLButtonElement[] {
  return [...container.querySelectorAll("button")].filter((element) => element.textContent?.trim() === name);
}

describe("HrApp", () => {
  it("opens on the menu asking who to grow, with the three starters, and keeps the roster it dealt", async () => {
    const view = await mount(<HrApp />);
    expect(view.container.querySelector("h1")?.textContent).toBe("HR Department");
    expect(view.container.textContent).toContain("Who will you grow?");
    const names = [...view.container.querySelectorAll(".hr-card-name")].map((element) => element.textContent);
    expect(names).toEqual(starters().map((coworker) => coworker.name));
    expect(view.container.textContent).toContain("Steals lunches");
    expect(localStorage.getItem(ROSTER_STORAGE_KEY)).not.toBeNull();
    view.unmount();
  });

  it("starts a career with one starter and shows only them, on day 1", async () => {
    const view = await mount(<HrApp />);
    await act(async () => buttons(view.container, "Start career")[1].click());
    expect(readCareer().focusId).toBe(2);
    const names = [...view.container.querySelectorAll(".hr-card-name")].map((element) => element.textContent);
    expect(names).toEqual([starters()[1].name]);
    expect(view.container.textContent).toContain("Day 1");
    expect(view.container.textContent).toContain("Trainee · Level 1");
    view.unmount();
  });

  it("speaks Russian when the site does", async () => {
    localStorage.setItem("lab:lang", "ru");
    const view = await mount(<HrApp />);
    expect(view.container.querySelector("h1")?.textContent).toBe("Отдел кадров");
    view.unmount();
  });

  it("sends the focus in, and a walk-out still moves the day on and saves the gold", async () => {
    localStorage.setItem(CAREER_STORAGE_KEY, JSON.stringify({ focusId: 2, owned: [2], sealed: [], stage: "openSpace", gold: 7 }));
    const view = await mount(<HrApp />);
    await act(async () => buttons(view.container, "Go to work")[0].click());
    expect(view.container.querySelector("canvas.tower-canvas")).toBeTruthy();
    expect(view.container.textContent).toContain("Middle Manager in 2:30");
    expect(readRun()?.coworkerId).toBe(2);
    await act(async () => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })));
    await act(async () => buttons(view.container, "Walk out")[0].click());
    expect(view.container.textContent).toContain("Walked out");
    expect(view.container.textContent).toContain("+0 review XP");
    expect(localStorage.getItem(RUN_STORAGE_KEY)).toBeNull();
    expect(readSave().day).toBe(1);
    expect(readCareer()).toEqual({ focusId: 2, owned: [2], sealed: [], stage: "openSpace", gold: 7 });
    view.unmount();
  });

  it("opens a pack, reveals a sealed card, and hires it only after its interview", async () => {
    localStorage.setItem(CAREER_STORAGE_KEY, JSON.stringify({ focusId: 1, owned: [1], sealed: [], stage: "openSpace" as const, gold: PACKS.price + 3 }));
    const view = await mount(<HrApp />);
    await act(async () => (view.container.querySelector(".hr-pack button") as HTMLButtonElement).click());
    expect(view.container.querySelector("#hr-pack-title")?.textContent).toMatch(/^New coworker: /);
    const card = readCareer().sealed[0];
    expect(readCareer()).toMatchObject({ gold: 3, owned: [1] });
    expect(readSave().coworkers.some((coworker) => coworker.id === card)).toBe(true);
    expect(view.container.textContent).toContain("has to beat the");
    await act(async () => buttons(view.container, "Nice")[0].click());
    expect(view.container.textContent).toContain("Waiting for an interview");
    expect(view.container.textContent).not.toContain("Your cards");
    // Walking out of the interview hires no one and costs no day.
    const interviewButton = [...view.container.querySelectorAll("button")].find((element) => element.textContent?.startsWith("Interview: "));
    await act(async () => interviewButton!.click());
    expect(readRun()?.interview).toMatchObject({ candidateId: card });
    await act(async () => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })));
    await act(async () => buttons(view.container, "Walk out")[0].click());
    expect(view.container.textContent).toContain("Walked out");
    expect(buttons(view.container, "Try again")).toHaveLength(1);
    expect(readSave().day).toBe(0);
    expect(readCareer().sealed).toEqual([card]);
    view.unmount();
  });

  it("lists a hired card under your cards and lets it take over as focus", async () => {
    const save = readSave();
    const card = generateCoworker(save);
    save.coworkers.push(card);
    localStorage.setItem(ROSTER_STORAGE_KEY, JSON.stringify(save));
    localStorage.setItem(CAREER_STORAGE_KEY, JSON.stringify({ focusId: 1, owned: [1, card.id], sealed: [], gold: 0 }));
    const view = await mount(<HrApp />);
    expect(view.container.textContent).toContain("Your cards");
    await act(async () => buttons(view.container, "Make focus")[0].click());
    expect(readCareer().focusId).toBe(card.id);
    view.unmount();
  });

  it("keeps the pack closed until there is gold for it", async () => {
    localStorage.setItem(CAREER_STORAGE_KEY, JSON.stringify({ focusId: 1, owned: [1], sealed: [], stage: "openSpace" as const, gold: PACKS.price - 1 }));
    const view = await mount(<HrApp />);
    expect((view.container.querySelector(".hr-pack button") as HTMLButtonElement).disabled).toBe(true);
    view.unmount();
  });

  it("keeps the kitchen locked until the focus reaches its level, then sends them there", async () => {
    const view = await mount(<HrApp />);
    await act(async () => buttons(view.container, "Start career")[0].click());
    const kitchenButton = () => buttons(view.container, "Kitchen")[0];
    expect(kitchenButton().disabled).toBe(true);
    expect(view.container.textContent).toContain("Kitchen opens at level 6.");
    view.unmount();

    const save = readSave();
    save.coworkers[0] = { ...save.coworkers[0], level: 6 };
    localStorage.setItem(ROSTER_STORAGE_KEY, JSON.stringify(save));
    const again = await mount(<HrApp />);
    const open = () => buttons(again.container, "Kitchen")[0];
    expect(open().disabled).toBe(false);
    await act(async () => open().click());
    expect(readCareer().stage).toBe("kitchen");
    await act(async () => buttons(again.container, "Go to work")[0].click());
    expect(readRun()?.stage).toBe("kitchen");
    expect(readRun()?.hazards.length).toBeGreaterThan(0);
    again.unmount();
  });

  it("starts a new career after confirming", async () => {
    localStorage.setItem(CAREER_STORAGE_KEY, JSON.stringify({ focusId: 1, owned: [1], sealed: [], gold: 40 }));
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const view = await mount(<HrApp />);
    await act(async () => buttons(view.container, "Start a new career")[0].click());
    expect(view.container.textContent).toContain("Who will you grow?");
    expect(readCareer()).toEqual({ focusId: null, owned: [], sealed: [], stage: "openSpace", gold: 0 });
    view.unmount();
  });

  it("offers to continue a saved run", async () => {
    const run = createRun(starters()[0], 5);
    run.time = 95;
    localStorage.setItem(RUN_STORAGE_KEY, JSON.stringify(run));
    const view = await mount(<HrApp />);
    expect(view.container.textContent).toContain("Kenji Dubois, at 1:35");
    await act(async () => buttons(view.container, "Continue the run")[0].click());
    expect(view.container.textContent).toContain("1:35");
    view.unmount();
  });
});
