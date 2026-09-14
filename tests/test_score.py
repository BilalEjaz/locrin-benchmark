import json
from pathlib import Path

import bench.corpus
import bench.score
from bench.labels import Entry, LabelFile, load_labels
from bench.run import Finding, RuleMeta, normalise
from bench.score import Score, render_markdown, score, stale

ROOT = Path(__file__).resolve().parent.parent


def F(diff, rule, file, line, lang="typescript", ident="0" * 16):
    return Finding(diff, rule, file, line, ident, "high", lang)


def E(rule, file, line, v, ident="0" * 16):
    return Entry(rule=rule, file=file, line=line, id=None if v == "missed" else ident, pass1=v, pass2=v, note="")


RULES = {r: RuleMeta(r, r != "dead-file", ["typescript"]) for r in ["leftover-debug", "unreachable", "dead-file", "vulnerable-dependency"]}


def labels(**files):
    return {d: LabelFile(d, "v0.5.0", {}, {}, es) for d, es in files.items()}


def test_precision_and_recall_per_rule():
    fs = [F("a", "leftover-debug", "x.ts", 1), F("a", "leftover-debug", "x.ts", 2), F("b", "unreachable", "y.ts", 3)]
    ls = labels(a=[E("leftover-debug", "x.ts", 1, "true"), E("leftover-debug", "x.ts", 2, "false-positive")],
                b=[E("unreachable", "y.ts", 3, "true"), E("unreachable", "y.ts", 9, "missed")])
    per_rule, _, unlabelled = score(fs, ls, RULES)
    by = {s.key: s for s in per_rule}
    assert (by["leftover-debug"].true, by["leftover-debug"].false_positive, by["leftover-debug"].missed) == (1, 1, 0)
    assert by["leftover-debug"].precision == 0.5 and by["leftover-debug"].recall == 1.0
    assert by["unreachable"].precision == 1.0 and by["unreachable"].recall == 0.5
    assert unlabelled == []


def test_small_samples_are_not_scored_and_not_benchmarked_rules_say_why():
    fs = [F("a", "leftover-debug", "x.ts", 1)]
    ls = labels(a=[E("leftover-debug", "x.ts", 1, "true")])
    per_rule, _, _ = score(fs, ls, RULES)
    by = {s.key: s for s in per_rule}
    assert by["leftover-debug"].scored is False and by["leftover-debug"].reason == "n<5, not scored"
    assert by["leftover-debug"].precision == 1.0
    assert by["vulnerable-dependency"].scored is False and "advisory" in by["vulnerable-dependency"].reason


def test_unconfirmed_and_not_applicable_entries_are_dropped_and_unlabelled_findings_flagged():
    fs = [F("a", "leftover-debug", "x.ts", 1), F("a", "leftover-debug", "x.ts", 2), F("a", "leftover-debug", "x.ts", 3)]
    ls = labels(a=[Entry("leftover-debug", "x.ts", 1, "0" * 16, "true", "false-positive", ""),
                   E("leftover-debug", "x.ts", 2, "not-applicable")])
    per_rule, _, unlabelled = score(fs, ls, RULES)
    by = {s.key: s for s in per_rule}
    assert (by["leftover-debug"].true, by["leftover-debug"].false_positive) == (0, 0)
    assert [(f.file, f.line) for f in unlabelled] == [("x.ts", 3)]


def test_pairs_split_by_language():
    fs = [F("a", "leftover-debug", "x.ts", 1), F("a", "leftover-debug", "y.php", 2, "php")]
    ls = labels(a=[E("leftover-debug", "x.ts", 1, "true"), E("leftover-debug", "y.php", 2, "false-positive")])
    _, per_pair, _ = score(fs, ls, RULES)
    by = {s.key: s for s in per_pair}
    assert by["leftover-debug@typescript"].precision == 1.0
    assert by["leftover-debug@php"].precision == 0.0


def test_render_marks_below_line_ships_off_and_reasons():
    per_rule = [
        Score("leftover-debug", 17, 3, 0, 0.85, 1.0, True, ""),
        Score("unreachable", 4, 2, 0, 4 / 6, 1.0, True, ""),
        Score("dead-file", 1, 0, 0, 1.0, 1.0, False, "n<5, not scored"),
        Score("vulnerable-dependency", 0, 0, 0, None, None, False, "not benchmarked: advisory feed changes daily"),
    ]
    md = render_markdown(per_rule, [], "v0.5.0", corpus_size=10, unlabelled=0)
    assert "| `leftover-debug` | on | 85% | 100% | 17 | 3 | 0 |" in md
    assert "| `unreachable` | on | 67% (below line) | 100% |" in md
    assert "| `dead-file` | off | 100% | 100% | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | n<5, not scored |" in md
    assert "not benchmarked: advisory feed changes daily" in md
    assert "Locrin v0.5.0" in md and "10 diffs" in md


def test_language_of_is_imported_at_module_top():
    assert bench.score.language_of is bench.corpus.language_of


def test_scored_rows_need_five_confirmed_findings_and_mark_below_line():
    fs = [F("a", "dead-file", f"f{i}.ts", 1) for i in range(5)]
    ls = labels(a=[E("dead-file", f"f{i}.ts", 1, "true") for i in range(4)] + [E("dead-file", "f4.ts", 1, "false-positive")])
    per_rule, per_pair, _ = score(fs, ls, RULES)
    by = {s.key: s for s in per_rule}
    assert by["dead-file"].scored is True and by["dead-file"].reason == "" and by["dead-file"].precision == 0.8
    md = render_markdown(per_rule, per_pair, "v0.5.0", corpus_size=1, unlabelled=0, rules=RULES)
    assert "| `dead-file` | off | 80% (below line) | 100% | 4 | 1 | 0 | 0 | 0 | 0 | 0 | 0 |  |" in md
    assert "| `dead-file@typescript` | off | 80% (below line) |" in md


