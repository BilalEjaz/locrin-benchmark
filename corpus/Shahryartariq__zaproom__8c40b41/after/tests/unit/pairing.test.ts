import { describe, expect, it } from "vitest";
import { findMatch, type QueueEntry } from "@/lib/pairing";
import { signTicket, strangerRoomId, verifyTicket } from "@/lib/ticket";

const q = (identity: string, joinedAtMs: number, matchedRoom?: string): QueueEntry => ({ identity, joinedAtMs, matchedRoom });

describe("findMatch", () => {
  it("pairs people in the order they joined", () => {
    const queue = [q("c", 30), q("a", 10), q("d", 40), q("b", 20)];
    expect(findMatch(queue, "a")).toEqual({ status: "pair", partner: "b" });
    expect(findMatch(queue, "b")).toEqual({ status: "pair", partner: "a" });
    expect(findMatch(queue, "c")).toEqual({ status: "pair", partner: "d" });
    expect(findMatch(queue, "d")).toEqual({ status: "pair", partner: "c" });
  });

  it("gives everyone the same answer, whoever asks", () => {
    const queue = [q("x", 1), q("y", 2), q("z", 3)];
    const pairs = ["x", "y", "z"].map((id) => findMatch(queue, id));
    expect(pairs).toEqual([
      { status: "pair", partner: "y" },
      { status: "pair", partner: "x" },
      { status: "waiting", ahead: 2 },
    ]);
  });

  it("skips people already matched", () => {
    const queue = [q("a", 1, "s-room"), q("b", 2, "s-room"), q("c", 3), q("d", 4)];
    expect(findMatch(queue, "c")).toEqual({ status: "pair", partner: "d" });
    expect(findMatch(queue, "a")).toEqual({ status: "matched", roomId: "s-room" });
  });

  it("breaks join-time ties by identity", () => {
    const queue = [q("b", 5), q("a", 5)];
    expect(findMatch(queue, "a")).toEqual({ status: "pair", partner: "b" });
  });

  it("waits when alone and reports when not in the queue yet", () => {
    expect(findMatch([q("a", 1)], "a")).toEqual({ status: "waiting", ahead: 0 });
    expect(findMatch([q("a", 1)], "zz")).toEqual({ status: "absent" });
  });
});

describe("tickets", () => {
  const secret = "test-secret";
  const id = "st_123e4567-e89b-12d3-a456-426614174000";

  it("verifies its own tickets", () => {
    expect(verifyTicket(signTicket(id, secret), secret)).toBe(id);
  });

  it("rejects tampering, other secrets and expired tickets", () => {
    const t = signTicket(id, secret, 0, 1000);
    expect(verifyTicket(t, secret, 500)).toBe(id);
    expect(verifyTicket(t, secret, 5000)).toBeNull();
    const fresh = signTicket(id, secret);
    expect(verifyTicket(fresh, "other")).toBeNull();
    expect(verifyTicket(fresh.replace("st_1", "st_2"), secret)).toBeNull();
    expect(verifyTicket("a.b.c", secret)).toBeNull();
    expect(verifyTicket(null, secret)).toBeNull();
  });
});

describe("strangerRoomId", () => {
  it("is the same in both directions and passes the id check", () => {
    expect(strangerRoomId("a", "b")).toBe(strangerRoomId("b", "a"));
    expect(strangerRoomId("a", "b")).toMatch(/^s-[a-f0-9]{16}$/);
    expect(strangerRoomId("a", "b")).not.toBe(strangerRoomId("a", "c"));
  });
});
