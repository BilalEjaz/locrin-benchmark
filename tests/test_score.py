import json
from pathlib import Path

import bench.corpus
import bench.score
from bench.labels import Entry, LabelFile, load_labels
from bench.run import Finding, RuleMeta, normalise
from bench.score import Score, render_markdown, score

ROOT = Path(__file__).resolve().parent.parent


def F(diff, rule, file, line, lang="typescript"):
    return Finding(diff, rule, file, line, "0" * 16, "high", lang)


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
    assert "| `dead-file` | off | 100% | 100% | 1 | 0 | 0 | n<5, not scored |" in md
    assert "not benchmarked: advisory feed changes daily" in md
    assert "Locrin v0.5.0" in md and "10 diffs" in md


def test_language_of_is_imported_at_module_top():
    assert bench.score.language_of is bench.corpus.language_of


def test_scored_rows_need_five_and_ships_column_reads_rule_metadata():
    fs = [F("a", "dead-file", f"f{i}.ts", 1) for i in range(5)]
    ls = labels(a=[E("dead-file", f"f{i}.ts", 1, "true") for i in range(4)] + [E("dead-file", "f4.ts", 1, "false-positive")])
    per_rule, per_pair, _ = score(fs, ls, RULES)
    by = {s.key: s for s in per_rule}
    assert by["dead-file"].scored is True and by["dead-file"].reason == "" and by["dead-file"].precision == 0.8
    md = render_markdown(per_rule, per_pair, "v0.5.0", corpus_size=1, unlabelled=0, rules=RULES)
    assert "| `dead-file` | off | 80% (below line) | 100% | 4 | 1 | 0 |  |" in md
    assert "| `dead-file@typescript` | off | 80% (below line) |" in md


def test_secret_exposed_ships_locked():
    md = render_markdown([Score("secret-exposed", 1, 0, 0, 1.0, 1.0, False, "n<5, not scored")], [], "v0.5.0", 1, 0,
                         rules={"secret-exposed": RuleMeta("secret-exposed", True, ["typescript"])})
    assert "| `secret-exposed` | locked | 100% | 100% | 1 | 0 | 0 | n<5, not scored |" in md


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
    assert md.startswith("Locrin v0.5.0, 2 diffs, 3 unlabelled findings.\n\n| Rule | Ships | Precision | Recall | True | False positive | Missed | Note |\n")
    assert "| `dead-export` | on |  |  | 0 | 0 | 0 | n<5, not scored |" in md
    assert "\n\n| Pair | Ships | Precision | Recall | True | False positive | Missed | Note |\n" in md
    assert md.endswith("| `leftover-debug@php` | on | 100% | 100% | 1 | 0 | 0 | n<5, not scored |\n")
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
    assert md.startswith("Locrin v0.5.0, 10 diffs, 0 unlabelled findings.\n")
    assert "| `leftover-debug` | on | 75% | 100% | 3 | 1 | 0 | n<5, not scored |" in md
    assert "| `unreachable` | on | 100% | 50% | 1 | 0 | 1 | n<5, not scored |" in md
    assert "| `dead-file` | off |  |  | 0 | 0 | 0 | n<5, not scored |" in md
    assert "| `vulnerable-dependency` | on |  |  | 0 | 0 | 0 | not benchmarked: advisory feed changes daily |" in md
    assert "| `leftover-debug@typescript` | on | 50% | 100% | 1 | 1 | 0 | n<5, not scored |" in md
