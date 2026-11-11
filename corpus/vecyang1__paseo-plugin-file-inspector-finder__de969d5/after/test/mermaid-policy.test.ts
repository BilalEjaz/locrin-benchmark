import assert from "node:assert/strict";
import test from "node:test";
import {
  MERMAID_FORMATTING_TAGS,
  PASEO_NATIVE_UNSAFE_MERMAID_SOURCE,
  explainMermaidSource,
  isUnsafeMermaidSource,
  resolveMermaidFence,
} from "../shared/mermaid-policy";

// The diagram from the 2026-11-10 report: a ```mermaid fence Paseo 0.15.3 showed as source,
// because its labels bold a line with <b>. Paseo's own runtime renders it (probe receipt in
// the plugin reference), so the only blocker was the source policy.
const REPORTED = [
  "flowchart TD",
  '    A["UI 编辑需求输入"] --> B{"需求性质判定"}',
  '    B -->|"局部精修<br>改文案"| C["第 1 层: 本地 DOM 精修<br><b>消耗 0 次 Stitch 配额</b>"]',
].join("\n");

test("Mermaid 1: Paseo's native regex is copied verbatim and rejects the reported <b> diagram", () => {
  assert.equal(PASEO_NATIVE_UNSAFE_MERMAID_SOURCE.test(REPORTED), true);
  assert.equal(PASEO_NATIVE_UNSAFE_MERMAID_SOURCE.test("flowchart LR\n A[a<br>b] --> B[<i>c</i>]"), false);
});

test("Mermaid 2: attribute-free formatting tags pass, and the verdict says the widened list was needed", () => {
  const verdict = explainMermaidSource(REPORTED);
  assert.equal(verdict.verdict, "widened");
  assert.equal(verdict.reason, null);
  assert.deepEqual(verdict.widenedTags, ["b"]);
  assert.equal(isUnsafeMermaidSource(REPORTED), false);
  for (const tag of MERMAID_FORMATTING_TAGS) {
    const src = `flowchart LR\n  A["x <${tag}>y</${tag}>"] --> B`;
    assert.equal(isUnsafeMermaidSource(src), false, `<${tag}> should pass`);
  }
});

test("Mermaid 3: diagrams Paseo already accepts stay 'native' (no behaviour change for them)", () => {
  const verdict = explainMermaidSource("sequenceDiagram\n  A->>B: hi<br/>there");
  assert.equal(verdict.verdict, "native");
  assert.deepEqual(verdict.widenedTags, []);
});

test("Mermaid 4: every guard Paseo has still rejects, with a named reason", () => {
  const cases: Array<[string, string]> = [
    ['flowchart LR\n  A@{ img: "https://x.test/a.png" }', "shape-metadata"],
    ["flowchart LR\n  A --> B\n  style A fill:url(https://x.test)", "css-url"],
    ["%%{init: {'themeCSS': '@import \"https://x.test\"'}}%%\nflowchart LR\n A-->B", "css-import"],
    ["%%{init: {'themeCSS': 'x'}}%%\nflowchart LR\n A-->B", "theme-css"],
    ["flowchart LR\n  A[&#60;img&#62;] --> B", "numeric-entity"],
  ];
  for (const [src, reason] of cases) {
    const verdict = explainMermaidSource(src);
    assert.equal(verdict.verdict, "rejected", src);
    assert.equal(verdict.reason, reason, src);
  }
});

test("Mermaid 5: a formatting tag with an attribute, or any other tag, is still rejected", () => {
  for (const src of [
    'flowchart LR\n  A["<b style=\\"x\\">y</b>"] --> B',
    'flowchart LR\n  A["<span class=x>y</span>"] --> B',
    'flowchart LR\n  A["<img src=x>"] --> B',
    'flowchart LR\n  A["<script>alert(1)</script>"] --> B',
    'flowchart LR\n  A["<a href=x>y</a>"] --> B',
    'flowchart LR\n  A["<!-- x -->"] --> B',
  ]) {
    const verdict = explainMermaidSource(src);
    assert.equal(verdict.verdict, "rejected", src);
    assert.equal(verdict.reason, "html-tag", src);
    assert.ok(verdict.match, "the offending text is reported");
  }
});

test("Mermaid 6: escape-smuggled tags are decoded before checking, like Paseo does", () => {
  const smuggled = 'flowchart LR\n  A["\\u003cimg src=x\\u003e"] --> B';
  assert.equal(explainMermaidSource(smuggled).verdict, "rejected");
  assert.equal(explainMermaidSource('flowchart LR\n  A["\\u{110000}"] --> B').reason, "invalid-escape");
  // Decoded escapes of an allowed tag stay allowed.
  assert.equal(isUnsafeMermaidSource('flowchart LR\n  A["\\u003cb\\u003ey\\u003c/b\\u003e"] --> B'), false);
});

test("Mermaid 7: fences tagged mermaid or an alias render; untagged fences render only with a real diagram header", () => {
  assert.deepEqual(resolveMermaidFence("flowchart TD\n A-->B", "mermaid"), { render: true, via: "tag" });
  assert.deepEqual(resolveMermaidFence("flowchart TD\n A-->B", "Mermaid"), { render: true, via: "tag" });
  assert.deepEqual(resolveMermaidFence("graph LR\n A-->B", "mmd"), { render: true, via: "alias" });
  assert.deepEqual(resolveMermaidFence("graph LR\n A-->B", undefined), { render: true, via: "detected" });
  assert.deepEqual(resolveMermaidFence("%% note\n\nsequenceDiagram\n A->>B: hi", ""), {
    render: true,
    via: "detected",
  });
  assert.deepEqual(
    resolveMermaidFence("---\ntitle: Flow\n---\nflowchart LR\n A-->B", ""),
    { render: true, via: "detected" },
  );
  assert.deepEqual(resolveMermaidFence("pie title Pets\n \"Dogs\" : 3", ""), { render: true, via: "detected" });
});

test("Mermaid 8: ordinary code is never mistaken for a diagram", () => {
  for (const [code, language] of [
    ["graph = build_graph()\nprint(graph)", ""],
    ["flowchart TD\n A-->B", "text"],
    ["flowchart TD\n A-->B", "python"],
    ["flowchart", ""],
    ["gantt", ""],
    ["const pie = 3;\nconsole.log(pie)", ""],
    ["timeline of events:\n- one", ""],
  ] as Array<[string, string]>) {
    assert.deepEqual(resolveMermaidFence(code, language), { render: false, via: null }, code);
  }
});

test("Mermaid 9: detection can be switched off without touching tagged fences", () => {
  assert.deepEqual(resolveMermaidFence("graph LR\n A-->B", "", { detectUntagged: false }), {
    render: false,
    via: null,
  });
  assert.deepEqual(resolveMermaidFence("graph LR\n A-->B", "mermaid", { detectUntagged: false }), {
    render: true,
    via: "tag",
  });
});
