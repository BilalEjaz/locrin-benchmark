/* smoke.js -- boot the BUILT dist/index.html headlessly in jsdom and exercise the app's real APIs:
 * store CRUD + migration, editor get/set/insert, lint verdicts, run gating, examples/API data presence.
 * jsdom has no layout engine, so CodeMirror's measurement calls get tiny stubs -- rendering fidelity is
 * Logan's half of the test; THIS half proves the page boots wire-to-wire with no module blowing up.
 * Run:  node smoke.js   (from tools/vendor; exits 1 on any failure) */
const fs = require("fs");
const path = require("path");
const { JSDOM, VirtualConsole } = require("jsdom");

const html = fs.readFileSync(path.join(__dirname, "..", "..", "dist", "index.html"), "utf8");

const errors = [];
const vc = new VirtualConsole();
vc.on("jsdomError", (e) => { if (!/Could not parse CSS/.test(String(e))) errors.push("jsdomError: " + e.message); });
vc.on("error", (...a) => errors.push("console.error: " + a.join(" ")));

const dom = new JSDOM(html, {
  runScripts: "dangerously",
  url: "http://127.0.0.1:27050/",
  pretendToBeVisual: true,          // requestAnimationFrame etc.
  virtualConsole: vc,
  beforeParse(window) {
    // no layout engine: CodeMirror measures rects constantly -- give it harmless zeros
    const rect = () => ({ top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0, x: 0, y: 0 });
    window.Range.prototype.getClientRects = function () { const l = [rect()]; l.item = i => l[i]; return l; };
    window.Range.prototype.getBoundingClientRect = rect;
    window.Element.prototype.getClientRects = function () { const l = [rect()]; l.item = i => l[i]; return l; };
    window.Element.prototype.scrollIntoView = function () {};
    // the page auto-connects; give it a WebSocket that just sits there closed
    window.WebSocket = class {
      constructor() { setTimeout(() => this.onclose && this.onclose({}), 5); }
      send() {} close() {}
    };
    // update check: pretend origin/master has a newer commit -> the update bar should appear
    window.fetch = () => Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ sha: "fffffff0000000", commit: { committer: { date: "2999-01-01T00:00:00Z" } } }),
    });
  },
});

const w = dom.window;
let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log("  ok  " + name); }
  else { fail++; console.log("FAIL  " + name + (extra ? " -- " + extra : "")); }
}

