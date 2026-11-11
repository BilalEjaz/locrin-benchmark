from bench.signals import (SIGNALS, WAVE_TWO_TARGETS, added_lines, is_server_path, is_test_file, is_test_rule_file,
                           matched, pick)


def f(name, *added, removed=()):
    body = "".join(f"-{l}\n" for l in removed) + "".join(f"+{l}\n" for l in added)
    return {"filename": name, "status": "modified", "patch": "@@ -1,2 +1,3 @@\n context\n" + body}


def test_the_signals_are_ordered_rarest_first_and_the_quotas_sum_to_the_budget():
    assert list(SIGNALS) == ["supabase-service-role", "cipher-iv", "express-cookie", "weak-hash", "test-skip",
                             "marker", "weak-random", "html-sink", "console", "test-case"]
    assert set(WAVE_TWO_TARGETS) == set(SIGNALS) and sum(WAVE_TWO_TARGETS.values()) == 110
    # The three shapes weak-crypto reads share the 20 records that rule was given.
    assert sum(WAVE_TWO_TARGETS[name] for name in ("cipher-iv", "weak-hash", "weak-random")) == 20


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
        "supabase-service-role": "const key = process.env.SUPABASE_SERVICE_ROLE_KEY;",
        "cipher-iv": 'const d = createDecipheriv("aes-256-cbc", key, iv);',
        "express-cookie": 'res.cookie("sid", id);',
        "weak-hash": 'const h = createHash("md5").update(pw).digest("hex");',
        "marker": "// TODO: handle the empty case",
        "weak-random": "const token = Math.random().toString(36);",
        "html-sink": "el.innerHTML = body;",
        "console": 'console.log("here", x);',
    }
    for name, line in cases.items():
        assert matched([f("src/a.ts", line)]) == [name], name
    assert matched([f("src/a.test.ts", 'it("renders", () => { run(); });')]) == ["test-case"]
    assert matched([f("src/a.test.ts", 'describe.skip("suite", () => {});')]) == ["test-skip"]


def test_weak_hash_reads_the_two_digests_the_rule_flags_and_no_other():
    for line in ('crypto.createHash("SHA1")', "createHash('md5')", 'const alg = "sha1";'):
        assert matched([f("src/a.ts", line)]) == ["weak-hash"], line
    # SHA-256 is not a subject of the rule: three of the five wave-one diffs an earlier, wider pattern matched
    # were this line, and a wave-two record spent on one could not move the rule's number.
    for line in ('createHash("sha256")', 'createHmac("sha256", key)', "const md5sum = cache.key;"):
        assert matched([f("src/a.ts", line)]) == [], line


def test_cipher_iv_reads_both_constructors_that_take_an_iv():
    for line in ('createCipheriv("aes-256-cbc", key, iv)', 'crypto.createDecipheriv("aes-256-gcm", key, iv)'):
        assert matched([f("src/a.ts", line)]) == ["cipher-iv"], line
    assert matched([f("src/a.ts", 'createCipher("aes192", pw)')]) == []


def test_test_skip_matches_every_form_the_engine_reads_as_a_skip():
    forms = ('it.skip("a", () => {});', 'test.todo("a");', 'xit("a", () => {});', 'xtest("a", () => {});',
             'xdescribe("s", () => {});', 'describe.skip("s", () => {});', 'context.skip("s", () => {});',
             'it.skip.each(rows)("a %s", () => {});', 'test.concurrent.skip("a", () => {});')
    for line in forms:
        assert "test-skip" in matched([f("src/a.test.ts", line)]), line


def test_test_skip_is_not_spent_on_code_that_only_spells_the_word():
    # The rule reads test files, and reads a skip off a test callee: none of these is one.
    for line in ("const page = await Model.find().skip((n - 1) * limit);", "if (opts.skip) return;",
                 "state.todo = next;", "items.filter((t) => !t.todo)"):
        assert matched([f("src/a.test.ts", line)]) == [], line
    assert matched([f("src/pager.ts", 'it.skip("a", () => {});')]) == []


def test_test_case_matches_every_form_the_engine_reads_as_a_case():
    forms = ('it("a", () => {});', 'test("a", () => {});', 'it.only("a", () => {});', 'it.each(rows)("a %s", () => {});',
             'test.concurrent("a", async () => {});', 'it.failing("a", () => {});', 'fit("a", () => {});',
             'ftest("a", () => {});', 'xit("a", () => {});', 'it.skip("a", () => {});', "it.each`a | b`('x', () => {});")
    for line in forms:
        assert "test-case" in matched([f("src/a.test.ts", line)]), line


def test_test_case_is_not_spent_on_a_method_that_is_spelled_like_one():
    for line in ("if (pattern.test(name)) return;", "await submit(form);", "emit(event);", "audit(row);"):
        assert matched([f("src/a.test.ts", line)]) == [], line