def test_secret_exposed_ships_locked():
    md = render_markdown([Score("secret-exposed", 1, 0, 0, 1.0, 1.0, False, "n<5, not scored")], [], "v0.5.0", 1, 0,
                         rules={"secret-exposed": RuleMeta("secret-exposed", True, ["typescript"])})
    assert "| `secret-exposed` | locked | 100% | 100% | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | n<5, not scored |" in md


def test_rule_order_is_sarif_order_then_label_only_rules_sorted():
    ls = labels(a=[E("zeta-rule", "x.ts", 1, "missed"), E("alpha-rule", "x.ts", 2, "not-applicable")])
    per_rule, _, _ = score([], ls, RULES)
    assert [s.key for s in per_rule] == [*RULES, "alpha-rule", "zeta-rule"]


def test_a_true_and_a_missed_entry_on_the_same_line_both_count():
    fs = [F("a", "unreachable", "y.ts", 3)]
    ls = labels(a=[E("unreachable", "y.ts", 3, "true"), E("unreachable", "y.ts", 3, "missed")])
    per_rule, per_pair, unlabelled = score(fs, ls, RULES)
    by = {s.key: s for s in per_rule}
    assert (by["unreachable"].true, by["unreachable"].false_positive, by["unreachable"].missed) == (1, 0, 1)
    assert {s.key: (s.true, s.missed) for s in per_pair} == {"unreachable@typescript": (1, 1)}
    assert unlabelled == []


def test_missed_pairs_use_the_engine_language_of_the_file():
    ls = labels(a=[E("leftover-debug", "view.tsx", 4, "missed"), E("leftover-debug", "notes.txt", 5, "missed")])
    per_rule, per_pair, _ = score([], ls, RULES)
    assert {s.key: s for s in per_rule}["leftover-debug"].missed == 2
    assert [(s.key, s.missed, s.recall) for s in per_pair] == [("leftover-debug@tsx", 1, 0.0)]


def test_every_pair_with_a_label_or_a_finding_gets_a_row():
    fs = [F("a", "leftover-debug", "x.py", 1, "python")]
    ls = labels(a=[E("unreachable", "y.php", 2, "not-applicable")])
    _, per_pair, unlabelled = score(fs, ls, RULES)
    assert [(s.key, s.true, s.false_positive, s.missed, s.precision) for s in per_pair] == [
        ("leftover-debug@python", 0, 0, 0, None), ("unreachable@php", 0, 0, 0, None)]
    assert len(unlabelled) == 1


def test_empty_cells_and_pair_table_heading():
    md = render_markdown([Score("dead-export", 0, 0, 0, None, None, False, "n<5, not scored")],
                         [Score("leftover-debug@php", 1, 0, 0, 1.0, 1.0, False, "n<5, not scored")], "v0.5.0", 2, 3)
    assert md.startswith("Locrin v0.5.0, 2 diffs. Left out of the numbers: 3 unlabelled, 0 without an agreed and confirmed label, 0 not applicable, 0 pre-existing and 0 duplicate.\n\n| Rule | Ships | Precision | Recall | True | False positive | Missed | Unlabelled | Excluded | Not applicable | Pre-existing | Duplicate | Note |\n")
    assert "| `dead-export` | on |  |  | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | n<5, not scored |" in md
    assert "\n\n| Pair | Ships | Precision | Recall | True | False positive | Missed | Unlabelled | Excluded | Not applicable | Pre-existing | Duplicate | Note |\n" in md
    assert md.endswith("| `leftover-debug@php` | opt-in | 100% | 100% | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | n<5, not scored |\n\n"
                       "Locrin reads PHP and Python only when `[languages]` turns them on, so their pairs ship "
                       "opt-in; the benchmark turns both on.\n")
    assert "\r" not in md


