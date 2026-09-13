import { expect, test } from "vitest";
import { run } from "./g";

test("run adds", () => {
  expect(run()).toBe(2);
});

test("x", () => {
  run();
});
