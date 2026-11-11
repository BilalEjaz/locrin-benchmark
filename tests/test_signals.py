from bench.signals import SIGNALS, WAVE_TWO_TARGETS, added_lines, is_test_file, matched, pick


def f(name, *added, removed=()):
    body = "".join(f"-{l}\n" for l in removed) + "".join(f"+{l}\n" for l in added)
    return {"filename": name, "status": "modified", "patch": "@@ -1,2 +1,3 @@\n context\n" + body}


def test_the_signals_are_ordered_rarest_first_and_the_quotas_sum_to_the_budget():
    assert list(SIGNALS) == ["weak-crypto", "express-cookie", "supabase-service-role",
                             "test-skip", "html-sink", "test-case", "marker", "console"]
    assert set(WAVE_TWO_TARGETS) == set(SIGNALS) and sum(WAVE_TWO_TARGETS.values()) == 110


def test_added_lines_keeps_only_added_lines_without_their_marker():
    patch = "@@ -1,2 +1,3 @@\n context\n-gone();\n+kept();\n+++i;\n\\ No newline at end of file"
    assert added_lines(patch) == ["kept();", "++i;"]


def test_a_file_without_a_patch_has_no_added_lines():
    assert added_lines(None) == []
    assert matched([{"filename": "src/a.ts", "status": "modified"}]) == []


def test_a_signal_on_a_removed_or_context_line_is_not_a_match():
    assert matched([f("src/a.ts", "const x = 1;", removed=["console.log(x);"])]) == []
    assert matched([{"filename": "src/a.ts", "patch": "@@ -1 +1 @@\n console.log(1);\n+const y = 2;\n"}]) == []


def test_each_signal_matches_its_subject():
    cases = {
        "weak-crypto": 'const h = createHash("md5").update(pw).digest("hex");',
        "express-cookie": 'res.cookie("sid", id);',
        "supabase-service-role": "const key = process.env.SUPABASE_SERVICE_ROLE_KEY;",
        "html-sink": "el.innerHTML = body;",
        "marker": "// TODO: handle the empty case",
        "console": 'console.log("here", x);',
    }
    for name, line in cases.items():
        assert matched([f("src/a.ts", line)]) == [name], name
    assert matched([f("src/a.test.ts", 'it.skip("renders", () => {});')]) == ["test-skip"]
    assert matched([f("src/a.test.ts", 'it("renders", () => { run(); });')]) == ["test-case"]


def test_test_skip_matches_every_form_the_engine_reads_as_a_skip():
    forms = ('it.skip("a", () => {});', 'test.todo("a");', 'xit("a", () => {});', 'xtest("a", () => {});',
             'xdescribe("s", () => {});', 'describe.skip("s", () => {});', 'context.skip("s", () => {});',
             'it.skip.each(rows)("a %s", () => {});')
    for line in forms:
        assert "test-skip" in matched([f("src/a.test.ts", line)]), line


def test_weak_crypto_also_matches_math_random_and_a_bare_sha1():
    assert matched([f("src/a.ts", "const token = Math.random().toString(36);")]) == ["weak-crypto"]
    assert matched([f("src/a.js", 'crypto.createHash("SHA1")')]) == ["weak-crypto"]
    assert matched([f("src/a.ts", 'const d = createDecipheriv("aes-256-cbc", key, iv);')]) == ["weak-crypto"]


def test_there_is_no_cors_signal_because_the_rule_needs_a_repository_config():
    # express-cors-wildcard-on-authenticated fires only where locrin.toml names the auth middleware, and the
    # harness writes one config for every repository, so no diff could ever move that rule's number.
    assert matched([f("src/a.ts", "app.use(cors());")]) == []


def test_a_pasted_key_literal_is_not_a_signal():
    # Left out on purpose: a diff chosen for holding a service-role key would put a live credential in a
    # public corpus. The signal covers the name of the key, not a pasted one.
    jwt = '"eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJvbGUiOiJzZXJ2aWNlX3JvbGUifQ.c2ln"'
    assert matched([f("src/a.ts", f"const key = {jwt};")]) == []


def test_console_is_not_a_signal_in_a_test_file_or_an_allowed_path():
    for path in ("src/a.test.ts", "test/run.mjs", "scripts/build.ts", "bin/cli.js", "vite.config.ts"):
        assert "console" not in matched([f(path, "console.log(1);")]), path


def test_a_new_test_case_is_a_signal_only_in_a_test_file():
    assert matched([f("src/a.ts", 'test("x", () => {});')]) == []


def test_only_the_javascript_family_is_read():
    for path in ("app/a.php", "app/a.py", "README.md", "db/001.sql"):
        assert matched([f(path, "// TODO: later", "console.log(1);")]) == [], path
    for path in ("a.ts", "a.tsx", "a.js", "a.jsx", "a.mjs", "a.cjs"):
        assert matched([f(path, "// TODO: later")]) == ["marker"], path


def test_several_signals_come_back_in_signal_order():
    got = matched([f("src/a.ts", "console.log(1);", "// FIXME"), f("src/b.ts", 'res.cookie("sid", id);')])
    assert got == ["express-cookie", "marker", "console"]


def test_is_test_file_is_the_engine_definition():
    for path in ("test/a.mjs", "src/tests/a.ts", "__tests__/a.js", "spec/a.ts", "src/a.test.ts", "src/a.spec.tsx",
                 "src/scope-prop-test.mjs", "src/bar_test.js"):
        assert is_test_file(path), path
    for path in ("src/latest.ts", "src/contest.ts", "src/testing/util.ts"):
        assert not is_test_file(path), path


def test_pick_takes_the_rarest_matched_signal_with_room():
    targets = {"weak-crypto": 1, "marker": 2, "console": 2}
    assert pick(["weak-crypto", "console"], {}, targets) == "weak-crypto"
    assert pick(["weak-crypto", "console"], {"weak-crypto": 1}, targets) == "console"
    assert pick(["weak-crypto", "console"], {"weak-crypto": 1, "console": 2}, targets) is None
    assert pick(["html-sink"], {}, targets) is None
    assert pick([], {}, targets) is None
