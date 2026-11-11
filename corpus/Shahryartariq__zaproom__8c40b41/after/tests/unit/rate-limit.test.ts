import { describe, expect, it } from "vitest";
import { RateLimiter, clientKey } from "@/lib/rate-limit";

describe("RateLimiter", () => {
  it("allows up to the limit, then asks to wait", () => {
    const rl = new RateLimiter(2, 10_000);
    expect(rl.check("ip", 0)).toBe(0);
    expect(rl.check("ip", 1000)).toBe(0);
    expect(rl.check("ip", 2000)).toBe(8);
    expect(rl.check("other", 2000)).toBe(0);
  });

  it("frees slots as the window slides", () => {
    const rl = new RateLimiter(1, 1000);
    expect(rl.check("ip", 0)).toBe(0);
    expect(rl.check("ip", 500)).toBeGreaterThan(0);
    expect(rl.check("ip", 1001)).toBe(0);
  });

  it("forgets the oldest key when full", () => {
    const rl = new RateLimiter(1, 60_000, 2);
    rl.check("a", 0);
    rl.check("b", 0);
    rl.check("c", 0);
    expect(rl.check("a", 1)).toBe(0);
  });
});

describe("clientKey", () => {
  it("uses the first forwarded address", () => {
    expect(clientKey(new Headers({ "x-forwarded-for": "1.2.3.4, 10.0.0.1" }))).toBe("1.2.3.4");
    expect(clientKey(new Headers({ "x-real-ip": "5.6.7.8" }))).toBe("5.6.7.8");
    expect(clientKey(new Headers())).toBe("local");
  });
});
