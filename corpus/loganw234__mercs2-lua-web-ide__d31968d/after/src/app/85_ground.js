/* 85_ground.js -- did the model actually get this from somewhere?
 *
 * The single failure mode this whole project keeps hitting is an invented
 * identifier stated confidently: a namespace, a module, a method that does not
 * exist. Five rounds of wiki auditing, the local-model benchmark's `invented`
 * column, and three live agent runs all reduce to it. Prompt rules reduce it.
 * Tool access reduces it. Neither eliminates it -- a model read the correct
 * page and still answered with a function that was not on it.
 *
 * So stop asking the model to be careful and check the claim instead. Every
 * API-shaped name in an answer either appears in something the model was shown
 * -- the reference pack, a tool result, the user's own buffer -- or it does
 * not. If it does not, the model did not get it from anywhere we can point at.
 *
 * This is deliberately NOT part of the agent loop. It needs no tools, no
 * particular provider, and no cooperation from the model, so it applies to
 * every answer: streamed or agentic, DeepSeek or a 0.5B running on a laptop.
 * When the model will not correct itself, the user still gets told.
 *
 * It is a heuristic and it is honest about that: it proves a name was NOT in
 * the sources, never that a name is wrong. Grounded is not the same as correct.
 */
(function () {
  var IDE = window.IDE;

  /* Dotted references -- Ai.Goal, Pg.Spawn, MrxFollow.follow, Ess.Player.pose.
   *
   * The method half is deliberately case-insensitive. An earlier version
   * required it to start uppercase and therefore sailed straight past
   * `MrxFollow.follow(npc, player)` -- a fabricated call on a real module,
   * which is the most plausible-looking kind of wrong answer there is. Engine
   * calls here are PascalCase but resident modules expose lowercase methods,
   * so the narrow pattern was checking the half of the API least likely to be
   * invented.
   *
   * The trailing `+` matters just as much, and its absence was a real hole.
   * With a single `\.name` group this matched only the FIRST TWO segments, so
   * `Ess.Player.teleportTo` yielded `Ess.Player` -- a real namespace, therefore
   * "grounded" -- and the invented method half was never looked at. Ess is a
   * three-segment API (`Ess.Namespace.method`), which is to say the entire
   * framework this IDE exists for was exempt from the check: any fabricated
   * method on a real namespace passed silently. Two-segment names were fine,
   * which is why the earlier `MrxFollow.follow` fix did not expose it. Caught
   * by testing a live local model's answer against the checker.
   *
   * Bare words are still not checked: too noisy to be useful. */
  var API_RE = /\b[A-Z][A-Za-z0-9_]*(?:\.[A-Za-z][A-Za-z0-9_]*)+\b/g;

  /* Filenames match the pattern and are not API references. The wiki is full of
     "mrxfollow.lua" and "vz-patch.wad", and flagging those would be constant
     noise. */
  var FILE_EXT = /\.(lua|gfx|wad|json|md|html?|txt|ini|asi|exe|py|js|css|png|jpe?g|csv|zip|bin|dll|toml|yml|yaml)$/i;

  /* Prose collisions that match the pattern but are not API references. */
  var IGNORE = { "U.S": 1, "I.E": 1, "E.G": 1 };

  function names(text) {
    var hits = String(text || "").match(API_RE) || [];
    var out = [], seen = {};
    for (var i = 0; i < hits.length; i++) {
      var h = hits[i];
      if (seen[h] || IGNORE[h] || FILE_EXT.test(h)) continue;
      seen[h] = 1;
      out.push(h);
    }
    return out;
  }

  /* answer: the model's text. sources: array of strings it was shown.
     -> { ungrounded: [names], checked: n } */
  function check(answer, sources) {
    var hay = (sources || []).join("\n");
    var all = names(answer);
    var bad = [];
    for (var i = 0; i < all.length; i++) {
      if (hay.indexOf(all[i]) === -1) bad.push(all[i]);
    }
    return { ungrounded: bad, checked: all.length };
  }

  /* Second pass: are these names documented ANYWHERE on the wiki?
   *
   * `check` only proves a name was not in what the model was shown, and the
   * pack is a slice of the wiki -- so on the small tier that fires on plenty of
   * perfectly real functions. This resolves the ambiguity against the full
   * index: `absent` really is undocumented, `elsewhere` is real and merely
   * outside the pack. Only `absent` deserves a warning.
   *
   * -> Promise<{absent: [], elsewhere: []}>, rejects if the index is unreachable.
   */
  /* The index is 3,485 entries / ~4.8 MB, and this used to concatenate the
     whole thing into one string on EVERY answer -- on the UI thread, right
     after the reply the user is trying to read. The index is immutable for the
     session (it is fetched once and cached), so the flattened form is too:
     build it on first use and keep it. Keyed on the array identity so a
     re-fetch would correctly rebuild rather than serve a stale haystack. */
  var hayCache = null, hayFor = null;
  function haystack(idx) {
    if (hayCache !== null && hayFor === idx) return hayCache;
    var parts = new Array(idx.length);
    for (var i = 0; i < idx.length; i++) {
      parts[i] = (idx[i].title || "") + "\n" + (idx[i].content || "");
    }
    hayCache = parts.join("\n");
    hayFor = idx;
    return hayCache;
  }

  function verify(candidates) {
    if (!candidates || !candidates.length) {
      return Promise.resolve({ absent: [], elsewhere: [] });
    }
    if (!IDE.agent || !IDE.agent.index) {
      return Promise.reject(new Error("no wiki index available"));
    }
    return IDE.agent.index().then(function (idx) {
      var hay = haystack(idx);
      var absent = [], elsewhere = [];
      for (var k = 0; k < candidates.length; k++) {
        (hay.indexOf(candidates[k]) === -1 ? absent : elsewhere).push(candidates[k]);
      }
      return { absent: absent, elsewhere: elsewhere };
    });
  }

  /* ---- one vocabulary, both surfaces --------------------------------------
   *
   * The same finding is reported in two places: agent mode appends a correction
   * to the answer, plain chat appends a warning under it. They used to describe
   * it differently, and not just in wording -- agent mode said a name "was not
   * in any source it had been shown", which is only the weak pack-level claim,
   * while plain chat had already checked the full wiki index before deciding
   * what to call it. Two vocabularies for one check read as two different
   * findings, and the weaker one was the more alarming-sounding of the pair.
   *
   * Three verdicts, one sentence each, and both surfaces resolve a name to a
   * verdict the same way:
   *
   *   absent      nothing in the entire wiki index documents it
   *   elsewhere   real, merely outside the loaded pack -- not a problem
   *   unverified  not in the pack, and the index could not be reached
   */
  var VERDICT = {
    absent: {
      label: "Not documented",
      one: "does not appear anywhere in the wiki. Treat it as invented until you confirm it yourself.",
      many: "do not appear anywhere in the wiki. Treat them as invented until you confirm them yourself."
    },
    elsewhere: {
      label: "Documented elsewhere",
      one: "checked out — documented, just not in the loaded pack.",
      many: "checked out — documented, just not in the loaded pack."
    },
    unverified: {
      label: "Unverified",
      one: "is not in the loaded reference pack, and the wiki index could not be reached to check further.",
      many: "are not in the loaded reference pack, and the wiki index could not be reached to check further."
    }
  };

  function label(kind) { return (VERDICT[kind] || VERDICT.unverified).label; }

  function phrase(kind, list) {
    var v = VERDICT[kind] || VERDICT.unverified;
    list = list || [];
    return list.join(", ") + " " + (list.length === 1 ? v.one : v.many);
  }

  /* check()'s candidates, resolved into the three buckets above. Folds the
     unreachable-index case in so every caller gets the same shape and nobody has
     to remember that verify() rejects. */
  function classify(candidates) {
    return verify(candidates).then(function (v) {
      return { absent: v.absent, elsewhere: v.elsewhere, unverified: [] };
    }, function () {
      return { absent: [], elsewhere: [], unverified: (candidates || []).slice() };
    });
  }

  IDE.ground = { check: check, names: names, verify: verify,
                 classify: classify, phrase: phrase, label: label };
})();