def test_the_test_signals_read_the_files_the_test_rules_read():
    # locrin_core::testcases::is_test_file: `.test.` or `.spec.` in the name, or a `__tests__` directory.
    for path in ("src/a.test.ts", "src/a.spec.jsx", "src/a.test.util.ts", "src/__tests__/a.ts", "__tests__/a.js"):
        assert is_test_rule_file(path), path
        assert matched([f(path, 'it("a", () => {});')]) == ["test-case"], path
    # A file leftover-debug calls a test, and the test rules never open.
    for path in ("test/a.js", "tests/x.ts", "src/a_test.js", "src/scope-prop-test.mjs", "spec/a.ts"):
        assert not is_test_rule_file(path), path
        assert matched([f(path, 'it("a", () => {});', 'it.skip("b", () => {});')]) == [], path


def test_console_matches_an_optional_chained_call_as_the_engine_does():
    assert matched([f("src/a.ts", 'console?.log("x", x);')]) == ["console"]
    assert matched([f("src/a.ts", "debugger;")]) == ["console"]
    # Passing the function is not calling it, and the engine does not report it.
    assert matched([f("src/a.ts", "p.catch(console.log);")]) == []


def test_console_is_not_a_signal_in_a_test_file_or_an_allowed_path():
    for path in ("src/a.test.ts", "test/run.mjs", "scripts/build.ts", "bin/cli.js", "vite.config.ts"):
        assert "console" not in matched([f(path, "console.log(1);")]), path


def test_service_role_is_read_where_the_rule_reads_it_and_spelled_as_the_rule_spells_it():
    line = "const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY);"
    for path in ("src/lib/supabase.ts", "app/(tabs)/home.tsx", "lib/server/admin.ts", "src/api/users.ts"):
        assert matched([f(path, line)]) == ["supabase-service-role"], path
    # framework.server_paths' defaults: the rule is silent in these, so a diff there cannot move its number.
    for path in ("supabase/functions/sync/index.ts", "server/admin.ts", "api/users.ts", "scripts/seed.ts",
                 "src/db.server.ts", "src/db.test.ts", "src/db.spec.ts"):
        assert is_server_path(path), path
        assert matched([f(path, line)]) == [], path
    # The rule reads `service_role` and not camel case, which is how AWS spells an unrelated thing.
    for other in ("const role = lambdaServiceRole;", "AWSServiceRoleForECS", "microserviceRoles.push(r);"):
        assert matched([f("src/a.ts", other)]) == [], other
    assert matched([f("src/a.ts", "role: 'service_role',")]) == ["supabase-service-role"]


def test_there_is_no_cors_signal_because_the_rule_needs_a_repository_config():
    # express-cors-wildcard-on-authenticated fires only where locrin.toml names the auth middleware, and the
    # harness writes one config for every repository, so no diff could ever move that rule's number.
    assert matched([f("src/a.ts", "app.use(cors());")]) == []


def test_a_pasted_key_literal_is_not_a_signal():
    # Left out on purpose: a diff chosen for holding a service-role key would put a live credential in a
    # public corpus. The signal covers the name of the key, not a pasted one.
    jwt = '"eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJvbGUiOiJzZXJ2aWNlX3JvbGUifQ.c2ln"'
    assert matched([f("src/a.ts", f"const key = {jwt};")]) == []


def test_only_the_javascript_family_is_read():
    for path in ("app/a.php", "app/a.py", "README.md", "db/001.sql"):
        assert matched([f(path, "// TODO: later", "console.log(1);")]) == [], path
    for path in ("a.ts", "a.tsx", "a.js", "a.jsx", "a.mjs", "a.cjs"):
        assert matched([f(path, "// TODO: later")]) == ["marker"], path


def test_several_signals_come_back_in_signal_order():
    got = matched([f("src/a.ts", "console.log(1);", "// FIXME"), f("src/b.ts", 'res.cookie("sid", id);')])
    assert got == ["express-cookie", "marker", "console"]


def test_is_test_file_is_the_leftover_debug_definition():
    for path in ("test/a.mjs", "src/tests/a.ts", "__tests__/a.js", "spec/a.ts", "src/a.test.ts", "src/a.spec.tsx",
                 "src/scope-prop-test.mjs", "src/bar_test.js"):
        assert is_test_file(path), path
    for path in ("src/latest.ts", "src/contest.ts", "src/testing/util.ts"):
        assert not is_test_file(path), path


def test_pick_takes_the_first_matched_signal_with_room():
    targets = {"weak-hash": 1, "marker": 2, "console": 2}
    assert pick(["weak-hash", "console"], {}, targets) == "weak-hash"
    assert pick(["weak-hash", "console"], {"weak-hash": 1}, targets) == "console"
    assert pick(["weak-hash", "console"], {"weak-hash": 1, "console": 2}, targets) is None
    assert pick(["html-sink"], {}, targets) is None
    assert pick([], {}, targets) is None
