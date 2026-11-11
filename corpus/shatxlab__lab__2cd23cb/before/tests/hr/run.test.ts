import { describe, expect, it } from "vitest";

import { AUDIT_CLOSES, FOES, INTERVIEW, HERO_BASE, MAX_FOES, MAX_GEMS, MAX_SHOTS, xpToNext } from "@/lib/hr/sim/balance";
import { abandon, choose, createRun, step } from "@/lib/hr/sim/run";
import type { Input, Run } from "@/lib/hr/sim/types";
import { starters } from "@/lib/roster/generate";
import type { Coworker } from "@/lib/roster/types";

const [intern, accountant] = starters();

/** A plain coworker: every stat 10, no quirks, so the run plays on the base numbers. */
const plain: Coworker = { ...intern, quirks: [], stats: { grit: 10, output: 10, hustle: 10, focus: 10, luck: 10 } };

/** Walks a slow circle and always takes the first pick. */
function play(run: Run, seconds: number): void {
  let tick = 0;
  while (run.status === "playing" && run.time < seconds) {
    if (run.picks) {
      choose(run, 0);
      continue;
    }
    const angle = (tick / 60) * 0.3;
    const input: Input = { dx: Math.cos(angle), dy: Math.sin(angle) };
    step(run, input);
    tick += 1;
  }
}

describe("createRun", () => {
  it("starts with the department's weapon and the coworker's numbers", () => {
    expect(createRun(intern, 1).weapons.map((weapon) => weapon.id)).toEqual(["stickyNotes"]);
    expect(createRun(accountant, 1).weapons.map((weapon) => weapon.id)).toEqual(["spreadsheet"]);
    const run = createRun(plain, 1);
    expect(run.numbers).toEqual(HERO_BASE);
    expect(run.hero.hp).toBe(HERO_BASE.maxHp);
  });
});

describe("step", () => {
  it("replays exactly from the seed and the inputs", () => {
    const a = createRun(intern, 7);
    const b = createRun(intern, 7);
    play(a, 60);
    play(b, 60);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(a.kills).toBeGreaterThan(0);
  });

  it("carries on the same after a trip through JSON", () => {
    const run = createRun(accountant, 3);
    play(run, 45);
    const copy = JSON.parse(JSON.stringify(run)) as Run;
    play(run, 90);
    play(copy, 90);
    expect(JSON.stringify(copy)).toBe(JSON.stringify(run));
  });

  // Bosses and printers are placed past the foe cap, so it may be passed by a few.
  it("keeps foes, shots and gems under their caps", () => {
    const run = createRun(accountant, 5);
    let tick = 0;
    while (run.status === "playing" && run.time < 200) {
      if (run.picks) choose(run, 0);
      else {
        step(run, { dx: Math.cos(tick / 200), dy: Math.sin(tick / 200) });
        tick += 1;
      }
      expect(run.foes.length).toBeLessThanOrEqual(MAX_FOES + 3);
      expect(run.shots.length).toBeLessThanOrEqual(MAX_SHOTS);
      expect(run.gems.length).toBeLessThanOrEqual(MAX_GEMS);
    }
  });

  it("is lost standing still, sooner or later", () => {
    const run = createRun(plain, 2);
    while (run.status === "playing") {
      if (run.picks) choose(run, 0);
      else step(run, { dx: 0, dy: 0 });
    }
    expect(run.status).toBe("lost");
    expect(run.hero.hp).toBe(0);
    expect(run.lastHitBy).not.toBeNull();
    expect(Object.values(run.takenFrom).reduce((sum, damage) => sum + damage, 0)).toBeGreaterThanOrEqual(HERO_BASE.maxHp);
  });

  it("is won when the auditor falls", () => {
    const run = createRun(plain, 4);
    step(run, { dx: 0, dy: 0 });
    run.foes.push(foe({ id: 999, kind: "auditor", hp: 0, gold: FOES.auditor.gold, x: 100, y: 100 }));
    step(run, { dx: 0, dy: 0 });
    expect(run.status).toBe("won");
    expect(run.gold).toBeGreaterThanOrEqual(FOES.auditor.gold);
  });

  it("is lost when the audit closes", () => {
    const run = createRun(plain, 4);
    run.time = AUDIT_CLOSES;
    step(run, { dx: 0, dy: 0 });
    expect(run.status).toBe("lost");
  });
});

