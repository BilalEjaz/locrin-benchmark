import { describe, expect, it } from "vitest";
import { encodeMeta, isRoomId, newRoomId, parseMeta, sortLobby, type LobbyRoom, type RoomMeta } from "@/lib/rooms";

describe("newRoomId", () => {
  it("makes ids in the xxx-xxxx-xxx shape that isRoomId accepts", () => {
    for (let i = 0; i < 200; i++) {
      const id = newRoomId();
      expect(id).toMatch(/^[a-z2-9]{3}-[a-z2-9]{4}-[a-z2-9]{3}$/);
      expect(isRoomId(id)).toBe(true);
    }
  });

  it("never uses look-alike characters", () => {
    const id = newRoomId(() => new Uint8Array(10).map((_, i) => i * 25));
    expect(id).not.toMatch(/[01ilo]/);
  });
});

describe("isRoomId", () => {
  it("accepts stranger rooms and rejects everything else", () => {
    expect(isRoomId("s-0123456789abcdef")).toBe(true);
    expect(isRoomId("zaproom-strangers-queue")).toBe(false);
    expect(isRoomId("../etc/passwd")).toBe(false);
    expect(isRoomId("ABC-DEFG-HJK")).toBe(false);
    expect(isRoomId(42)).toBe(false);
  });
});

describe("room metadata", () => {
  const meta: RoomMeta = { v: 1, title: "Standup", topic: "", visibility: "private", kind: "voice", createdAt: 5 };

  it("round-trips", () => {
    expect(parseMeta(encodeMeta(meta))).toEqual(meta);
  });

  it("ignores rooms Zaproom didn't make", () => {
    expect(parseMeta(undefined)).toBeNull();
    expect(parseMeta("")).toBeNull();
    expect(parseMeta("not json")).toBeNull();
    expect(parseMeta(JSON.stringify({ v: 2, title: "x" }))).toBeNull();
  });
});

describe("sortLobby", () => {
  const room = (id: string, count: number, createdAt: number): LobbyRoom => ({
    id,
    title: id,
    topic: "",
    kind: "video",
    count,
    people: [],
    createdAt,
  });

  it("puts busy rooms first, then the newest", () => {
    const sorted = sortLobby([room("a", 0, 1), room("b", 3, 1), room("c", 0, 9), room("d", 3, 5)]);
    expect(sorted.map((r) => r.id)).toEqual(["d", "b", "c", "a"]);
  });
});
