/* 50_api.js -- the API panel. Three provenances, and the panel says which:
     * the Ess reference (window.ESS_API, generated from Ess's own api/ess.json -- see tools/gen_api.py)
     * the engine's C++ natives (window.MERCS_NATIVES.natives, a live _G dump merged with a scrape of the
       decompiled base-game scripts, so most carry a real call site and observed argument counts)
     * the lua-bridge's OWN functions (Loader.*), which the dump reports as engine because the walk runs
       over the bridge -- corrected in gen_natives.py and badged separately here
   Clicking a call opens the doc pane -- signature, tier badge, what the namespace is for, a real example
   for natives -- with an Insert button that drops it in as a tab-through snippet. The completion list the
   editor consumes also lives here. */
(function () {
  var IDE = window.IDE, data = window.ESS_API || { namespaces: [], completions: [] };
  var natives = (window.MERCS_NATIVES && window.MERCS_NATIVES.natives) || {};
  var tree = IDE.$("apiTree"), search = IDE.$("apiSearch"), docEl = IDE.$("apiDoc");

  /* ---- one merged model: Ess namespaces first, then the engine's own ---- */
  var MODEL = data.namespaces.map(function (ns) {
    return { name: ns.name, group: ns.group || "", doc: ns.doc || "", calls: ns.calls };
  });
  /* Provenance, from gen_natives.py. The live dump is a pairs(_G) walk taken over the lua-bridge, so
     the globals Lua_Loader.asi injects sit in _G next to the real C++ natives and arrive labelled
     `engine`. `Loader` is that whole surface -- calling it "the engine's own functions, as the base
     game's scripts actually use them" was wrong twice: it is the bridge's API, and no base-game script
     references it at all. */
  var KINDS = (window.MERCS_NATIVES && window.MERCS_NATIVES.kinds) || {};
  var NSDOCS = (window.MERCS_NATIVES && window.MERCS_NATIVES.nsDocs) || {};
  Object.keys(natives).sort().forEach(function (nsName) {
    var members = natives[nsName];
    var bridge = KINDS[nsName] === "bridge";
    MODEL.push({
      name: nsName, group: bridge ? "lua-bridge" : "game native", native: true, bridge: bridge,
      doc: NSDOCS[nsName] || (bridge
        ? "Added by the lua-bridge mod (Lua_Loader.asi), not by the game — these exist only while the bridge is loaded, which is exactly when you are running scripts from this IDE."
        : "The engine's own " + nsName + ".* functions, as the base game's scripts actually use them. Lower-level than Ess — check the example call sites."),
      calls: Object.keys(members).sort().map(function (fn) {
        var e = members[fn];
        /* A curated signature wins over an example call: for Loader.* there IS no example (no
           base-game script calls the bridge), and where both exist the signature names the
           arguments while the example just shows one invocation. */
        return { path: nsName + "." + fn, sig: e.sig || e.example || nsName + "." + fn + "(…)", native: e };
      })
    });
  });

  /* Bare globals have no namespace to sit under, so they get one synthetic entry rather than a fake
     namespace prefix -- `assert(v)` is called as `assert`, not `globals.assert`, and the panel must not
     imply otherwise. Listed last so it never displaces a real namespace at the top of the tree. */
  var GLOBALS = (window.MERCS_NATIVES && window.MERCS_NATIVES.globals) || {};
  if (Object.keys(GLOBALS).length) {
    MODEL.push({
      name: "(globals)", group: "lua-bridge", native: true, bridge: true,
      doc: "Functions with no namespace at all — called by bare name. Added by lua-bridge to fill gaps in this game's stripped Lua runtime.",
      calls: Object.keys(GLOBALS).sort().map(function (name) {
        var g = GLOBALS[name];
        return { path: name, sig: g.sig || name + "(…)", native: { doc: g.doc, sig: g.sig, global: 1 } };
      })
    });
  }

  function tierOf(path, native) {
    /* A Loader.* call is not a native -- badging it "Native" repeats the same mislabel the
       dump introduced (see KINDS above). */
    if (native) {
      return KINDS[String(path).split(".")[0]] === "bridge"
        ? ["bridge", "lua-bridge"] : ["native", "Native"];
    }
    if (path.indexOf("Ess.Easy") === 0) return ["easy", "Easy — guardrails on"];
    if (path.indexOf("Ess.Raw") === 0) return ["raw", "Raw — building blocks"];
    return ["core", "Core"];
  }

  /* ---- doc pane ---- */
  function esc(s) { return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
  function showDoc(ns, c) {
    var tier = tierOf(c.path, !!c.native), html = "";
    html += '<div class="sig">' + esc(c.sig) + "</div>";
    html += '<span class="tier ' + tier[0] + '">' + esc(tier[1]) + "</span>";
    /* per-call doc (wiki-sourced, what THIS function actually does) takes priority; the namespace doc
       (what the whole namespace is FOR) shows as a smaller secondary note when a per-call doc exists,
       or as the main doc when it doesn't -- the pre-per-call-doc fallback. */
    var callDoc = c.doc || (c.native && c.native.doc);
    if (callDoc) html += '<div class="doc">' + esc(callDoc) + "</div>";
    /* What the call RETURNS, when the source documented it. */
    var ret = c.ret || (c.native && c.native.ret);
    if (ret) html += '<div class="retline"><b>returns</b> ' + esc(ret) + "</div>";
    /* The gotcha goes right under the description, not at the bottom. This engine fails silently far
       more often than it errors -- a getter returning 1/0 so `not x` never flips, a call that is async,
       a name one letter from a different function -- so the warning IS the useful part, and burying it
       below the fold defeats it. */
    var got = c.gotcha || (c.native && c.native.gotcha);
    if (got) html += '<div class="gotcha"><b>Watch out</b> ' + esc(got) + "</div>";
    if (ns.doc) html += '<div class="' + (callDoc ? "nsnote" : "doc") + '">' + esc(ns.doc) + "</div>";
    if (c.native) {
      html += '<div class="doc">The game’s own scripts call this ' + c.native.n + "×" +
              (c.native.min != null ? ", always with " + (c.native.min === c.native.max ? c.native.min : c.native.min + "–" + c.native.max) + " argument" + (c.native.max === 1 ? "" : "s") : "") + ".</div>";
      if (c.native.example) html += '<div class="exlabel">a real call from the game:</div><div class="ex">' + esc(c.native.example) + "</div>";
    }
    html += '<button class="btn small go" id="apiInsert">Insert into script</button>';
    docEl.innerHTML = html;
    docEl.classList.remove("hidden");
    IDE.$("apiInsert").onclick = function () { IDE.editor.insertSnippet(templateFor(c)); };
  }

  /* insert form: Ess calls use the documented arg names; natives use the real example's args as
     placeholder names (Object.AddLabel(uGuid, "Prisoner") -> ${uGuid}, ${Prisoner}) */
  function templateFor(c) {
    if (!c.native) return IDE.callTemplate(c);
    /* math.pi / math.huge are values, not functions -- inserting "math.pi(${})" would be nonsense. */
    if (c.native.const) return c.path;
    if (c.native.global) return IDE.callTemplate({ path: c.path, sig: c.sig });
    var m = /\(([^]*)\)$/.exec(c.native.example || "");
    var args = m && m[1].trim() ? m[1].split(",").map(function (a) {
      return "${" + (a.trim().replace(/[^\w .:-]/g, "").trim() || "arg") + "}";
    }) : [];
    return c.path + "(" + (args.length ? args.join(", ") : "${}") + ")";
  }

  /* ---- the tree ---- */
  function build(filter) {
    filter = (filter || "").trim().toLowerCase();
    tree.innerHTML = "";
    MODEL.forEach(function (ns) {
      var nsHit = ns.name.toLowerCase().indexOf(filter) >= 0;
      var calls = ns.calls.filter(function (c) { return !filter || nsHit || c.path.toLowerCase().indexOf(filter) >= 0; });
      if (filter && !nsHit && !calls.length) return;

      var open = !!filter;
      var nsEl = document.createElement("div"); nsEl.className = "ns" + (ns.native ? " nat" : "");
      nsEl.innerHTML = esc(ns.name) + '<span class="g">' + esc(ns.group) + "</span>";
      var wrap = document.createElement("div");
      function paint() {
        wrap.innerHTML = "";
        if (!open) return;
        if (ns.doc) { var d = document.createElement("div"); d.className = "nsdoc"; d.textContent = ns.doc; wrap.appendChild(d); }
        (filter ? calls : ns.calls).forEach(function (c) {
          var el = document.createElement("div"); el.className = "call";
          el.textContent = c.sig.replace(/^Ess\./, ""); el.title = c.sig + " — click for details";
          el.onclick = function () { showDoc(ns, c); };
          wrap.appendChild(el);
        });
      }
      nsEl.onclick = function () { open = !open; paint(); };
      tree.appendChild(nsEl); tree.appendChild(wrap); paint();
    });
    if (!tree.childElementCount) { var e = document.createElement("div"); e.className = "nsdoc"; e.textContent = "no matches"; tree.appendChild(e); }
  }

  /* lookup(path): exact-match a dotted call/namespace path against the merged model -- used by the
     editor's hover tooltip (20_editor.js) so it doesn't need its own copy of this data shape. */
  function lookup(path) {
    for (var i = 0; i < MODEL.length; i++) {
      var ns = MODEL[i];
      if (ns.name === path) return { ns: ns, c: null };
      for (var j = 0; j < ns.calls.length; j++) if (ns.calls[j].path === path) return { ns: ns, c: ns.calls[j] };
    }
    return null;
  }

  search.addEventListener("input", function () { build(search.value); });
  /* `model` and `templateFor` are exported for the command palette (66_palette.js),
     so palette insertion produces byte-identical snippets to the panel's own
     Insert button rather than a second implementation that can drift. */
  IDE.api = { completions: function () { return data.completions; }, build: build, lookup: lookup,
              tierOf: tierOf, model: function () { return MODEL; }, templateFor: templateFor };
  build("");
})();
