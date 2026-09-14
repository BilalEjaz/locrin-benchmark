/* 60_ui.js -- toolbar + chrome wiring: connect/disconnect, run/save/share, the sidebar's Scripts/Examples/API
   tabs, output tabs, onboarding, status dot, and the debounced autosave into the script library. */
(function () {
  var IDE = window.IDE, $ = IDE.$;

  function flash(btn, msg) { var o = btn.textContent; btn.textContent = msg; setTimeout(function () { btn.textContent = o; }, 1100); }
  function save() { IDE.store.saveActive(IDE.editor.get()); }

  IDE.bus.on("status", function (s) {
    $("dot").className = "dot " + s; $("state").textContent = s;
    $("connect").textContent = (s === "open" || s === "connecting") ? "Disconnect" : "Connect";
    if (s === "open") $("onboard").hidden = true;
  });

  $("connect").onclick = function () {
    var st = IDE.bridge.state();
    if (st === "open" || st === "connecting") { IDE.bridge.disconnect(); }
    else { try { localStorage.setItem(IDE.cfg.wsKey, $("url").value); } catch (e) {} IDE.bridge.connect($("url").value); }
  };
  $("run").onclick = function () { IDE.run(); };
  $("panic").onclick = function () {
    IDE.runCode('local n = 0\n' +
      'for id in pairs(Ess.Loop._reg) do Ess.Loop.stop(id) n = n + 1 end\n' +
      'if Ess.Time and Ess.Time.restoreScale then Ess.Time.restoreScale() end\n' +
      'return "stopped " .. n .. " loop(s), time scale restored"');
  };
  $("save").onclick = function () { save(); flash($("save"), "Saved"); };
  IDE.bus.on("save", function () { save(); flash($("save"), "Saved"); });
  $("share").onclick = function () {
    var code = IDE.editor.get(), name = IDE.store.active().name;
    /* LZ-string the payload (~3-4x more script per link) and carry the script name along -- #z= is the
       compressed form; #s= (plain encodeURIComponent, no name) is the old format, kept working forever
       as the fallback for any link minted before this shipped, or if LZString somehow isn't on window.CM. */
    var packed = (window.CM && CM.LZString) ? CM.LZString.compressToEncodedURIComponent(JSON.stringify({ n: name, c: code })) : null;
    var url = packed
      ? location.origin + location.pathname + "#z=" + packed
      : location.origin + location.pathname + "#s=" + encodeURIComponent(code);
    if (navigator.clipboard) navigator.clipboard.writeText(url).then(function () { flash($("share"), "Link copied"); }, function () { prompt("Copy this link:", url); });
    else prompt("Copy this link:", url);
  };

  /* "grab what I'm aiming at" -- one click instead of a docs hunt for "how do I get a guid". Not routed
     through IDE.runCode: this is a fixed, trusted snippet, not user code, so it skips the lint gate and
     just needs the connected check that gate would otherwise provide.

     A guid is Lua userdata -- tostring()-ing it directly gives an opaque, non-reusable "userdata: 0x...".
     Ess.Name(uGuid) (pcall-wrapped Sys.GuidToString) gives the real portable form, "0x0012B69E", and
     Sys.StringToGuid("0x0012B69E") reconstructs the identical handle (live-confirmed: same Ess.Object.health
     before/after) -- so what actually gets inserted is that reconstruct call, ready to paste straight into
     another Ess.Object.* / Ess.Probe.* call. Returns a table, not a tab-joined string: the bridge's
     serializer %q-quotes string returns, and %q escapes tabs into literal "\9" text, so a hand tab-joined
     string can never be split back apart client-side (see 05_lua.js). */
  $("grabTarget").onclick = function () {
    if (!IDE.bridge.connected()) { flash($("grabTarget"), "not connected"); return; }
    IDE.bridge.run(
      'local uGuid = Ess.Player.targetUnderReticle(0)\n' +
      'if not uGuid then return nil end\n' +
      'local descOk, desc = pcall(Ess.Probe.describeSafe, uGuid)\n' +
      'return { hex = Ess.Name(uGuid), desc = (descOk and desc) or nil }'
    ).then(function (r) {
      if (!r.ok || r.value == null || r.value === "nil") { flash($("grabTarget"), "nothing aimed at"); return; }
      var obj = IDE.lua.parseTable(String(r.value));
      if (!obj.hex) { flash($("grabTarget"), "couldn't name that guid"); return; }
      IDE.editor.insertSnippet('Sys.StringToGuid(' + IDE.lua.quote(obj.hex) + ')');
      flash($("grabTarget"), obj.desc ? (obj.desc.length > 34 ? obj.desc.slice(0, 34) + "…" : obj.desc) : "grabbed");
    });
  };

  /* Sidebar-panel switching used to live here (the .stab tabs). The dock
     (61_dock.js) + activity bar (63_shell.js) own panel visibility now, so this
     is gone. The output sub-tabs below stay: Results/Log/Watch are still an
     internal tabset inside the single "Output" dock panel. */

  /* output tabs */
  Array.prototype.forEach.call(document.querySelectorAll(".tab"), function (t) {
    t.onclick = function () {
      Array.prototype.forEach.call(document.querySelectorAll(".tab"), function (x) { x.classList.remove("on"); });
      t.classList.add("on");
      var which = t.getAttribute("data-t");
      $("results").classList.toggle("hidden", which !== "results");
      $("log").classList.toggle("hidden", which !== "log");
      $("logFilter").classList.toggle("hidden", which !== "log" && which !== "results");
      $("logFilter").placeholder = which === "results" ? "filter results…" : "filter the log…";
      $("hlRules").classList.toggle("hidden", which !== "log");
      $("wsToggle").classList.toggle("hidden", which !== "log");
      /* Watch moved to its own dock panel; the Output panel is just
         Results/Log now, so no watch toggle here. */
      if (which !== "log") $("hlPanel").classList.add("hidden");
      $("latest").classList.add("hidden");
    };
  });
  $("clr").onclick = function () { var on = document.querySelector(".tab.on").getAttribute("data-t"); IDE.console.clear(on); };
  $("onboardClose").onclick = function () { $("onboard").hidden = true; };

  var t = null;
  IDE.bus.on("editorchange", function () { clearTimeout(t); t = setTimeout(save, 700); });

  /* ---- modal focus management --------------------------------------------
   *
   * Every dialog in this app is a div that gets a class toggled, which means
   * keyboard focus stays wherever it was -- behind the dialog. For Settings
   * that is an annoyance; for the run_lua and propose_script gates it is a real
   * problem, because the entire safety design rests on the user consciously
   * approving code that is about to run in their game. A gate whose Approve
   * button cannot be reached by keyboard, and whose "outside" is still
   * focusable, is not the deliberate action it claims to be.
   *
   * trapFocus: move focus into the dialog, keep Tab cycling inside it, and
   * restore focus to whatever opened it on release.
   */
  var FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), ' +
    'select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
  var trapped = null;

  function focusableIn(root) {
    return Array.prototype.filter.call(root.querySelectorAll(FOCUSABLE), function (el) {
      return el.offsetParent !== null || el === document.activeElement;
    });
  }

  function trapFocus(root, opts) {
    if (!root) return;
    releaseFocus();
    var restoreTo = document.activeElement;
    var dialog = root.querySelector('[role="dialog"]') || root;
    dialog.setAttribute("aria-modal", "true");
    if (!dialog.getAttribute("role")) dialog.setAttribute("role", "dialog");

    function onKey(e) {
      if (e.key === "Escape" && !(opts && opts.noEscape)) {
        e.preventDefault();
        if (opts && opts.onEscape) opts.onEscape();
        return;
      }
      if (e.key !== "Tab") return;
      var items = focusableIn(dialog);
      if (!items.length) return;
      var first = items[0], last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
    document.addEventListener("keydown", onKey, true);
    trapped = { root: root, dialog: dialog, onKey: onKey, restoreTo: restoreTo };

    /* Focus the element the dialog wants read first -- for a gate that is the
       explanation, not the Approve button, so nobody confirms by reflex. */
    var want = dialog.querySelector("[data-autofocus]") || focusableIn(dialog)[0];
    if (want) setTimeout(function () { try { want.focus(); } catch (e) {} }, 0);
  }

  function releaseFocus() {
    if (!trapped) return;
    document.removeEventListener("keydown", trapped.onKey, true);
    trapped.dialog.removeAttribute("aria-modal");
    var back = trapped.restoreTo;
    trapped = null;
    if (back && back.focus) { try { back.focus(); } catch (e) {} }
  }

  /* ---- dropdown menu ------------------------------------------------------
   *
   * A real menu, because the thing this replaces was a <select> impersonating
   * one. That mattered beyond looks: a select announces as a form control, its
   * keyboard model is "pick a value" rather than "run a command", it cannot
   * show separators or shortcut hints, and on some platforms it opens a native
   * popup that ignores the app's theme entirely.
   *
   * items: [{label, hint, run} | {sep:true}]
   */
  function menu(anchor, items) {
    closeMenu();
    var box = document.createElement("div");
    box.className = "menu";
    box.setAttribute("role", "menu");

    var focusables = [];
    items.forEach(function (it) {
      if (it.sep) {
        var hr = document.createElement("div");
        hr.className = "menu-sep";
        hr.setAttribute("role", "separator");
        box.appendChild(hr);
        return;
      }
      var b = document.createElement("button");
      b.type = "button";
      b.className = "menu-item";
      b.setAttribute("role", "menuitem");
      b.innerHTML = "";
      var lbl = document.createElement("span");
      lbl.textContent = it.label;
      b.appendChild(lbl);
      if (it.hint) {
        var h = document.createElement("span");
        h.className = "menu-hint";
        h.textContent = it.hint;
        b.appendChild(h);
      }
      b.onclick = function () { closeMenu(); it.run(); };
      box.appendChild(b);
      focusables.push(b);
    });

    /* Positioned against the anchor, flipped when it would run off the right
       edge -- the top bar wraps at narrow widths, so the anchor can sit
       anywhere. */
    var r = anchor.getBoundingClientRect();
    box.style.position = "fixed";
    box.style.top = Math.round(r.bottom + 4) + "px";
    box.style.left = Math.round(r.left) + "px";
    document.body.appendChild(box);
    var bw = box.getBoundingClientRect().width;
    if (r.left + bw > window.innerWidth - 8) {
      box.style.left = Math.max(8, Math.round(r.right - bw)) + "px";
    }

    anchor.setAttribute("aria-expanded", "true");
    var idx = -1;
    function focusAt(n) {
      if (!focusables.length) return;
      idx = (n + focusables.length) % focusables.length;
      focusables[idx].focus();
    }
    function onKey(e) {
      if (e.key === "Escape") { e.preventDefault(); closeMenu(); anchor.focus(); }
      else if (e.key === "ArrowDown") { e.preventDefault(); focusAt(idx + 1); }
      else if (e.key === "ArrowUp") { e.preventDefault(); focusAt(idx - 1); }
      else if (e.key === "Home") { e.preventDefault(); focusAt(0); }
      else if (e.key === "End") { e.preventDefault(); focusAt(focusables.length - 1); }
      else if (e.key === "Tab") { e.preventDefault(); }   /* a menu traps Tab */
    }
    function onDown(e) { if (!box.contains(e.target) && e.target !== anchor) closeMenu(); }
    document.addEventListener("keydown", onKey, true);
    document.addEventListener("mousedown", onDown, true);
    openMenu = { box: box, anchor: anchor, onKey: onKey, onDown: onDown };
    focusAt(0);
  }

  var openMenu = null;
  function closeMenu() {
    if (!openMenu) return;
    document.removeEventListener("keydown", openMenu.onKey, true);
    document.removeEventListener("mousedown", openMenu.onDown, true);
    openMenu.anchor.setAttribute("aria-expanded", "false");
    if (openMenu.box.parentNode) openMenu.box.parentNode.removeChild(openMenu.box);
    openMenu = null;
  }

  IDE.ui = { flash: flash, save: save, trapFocus: trapFocus, releaseFocus: releaseFocus,
             menu: menu, closeMenu: closeMenu };
})();