def test_fixture_labels_produce_the_truthful_numbers():
    ls = load_labels(ROOT / "fixtures" / "labels")
    fs = [Finding(d, e.rule, e.file, e.line, e.id, "high", bench.corpus.language_of(e.file))
          for d, lf in ls.items() for e in lf.entries if e.verdict != "missed"]
    sarif = json.loads((ROOT / "fixtures" / "sarif" / "sample.sarif").read_text(encoding="utf-8"))
    _, rules = normalise("fx-01-debug", sarif)
    per_rule, per_pair, unlabelled = score(fs, ls, rules)
    assert unlabelled == []
    got = {s.key: (s.true, s.false_positive, s.missed, s.precision, s.recall) for s in per_rule if s.true + s.false_positive + s.missed}
    assert got == {
        "leftover-debug": (3, 1, 0, 0.75, 1.0),
        "leftover-agent-marker": (2, 0, 0, 1.0, 1.0),
        "unused-import": (1, 0, 0, 1.0, 1.0),
        "unreachable": (1, 0, 1, 1.0, 0.5),
        "test-no-assert": (1, 0, 0, 1.0, 1.0),
        "secret-exposed": (1, 0, 0, 1.0, 1.0),
        "weak-crypto": (1, 0, 0, 1.0, 1.0),
    }
    assert [s.key for s in per_rule] == list(rules)
    assert [(s.key, s.true, s.false_positive, s.missed) for s in per_pair] == [
        ("leftover-agent-marker@javascript", 2, 0, 0),
        ("leftover-debug@php", 1, 0, 0),
        ("leftover-debug@python", 1, 0, 0),
        ("leftover-debug@typescript", 1, 1, 0),
        ("secret-exposed@typescript", 1, 0, 0),
        ("test-no-assert@typescript", 1, 0, 0),
        ("unreachable@typescript", 1, 0, 1),
        ("unused-import@typescript", 1, 0, 0),
        ("weak-crypto@typescript", 1, 0, 0),
    ]
    assert all(not s.scored for s in per_rule + per_pair)
    md = render_markdown(per_rule, per_pair, "v0.5.0", corpus_size=10, unlabelled=0, rules=rules)
    assert md.startswith("Locrin v0.5.0, 10 diffs. Left out of the numbers: 0 unlabelled, 0 without an agreed and confirmed label, 0 not applicable, 0 pre-existing and 0 duplicate.\n")
    assert "| `leftover-debug` | on | 75% | 100% | 3 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | n<5, not scored |" in md
    assert "| `unreachable` | on | 100% | 50% | 1 | 0 | 1 | 0 | 0 | 0 | 0 | 0 | n<5, not scored |" in md
    assert "| `dead-file` | off |  |  | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | n<5, not scored |" in md
    assert "| `vulnerable-dependency` | on |  |  | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | not benchmarked: advisory feed changes daily |" in md
    assert "| `leftover-debug@typescript` | on | 50% | 100% | 1 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | n<5, not scored |" in md


A, B, C, D = "a" * 16, "b" * 16, "c" * 16, "d" * 16


def counts(per_rule, key):
    s = {s.key: s for s in per_rule}[key]
    return (s.true, s.false_positive, s.missed)


def test_same_line_findings_match_their_own_entries_by_engine_id():
    fs = [F("a", "unused-import", "x.ts", 1, ident=A), F("a", "unused-import", "x.ts", 1, ident=B)]
    ls = labels(a=[E("unused-import", "x.ts", 1, "true", A), E("unused-import", "x.ts", 1, "false-positive", B)])
    per_rule, per_pair, unlabelled = score(fs, ls, RULES)
    assert counts(per_rule, "unused-import") == (1, 1, 0)
    assert {s.key: s for s in per_rule}["unused-import"].precision == 0.5
    assert [(s.key, s.true, s.false_positive) for s in per_pair] == [("unused-import@typescript", 1, 1)]
    assert unlabelled == []


def test_a_disagreeing_sibling_on_the_same_line_does_not_borrow_the_confirmed_verdict():
    fs = [F("a", "unused-import", "x.ts", 1, ident=A), F("a", "unused-import", "x.ts", 1, ident=B)]
    ls = labels(a=[E("unused-import", "x.ts", 1, "true", A),
                   Entry("unused-import", "x.ts", 1, B, "true", "false-positive", "")])
    per_rule, _, unlabelled = score(fs, ls, RULES)
    assert counts(per_rule, "unused-import") == (1, 0, 0)
    assert unlabelled == []


def test_a_finding_matches_only_an_entry_with_its_own_id_and_line():
    # Labels are written from the same locrin version's output, so a moved line or a changed id is
    # another finding: the finding is unlabelled and the entry unreproduced, never a borrowed verdict.
    for finding in (F("a", "unreachable", "x.ts", 7, ident=A), F("a", "unreachable", "x.ts", 3, ident=C)):
        ls = labels(a=[E("unreachable", "x.ts", 3, "false-positive", A)])
        per_rule, _, unlabelled = score([finding], ls, RULES)
        assert counts(per_rule, "unreachable") == (0, 0, 0)
        assert unlabelled == [finding]
        assert [(d, e.line, e.id) for d, e in bench.score.unreproduced([finding], ls)] == [("a", 3, A)]
    # A new finding beside one whose id and line match does not take its sibling's entry.
    per_rule, _, unlabelled = score([F("a", "unreachable", "x.ts", 3, ident=A), F("a", "unreachable", "x.ts", 3, ident=D)],
                                    labels(a=[E("unreachable", "x.ts", 3, "true", A)]), RULES)
    assert counts(per_rule, "unreachable") == (1, 0, 0) and [f.id for f in unlabelled] == [D]


def test_a_finding_on_a_missed_only_key_is_unlabelled():
    fs = [F("a", "unreachable", "x.ts", 7, ident=A)]
    ls = labels(a=[E("unreachable", "x.ts", 7, "missed")])
    per_rule, _, unlabelled = score(fs, ls, RULES)
    assert counts(per_rule, "unreachable") == (0, 0, 1)
    assert [(f.file, f.line) for f in unlabelled] == [("x.ts", 7)]


def test_the_n_gate_counts_confirmed_findings_not_missed_entries():
    fs = [F("a", "unreachable", "x.ts", 1, ident=A)]
    ls = labels(a=[E("unreachable", "x.ts", 1, "false-positive", A)] + [E("unreachable", "x.ts", 10 + i, "missed") for i in range(4)])
    per_rule, per_pair, _ = score(fs, ls, RULES)
    row = {s.key: s for s in per_rule}["unreachable"]
    assert (row.true, row.false_positive, row.missed) == (0, 1, 4)
    assert row.scored is False and row.reason == "n<5, not scored"
    assert {s.key: s for s in per_pair}["unreachable@typescript"].scored is False
    md = render_markdown(per_rule, per_pair, "v0.5.0", 1, 0, rules=RULES)
    assert "| `unreachable` | on | 0% | 0% | 0 | 1 | 4 | 0 | 0 | 0 | 0 | 0 | n<5, not scored |" in md
    assert "below line" not in md


