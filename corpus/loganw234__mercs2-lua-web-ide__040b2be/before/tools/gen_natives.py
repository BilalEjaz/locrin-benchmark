#!/usr/bin/env python3
"""gen_natives.py -- merge the two things we know about the engine's own functions.

TWO SOURCES, DIFFERENT KNOWLEDGE, NEITHER SUFFICIENT

  src/data/natives-scraped.json   what scrape_natives.py mined from the DECOMPILED base-game scripts:
                                  how each native is actually CALLED -- a real call site, observed
                                  argument counts, how often. 40 namespaces. Cannot know about a
                                  function no shipped script happens to call.

  src/data/ess-natives.json       Ess's api/natives.json, a pairs(_G) walk of a LIVE game (vendored,
                                  see vendor.json). Authoritative for what EXISTS -- 81 engine
                                  namespaces, 1,146 functions. Carries no call sites and no argument
                                  counts, because nothing was observed calling anything.

So this merge is strictly ADDITIVE: it fills in functions the scrape never saw, and never touches an
existing entry's n/min/max/example. That matters because 25_lint.js gates its argument-count warning on
`entry.n >= 5 && entry.min != null` -- a live-only entry simply has no `n`, so it silently opts out of
arg checking rather than producing warnings from data we do not have.

What it fixes: the linter used to tell you a real engine function "isn't seen anywhere in the game's own
scripts -- double-check the name" whenever no shipped script called it. With the live dump merged in, the
function is known to exist and that warning stops firing on correct code.

`kind: "engine"` namespaces merge into `natives` -- the C++ surface, always reachable.

RESIDENT MODULES GO SOMEWHERE ELSE, ON PURPOSE. The dump also carries `game_script` namespaces:
resident Lua modules like MrxUtil and MrxGuiBase. They are real and callable, but they are NOT natives
and they are not unconditionally available, so folding them into `natives` would both misdescribe the
panel and make the linter treat them as always-present. They land under `modules` instead, because they
support a check nothing else can do:

    import("Name") only affects THE IMPORTING FILE'S OWN ENVIRONMENT -- confirmed by live testing and
    documented at wiki resident/index.md. An OnKey script or a console chunk that calls MrxPmc.AddCashQty
    without importing MrxPmc first fails with:
        attempt to index global 'MrxPmc' (a nil value)

That is a runtime failure the IDE can see coming before it ever sends the script, which is exactly what
the pre-send linter is for. 25_lint.js reads `modules` and warns on a module used without its import.

Only the 18 CANONICAL top-level modules are recorded. The other 179 `game_script` entries are dotted
(MrxGui.FlashWidget, MrxFactionManager.MrxUtil) -- sub-tables reached THROUGH a parent, so the import
they need is the parent's, and warning on the dotted path would be wrong. Things a module publishes to
_G directly (MrxCheatBootstrap's _G.Cheat, _G.DebugTeleport) need no import at all, and the dump already
classifies those as `engine` or omits them, so they are excluded for free rather than by a special case.

Run: python tools/gen_natives.py     (writes src/data/natives.json, which build.py inlines)
"""
import json
import pathlib

ROOT = pathlib.Path(__file__).resolve().parent.parent
SCRAPED = ROOT / "src" / "data" / "natives-scraped.json"   # from tools/scrape_natives.py
LIVE = ROOT / "src" / "data" / "ess-natives.json"          # vendored from Ess's release
CALL_DOCS = ROOT / "src" / "data" / "call_docs.json"       # hand-curated: {"natives": {path: doc}, "sigs": {path: sig}}
OUT = ROOT / "src" / "data" / "natives.json"

# NOT THE ENGINE, despite what the dump says.
#
# The dump is a pairs(_G) walk of a running game -- but that game is running WITH the lua-bridge mod
# loaded, because the walk is performed over the bridge. So the globals Lua_Loader.asi injects are
# sitting in _G alongside the real C++ natives and get classified `engine` with them. `Loader` is the
# whole of that surface: exactly the 9 functions the wiki documents at lua-bridge-api/loader.md, and no
# decompiled base-game script references Loader.* at all -- the mod postdates the game.
#
# Left alone, the API panel described the bridge's own API as "the engine's own Loader.* functions, as
# the base game's scripts actually use them", which is wrong twice in one sentence, and the reference
# the assistant is grounded against agreed with it.
#
# The proper fix belongs upstream in Ess's tools/dump_natives.py, which is the only thing that can know
# what was resident before the bridge attached. Until then this is the correction, kept as data rather
# than a special case in the consumers.
BRIDGE_NS = {"Loader"}

