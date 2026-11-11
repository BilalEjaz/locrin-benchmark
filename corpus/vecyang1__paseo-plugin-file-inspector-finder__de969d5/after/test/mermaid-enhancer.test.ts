import assert from "node:assert/strict";
import test from "node:test";
import { getMetroModuleMap, requireMetroExport } from "../client/metro-registry";

// A fake Metro registry shaped like Paseo 0.15.3's: module 40 defines the policy (uninitialized,
// found by factory source), module 41 exposes WEB_RENDERERS through a getter, module 42 is the
// consumer that imports the policy without defining it. `__c` is Metro's clear(); calling it is
// the registry wipe this helper must never cause.
type Rec = { isInitialized: boolean; factory?: (() => void) | undefined; publicModule: { exports: Record<string, unknown> } };

function makeFakeMetro() {
  const calls = { policy: [] as string[], codeBlock: [] as Array<Record<string, unknown>> };
  const registry = new Map<number, Rec>();
  for (let id = 0; id < 60; id++) registry.set(id, { isInitialized: true, publicModule: { exports: {} } });
  const renderers = {
    codeBlock: (props: Record<string, unknown>) => {
      calls.codeBlock.push(props);
      return { type: props.language === "mermaid" ? "MermaidFence" : "HighlightedCodeBlock", props };
    },
  };
  const policyFactory = function (this: void) {
    const e = registry.get(40)!.publicModule.exports;
    e.containsUnsafeMermaidSource = (code: string) => {
      calls.policy.push(code);
      return /<(?!\/?(?:br|i)\s*\/?>)[a-z!/]/i.test(code);
    };
  };
  // Make the factory source look like Metro's minified assignment.
  Object.defineProperty(policyFactory, "toString", { value: () => "function(g,r){e.containsUnsafeMermaidSource=function(o){}}" });
  registry.set(40, { isInitialized: false, factory: policyFactory, publicModule: { exports: {} } });
  const rendererExports: Record<string, unknown> = {};
  Object.defineProperty(rendererExports, "WEB_RENDERERS", { enumerable: true, get: () => renderers });
  registry.set(41, { isInitialized: true, publicModule: { exports: rendererExports } });
  registry.set(42, { isInitialized: true, publicModule: { exports: { useMermaidRenderModel: () => null } } });
  registry.set(43, { isInitialized: true, publicModule: { exports: { MermaidFence: () => null } } });
  const win = {
    __c: () => {
      throw new Error("__c (Metro clear) must never be called");
    },
    __r: (id: number) => {
      const rec = registry.get(id);
      if (!rec) throw new Error(`Requiring unknown module "${id}"`);
      if (!rec.isInitialized && rec.factory) {
        rec.factory();
        rec.isInitialized = true;
        rec.factory = undefined;
      }
      return rec.publicModule.exports;
    },
  };
  return { win, registry, renderers, calls };
}

function withWindow<T>(win: object, fn: () => T): T {
  const g = globalThis as Record<string, unknown>;
  const saved = { window: g.window, document: g.document };
  g.window = Object.assign(win, { addEventListener() {}, removeEventListener() {}, dispatchEvent() { return true; } });
  g.document = { defaultView: g.window, querySelectorAll: () => [] };
  try {
    return fn();
  } finally {
    g.window = saved.window;
    g.document = saved.document;
  }
}

test("Mermaid enhancer 1: the registry is found through __r(0) and __c is never called", () => {
  const { win, registry } = makeFakeMetro();
  assert.equal(getMetroModuleMap(win), registry);
  const hit = requireMetroExport("containsUnsafeMermaidSource", win);
  assert.equal(hit?.id, 40, "the defining module, initialized on demand");
  assert.equal(requireMetroExport("WEB_RENDERERS", win)?.id, 41);
  assert.equal(requireMetroExport("noSuchExport", win), null);
});