def test_ships_column_follows_rule_metadata_over_the_fallback():
    rules = {"swallowed-error": RuleMeta("swallowed-error", True, ["typescript"]),
             "leftover-debug": RuleMeta("leftover-debug", False, ["typescript"])}
    md = render_markdown([Score("swallowed-error", 0, 0, 0, None, None, False, "n<5, not scored"),
                          Score("leftover-debug", 0, 0, 0, None, None, False, "n<5, not scored")],
                         [Score("swallowed-error@typescript", 0, 0, 0, None, None, False, "n<5, not scored"),
                          Score("leftover-debug@typescript", 0, 0, 0, None, None, False, "n<5, not scored")], "v0.5.0", 1, 0, rules=rules)
    assert "| `swallowed-error` | on |" in md and "| `swallowed-error@typescript` | on |" in md
    assert "| `leftover-debug` | off |" in md and "| `leftover-debug@typescript` | off |" in md


def test_pairs_shipped_off_render_off_even_when_the_rule_ships_on():
    rules = {"leftover-commented-code": RuleMeta("leftover-commented-code", True, ["typescript", "python"])}
    md = render_markdown([Score("leftover-commented-code", 1, 0, 0, 1.0, 1.0, False, "n<5, not scored")],
                         [Score("leftover-commented-code@python", 1, 0, 0, 1.0, 1.0, False, "n<5, not scored"),
                          Score("leftover-commented-code@typescript", 0, 0, 0, None, None, False, "n<5, not scored")], "v0.5.0", 1, 0, rules=rules)
    assert "| `leftover-commented-code` | on |" in md
    assert "| `leftover-commented-code@python` | off | 100% | 100% | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | n<5, not scored |" in md
    assert "| `leftover-commented-code@typescript` | on |" in md
    assert "| `leftover-commented-code@python` | off |" in render_markdown([], [Score("leftover-commented-code@python", 0, 0, 0, None, None, False, "n<5, not scored")], "v0.5.0", 1, 0)


def test_identical_same_line_findings_pair_one_to_one_with_their_entries():
    # 0.5.0 reports one rule twice on one line with the same id (the anchor has no column).
    fs = [F("a", "swallowed-error", "e.ts", 5, ident=A), F("a", "swallowed-error", "e.ts", 5, ident=A)]
    per_rule, _, unlabelled = score(fs, labels(a=[E("swallowed-error", "e.ts", 5, "true", A), E("swallowed-error", "e.ts", 5, "true", A)]), RULES)
    assert counts(per_rule, "swallowed-error") == (2, 0, 0) and unlabelled == []
    per_rule, _, unlabelled = score(fs, labels(a=[E("swallowed-error", "e.ts", 5, "true", A), E("swallowed-error", "e.ts", 5, "false-positive", A)]), RULES)
    assert counts(per_rule, "swallowed-error") == (1, 1, 0) and unlabelled == []


def test_one_entry_decides_one_finding_only():
    # Case A: labels made when the engine reported one of two identical findings.
    fs = [F("a", "weak-crypto", "e.ts", 4, ident=A), F("a", "weak-crypto", "e.ts", 4, ident=A)]
    per_rule, _, unlabelled = score(fs, labels(a=[E("weak-crypto", "e.ts", 4, "true", A)]), RULES)
    assert counts(per_rule, "weak-crypto") == (1, 0, 0)
    assert [(f.line, f.id) for f in unlabelled] == [(4, A)]
    # Case C: secret-exposed anchors on the value, so one secret on two lines shares an id.
    fs = [F("a", "secret-exposed", "e.ts", 2, ident=A), F("a", "secret-exposed", "e.ts", 4, ident=A)]
    per_rule, _, unlabelled = score(fs, labels(a=[E("secret-exposed", "e.ts", 2, "false-positive", A)]), RULES)
    assert counts(per_rule, "secret-exposed") == (0, 1, 0)
    assert [(f.line, f.id) for f in unlabelled] == [(4, A)]


def test_a_confirmed_true_entry_the_run_no_longer_reports_counts_as_missed_and_is_stale():
    ls = labels(a=[E("unreachable", "x.ts", 2, "true", A), E("unreachable", "x.ts", 9, "missed"),
                   E("unreachable", "x.ts", 4, "false-positive", B), Entry("unreachable", "x.ts", 6, C, "true", "?", "")])
    per_rule, per_pair, unlabelled = score([], ls, RULES)
    assert counts(per_rule, "unreachable") == (0, 0, 2)
    assert {s.key: s for s in per_rule}["unreachable"].recall == 0.0
    assert [(s.key, s.missed) for s in per_pair] == [("unreachable@typescript", 2)]
    assert unlabelled == []
    assert [(d, e.line, e.id) for d, e in stale([], ls)] == [("a", 2, A)]
    # A matched true entry is not stale.
    fs = [F("a", "unreachable", "x.ts", 2, ident=A)]
    assert counts(score(fs, ls, RULES)[0], "unreachable") == (1, 0, 1)
    assert stale(fs, ls) == []