def norm(v):
    """A curated entry is either a plain doc string (the original 496) or a rich object.

    Allowing both means the existing entries needed no migration, and a new one can carry the fields
    that actually help: `gotcha` above all. This engine's failure mode is silent wrong behaviour --
    getters returning 1/0 rather than booleans, calls that are async, names that shadow a different
    function -- and a warning attached to the call you are hovering is worth more than another
    paragraph restating what the call does.
    """
    if isinstance(v, str):
        return {"doc": v}
    return dict(v or {})


def main():
    if not SCRAPED.exists():
        print("[gen_natives] missing %s -- run tools/scrape_natives.py (needs the decompiled corpus)"
              % SCRAPED.name)
        return 1
    scraped = json.loads(SCRAPED.read_text(encoding="utf-8"))
    natives = scraped.get("natives") or {}

    added_ns = added_fn = confirmed = 0
    live_meta = {}
    modules = {}
    if LIVE.exists():
        live = json.loads(LIVE.read_text(encoding="utf-8"))
        for ns, info in (live.get("namespaces") or {}).items():
            # Resident Lua modules: recorded separately, and only the canonical top-level ones --
            # a dotted entry is reached through its parent, so the parent's import is what matters.
            if info.get("kind") == "game_script":
                if "." in ns:
                    continue
                modules[ns] = {
                    "source": info.get("source", ""),
                    "fns": sorted(info.get("functions") or []),
                    "ess": sorted(info.get("called_by_ess") or []),
                }
                continue
            if info.get("kind") != "engine":
                continue
            members = natives.setdefault(ns, {})
            if not members:
                added_ns += 1
            called = set(info.get("called_by_ess") or [])
            for fn in info.get("functions") or []:
                e = members.get(fn)
                if e is None:
                    # Exists in the running game; nothing observed calling it. No n/min/max, so the
                    # linter's argument check skips it and only its EXISTENCE is asserted.
                    members[fn] = {"live": 1, "ess": 1} if fn in called else {"live": 1}
                    added_fn += 1
                else:
                    e["live"] = 1                 # scraped AND confirmed present at runtime
                    if fn in called:
                        e["ess"] = 1
                    confirmed += 1
        live_meta = {
            "generated": live.get("generated", ""),
            "source": live.get("source", ""),
            "engine_namespaces": sum(1 for i in (live.get("namespaces") or {}).values()
                                     if i.get("kind") == "engine"),
        }
    else:
        print("[gen_natives] no %s -- writing the scrape alone. Run tools/sync_assets.py to vendor "
              "the live dump." % LIVE.name)

    # Hand-curated docs and signatures, merged HERE rather than in scrape_natives.py.
    #
    # That move is a fix, not a tidy-up. scrape_natives.py merges call_docs into its own output, which
    # only ever contained functions the decompiled corpus calls -- so once the pipeline split, the 543
    # live-only functions could not receive a doc at all, no matter what anyone wrote for them. Loader
    # was the visible case (nothing in the base game calls it, so all nine arrived bare), but it applied
    # to every live-only entry. Merging after the merge means a curated doc reaches whatever it names.
    docs, sigs, bridge_ns, consts, globals_ = {}, {}, {}, set(), {}
    if CALL_DOCS.exists():
        try:
            cd = json.loads(CALL_DOCS.read_text(encoding="utf-8"))
            docs = cd.get("natives") or {}
            sigs = cd.get("sigs") or {}
            bridge_ns = cd.get("bridge_ns") or {}
            globals_ = cd.get("globals") or {}
            consts = set(cd.get("consts") or [])
        except (OSError, ValueError) as e:
            print("[gen_natives] could not read %s (%s) -- continuing without curated docs"
                  % (CALL_DOCS.name, e))

    # Namespaces the bridge ADDS that the live dump cannot see. dump_natives.py walks _G for tables it
    # treats as namespaces; `math` is a pre-existing engine table the bridge patches INTO, and `TCP` did
    # not surface either, so neither arrives from the dump at all. They are synthesized here from the
    # curated entries, and only for namespaces call_docs explicitly declares -- a stray curated path
    # must never be able to invent a namespace.
    added_bridge = 0
    for path in docs:
        ns = path.rsplit(".", 1)[0]
        if ns not in bridge_ns:
            continue
        fn = path.rsplit(".", 1)[1]
        members = natives.setdefault(ns, {})
        if fn not in members:
            members[fn] = {"bridge": 1}
            added_bridge += 1
        if path in consts:
            members[fn]["const"] = 1     # a value, not a callable: no argument placeholders

    doc_hits = sig_hits = got_hits = 0
    for ns, members in natives.items():
        for fn, entry in members.items():
            path = ns + "." + fn
            cur = norm(docs.get(path)) if path in docs else {}
            if cur.get("doc") and not entry.get("doc"):
                entry["doc"] = cur["doc"]
                doc_hits += 1
            # A curated signature always wins: it names the arguments, where a mined example only
            # shows one invocation.
            sig = sigs.get(path) or cur.get("sig")
            if sig:
                entry["sig"] = sig
                sig_hits += 1
            if cur.get("gotcha"):
                entry["gotcha"] = cur["gotcha"]
                got_hits += 1
            if cur.get("src"):
                entry["src"] = cur["src"]

    # Per-namespace provenance, so a consumer can say where a function actually comes from instead of
    # calling everything in `natives` an engine function. Kept as a sibling map rather than folded into
    # each entry: `natives` is {ns: {fn: {...}}} and everything downstream indexes it that way.
    kinds = {ns: ("bridge" if (ns in BRIDGE_NS or ns in bridge_ns) else "engine")
             for ns in natives}
    # A namespace the bridge only ADDS TO (math) is not exhaustively known here, so say so:
    # 25_lint.js must not claim an unlisted member does not exist.
    partial = sorted(ns for ns, meta in bridge_ns.items()
                     if meta.get("partial") and ns in natives)
    ns_docs = {ns: meta["doc"] for ns, meta in bridge_ns.items()
               if meta.get("doc") and ns in natives}

    out = {
        "source": scraped.get("source", ""),
        "files": scraped.get("files", 0),
        "live": live_meta,
        "kinds": kinds,
        "partial": partial,
        "nsDocs": ns_docs,
        "natives": {ns: natives[ns] for ns in sorted(natives)},
        "modules": {m: modules[m] for m in sorted(modules)},
        # Bare globals: no namespace to hang them off, so they get their own key rather than a
        # fake one. assert() is the bridge's polyfill over the engine's error().
        "globals": {k: globals_[k] for k in sorted(globals_)},
    }
    OUT.write_text(json.dumps(out, separators=(",", ":")), encoding="utf-8")

    total_fn = sum(len(v) for v in natives.values())
    print("[gen_natives] wrote %s -- %d native namespaces, %d functions" % (OUT.name, len(natives), total_fn))
    print("[gen_natives] live dump added %d namespaces and %d functions the scrape never saw; "
          "confirmed %d it had" % (added_ns, added_fn, confirmed))
    print("[gen_natives] %d resident modules recorded (%d functions) -- these need import(\"Name\") "
          "before use; 25_lint.js warns when one is missing"
          % (len(modules), sum(len(m["fns"]) for m in modules.values())))
    print("[gen_natives] curated: %d docs, %d signatures, %d gotchas merged from %s"
          % (doc_hits, sig_hits, got_hits, CALL_DOCS.name))
    if added_bridge:
        print("[gen_natives] synthesized %d bridge-added entries in %s (%s marked partial -- the "
              "bridge only ADDS to those, so the linter must not call an unlisted member missing)"
              % (added_bridge, ", ".join(sorted(bridge_ns)), ", ".join(partial) or "none"))
    if globals_:
        print("[gen_natives] %d bare global(s) recorded: %s"
              % (len(globals_), ", ".join(sorted(globals_))))
    bridge = sorted(ns for ns in natives if ns in BRIDGE_NS)
    if bridge:
        print("[gen_natives] reclassified as lua-bridge (Lua_Loader.asi), not engine: %s"
              % ", ".join("%s (%d fns)" % (b, len(natives[b])) for b in bridge))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