describe("level-ups", () => {
  it("stop the clock until a pick is taken, and offer every owed level in turn", () => {
    const run = createRun(plain, 9);
    run.gems.push({ id: 900, x: run.hero.x, y: run.hero.y, value: xpToNext(1) + xpToNext(2), pulled: false });
    step(run, { dx: 0, dy: 0 });
    expect(run.level).toBe(3);
    expect(run.picks).toHaveLength(3);
    const time = run.time;
    step(run, { dx: 1, dy: 0 });
    expect(run.time).toBe(time);
    expect(choose(run, 0)).toBe(true);
    expect(run.picks).toHaveLength(3);
    expect(choose(run, 1)).toBe(true);
    expect(run.picks).toBeNull();
    expect(choose(run, 0)).toBe(false);
  });
});

describe("abandon", () => {
  it("ends the run as a fall", () => {
    const run = createRun(plain, 1);
    abandon(run);
    expect(run).toMatchObject({ status: "lost", abandoned: true });
  });
});

/** A foe with every field filled in. */
function foe(fields: Partial<Run["foes"][number]>): Run["foes"][number] {
  return {
    id: 0,
    kind: "replyAll",
    x: 0,
    y: 0,
    hp: 1,
    maxHp: 1,
    radius: 8,
    speed: 0,
    touch: 0,
    xp: 0,
    gold: 0,
    pushX: 0,
    pushY: 0,
    slow: 0,
    timer: 0,
    cycles: 0,
    charge: 0,
    chargeX: 0,
    chargeY: 0,
    duckCooldown: 0,
    hurt: 0,
    ...fields,
  };
}

describe("an interview", () => {
  const interview = { boss: "hrManager", candidateId: 9 } as const;

  it("brings the boss in at once, and none of the day's bosses or printers", () => {
    const run = createRun(plain, 1, 1, interview);
    play(run, INTERVIEW.bossAt + 20);
    expect(run.foes.some((foe) => foe.kind === "hrManager")).toBe(true);
    expect(run.foes.some((foe) => ["middleManager", "auditor", "printerJam"].includes(foe.kind))).toBe(false);
  });

  it("is won by beating the boss, not the auditor", () => {
    const run = createRun(plain, 1, 1, interview);
    play(run, INTERVIEW.bossAt + 1);
    for (const foe of run.foes) if (foe.kind === "hrManager") foe.hp = 0;
    step(run, { dx: 0, dy: 0 });
    expect(run.status).toBe("won");
  });

  it("is lost when its time runs out with the boss still standing", () => {
    // A boss nobody can beat, and a hero who cannot fall.
    const run = createRun(plain, 1, 1e6, interview);
    run.hero.hp = run.numbers.maxHp = 1e12;
    play(run, INTERVIEW.closesAt + 1);
    expect(run.status).toBe("lost");
    expect(run.time).toBeGreaterThanOrEqual(INTERVIEW.closesAt);
    expect(run.time).toBeLessThan(AUDIT_CLOSES);
  });

  it("makes foes tougher with the difficulty, the boss included", () => {
    const hard = createRun(plain, 1, 2, interview);
    const easy = createRun(plain, 1, 1, interview);
    play(hard, INTERVIEW.bossAt + 1);
    play(easy, INTERVIEW.bossAt + 1);
    const hp = (run: Run) => run.foes.find((foe) => foe.kind === "hrManager")!.maxHp;
    expect(hp(hard)).toBeCloseTo(hp(easy) * 2);
  });
});