def test_label_files_for_diffs_that_did_not_run_are_ignored():
    fs = [F("a", "unreachable", "x.ts", 2, ident=A)]
    ls = labels(a=[E("unreachable", "x.ts", 2, "true", A)],
                b=[E("zeta-rule", "y.ts", 2, "true", B), E("zeta-rule", "y.ts", 9, "missed")])
    per_rule, per_pair, unlabelled = score(fs, ls, RULES, ran={"a"})
    assert counts(per_rule, "unreachable") == (1, 0, 0)
    assert [s.key for s in per_rule] == list(RULES)
    assert [s.key for s in per_pair] == ["unreachable@typescript"]
    assert unlabelled == []
    assert stale(fs, ls, ran={"a"}) == []
    # Without ran every label file counts, so b's true entry is stale and missed.
    per_rule, _, _ = score(fs, ls, RULES)
    assert counts(per_rule, "zeta-rule") == (0, 0, 2)
    assert [(d, e.line) for d, e in stale(fs, ls)] == [("b", 2)]


def test_heading_says_how_many_diffs_ran_when_told():
    md = render_markdown([], [], "v0.5.0", corpus_size=10, unlabelled=0, ran=9)
    assert md.startswith("Locrin v0.5.0, 9 of 10 diffs ran. Left out of the numbers: 0 unlabelled, 0 without an agreed and confirmed label, 0 not applicable, 0 pre-existing and 0 duplicate.\n")


def test_a_precision_just_under_the_line_never_renders_as_the_line():
    assert bench.score._cell(45 / 53, True, True) == "84.9% (below line)"
    assert bench.score._cell(0.8, True, True) == "80% (below line)"
    assert bench.score._cell(0.85, True, True) == "85%"
    assert bench.score._cell(45 / 53, False, True) == "85%"


def test_php_and_python_pairs_render_opt_in_because_those_languages_ship_off():
    rules = {"leftover-debug": RuleMeta("leftover-debug", True, ["php", "python"]),
             "secret-exposed": RuleMeta("secret-exposed", True, ["python"]),
             "dead-file": RuleMeta("dead-file", False, ["python"])}
    pairs = [Score(k, 0, 0, 0, None, None, False, "n<5, not scored") for k in
             ("leftover-debug@php", "leftover-debug@python", "leftover-debug@typescript", "secret-exposed@python",
              "dead-file@python", "leftover-commented-code@python")]
    md = render_markdown([], pairs, "v0.5.0", 1, 0, rules=rules)
    assert "| `leftover-debug@php` | opt-in |" in md
    assert "| `leftover-debug@python` | opt-in |" in md
    assert "| `leftover-debug@typescript` | on |" in md
    assert "| `secret-exposed@python` | opt-in |" in md
    assert "| `dead-file@python` | off |" in md
    assert "| `leftover-commented-code@python` | off |" in md
    assert "PHP and Python" in md


def test_the_table_always_lists_the_rules_that_are_not_benchmarked():
    md = render_markdown([], [], "v0.5.0", corpus_size=0, unlabelled=0, ran=0)
    for rule, reason in bench.score.NOT_BENCHMARKED.items():
        assert f"| `{rule}` | on |  |  | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | not benchmarked: {reason} |" in md
    once = render_markdown([Score("vulnerable-dependency", 0, 0, 0, None, None, False,
                                  "not benchmarked: advisory feed changes daily")], [], "v0.5.0", 1, 0)
    assert once.count("`vulnerable-dependency`") == 1


def test_findings_matched_to_unconfirmed_entries_are_excluded_and_count_nowhere():
    fs = [F("a", "leftover-debug", "x.ts", 1, ident=A), F("a", "leftover-debug", "x.ts", 2, ident=B),
          F("a", "leftover-debug", "x.ts", 3, ident=C)]
    unfilled = Entry("leftover-debug", "x.ts", 2, B, "?", "?", "")
    disputed = Entry("leftover-debug", "x.ts", 3, C, "true", "false-positive", "")
    ls = labels(a=[E("leftover-debug", "x.ts", 1, "true", A), unfilled, disputed])
    per_rule, _, unlabelled = score(fs, ls, RULES)
    assert counts(per_rule, "leftover-debug") == (1, 0, 0)
    assert unlabelled == []
    assert [(f.line, f.id) for f in bench.score.excluded(fs, ls)] == [(2, B), (3, C)]
    assert bench.score.excluded(fs, ls, ran=set()) == []


def test_a_label_file_never_confirmed_by_pass_two_counts_nowhere():
    fs = [F("a", "leftover-debug", "x.ts", 1, ident=A)]
    lf = LabelFile("a", "v0.5.0", {"by": "one", "date": "d"}, None,
                   [E("leftover-debug", "x.ts", 1, "true", A), E("leftover-debug", "x.ts", 5, "missed")])
    per_rule, per_pair, unlabelled = score(fs, {"a": lf}, RULES)
    assert counts(per_rule, "leftover-debug") == (0, 0, 0)
    assert unlabelled == []
    assert [f.id for f in bench.score.excluded(fs, {"a": lf})] == [A]
    assert stale([], {"a": lf}) == []


def test_unlabelled_findings_are_counted_per_rule_and_per_pair_and_rendered():
    fs = [F("a", "leftover-debug", "x.ts", 1), F("a", "leftover-debug", "x.ts", 2, ident=B),
          F("a", "leftover-debug", "y.php", 3, "php", ident=C), F("a", "no-meta-rule", "z.ts", 4, ident=D)]
    ls = labels(a=[E("leftover-debug", "x.ts", 1, "true")])
    per_rule, per_pair, unlabelled = score(fs, ls, RULES)
    assert len(unlabelled) == 3
    rule = {s.key: s for s in per_rule}
    assert rule["leftover-debug"].unlabelled == 2 and rule["unreachable"].unlabelled == 0
    assert rule["no-meta-rule"].unlabelled == 1
    pair = {s.key: s for s in per_pair}
    assert pair["leftover-debug@typescript"].unlabelled == 1 and pair["leftover-debug@php"].unlabelled == 1
    assert pair["no-meta-rule@typescript"].unlabelled == 1
    md = render_markdown(per_rule, per_pair, "v0.5.0", 1, len(unlabelled), rules=RULES)
    assert "| `leftover-debug` | on | 100% | 100% | 1 | 0 | 0 | 2 | 0 | 0 | 0 | 0 | n<5, not scored |" in md
    assert "| `leftover-debug@php` | opt-in |  |  | 0 | 0 | 0 | 1 | 0 | 0 | 0 | 0 | n<5, not scored |" in md


