import { describe, expect, it } from "vitest";
import { insertHubEntry } from "../src/hub-text";

describe("insertHubEntry", () => {
  it("creates the stable entry section when an older hub does not have it", () => {
    expect(insertHubEntry("```follow-up-calendar\n```\n", "- [ ] New task")).toBe(
      "```follow-up-calendar\n```\n\n## Calendar entries\n\n- [ ] New task\n"
    );
  });

  it("inserts newest entries under the heading and above a document signature", () => {
    const content = [
      "## Calendar entries",
      "",
      "- [ ] Older task",
      "",
      "> *— Codex, 2026-09-04*",
      ""
    ].join("\n");

    expect(insertHubEntry(content, "- [ ] New task")).toBe(
      [
        "## Calendar entries",
        "",
        "- [ ] New task",
        "",
        "- [ ] Older task",
        "",
        "> *— Codex, 2026-09-04*",
        ""
      ].join("\n")
    );
  });
});
