// Plain-text session ids (client/session-ref-text-web.ts): matching, hit-testing and hover text.
// Resolution itself belongs to session-lineage-web.ts and is injected here.
import assert from "node:assert/strict";
import test from "node:test";
import {
  describeSessionRef,
  findSessionRefMatches,
  hitTestRects,
} from "../client/session-ref-text-web";

const node = (agentId: string, over: Record<string, unknown> = {}) =>
  ({
    agentId,
    shortId: agentId.slice(0, 8),
    agentTitle: "nest sub-sessions under their parent",
    workspaceId: "wks_x",
    workspaceTitle: "ws",
    projectId: null,
    projectName: "Demo project",
    status: "done",
    provider: "claude",
    model: "default",
    createdAt: null,
    updatedAt: null,
    briefPath: null,
    reportPath: null,
    reportExists: false,
    notionUrl: null,
    notionTaskId: null,
    ...over,
  }) as never;

const KNOWN = ["5e55a0d1-0000-4000-8000-000000000001", "7f7f0001-0000-4000-8000-000000000002"];
const resolve = (token: string, currentId: string | null) => {
  const t = token.toLowerCase();
  const hit = KNOWN.find((id) => id.startsWith(t) || id === t);
  return hit && hit !== currentId ? node(hit) : null;
};

test("session ref text 1: ids written in prose resolve, with exact offsets", () => {
  const text = "5e55a0d had the same prompt. 7f7f000, which was editing that file, fixed it.";
  const matches = findSessionRefMatches(text, null, resolve);
  assert.deepEqual(
    matches.map((m) => [m.token, text.slice(m.start, m.end)]),
    [["5e55a0d", "5e55a0d"], ["7f7f000", "7f7f000"]],
  );
});

test("session ref text 2: CJK neighbours, #prefix and full UUIDs match; hashes inside longer hex do not", () => {
  const cjk = findSessionRefMatches("另一个会话5e55a0d的提交", null, resolve);
  assert.equal(cjk[0]?.token, "5e55a0d");
  assert.equal(findSessionRefMatches("see #7f7f000.", null, resolve)[0]?.token, "7f7f000");
  assert.equal(findSessionRefMatches(`agent ${KNOWN[0]} done`, null, resolve)[0]?.token, KNOWN[0]);
  assert.deepEqual(findSessionRefMatches("commit a5e55a0d1b and x5e55a0d", null, resolve), [], "no match inside a longer token");
  assert.deepEqual(findSessionRefMatches("commit 714efcf", null, resolve), [], "unknown hex is left alone");
});

test("session ref text 3: the current session's own id is not a link", () => {
  assert.deepEqual(findSessionRefMatches("I am 5e55a0d", KNOWN[0], resolve), []);
});

test("session ref text 4: hit-testing uses every line box of a wrapped id", () => {
  const entries = [
    { rects: [{ left: 0, right: 50, top: 0, bottom: 20 }] },
    { rects: [{ left: 400, right: 480, top: 0, bottom: 20 }, { left: 0, right: 30, top: 20, bottom: 40 }] },
  ];
  assert.equal(hitTestRects(entries, 25, 10), 0);
  assert.equal(hitTestRects(entries, 10, 30), 1, "second line of a wrapped id");
  assert.equal(hitTestRects(entries, 200, 10), -1);
});

test("session ref text 5: hover names the session, its id, project and status", () => {
  assert.equal(
    describeSessionRef(node(KNOWN[0], { status: "running" }), true),
    "点击跳转至会话：nest sub-sessions under their parent（#5e55a0d） · Demo project · 运行中",
  );
  assert.match(describeSessionRef(node(KNOWN[1], { agentTitle: "d Fix it" }), false), /^Click to open session: Fix it \(#7f7f000\)/);
});