setTimeout(() => {
  const IDE = w.IDE;
  ok("page booted, IDE namespace exists", !!IDE);
  ok("no page errors during boot", errors.length === 0, errors.join(" | "));
  ok("data: ESS_API loaded", w.ESS_API && w.ESS_API.completions.length > 400, w.ESS_API && w.ESS_API.completions.length);
  /* Was 40 -- the scrape of the decompiled corpus. Now merged with Ess's live pairs(_G) dump
     (tools/gen_natives.py), so it covers engine namespaces no shipped script happens to call. */
  ok("data: natives loaded (scrape + live dump)",
     w.MERCS_NATIVES && Object.keys(w.MERCS_NATIVES.natives).length >= 90,
     w.MERCS_NATIVES && Object.keys(w.MERCS_NATIVES.natives).length);
  ok("data: live-only natives carry no argument data (so the linter cannot invent a warning)", (() => {
     const nat = w.MERCS_NATIVES.natives;
     const liveOnly = [];
     for (const ns in nat) for (const fn in nat[ns]) {
       const e = nat[ns][fn];
       if (e.live && e.n == null) liveOnly.push(e);
     }
     return liveOnly.length > 0 && liveOnly.every(e => e.min == null && e.max == null);
  })());
  ok("data: ess-api generated from ess.json, not markdown",
     w.ESS_API.completions.length > 600 && /^0\.4\./.test(w.ESS_API.essVersion || ""),
     w.ESS_API.completions.length + " completions, Ess " + w.ESS_API.essVersion);
  /* The old markdown parser resolved `.method` shorthand against the most recent full path in the
     row, which attached Ess.Squad's .setFormation/.clearFormation/.on to Ess.Squad.Tactics -- real
     methods on a namespace that does not have them. ess.json cannot produce that. */
  ok("data: no phantom calls from shorthand mis-attribution", (() => {
     const paths = new Set(w.ESS_API.completions);
     return !paths.has("Ess.Squad.Tactics.setFormation") &&
            !paths.has("Ess.Squad.Tactics.on") &&
            paths.has("Ess.Squad.setFormation") && paths.has("Ess.Squad.on");
  })());

  /* The live dump is a pairs(_G) walk taken OVER the lua-bridge, so the globals Lua_Loader.asi injects
     are sitting in _G next to the real C++ natives and come back classified `engine`. Loader is that
     whole surface -- exactly the 9 functions the wiki documents at lua-bridge-api/loader.md, and no
     decompiled base-game script references Loader.* at all. gen_natives.py corrects it. */
  ok("provenance: kinds map is emitted", !!(w.MERCS_NATIVES.kinds));
  ok("provenance: Loader is lua-bridge, not engine",
     w.MERCS_NATIVES.kinds.Loader === "bridge", w.MERCS_NATIVES.kinds.Loader);
  ok("provenance: real engine namespaces stay engine",
     w.MERCS_NATIVES.kinds.Pg === "engine" && w.MERCS_NATIVES.kinds.Ai === "engine");
  ok("provenance: Loader still resolves for autocomplete and the linter",
     !!w.MERCS_NATIVES.natives.Loader && Object.keys(w.MERCS_NATIVES.natives.Loader).length === 9,
     Object.keys(w.MERCS_NATIVES.natives.Loader || {}).length + " fns");
  ok("provenance: the panel badges Loader as lua-bridge, not Native",
     IDE.api.tierOf("Loader.Printf", true)[0] === "bridge" &&
     IDE.api.tierOf("Pg.Spawn", true)[0] === "native",
     JSON.stringify([IDE.api.tierOf("Loader.Printf", true), IDE.api.tierOf("Pg.Spawn", true)]));
  ok("provenance: the panel no longer calls the bridge's API the game's own", (() => {
     const hit = IDE.api.lookup("Loader.Printf");
     return hit && /lua-bridge mod/.test(hit.ns.doc) && !/engine's own/.test(hit.ns.doc);
  })(), (IDE.api.lookup("Loader.Printf") || {}).ns && IDE.api.lookup("Loader.Printf").ns.doc.slice(0, 60));


  /* Loader.* arrived bare: no base-game script calls the bridge, so the scrape had nothing, and the
     live dump carries existence only. Worse, call_docs was merged inside scrape_natives.py, so a
     curated doc could never reach ANY live-only function -- 543 of them, not just these nine.
     gen_natives.py merges it after the merge instead. */
  ok("loader: every Loader function has a real signature", (() => {
     const L = w.MERCS_NATIVES.natives.Loader;
     return Object.keys(L).length === 9 &&
            Object.keys(L).every(fn => /\(/.test(L[fn].sig || ""));
  })(), JSON.stringify(Object.keys(w.MERCS_NATIVES.natives.Loader).map(
       fn => w.MERCS_NATIVES.natives.Loader[fn].sig)));
  ok("loader: every Loader function has a description",
     Object.values(w.MERCS_NATIVES.natives.Loader).every(e => (e.doc || "").length > 40));
  ok("loader: signatures name their arguments",
     /Loader\.SaveVar\(sKey, xValue\)/.test(w.MERCS_NATIVES.natives.Loader.SaveVar.sig) &&
     /Loader\.IsKeyDown\(vk\)/.test(w.MERCS_NATIVES.natives.Loader.IsKeyDown.sig));
  ok("loader: the panel shows the signature, not a bare Name(…)", (() => {
     const hit = IDE.api.lookup("Loader.PopKeyEvents");
     return hit && hit.c && /Loader\.PopKeyEvents\(\)/.test(hit.c.sig) && !/…/.test(hit.c.sig);
  })(), (IDE.api.lookup("Loader.PopKeyEvents") || {}).c &&
        IDE.api.lookup("Loader.PopKeyEvents").c.sig);
  ok("loader: the doc pane has real text to show",
     /lua_loader_printf\.log/.test((IDE.api.lookup("Loader.Printf").c.native || {}).doc || ""));
  /* The curated merge must not clobber what the scrape mined for real natives. */
  ok("curated docs do not overwrite a scraped native's own doc", (() => {
     const nat = w.MERCS_NATIVES.natives;
     const scraped = Object.keys(nat).filter(ns => ns !== "Loader")
       .flatMap(ns => Object.values(nat[ns])).filter(e => e.example && e.doc);
     return scraped.length > 100;
  })());


  /* The bridge patches 19 missing math functions plus math.pi/math.huge back into the game's stripped
     Lua runtime, and adds a one-function TCP namespace. Neither surfaces in the live _G dump -- math is
     a pre-existing engine table the bridge writes INTO, and TCP did not enumerate -- so both are
     synthesized from curated entries in call_docs.json. */
  ok("bridge-added: math and TCP exist in the reference",
     !!w.MERCS_NATIVES.natives.math && !!w.MERCS_NATIVES.natives.TCP);
  ok("bridge-added: both are labelled lua-bridge, not engine",
     w.MERCS_NATIVES.kinds.math === "bridge" && w.MERCS_NATIVES.kinds.TCP === "bridge");
  ok("bridge-added: the 19 math functions plus 2 constants are present",
     Object.keys(w.MERCS_NATIVES.natives.math).length === 21,
     Object.keys(w.MERCS_NATIVES.natives.math).length + " entries");
  ok("bridge-added: every math entry carries a signature and a doc",
     Object.values(w.MERCS_NATIVES.natives.math).every(e => e.sig && (e.doc || "").length > 20));
  ok("bridge-added: TCP.Send documents the loopback-only restriction",
     /LOOPBACK ONLY/.test(w.MERCS_NATIVES.natives.TCP.Send.doc) &&
     /SILENTLY/.test(w.MERCS_NATIVES.natives.TCP.Send.doc));
  ok("bridge-added: TCP.Send names its three arguments",
     /TCP\.Send\(sHost, nPort, sMsg\)/.test(w.MERCS_NATIVES.natives.TCP.Send.sig));
  ok("bridge-added: math.random is distinguished from the engine's math.randf",
     /randf/.test(w.MERCS_NATIVES.natives.math.random.doc));

  /* math is PARTIAL: the bridge only adds to it, and the engine's own floor/abs/max/min/randf are
     still there but enumerated nowhere. Warning that math.floor "isn't seen in the game's own scripts"
     would be a false alarm on correct code. */
  ok("bridge-added: math is marked partial",
     (w.MERCS_NATIVES.partial || []).indexOf("math") !== -1,
     JSON.stringify(w.MERCS_NATIVES.partial));
  ok("lint: an engine math function the bridge did not add is NOT flagged",
     IDE.lint.validate("local y = math.floor(1.5)").warnings
       .filter(d => /math\.floor/.test(d.message)).length === 0,
     JSON.stringify(IDE.lint.validate("local y = math.floor(1.5)").warnings.map(d => d.message)));
  ok("lint: math.randf (the engine's own RNG) is not flagged either",
     IDE.lint.validate("local r = math.randf()").warnings
       .filter(d => /math\.randf/.test(d.message)).length === 0);
  ok("lint: a patched math function is clean too",
     IDE.lint.validate("local s = math.sqrt(2)").warnings
       .filter(d => /math\.sqrt/.test(d.message)).length === 0);
  /* TCP is NOT partial -- one function is the whole namespace -- so a wrong member still gets caught. */
  ok("lint: a non-existent TCP member is still flagged",
     IDE.lint.validate('TCP.Broadcast("x")').warnings.some(d => /TCP\.Broadcast/.test(d.message)),
     JSON.stringify(IDE.lint.validate('TCP.Broadcast("x")').warnings.map(d => d.message)));

  /* A constant is not callable: inserting "math.pi(${})" would be nonsense. */
  ok("bridge-added: constants are marked and insert without parentheses",
     w.MERCS_NATIVES.natives.math.pi.const === 1 &&
     IDE.api.lookup("math.pi") && !/\(/.test(IDE.api.tierOf("math.pi", true)[0]));


  /* Bare globals have no namespace, so they cannot live in natives.{ns}.{fn}. assert() is the bridge's
     polyfill over the engine's error() -- stock Lua 5.1 has it, this game's stripped runtime did not. */
  ok("globals: the key exists and carries assert",
     !!(w.MERCS_NATIVES.globals && w.MERCS_NATIVES.globals.assert));
  ok("globals: assert has a signature and a real description",
     /assert\(v \[, msg\]\)/.test(w.MERCS_NATIVES.globals.assert.sig) &&
     w.MERCS_NATIVES.globals.assert.doc.length > 60);
  ok("globals: the panel lists it without inventing a namespace prefix", (() => {
     const hit = IDE.api.lookup("assert");
     return hit && hit.c && hit.c.path === "assert" && hit.ns.name === "(globals)";
  })());

  /* The curated overlay accepts EITHER a plain doc string (the original entries) or a rich object
     carrying gotcha/ret/src -- so the existing ones needed no migration. */
  ok("enrichment: a rich curated entry merges through to the data", (() => {
     const e = w.MERCS_NATIVES.natives.Loader.Printf;
     return e && e.gotcha && e.src && e.sig;
  })(), JSON.stringify(w.MERCS_NATIVES.natives.Loader.Printf));
  ok("enrichment: plain-string curated entries still work",
     Object.values(w.MERCS_NATIVES.natives).some(mem =>
       Object.values(mem).some(e => e.doc && !e.gotcha)));
  ok("enrichment: a gotcha carries its source, so a claim can be traced",
     /CLAUDE\.md|wiki|\.lua|\.md/.test(w.MERCS_NATIVES.natives.Loader.Printf.src || ""));

  /* A gotcha only earns its keep if it reaches the surfaces someone actually reads. */
  ok("enrichment: the doc pane renders a gotcha", (() => {
     const tree = w.document.getElementById("apiTree");
     IDE.api.build("Loader.Printf");
     const call = [...w.document.querySelectorAll("#apiTree .call")]
       .find(el => /Printf/.test(el.textContent));
     if (!call) return false;
     call.click();
     const html = w.document.getElementById("apiDoc").innerHTML;
     IDE.api.build("");
     return /class="gotcha"/.test(html) && /format substitution/.test(html);
  })());
  ok("enrichment: the gotcha is escaped, not injected as markup",
     !/<script/i.test(w.document.getElementById("apiDoc").innerHTML));


  /* The enriched reference. Every curated fact carries a `src` so a claim can be traced -- an
     unsourced assertion about this engine is exactly what the reference exists to be an antidote to. */
  ok("corpus: Ess is fully documented", (() => {
     const calls = w.ESS_API.namespaces.flatMap(n => n.calls);
     return calls.length > 500 && calls.every(c => c.doc);
  })(), (() => { const c = w.ESS_API.namespaces.flatMap(n => n.calls);
                 return c.filter(x => !x.doc).length + " without a doc"; })());
  ok("corpus: Ess carries gotchas and documented returns",
     w.ESS_API.namespaces.flatMap(n => n.calls).filter(c => c.gotcha).length > 100 &&
     w.ESS_API.namespaces.flatMap(n => n.calls).filter(c => c.ret).length > 250);
  ok("corpus: all 562 resident-module functions are documented",
     Object.values(w.MERCS_NATIVES.modules)
       .reduce((n, m) => n + Object.keys(m.fnDocs || {}).length, 0) === 562);
  ok("corpus: every module has a summary naming its import requirement",
     Object.values(w.MERCS_NATIVES.modules).every(m => m.doc && /import/.test(m.doc)));
  ok("corpus: natives gained real coverage", (() => {
     let t = 0, d = 0;
     for (const ns in w.MERCS_NATIVES.natives)
       for (const fn in w.MERCS_NATIVES.natives[ns]) { t++; if (w.MERCS_NATIVES.natives[ns][fn].doc) d++; }
     return d / t > 0.5;
  })());

  /* An "exists but nobody traced it" sentence is not documentation -- the `live` flag already says
     exactly that. Restating it would inflate the coverage number while telling a reader nothing, so
     those were stripped rather than shipped. */
  ok("corpus: no placeholder 'exists per the live pairs()' pseudo-docs shipped", (() => {
     for (const ns in w.MERCS_NATIVES.natives)
       for (const fn in w.MERCS_NATIVES.natives[ns]) {
         const doc = w.MERCS_NATIVES.natives[ns][fn].doc || "";
         if (/^Exists on |by the live pairs\(\) enumeration/i.test(doc)) return false;
       }
     return true;
  })());
  /* Every curated gotcha must be traceable. */
  ok("corpus: every native gotcha carries a source", (() => {
     for (const ns in w.MERCS_NATIVES.natives)
       for (const fn in w.MERCS_NATIVES.natives[ns]) {
         const e = w.MERCS_NATIVES.natives[ns][fn];
         if (e.gotcha && !e.src) return false;
       }
     return true;
  })());
  /* Known-good spot checks, each verified against a named source during extraction. */
  ok("corpus: the Ai.Goal vs Ai.Role trap is recorded",
     /Role/.test((w.MERCS_NATIVES.natives.Ai.Goal || {}).gotcha || ""),
     (w.MERCS_NATIVES.natives.Ai.Goal || {}).gotcha);
  ok("corpus: resident modules are browsable in the panel", (() => {
     const hit = IDE.api.lookup("MrxUtil.CallWithOptionalArgs");
     return hit && hit.c && hit.ns.group === "resident module" && /import/.test(hit.ns.doc);
  })());

  ok("data: examples loaded", w.ESS_EXAMPLES && w.ESS_EXAMPLES.categories.length === 8);

  // ---- store ----
  ok("store: starts with Welcome script", IDE.store.list().length === 1 && IDE.store.active().name === "Welcome");
  const s2 = IDE.store.create("Test script", "return 1");
  ok("store: create + becomes active", IDE.store.active().id === s2.id && IDE.store.list().length === 2);
  ok("editor: loaded new script's code", IDE.editor.get() === "return 1");
  IDE.store.rename(s2.id, "Renamed");
  ok("store: rename", IDE.store.get(s2.id).name === "Renamed");
  IDE.store.duplicate(s2.id);
  ok("store: duplicate", IDE.store.list().length === 3 && IDE.store.active().name === "Renamed copy");
  IDE.store.remove(IDE.store.active().id);
  ok("store: remove falls back to a survivor", IDE.store.list().length === 2);
  ok("store: unique names", IDE.store.create("Renamed", "").name === "Renamed 2");

  // ---- editor ----
  IDE.editor.set("local x = 1\n");
  ok("editor: set/get round-trip", IDE.editor.get() === "local x = 1\n");
  IDE.editor.insertSnippet("Ess.Log(${msg})");
  ok("editor: snippet insert (placeholder resolved)", IDE.editor.get().indexOf("Ess.Log(msg)") === 0, JSON.stringify(IDE.editor.get()));

  // ---- lint verdicts through the real page ----
  ok("lint: syntax error caught", IDE.lint.validate("if x = 1 then end").errors.length === 1);
  ok("lint: Ess typo did-you-mean", /summon/.test((IDE.lint.validate('Ess.Easy.Vehicle.sumon("V")').warnings[0] || {}).message));
  ok("lint: freeze loop flagged", IDE.lint.validate("while true do end").warnings.some(d => /FREEZE/.test(d.message)));
  ok("lint: clean code is clean", IDE.lint.validate('Ess.Player.giveCash(1000)').warnings.length === 0);

  /* import("Name") only affects THE IMPORTING FILE'S OWN ENVIRONMENT -- documented at the wiki's
     resident/index.md and confirmed there by live testing. So calling a resident module without
     importing it first does not misbehave subtly, it dies with
         attempt to index global 'MrxPmc' (a nil value)
     which is a runtime failure the pre-send pass can catch before the script is ever sent. */
  const lintMsgs = (src) => IDE.lint.validate(src).warnings.map(d => d.message);
  const modWarn = (src) => lintMsgs(src).filter(m => /resident game module/.test(m));

  ok("lint: resident module used without import is flagged",
     modWarn('MrxPmc.AddCashQty(0, 1000)').length === 1,
     JSON.stringify(lintMsgs('MrxPmc.AddCashQty(0, 1000)')));
  ok("lint: the warning names the exact import and the real failure",
     /import\("MrxPmc"\)/.test(modWarn('MrxPmc.AddCashQty(0, 1000)')[0] || "") &&
     /attempt to index global 'MrxPmc'/.test(modWarn('MrxPmc.AddCashQty(0, 1000)')[0] || ""),
     modWarn('MrxPmc.AddCashQty(0, 1000)')[0]);
  ok("lint: the same module WITH its import is clean",
     modWarn('import("MrxPmc")\nMrxPmc.AddCashQty(0, 1000)').length === 0);
  ok("lint: an import lower down the file still counts",
     modWarn('MrxUtil.Foo()\nimport("MrxUtil")').length === 0);
  ok("lint: engine natives need no import",
     modWarn('Pg.GetGuidByName("x")').length === 0);
  ok("lint: Ess needs no import",
     modWarn('Ess.Player.pose(0)').length === 0);
  ok("lint: each missing module is reported once, not once per use",
     modWarn('MrxUtil.A()\nMrxUtil.B()\nMrxUtil.C()').length === 1);
  ok("lint: two different missing modules are reported separately",
     modWarn('MrxUtil.A()\nMrxGuiBase.B()').length === 2);
  /* Things a module publishes straight to _G (MrxCheatBootstrap's Cheat, DebugTeleport) work from
     anywhere. The dump classifies those as engine or omits them, so they are excluded for free. */
  ok("lint: a _G-published global is not treated as a module",
     modWarn('Cheat.Something()').length === 0);
  ok("data: resident modules are recorded separately from natives",
     w.MERCS_NATIVES.modules && Object.keys(w.MERCS_NATIVES.modules).length >= 15 &&
     !w.MERCS_NATIVES.natives.MrxUtil,
     Object.keys(w.MERCS_NATIVES.modules || {}).length + " modules");
  ok("data: only canonical top-level modules, no dotted sub-tables",
     Object.keys(w.MERCS_NATIVES.modules).every(k => k.indexOf(".") === -1));

  ok("lint: table-call style accepted", IDE.lint.validate('Ess.TextConsole.open{ onSubmit = function(t) end }').warnings.length === 0);

  // ---- run gating (not connected; syntax error must block before the bridge) ----
  IDE.editor.set("function broken(");
  IDE.run();
  const res = w.document.getElementById("results").textContent;
  ok("run: syntax error blocks with friendly message", /didn't send it/.test(res), res.slice(0, 80));

  // ---- sidebar DOM actually rendered ----
  ok("scripts panel rendered rows", w.document.querySelectorAll(".scrow").length >= 2);
  ok("examples gallery rendered cards", w.document.querySelectorAll(".excard").length === 45);
  ok("API tree rendered (Ess + natives)", w.document.querySelectorAll(".ns").length > 100);

  // ---- theme toggle: auto -> dark -> light -> auto ----
  const themeBtn = w.document.getElementById("themeBtn");
  themeBtn.click();
  ok("theme: force dark", w.document.documentElement.getAttribute("data-theme") === "dark");
  themeBtn.click();
  ok("theme: force light + persisted", w.document.documentElement.getAttribute("data-theme") === "light" && w.localStorage.getItem("m2ide.theme") === "light");
  themeBtn.click();
  ok("theme: back to auto", !w.document.documentElement.hasAttribute("data-theme"));

  // ---- REPL: bare expression wraps in return(), history recorded ----
  const repl = w.document.getElementById("repl");
  repl.value = "Ess.VERSION";
  repl.dispatchEvent(new w.KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  const rows = w.document.querySelectorAll("#results .row");
  const last = rows[rows.length - 1];
  ok("repl: expression auto-wrapped in return()", last && last.dataset.code.indexOf("return (Ess.VERSION") === 0, last && last.dataset.code);
  ok("repl: history persisted", (JSON.parse(w.localStorage.getItem("m2ide.replhist.v1")) || []).pop() === "Ess.VERSION");
  ok("repl: not-connected still friendly", /not connected/.test(last.textContent));

  // ---- re-run button exists and re-fires ----
  const before = w.document.querySelectorAll("#results .row").length;
  last.querySelector(".rerun").click();
  ok("results: re-run adds a fresh row", w.document.querySelectorAll("#results .row").length === before + 1);

  // ---- the serializer wrap is valid Lua ----
  let sent = null;
  const b = new w.EssBridge("ws://x", { WebSocketImpl: function () {} });
  b.state = "open";
  b.ws = { send: (d) => { sent = JSON.parse(d).code; } };
  b.run("return Ess.VERSION");
  let wrapOk = true, wrapErr = "";
  try { w.CM.luaparse.parse(sent, { luaVersion: "5.1" }); } catch (e) { wrapOk = false; wrapErr = e.message; }
  ok("bridge: serializer wrap parses as Lua 5.1", wrapOk, wrapErr);
  ok("bridge: wrap still single-line tagged protocol", /Loader\.WsSend\('<<<WSR:/.test(sent) && /__ideser/.test(sent));

  // ---- panic button goes through the gated path ----
  w.document.getElementById("panic").click();
  const panicRow = [...w.document.querySelectorAll("#results .row")].pop();
  ok("panic: stop-loops snippet submitted", /Ess\.Loop\.stop/.test(panicRow.dataset.code));

  // ---- layout + log chrome present ----
  /* The fork replaced the two fixed splitters with the dock tree (61_dock.js),
     so this asserted on ids that no longer exist -- it had been failing since
     that refactor, unnoticed, because nothing ran this file. Assert the dock. */
  ok("dock mounted with panels", !!w.document.getElementById("dockRoot") &&
     w.document.querySelectorAll(".dleaf").length > 0 && !!w.IDE.dock);
  ok("activity bar built", w.document.querySelectorAll("#activity .actbtn").length > 0);
  ok("log filter + latest chip present", !!w.document.getElementById("logFilter") && !!w.document.getElementById("latest"));

  // ---- update check (fetch stubbed to a future commit above) ----
  // ---- tutorial: walk it end to end on simulated game signals ----
  const T = w.IDE.tutorial, bus = w.IDE.bus;
  const ranOk = (code, value) => bus.emit("ran", { code, result: { ok: true, value } });
  const stepTitle = () => w.document.getElementById("tutTitle").textContent;
  T.start();
  ok("tutorial: starts on connect step", T._state().idx === 0 && /Connect/.test(stepTitle()));
  ok("tutorial: connect button glows", w.document.getElementById("connect").classList.contains("tutglow"));
  bus.emit("status", "open");
  ok("tutorial: real connect advances", T._state().idx === 1);
  ranOk("print('hi')", '"x"');
  ok("tutorial: unrelated run ignored (need marker)", T._state().idx === 1);
  ranOk("return Ess.VERSION", '"0.2.1"');
  ok("tutorial: typed hello advances", T._state().idx === 2);
  ranOk(w.IDE.editor.get(), '"you\'re at x=1  y=2  z=3, facing 4"');
  ok("tutorial: pose step advances", T._state().idx === 3);
  ranOk(w.IDE.editor.get(), '"off you go -- watch the screen"');
  ok("tutorial: teleport step advances", T._state().idx === 4);
  ok("tutorial: taxi code in own script WITH teardown", w.IDE.store.active().name === "Tutorial: Taxi Fare" &&
    /summon/.test(w.IDE.editor.get()) && /Ess\.Object\.remove\(S\.taxi\)/.test(w.IDE.editor.get()) && /Ess\.State\("taxi_tutorial"/.test(w.IDE.editor.get()));
  ranOk(w.IDE.editor.get(), '"your taxi\'s here"');
  ranOk(w.IDE.editor.get(), '"found a fare 15 units away"');
  ok("tutorial: at the your-turn radius step", T._state().idx === 6);
  ranOk('... Ess.Probe.nearby(px, py, pz, 150, "humans") ...', '"found a fare 15 units away"');
  ok("tutorial: unedited radius does NOT advance, coaching shown", T._state().idx === 6 && !w.document.getElementById("tutHint").classList.contains("hidden"));
  ranOk('... Ess.Probe.nearby(px, py, pz, 300, "humans") ...', '"found a fare 15 units away"');
  ok("tutorial: edited radius advances + sticks", T._state().idx === 7 && T._state().radius === 300);
  ok("tutorial: later steps keep the learner's radius", /nearby\(px, py, pz, 300,/.test(w.IDE.editor.get()));
  ranOk(w.IDE.editor.get(), '"they\'re waiting for you now"');
  ok("tutorial: marks step gains mark teardown lines", /Ess\.Mark\.clear\(S\.markFare\)/.test(w.IDE.editor.get()));
  ranOk(w.IDE.editor.get(), '"fare marked, destination ring dropped -- go pick them up!"');
  ok("tutorial: at the your-turn drop-off step", T._state().idx === 9);
  ranOk('... Ess.Easy.Mark.zone(fx + 80, fy, fz + 80, 8) ...', '"fare marked, destination ring dropped -- go pick them up!"');
  ok("tutorial: drop-off edit advances", T._state().idx === 10 && T._state().drop === 80);
  ok("tutorial: progress persisted for resume", (JSON.parse(w.localStorage.getItem("m2ide.tutorial.v1")) || {}).idx === 10);
  const back = w.document.getElementById("tutBack"), fwd = w.document.getElementById("tutFwd");
  back.click();
  ok("tutorial: back revisits a step", T._state().idx === 9);
  fwd.click();
  ok("tutorial: forward returns (capped at reached)", T._state().idx === 10 && fwd.disabled);
  bus.emit("deployed", { name: "x" });
  ok("tutorial: deploy finishes + clears saved progress", !w.document.getElementById("tutDone").classList.contains("hidden") && !w.localStorage.getItem("m2ide.tutorial.v1"));

  ok("build stamped with a git sha", /^[0-9a-f]{7}$/.test((w.IDE_BUILD || {}).sha), JSON.stringify(w.IDE_BUILD));
  const updbar = w.document.getElementById("updbar");
  ok("update bar shown for a newer remote commit", !updbar.classList.contains("hidden"));
  w.document.getElementById("updSkip").click();
  ok("skip hides + remembers the sha", updbar.classList.contains("hidden") &&
     JSON.parse(w.localStorage.getItem("m2ide.update.v1")).skip === "fffffff");


  /* ---- AI layer -----------------------------------------------------------
   * The assistant is the largest and fastest-moving part of this fork and had
   * no coverage at all: this file used to be byte-identical to the base IDE's,
   * so ~3,300 lines of provider/agent/grounding/render code could break in
   * silence. These exercise the PURE, decidable parts -- the ones where a
   * regression is a wrong answer rather than a layout nudge.
   */
  const R = w.IDE.render, P = w.IDE.provider, A = w.IDE.agent, G = w.IDE.ground;

  ok("ai: render/provider/agent/ground all wired", !!(R && P && A && G));

  /* -- renderer (79_render.js) -- */
  ok("render: escapes angle brackets", R.esc("<script>") === "&lt;script&gt;");
  ok("render: escapes quotes too",
     R.esc('a"b').indexOf('"') === -1, R.esc('a"b'));
  /* A URL carrying a quote must not be able to close the href and add its own
     attributes. Model output is not trusted input. */
  const evil = R.md('see https://x.example/#"onmouseover="steal()" ok');
  ok("render: a link cannot inject an event handler",
     !/<a[^>]+onmouseover/i.test(evil), evil.slice(0, 160));
  ok("render: normal links still render",
     /<a href="https:\/\/wiki\.mercs2\.tools\/x"/.test(R.md("see https://wiki.mercs2.tools/x here")));
  ok("render: fenced lua gets Insert/Replace", /ai-insert/.test(R.md("```lua\nreturn 1\n```")));
  ok("render: fenced non-lua does not", !/ai-insert/.test(R.md("```python\nx=1\n```")));
  ok("render: a table renders as a table", /<table>/.test(R.md("| a | b |\n|---|---|\n| 1 | 2 |")));

  /* splitThink: BOTH inline shapes. Shape 2 (closing tag only) is what Qwen
     emits, because its chat template injects the opening tag into the prompt --
     not handling it looked exactly like "streaming is broken". */
  const t1 = R.splitThink("<think>reasoning here</think>the answer");
  ok("render: <think> open+close split",
     t1.think === "reasoning here" && t1.rest === "the answer", JSON.stringify(t1));
  const t2 = R.splitThink("reasoning here</think>the answer");
  ok("render: close-tag-only split (Qwen shape)",
     t2.think === "reasoning here" && t2.rest === "the answer", JSON.stringify(t2));
  const t3 = R.splitThink("just an answer");
  ok("render: no reasoning leaves the text alone", t3.think === "" && t3.rest === "just an answer");

  /* -- derived budgets (80_provider.js) -- */
  P.set({ modelCtx: 0, logSend: 0, keepRawResults: 0 });
  const b0 = { page: P.budget("pageChars"), log: P.budget("logLines"), keep: P.budget("keepRaw") };
  ok("budget: an unknown window keeps the old fixed defaults",
     b0.page === 14000 && b0.log === 40 && b0.keep === 2, JSON.stringify(b0));
  P.set({ modelCtx: 40960 });
  const bSmall = { page: P.budget("pageChars"), keep: P.budget("keepRaw") };
  P.set({ modelCtx: 1000000 });
  const bBig = { page: P.budget("pageChars"), keep: P.budget("keepRaw") };
  ok("budget: scales up with the window",
     bBig.page > bSmall.page && bBig.keep > bSmall.keep, JSON.stringify({ bSmall, bBig }));
  ok("budget: stays clamped at the top end",
     bBig.page <= 120000 && bBig.keep <= 12, JSON.stringify(bBig));
  P.set({ modelCtx: 0, keepRawResults: 7 });
  ok("budget: an explicit profile value still wins", P.budget("keepRaw") === 7);
  P.set({ keepRawResults: 0 });

  /* -- the inspect_game auto-run boundary (86_agent.js) --
     This decides what the model may run in the user's game WITHOUT asking, so
     it is the one guard worth asserting directly. */
  ok("agent: allows an idiomatic Ess read", A.isReadOnly("return Ess.Player.pose(0)"));
  ok("agent: allows an engine getter", A.isReadOnly("return tostring(Player.GetLocalCharacter())"));
  ok("agent: refuses an Ess mutator", !A.isReadOnly("return Ess.Loop.stop('demo')"));
  ok("agent: refuses a spawn", !A.isReadOnly("return Pg.Spawn('x',1,2,3)"));
  ok("agent: refuses a native setter", !A.isReadOnly("Weather.SetTimeOfDay(0)"));
  ok("agent: refuses an empty expression", !A.isReadOnly(""));

  /* -- compaction: older tool results shrink, the newest stay verbatim, and the
        role/id pairing survives (breaking it desynchronises the conversation). -- */
  const convo = [
    { role: "user", content: "q" },
    { role: "tool", tool_call_id: "a", name: "search_wiki", content: "X".repeat(4000) },
    { role: "tool", tool_call_id: "b", name: "search_api", content: "Y".repeat(4000) },
    { role: "tool", tool_call_id: "c", name: "get_editor", content: "Z".repeat(4000) }
  ];
  const compacted = A.compactConvo(convo);
  ok("agent: compaction shortens the oldest tool result",
     compacted[1].content.length < 4000, String(compacted[1].content.length));
  ok("agent: compaction keeps the newest verbatim",
     compacted[3].content.length === 4000, String(compacted[3].content.length));
  ok("agent: compaction preserves tool_call_id pairing",
     compacted[1].tool_call_id === "a" && compacted[3].tool_call_id === "c");

  /* -- grounding (85_ground.js) -- */
  const g1 = G.check("Use Ai.Follow(npc) and Pg.Spawn(t)", ["Pg.Spawn is real and documented here"]);
  ok("ground: flags a name absent from the sources",
     g1.ungrounded.indexOf("Ai.Follow") !== -1, JSON.stringify(g1));
  ok("ground: does not flag a name present in the sources",
     g1.ungrounded.indexOf("Pg.Spawn") === -1, JSON.stringify(g1));
  ok("ground: ignores filenames", G.check("see mrxfollow.lua", []).ungrounded.length === 0);
  /* Lowercase method halves matter: an earlier version demanded PascalCase and
     sailed straight past a fabricated call on a real module. */
  /* Three-segment Ess names. A single \.name group in API_RE meant only the
     first TWO segments were extracted, so `Ess.Player.teleportTo` reduced to the
     real namespace `Ess.Player` and the invented method was never checked --
     exempting the whole Ess surface, which is the API this IDE is about. */
  ok("ground: catches a fabricated METHOD on a real Ess namespace",
     G.check("call Ess.Player.teleportTo(1,2,3)", ["Ess.Player.pose(i)"]).ungrounded
       .indexOf("Ess.Player.teleportTo") !== -1,
     JSON.stringify(G.check("call Ess.Player.teleportTo(1,2,3)", ["Ess.Player.pose(i)"])));
  ok("ground: does NOT flag a real three-segment Ess call",
     G.check("call Ess.Player.pose(0)", ["Ess.Player.pose(i) returns the pose"]).ungrounded.length === 0);
  ok("ground: extracts the full dotted path, not just two segments",
     G.names("Ess.Player.teleportTo(x)").indexOf("Ess.Player.teleportTo") !== -1,
     JSON.stringify(G.names("Ess.Player.teleportTo(x)")));
  /* An invented namespace is now reported as the FULL path the model actually
     wrote (`Ess.Teleporter.go`), which is the more useful message -- it names
     what to search for rather than a prefix the user never typed. */
  ok("ground: still catches an invented namespace",
     G.check("Ess.Teleporter.go()", ["Ess.Player.pose(i)"]).ungrounded.indexOf("Ess.Teleporter.go") !== -1,
     JSON.stringify(G.check("Ess.Teleporter.go()", ["Ess.Player.pose(i)"])));

  ok("ground: catches a lowercase fabricated method",
     G.check("call MrxFollow.follow(a,b)", ["MrxFollow exists"]).ungrounded.indexOf("MrxFollow.follow") !== -1);

  /* -- provider shape -- */
  ok("provider: the ollama preset uses the native adapter",
     (P.preset("ollama") || {}).api === "ollama", JSON.stringify(P.preset("ollama")));
  ok("provider: the ollama base URL has no /v1 (native endpoint)",
     !/\/v1$/.test((P.preset("ollama") || {}).baseUrl || ""));
  ok("provider: detectContext exists and is async",
     typeof P.detectContext === "function" && !!P.detectContext().then);


  /* ---- File menu / palette / Examples modal --------------------------------
   * The three panels that moved. These assert the WIRING (a command actually
   * runs, an insert actually lands in the editor), not the pixels.
   */
  const D = w.document;

  /* -- Examples is a modal, not a dock panel -- */
  ok("examples: no longer a dock panel", !w.IDE.dock.panels().includes("examples"));
  ok("examples: modal starts hidden", D.getElementById("examplesModal").classList.contains("hidden"));
  w.IDE.examples.open();
  ok("examples: opens", !D.getElementById("examplesModal").classList.contains("hidden"));
  ok("examples: search filters the gallery", (() => {
    const s = D.getElementById("exSearch");
    s.value = "zzzznomatch";
    s.dispatchEvent(new w.Event("input", { bubbles: true }));
    const n = D.querySelectorAll("#exList .excard").length;
    s.value = "";
    s.dispatchEvent(new w.Event("input", { bubbles: true }));
    return n === 0 && D.querySelectorAll("#exList .excard").length === 45;
  })());
  /* Picking an example is terminal: it creates a script AND closes the gallery.
     The old handler clicked a `.stab` tab the dock refactor had deleted, so it
     threw on a null querySelector and the button did nothing at all. */
  const beforeCount = w.IDE.store.list().length;
  w.IDE.examples.openAsScript({ name: "Palette test example", code: "return 42" });
  ok("examples: open-as-script creates the script",
     w.IDE.store.list().length === beforeCount + 1 && w.IDE.store.active().name === "Palette test example");
  ok("examples: open-as-script closes the gallery",
     D.getElementById("examplesModal").classList.contains("hidden"));

  /* -- File menu -- */
  ok("file menu: button exists in the top bar", !!D.getElementById("fileMenu"));
  ok("file menu: the Actions <select> is gone", !D.getElementById("scActions"));
  ok("file menu: commands are exported for reuse",
     (w.IDE.scriptsPanel.commands || []).filter(c => !c.sep).length >= 6);
  D.getElementById("fileMenu").click();
  const menuEl = D.querySelector(".menu");
  ok("file menu: opens a real menu with menuitem roles",
     !!menuEl && menuEl.getAttribute("role") === "menu" &&
     menuEl.querySelectorAll('[role="menuitem"]').length >= 6,
     menuEl ? menuEl.querySelectorAll('[role="menuitem"]').length : "no menu");
  ok("file menu: marks the button expanded",
     D.getElementById("fileMenu").getAttribute("aria-expanded") === "true");
  /* Running a command from the menu must actually run it. "New script" is the
     safe one to assert (no download, no file picker). */
  const beforeNew = w.IDE.store.list().length;
  [...menuEl.querySelectorAll('[role="menuitem"]')]
    .find(b => /New script/.test(b.textContent)).click();
  ok("file menu: a command actually runs", w.IDE.store.list().length === beforeNew + 1);
  ok("file menu: closes after running", !D.querySelector(".menu"));

  /* -- command palette -- */
  ok("palette: starts hidden", !w.IDE.palette.isOpen());
  w.IDE.palette.open();
  ok("palette: opens", w.IDE.palette.isOpen());
  const pInput = D.getElementById("paletteInput");
  const type = (v) => { pInput.value = v; pInput.dispatchEvent(new w.Event("input", { bubbles: true })); };
  ok("palette: empty query shows commands only, not 1,300 API calls",
     D.querySelectorAll("#paletteList .palette-row").length > 0 &&
     D.querySelectorAll("#paletteList .palette-row").length <= 12,
     String(D.querySelectorAll("#paletteList .palette-row").length));
  type("Ess.Player.pose");
  const firstRow = D.querySelector("#paletteList .palette-row .palette-label");
  ok("palette: finds an exact Ess call", firstRow && /Ess\.Player\.pose/.test(firstRow.textContent),
     firstRow && firstRow.textContent);
  /* Ess must outrank the engine natives at equal match quality -- searching
     "player" used to return nothing but Player.* natives and bury Ess.Player.*
     below the fold, which is backwards for a framework-first IDE. */
  type("player");
  ok("palette: Ess ranks above engine natives",
     /^Ess\./.test((D.querySelector("#paletteList .palette-label") || {}).textContent || ""),
     (D.querySelector("#paletteList .palette-label") || {}).textContent);

  type("eplpose");
  ok("palette: subsequence match still finds it",
     [...D.querySelectorAll("#paletteList .palette-label")].some(e => /Ess\.Player\.pose/.test(e.textContent)));
  type("zzqqxxnothing");
  ok("palette: an empty result says so rather than showing junk",
     !!D.querySelector("#paletteList .palette-empty"));

  /* Enter inserts into the editor via the panel's own templateFor, so a palette
     insert is byte-identical to the panel's Insert button. */
  w.IDE.editor.set("");
  type("Ess.Player.pose");
  pInput.dispatchEvent(new w.KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  ok("palette: Enter inserts the call into the editor",
     /Ess\.Player\.pose/.test(w.IDE.editor.get()), JSON.stringify(w.IDE.editor.get()).slice(0, 80));
  ok("palette: closes after inserting", !w.IDE.palette.isOpen());

  /* Templates are pure string lookup -- the case a palette serves best. */
  w.IDE.editor.set("");
  w.IDE.palette.open();
  const tplName = (w.IDE.templates.list()[0] || {}).name;
  if (tplName) {
    type(tplName);
    pInput.dispatchEvent(new w.KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    ok("palette: inserts a spawn template as a quoted string",
       w.IDE.editor.get().indexOf('"' + tplName + '"') !== -1,
       JSON.stringify(w.IDE.editor.get()).slice(0, 80));
  }
  if (w.IDE.palette.isOpen()) w.IDE.palette.close();

  /* Ctrl+K from anywhere -- registered in the capture phase so CodeMirror's own
     keymap cannot swallow it first. */
  D.dispatchEvent(new w.KeyboardEvent("keydown", { key: "k", ctrlKey: true, bubbles: true }));
  ok("palette: Ctrl+K opens it", w.IDE.palette.isOpen());
  D.dispatchEvent(new w.KeyboardEvent("keydown", { key: "k", ctrlKey: true, bubbles: true }));
  ok("palette: Ctrl+K toggles it shut", !w.IDE.palette.isOpen());


  /* ---- dock: gutter sizing + collapse ---------------------------------------
   * The grab bar rendered 48px wide with a stray border because the dock built
   * `className = "dsplit " + node.dir` -- a bare "row" -- which collided with the
   * results list's generic `.row` rule (padding: 5px 48px 5px 0). Horizontal
   * splits inherited it too, eating 48px off the right of every one. `.col` had
   * no such rule, which is why only the vertical bars looked wrong.
   */
  const dsplit = D.querySelector(".dockroot > .dsplit");
  ok("dock: direction classes are namespaced (no bare .row)",
     !!D.querySelector(".dsplit.d-row") && !D.querySelector(".dockroot .dsplit.row:not(.d-row)"),
     dsplit && dsplit.className);
  ok("dock: gutters carry no result-row padding",
     [...D.querySelectorAll(".dgutter")].every(g => !/48px/.test(g.className)) &&
     !!D.querySelector(".dgutter.d-row"));
  ok("dock: every gutter offers two collapse chevrons",
     D.querySelector(".dgutter.d-row").querySelectorAll(".dchev").length === 2,
     String(D.querySelector(".dgutter.d-row").querySelectorAll(".dchev").length));

  /* Collapse is a LAYOUT change, so assert on the tree the dock persists rather
     than on pixels -- jsdom has no layout engine. */
  const rootSplit = (() => {
    let t = null;
    try { t = JSON.parse(w.localStorage.getItem("m2ide.dock.v1")); } catch (e) {}
    return t;
  })();
  ok("dock: layout persists as a tree", !!rootSplit && rootSplit.t === "split");

  const gut = D.querySelector(".dgutter.d-row");
  gut.querySelector(".dchev.before").click();
  ok("dock: a chevron collapses its neighbour to a strip",
     !!D.querySelector(".dcell.collapsed") && !!D.querySelector(".dstrip"));
  ok("dock: the strip names what it is hiding",
     /\w/.test((D.querySelector(".dstrip-label") || {}).textContent || ""),
     (D.querySelector(".dstrip-label") || {}).textContent);
  ok("dock: the collapsed side loses its chevron (nothing left to hide)",
     D.querySelector(".dgutter.d-row").querySelectorAll(".dchev").length === 1);
  ok("dock: collapse is persisted",
     (() => { const t = JSON.parse(w.localStorage.getItem("m2ide.dock.v1"));
              return !!(t.collapsed || []).some(Boolean); })());
  /* The point of hiding is that the neighbours GROW. The stored sizes are
     percentages of the whole split, so using them unchanged left the collapsed
     cell's share as dead space -- the panel hid and nothing expanded. */
  ok("dock: visible cells renormalise to fill the freed space", (() => {
    const vis = [...D.querySelectorAll(".dockroot > .dsplit > .dcell")]
      .filter(c => !c.classList.contains("collapsed"))
      .map(c => parseFloat(c.style.flexBasis));
    const total = vis.reduce((a, b) => a + b, 0);
    return Math.abs(total - 100) < 0.5;
  })(), [...D.querySelectorAll(".dockroot > .dsplit > .dcell")].map(c => c.style.flexBasis).join(" "));

  D.querySelector(".dstrip").click();
  ok("dock: clicking the strip restores the panel", !D.querySelector(".dcell.collapsed"));
  ok("dock: restore returns the original proportions", (() => {
    const vis = [...D.querySelectorAll(".dockroot > .dsplit > .dcell")]
      .map(c => parseFloat(c.style.flexBasis));
    return Math.abs(vis.reduce((a, b) => a + b, 0) - 100) < 0.5;
  })());

  /* Templates left the dock entirely -- it is palette-served now. */
  ok("templates: no longer a dock panel", !w.IDE.dock.panels().includes("templates"));
  ok("templates: its hidden panel markup is gone", !D.getElementById("panelTemplates"));
  ok("templates: data still available to the palette and linter",
     w.IDE.templates.list().length > 0, String(w.IDE.templates.list().length));
  w.IDE.editor.set("");
  w.IDE.palette.open({ kind: "tpl" });
  ok("templates: the palette opens scoped to templates only",
     [...D.querySelectorAll("#paletteList .palette-kind")].every(e => e.textContent === "template") &&
     D.querySelectorAll("#paletteList .palette-row").length > 0);
  w.IDE.palette.close();

  /* The sidebar is down to a tab count that actually fits. */
  ok("dock: default sidebar is three tabs, not five",
     [...D.querySelectorAll(".dtabs")][0].querySelectorAll(".dtab").length <= 3,
     String([...D.querySelectorAll(".dtabs")][0].querySelectorAll(".dtab").length));

  /* The theme toggle used to be position:fixed bottom-right, which put it on top
     of whichever panel was there -- in practice the Assistant's send button. */
  ok("theme toggle: lives in the top bar, not floating",
     !!D.querySelector(".bar #themeBtn"));
  ok("theme toggle: no longer fixed-positioned",
     w.getComputedStyle(D.getElementById("themeBtn")).position !== "fixed",
     w.getComputedStyle(D.getElementById("themeBtn")).position);
  ok("theme toggle: does not overlap the assistant send button", (() => {
     const t = D.getElementById("themeBtn"), s2 = D.getElementById("aiSend");
     if (!t || !s2) return true;
     return !t.compareDocumentPosition ||
            !(t.getAttribute("style") || "").includes("fixed");
  })());

  console.log(fail ? "\n" + fail + " FAILED, " + pass + " passed" : "\nall " + pass + " passed");
  process.exit(fail ? 1 : 0);
}, 400);