test("Mermaid enhancer 2: <b> diagrams pass the hooked policy; Paseo's guards still refuse", async () => {
  const fake = makeFakeMetro();
  const mod = await import("../client/markdown-mermaid-web");
  await withWindow(fake.win, async () => {
    const cleanup = mod.installMermaidEnhancer();
    try {
      const policy = fake.registry.get(40)!.publicModule.exports.containsUnsafeMermaidSource as (c: string) => boolean;
      assert.equal(policy('flowchart LR\n A["<b>x</b>"] --> B'), false);
      assert.equal(policy('flowchart LR\n A@{ img: "https://x.test" }'), true);
      assert.equal(policy('flowchart LR\n A["<img src=x>"] --> B'), true);
      const status = mod.getMermaidStatus();
      assert.deepEqual(status.policyHook, { installed: true, moduleId: 40 });
      assert.deepEqual(status.renderersHook, { installed: true, moduleId: 41 });
      assert.equal(status.hostFenceAvailable, true);
      assert.equal(status.counts.widened, 1);
      assert.equal(status.counts.rejected, 2);

      mod.syncMermaidPrefs({ widenFormattingTags: false });
      assert.equal(policy('flowchart LR\n A["<b>y</b>"] --> B'), true, "switch off = Paseo's own verdict");
      assert.ok(fake.calls.policy.length >= 1, "the original policy ran");
    } finally {
      mod.syncMermaidPrefs(mod.DEFAULT_MERMAID_PREFS);
      cleanup();
    }
    assert.equal(
      typeof fake.registry.get(40)!.publicModule.exports.containsUnsafeMermaidSource,
      "function",
    );
    assert.equal(mod.getMermaidStatus().policyHook.installed, false, "cleanup restores Paseo's policy");
  });
});

test("Mermaid enhancer 3: code blocks route untagged diagrams, caption blocked ones, pass everything else through", async () => {
  const fake = makeFakeMetro();
  const mod = await import("../client/markdown-mermaid-web");
  await withWindow(fake.win, async () => {
    const cleanup = mod.installMermaidEnhancer({ getLocale: () => "en" });
    try {
      const codeBlock = fake.renderers.codeBlock as (p: Record<string, unknown>) => any;

      const plain = { code: "print(1)", language: "python" };
      assert.equal(codeBlock(plain).type, "HighlightedCodeBlock");
      assert.equal(fake.calls.codeBlock.at(-1), plain, "non-diagram props pass through untouched");

      assert.equal(codeBlock({ code: "graph LR\n A-->B", language: "" }).type, "MermaidFence");
      assert.equal(codeBlock({ code: "graph TD\n C-->D", language: "mmd" }).type, "MermaidFence");
      codeBlock({ code: "graph TD\n C-->D", language: "mmd" });
      assert.equal(mod.getMermaidStatus().counts.detected, 2, "each distinct diagram counts once across re-renders");

      const blocked = codeBlock({ code: 'flowchart LR\n A@{ img: "https://x.test" }', language: "mermaid" });
      const children = blocked.props.children as any[];
      assert.equal(children[0].type, "MermaidFence");
      assert.equal(children[1].props.testID, "mermaid-blocked-reason");
      assert.match(children[1].props.children, /^Diagram shown as source: it uses @\{…\} shape data/);

      mod.syncMermaidPrefs({ explainBlocked: false });
      assert.equal(
        codeBlock({ code: 'flowchart LR\n A@{ img: "x" }', language: "mermaid" }).type,
        "MermaidFence",
        "captions can be switched off",
      );
      mod.syncMermaidPrefs({ detectUntaggedFences: false });
      assert.equal(codeBlock({ code: "graph LR\n A-->B", language: "" }).type, "HighlightedCodeBlock");
    } finally {
      mod.syncMermaidPrefs(mod.DEFAULT_MERMAID_PREFS);
      cleanup();
    }
    assert.notEqual(fake.renderers.codeBlock.name, "wrapped", "cleanup restores Paseo's renderer");
  });
});

test("Mermaid enhancer 4: captions are single-language and name the offending tag", async () => {
  const mod = await import("../client/markdown-mermaid-web");
  assert.equal(
    mod.describeMermaidBlock("html-tag", "<img src=x>", "zh-CN"),
    "图表以源码显示：含 <img src=x>，Paseo 出于安全不渲染。",
  );
  assert.equal(
    mod.describeMermaidBlock("render-error", null, "en"),
    "Diagram shown as source: Mermaid could not parse it.",
  );
});
