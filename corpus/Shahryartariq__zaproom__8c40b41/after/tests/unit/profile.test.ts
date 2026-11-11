import { describe, expect, it } from "vitest";
import { createRoomSchema, initials, nameSchema, profileSchema, tidy } from "@/lib/profile";

describe("tidy", () => {
  it("collapses whitespace and strips control characters", () => {
    expect(tidy("  Sara \n\t Ahmed\u0007 ")).toBe("Sara Ahmed");
    expect(tidy("a​b")).toBe("a b");
  });
});

describe("nameSchema", () => {
  it("accepts names in any script", () => {
    for (const n of ["Sara", "شہریار", "José María", "O'Neil", "李雷", "Jean-Luc 2"]) {
      expect(nameSchema.safeParse(n).success, n).toBe(true);
    }
  });

  it("rejects empty, long or markup-looking names", () => {
    expect(nameSchema.safeParse("   ").success).toBe(false);
    expect(nameSchema.safeParse("x".repeat(25)).success).toBe(false);
    expect(nameSchema.safeParse("<script>").success).toBe(false);
    expect(nameSchema.safeParse("a@b.com").success).toBe(false);
  });

  it("returns the tidied value", () => {
    expect(nameSchema.parse("  Sara   Ahmed ")).toBe("Sara Ahmed");
  });
});

describe("profileSchema", () => {
  it("only allows known colours", () => {
    expect(profileSchema.safeParse({ name: "Sara", color: "mint" }).success).toBe(true);
    expect(profileSchema.safeParse({ name: "Sara", color: "#ff0000" }).success).toBe(false);
  });
});

describe("createRoomSchema", () => {
  it("fills in an empty topic", () => {
    expect(createRoomSchema.parse({ title: "Standup", visibility: "public", kind: "video" })).toEqual({
      title: "Standup",
      topic: "",
      visibility: "public",
      kind: "video",
    });
  });

  it("rejects bad titles and kinds", () => {
    expect(createRoomSchema.safeParse({ title: "x", visibility: "public", kind: "video" }).success).toBe(false);
    expect(createRoomSchema.safeParse({ title: "Room", visibility: "stranger", kind: "video" }).success).toBe(false);
    expect(createRoomSchema.safeParse({ title: "Room", visibility: "public", kind: "radio" }).success).toBe(false);
    expect(createRoomSchema.safeParse({ title: "Room", topic: "t".repeat(81), visibility: "public", kind: "video" }).success).toBe(false);
  });
});

describe("initials", () => {
  it("takes the first and last words", () => {
    expect(initials("sara ahmed khan")).toBe("SK");
    expect(initials("Jo")).toBe("J");
    expect(initials("")).toBe("?");
  });

  it("keeps characters outside the basic plane whole", () => {
    expect(initials("𝒜lice 𝒵ed")).toBe("𝒜𝒵");
  });
});