def test_findings_and_missed_entries_whose_passes_disagree_are_counted_excluded_per_rule_and_pair_and_rendered():
    fs = [F("a", "leftover-debug", "x.ts", 1, ident=A), F("a", "leftover-debug", "y.php", 2, "php", ident=B)]
    ls = labels(a=[E("leftover-debug", "x.ts", 1, "true", A),
                   Entry("leftover-debug", "y.php", 2, B, "true", "false-positive", ""),
                   Entry("unreachable", "z.ts", 9, None, "missed", "false-positive", "")])
    per_rule, per_pair, unlabelled = score(fs, ls, RULES)
    rule = {s.key: s for s in per_rule}
    pair = {s.key: s for s in per_pair}
    assert unlabelled == []
    assert rule["leftover-debug"].excluded == 1 and rule["unreachable"].excluded == 1
    assert counts(per_rule, "unreachable") == (0, 0, 0)
    assert pair["leftover-debug@php"].excluded == 1 and pair["leftover-debug@typescript"].excluded == 0
    assert pair["unreachable@typescript"].excluded == 1
    assert bench.score.excluded_count(fs, ls) == 2
    assert bench.score.excluded_count(fs, ls, ran=set()) == 0
    md = render_markdown(per_rule, per_pair, "v0.5.0", 1, 0, rules=RULES, excluded=2)
    assert md.startswith("Locrin v0.5.0, 1 diffs. Left out of the numbers: 0 unlabelled, 2 without an agreed and confirmed label, 0 not applicable, 0 pre-existing and 0 duplicate.\n")
    assert "| `leftover-debug` | on | 100% | 100% | 1 | 0 | 0 | 0 | 1 | 0 | 0 | 0 | n<5, not scored |" in md
    assert "| `leftover-debug@php` | opt-in |  |  | 0 | 0 | 0 | 0 | 1 | 0 | 0 | 0 | n<5, not scored |" in md
    assert "| `unreachable@typescript` | on |  |  | 0 | 0 | 0 | 0 | 1 | 0 | 0 | 0 | n<5, not scored |" in md


def test_unreproduced_lists_every_labelled_finding_entry_no_finding_of_the_run_matches():
    ls = labels(a=[E("unreachable", "x.ts", 2, "true", A), E("unreachable", "x.ts", 4, "false-positive", B),
                   E("unreachable", "x.ts", 6, "not-applicable", C),
                   Entry("unreachable", "x.ts", 8, D, "true", "false-positive", ""),
                   E("unreachable", "x.ts", 9, "missed")],
                b=[E("unreachable", "y.ts", 3, "false-positive", A)])
    fs = [F("a", "unreachable", "x.ts", 2, ident=A)]
    assert [(d, e.line) for d, e in bench.score.unreproduced(fs, ls)] == [("a", 4), ("a", 6), ("a", 8), ("b", 3)]
    assert [(d, e.line) for d, e in bench.score.unreproduced(fs, ls, ran={"a"})] == [("a", 4), ("a", 6), ("a", 8)]


def test_not_applicable_findings_are_counted_per_rule_and_per_pair_and_rendered():
    fs = [F("a", "leftover-debug", "x.ts", 1, ident=A), F("a", "leftover-debug", "gen.php", 2, "php", ident=B)]
    ls = labels(a=[E("leftover-debug", "x.ts", 1, "true", A), E("leftover-debug", "gen.php", 2, "not-applicable", B)])
    per_rule, per_pair, unlabelled = score(fs, ls, RULES)
    assert unlabelled == [] and counts(per_rule, "leftover-debug") == (1, 0, 0)
    assert {s.key: s for s in per_rule}["leftover-debug"].not_applicable == 1
    assert {s.key: s.not_applicable for s in per_pair} == {"leftover-debug@php": 1, "leftover-debug@typescript": 0}
    assert [f.id for f in bench.score.not_applicable(fs, ls)] == [B]
    assert bench.score.not_applicable(fs, ls, ran=set()) == []
    # A not-applicable entry in a file pass two never confirmed has no verdict that counts yet: excluded.
    pending = {"a": LabelFile("a", "v0.5.0", {"by": "a", "date": "d"}, None, ls["a"].entries)}
    assert bench.score.not_applicable(fs, pending) == []
    md = render_markdown(per_rule, per_pair, "v0.5.0", 1, 0, rules=RULES, not_applicable=1)
    assert "0 without an agreed and confirmed label, 1 not applicable, 0 pre-existing and 0 duplicate." in md
    assert "| `leftover-debug` | on | 100% | 100% | 1 | 0 | 0 | 0 | 0 | 1 | 0 | 0 | n<5, not scored |" in md
    assert "| `leftover-debug@php` | opt-in |  |  | 0 | 0 | 0 | 0 | 0 | 1 | 0 | 0 | n<5, not scored |" in md


def test_a_finding_the_parent_run_reports_is_pre_existing():
    at_commit = [F("a", "leftover-debug", "x.ts", 5, ident=A), F("a", "leftover-debug", "x.ts", 9, ident=B),
                 F("a", "dead-file", "y.ts", 1, ident=C), F("a", "leftover-debug", "z.ts", 5, ident=A)]
    # Same rule, file and id at the parent: pre-existing, even when an edit above moved its line.
    at_parent = [F("a", "leftover-debug", "x.ts", 4, ident=A), F("a", "dead-file", "y.ts", 1, ident=C),
                 F("a", "unreachable", "x.ts", 9, ident=B)]
    introduced, preexisting = bench.score.split_preexisting(at_commit, at_parent)
    assert [(f.rule, f.file, f.line) for f in introduced] == [("leftover-debug", "x.ts", 9), ("leftover-debug", "z.ts", 5)]
    assert [(f.rule, f.file, f.line) for f in preexisting] == [("leftover-debug", "x.ts", 5), ("dead-file", "y.ts", 1)]


def _two_diffs_from_one_repository():
    """Two diffs from acme/w and one tree diff. X was already in x.ts before either diff; Y is a
    construct both diffs introduce (say one reverted and the other reapplied it)."""
    X, Y = "e" * 16, "f" * 16
    commit = {"acme__w__1111111": [F("acme__w__1111111", "leftover-debug", "x.ts", 3, ident=X),
                                   F("acme__w__1111111", "leftover-debug", "x.ts", 8, ident=Y)],
              "acme__w__2222222": [F("acme__w__2222222", "leftover-debug", "x.ts", 3, ident=X),
                                   F("acme__w__2222222", "leftover-debug", "x.ts", 8, ident=Y)],
              "fx-01-tree": [F("fx-01-tree", "leftover-debug", "x.ts", 8, ident=Y)]}
    parent = {"acme__w__1111111": [F("acme__w__1111111", "leftover-debug", "x.ts", 3, ident=X)],
              "acme__w__2222222": [F("acme__w__2222222", "leftover-debug", "x.ts", 3, ident=X)],
              "fx-01-tree": []}
    repository = {"acme__w__1111111": "acme/w", "acme__w__2222222": "acme/w", "fx-01-tree": "tree:fx-01-tree"}
    return commit, parent, repository, X, Y


def test_two_diffs_from_one_repository_count_an_unchanged_construct_zero_times_and_an_introduced_one_once():
    commit, parent, repository, X, Y = _two_diffs_from_one_repository()
    introduced, preexisting = [], []
    for d in sorted(commit):
        new, old = bench.score.split_preexisting(commit[d], parent[d])
        introduced += new
        preexisting += old
    first, duplicates = bench.score.split_duplicates(introduced, repository, preexisting)
    assert [(f.diff, f.id) for f in first] == [("acme__w__1111111", Y), ("fx-01-tree", Y)]
    assert [(f.diff, f.id) for f in duplicates] == [("acme__w__2222222", Y)]
    assert [(f.diff, f.id) for f in preexisting] == [("acme__w__1111111", X), ("acme__w__2222222", X)]
    ls = labels(acme__w__1111111=[E("leftover-debug", "x.ts", 8, "true", Y)], acme__w__2222222=[],
                **{"fx-01-tree": [E("leftover-debug", "x.ts", 8, "false-positive", Y)]})
    per_rule, per_pair, unlabelled = score(first, ls, RULES, preexisting=preexisting, duplicates=duplicates)
    row = {s.key: s for s in per_rule}["leftover-debug"]
    assert unlabelled == [] and (row.true, row.false_positive, row.missed) == (1, 1, 0)
    assert (row.preexisting, row.duplicates) == (2, 1)
    assert [(s.key, s.preexisting, s.duplicates) for s in per_pair] == [("leftover-debug@typescript", 2, 1)]
    md = render_markdown(per_rule, per_pair, "v0.5.0", 3, 0, rules=RULES, preexisting=2, duplicates=1)
    assert "0 not applicable, 2 pre-existing and 1 duplicate." in md
    assert "| `leftover-debug` | on | 50% | 100% | 1 | 1 | 0 | 0 | 0 | 0 | 2 | 1 | n<5, not scored |" in md


def test_one_construct_reported_twice_in_its_first_diff_counts_twice_there():
    fs = [F("b", "swallowed-error", "e.ts", 5, ident=A), F("a", "swallowed-error", "e.ts", 5, ident=A),
          F("a", "swallowed-error", "e.ts", 5, ident=A)]
    first, duplicates = bench.score.split_duplicates(fs, {"a": "acme/w", "b": "acme/w"}, [])
    assert [f.diff for f in first] == ["a", "a"] and [f.diff for f in duplicates] == ["b"]


def test_the_parent_count_of_an_id_decides_how_many_occurrences_are_pre_existing():
    # secret-exposed anchors on the provider and the secret value, and test-no-assert on the test case name,
    # so the same literal pasted into a new function, or a second case with an old name, has the parent's id.
    at_commit = [F("a", "secret-exposed", "s.ts", 2, ident=A), F("a", "secret-exposed", "s.ts", 6, ident=A),
                 F("a", "test-no-assert", "a.test.ts", 3, ident=B), F("a", "test-no-assert", "a.test.ts", 8, ident=B),
                 F("a", "test-no-assert", "a.test.ts", 12, ident=B)]
    at_parent = [F("a", "secret-exposed", "s.ts", 2, ident=A), F("a", "test-no-assert", "a.test.ts", 3, ident=B)]
    introduced, preexisting = bench.score.split_preexisting(at_commit, at_parent)
    # Without the added lines, the occurrences on the earliest lines are the ones the parent held.
    assert [(f.file, f.line) for f in introduced] == [("s.ts", 6), ("a.test.ts", 8), ("a.test.ts", 12)]
    assert [(f.file, f.line) for f in preexisting] == [("s.ts", 2), ("a.test.ts", 3)]
    # The change added lines 1 to 4 of s.ts (a new function above the old one) and line 8 of a.test.ts: the
    # occurrences on added lines are introduced first, then the latest lines.
    introduced, preexisting = bench.score.split_preexisting(at_commit, at_parent, {"s.ts": {1, 2, 3, 4}, "a.test.ts": {8}})
    assert [(f.file, f.line) for f in introduced] == [("s.ts", 2), ("a.test.ts", 8), ("a.test.ts", 12)]
    assert [(f.file, f.line) for f in preexisting] == [("s.ts", 6), ("a.test.ts", 3)]
    # The parent held as many as the commit: all pre-existing, whatever lines the change added.
    introduced, preexisting = bench.score.split_preexisting(at_commit[:2], at_commit[:2], {"s.ts": {6}})
    assert introduced == [] and len(preexisting) == 2


def test_files_with_a_repeated_id_are_the_ones_whose_added_lines_matter():
    fs = [F("a", "secret-exposed", "s.ts", 2, ident=A), F("a", "secret-exposed", "s.ts", 6, ident=A),
          F("a", "leftover-debug", "s.ts", 7, ident=A), F("a", "leftover-debug", "t.ts", 1, ident=B)]
    assert bench.score.repeated_files(fs) == ["s.ts"]
    assert bench.score.repeated_files(fs[1:]) == []


def test_a_later_diff_counts_the_occurrences_of_an_id_beyond_those_earlier_diffs_counted():
    # Two diffs from one repository each add a no-assert case named `works` to a.test.ts; the later one adds
    # a second case with that name in another describe block, which no earlier diff counted.
    fs = [F("b", "test-no-assert", "a.test.ts", 3, ident=B), F("b", "test-no-assert", "a.test.ts", 8, ident=B),
          F("a", "test-no-assert", "a.test.ts", 3, ident=B), F("c", "test-no-assert", "a.test.ts", 3, ident=B)]
    first, duplicates = bench.score.split_duplicates(fs, {"a": "acme/w", "b": "acme/w", "c": "acme/w"}, [])
    assert [(f.diff, f.line) for f in first] == [("a", 3), ("b", 8)]
    assert [(f.diff, f.line) for f in duplicates] == [("b", 3), ("c", 3)]


def test_an_occurrence_a_later_diff_adds_beside_one_its_parent_held_is_not_a_duplicate():
    # Linear history: c1 adds a no-assert case `renders`; c2, a child of c1, adds a second case with that name.
    # c2's parent run reports c1's case, so c2's new case is the second occurrence, which no diff counted yet.
    c1 = [F("acme__w__1111111", "test-no-assert", "a.test.ts", 8, ident=B)]
    c2_new = [F("acme__w__2222222", "test-no-assert", "a.test.ts", 13, ident=B)]
    c2_old = [F("acme__w__2222222", "test-no-assert", "a.test.ts", 8, ident=B)]
    repository = {"acme__w__1111111": "acme/w", "acme__w__2222222": "acme/w"}
    first, duplicates = bench.score.split_duplicates(c1 + c2_new, repository, c2_old)
    assert [(f.diff, f.line) for f in first] == [("acme__w__1111111", 8), ("acme__w__2222222", 13)]
    assert duplicates == []
    # Whatever the id order, nothing is a duplicate.
    repository = {"acme__w__2222222": "acme/w", "acme__w__0000000": "acme/w"}
    c0 = [F("acme__w__2222222", "test-no-assert", "a.test.ts", 8, ident=B)]
    later = [F("acme__w__0000000", "test-no-assert", "a.test.ts", 13, ident=B)]
    first, duplicates = bench.score.split_duplicates(c0 + later, repository,
                                                     [F("acme__w__0000000", "test-no-assert", "a.test.ts", 8, ident=B)])
    assert len(first) == 2 and duplicates == []


def test_a_reland_of_an_occurrence_with_the_same_parent_count_is_a_duplicate():
    # Both diffs add the case to a parent that held none of it (a revert and a reland, or parallel branches).
    fs = [F("b", "test-no-assert", "a.test.ts", 13, ident=B), F("a", "test-no-assert", "a.test.ts", 8, ident=B)]
    old = [F("a", "test-no-assert", "a.test.ts", 3, ident=B), F("b", "test-no-assert", "a.test.ts", 3, ident=B)]
    first, duplicates = bench.score.split_duplicates(fs, {"a": "acme/w", "b": "acme/w"}, old)
    assert [(f.diff, f.line) for f in first] == [("a", 8)]
    assert [(f.diff, f.line) for f in duplicates] == [("b", 13)]


def test_repository_of_a_git_diff_is_its_name_and_a_tree_diff_is_its_own():
    git = bench.corpus.Diff("acme__w__1111111", "git", "Acme/W", "1" * 40, "2" * 40, "MIT", "typescript", "u", ["x.ts"])
    tree = bench.corpus.Diff("fx-01-tree", "tree", None, None, None, "MIT", "typescript", "fixture", ["x.ts"])
    assert bench.score.repository_of(git) == "acme/w"
    assert bench.score.repository_of(tree) == "tree:fx-01-tree"
