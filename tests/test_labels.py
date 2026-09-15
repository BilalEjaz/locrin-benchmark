import json
from pathlib import Path

import pytest

import bench.label_tool as label_tool
from bench.label_tool import confirm, main, new, status
from bench.labels import LabelError, disagreements, load_labels
from bench.run import Finding

FIXTURE_LABELS = Path(__file__).resolve().parent.parent / "fixtures" / "labels"


def entry(**over):
    e = {"rule": "leftover-debug", "file": "src/a.ts", "line": 5, "id": "0" * 16, "pass1": "true", "pass2": "true", "note": ""}
    e.update(over)
    return e


def label(tmp_path, entries, diff="fx-01-debug"):
    rec = {"diff": diff, "locrin": "v0.5.0", "pass1": {"by": "a", "date": "2026-09-14"},
           "pass2": {"by": "b", "date": "2026-09-14"}, "entries": entries}
    (tmp_path / f"{diff}.json").write_text(json.dumps(rec), encoding="utf-8")


def test_confirmed_only_when_both_passes_agree(tmp_path):
    label(tmp_path, [entry(), entry(line=9, pass2="false-positive"), entry(line=11, pass1="?", pass2="?")])
    labels = load_labels(tmp_path)
    es = labels["fx-01-debug"].entries
    assert [e.confirmed for e in es] == [True, False, False]
    assert es[0].verdict == "true" and es[1].verdict is None
    assert [(d, e.line) for d, e in disagreements(labels)] == [("fx-01-debug", 9)]


def test_missed_entries_have_null_id_and_reported_ones_do_not(tmp_path):
    label(tmp_path, [entry(id=None, pass1="missed", pass2="missed")])
    assert load_labels(tmp_path)["fx-01-debug"].entries[0].id is None
    label(tmp_path, [entry(id=None)])
    with pytest.raises(LabelError, match="id"):
        load_labels(tmp_path)


def test_missed_entry_with_an_engine_id_and_a_malformed_id_are_rejected(tmp_path):
    label(tmp_path, [entry(pass1="missed", pass2="missed")])
    with pytest.raises(LabelError, match="id"):
        load_labels(tmp_path)
    label(tmp_path, [entry(id="z" * 16)])
    with pytest.raises(LabelError, match="hex"):
        load_labels(tmp_path)


def test_rejects_unknown_verdict_and_diff_mismatch(tmp_path):
    label(tmp_path, [entry(pass1="maybe")])
    with pytest.raises(LabelError, match="verdict"):
        load_labels(tmp_path)
    label(tmp_path, [entry()], diff="wrong")
    (tmp_path / "fx-01-debug.json").unlink()
    (tmp_path / "wrong.json").rename(tmp_path / "fx-01-debug.json")
    with pytest.raises(LabelError, match="diff"):
        load_labels(tmp_path)


def test_unparsable_label_file_raises_label_error_naming_it(tmp_path):
    (tmp_path / "fx-01-debug.json").write_text("{not json", encoding="utf-8")
    with pytest.raises(LabelError, match="fx-01-debug.json"):
        load_labels(tmp_path)


def test_new_writes_template_with_unfilled_passes(tmp_path):
    fs = [Finding("fx-01-debug", "leftover-debug", "src/a.ts", 5, "1" * 16, "high", "typescript")]
    new("fx-01-debug", fs, "v0.5.0", tmp_path, by="opus", date="2026-09-14")
    rec = json.loads((tmp_path / "fx-01-debug.json").read_text())
    assert rec["pass1"] == {"by": "opus", "date": "2026-09-14"} and rec["pass2"] is None
    assert rec["entries"] == [{"rule": "leftover-debug", "file": "src/a.ts", "line": 5, "id": "1" * 16, "pass1": "?", "pass2": "?", "note": ""}]


def test_new_refuses_to_overwrite_an_existing_label_file_unless_forced(tmp_path):
    label(tmp_path, [entry(), entry(line=9, pass1="false-positive", pass2="false-positive")])
    p = tmp_path / "fx-01-debug.json"
    before = p.read_bytes()
    fs = [Finding("fx-01-debug", "leftover-debug", "src/a.ts", 5, "1" * 16, "high", "typescript")]
    with pytest.raises(LabelError, match="already exists.*--force"):
        new("fx-01-debug", fs, "v0.6.0", tmp_path, by="opus", date="2026-10-01")
    assert p.read_bytes() == before
    new("fx-01-debug", fs, "v0.6.0", tmp_path, by="opus", date="2026-10-01", force=True)
    rec = json.loads(p.read_text())
    assert rec["locrin"] == "v0.6.0" and [e["pass1"] for e in rec["entries"]] == ["?"]


def test_cli_new_refuses_an_existing_file_before_running_the_engine_and_force_overwrites(tmp_path, monkeypatch, capsys):
    calls = []

    def fake_findings_for(diff_id, locrin_version, corpus_root, work):
        calls.append(diff_id)
        return [Finding(diff_id, "leftover-debug", "src/a.ts", 5, "2" * 16, "high", "typescript")]

    monkeypatch.setattr(label_tool, "_findings_for", fake_findings_for)
    label(tmp_path, [entry()])
    p = tmp_path / "fx-01-debug.json"
    before = p.read_bytes()
    args = ["new", "fx-01-debug", "--locrin", "v0.6.0", "--by", "opus", "--labels", str(tmp_path)]
    assert main(args) == 1
    assert "--force" in capsys.readouterr().err
    assert p.read_bytes() == before and calls == []
    assert main(args + ["--force"]) == 0
    assert json.loads(p.read_text())["entries"][0]["id"] == "2" * 16


def test_confirm_refuses_an_entry_with_only_one_pass_filled(tmp_path):
    label(tmp_path, [entry(), entry(line=13, pass2="?")])
    with pytest.raises(LabelError, match="unfilled"):
        confirm("fx-01-debug", tmp_path, by="fable", date="2026-09-15")
    label(tmp_path, [entry(), entry(line=13, pass1="?")])
    with pytest.raises(LabelError, match="unfilled"):
        confirm("fx-01-debug", tmp_path, by="fable", date="2026-09-15")


def test_confirm_sets_pass2_metadata_and_refuses_unfilled(tmp_path):
    fs = [Finding("fx-01-debug", "leftover-debug", "src/a.ts", 5, "1" * 16, "high", "typescript")]
    new("fx-01-debug", fs, "v0.5.0", tmp_path, by="opus", date="2026-09-14")
    with pytest.raises(LabelError, match="unfilled"):
        confirm("fx-01-debug", tmp_path, by="fable", date="2026-09-15")
    p = tmp_path / "fx-01-debug.json"
    rec = json.loads(p.read_text())
    rec["entries"][0]["pass1"] = "true"
    rec["entries"][0]["pass2"] = "true"
    p.write_text(json.dumps(rec))
    confirm("fx-01-debug", tmp_path, by="fable", date="2026-09-15")
    assert json.loads(p.read_text())["pass2"] == {"by": "fable", "date": "2026-09-15"}


def _merged(tmp_path, pass2_by="opus-blind"):
    """A label file as `merge` leaves it: every slot filled, pass two named but not yet stamped."""
    rec = {"diff": "fx-01-debug", "locrin": "v0.5.0", "pass1": {"by": "opus", "date": "2026-09-14"},
           "pass2": None, "pass2_by": pass2_by, "entries": [entry()]}
    path = tmp_path / "fx-01-debug.json"
    path.write_text(json.dumps(rec), encoding="utf-8")
    return path


def test_confirm_takes_the_name_the_merge_recorded_when_by_is_not_given(tmp_path):
    path = _merged(tmp_path)
    confirm("fx-01-debug", tmp_path, by=None, date="2026-09-15")
    assert json.loads(path.read_text())["pass2"] == {"by": "opus-blind", "date": "2026-09-15"}


def test_confirm_refuses_a_name_that_is_not_the_one_the_merge_folded_in(tmp_path):
    path = _merged(tmp_path)
    with pytest.raises(LabelError, match="opus-blind"):
        confirm("fx-01-debug", tmp_path, by="fable", date="2026-09-15")
    assert json.loads(path.read_text())["pass2"] is None
    confirm("fx-01-debug", tmp_path, by="fable", date="2026-09-15", force=True)
    rec = json.loads(path.read_text())
    # The forced name is the file's pass two everywhere, so the file never names two labellers.
    assert rec["pass2"] == {"by": "fable", "date": "2026-09-15"} and rec["pass2_by"] == "fable"


def test_cli_confirm_with_force_says_the_pass_two_name_changed(tmp_path, capsys):
    _merged(tmp_path)
    assert main(["confirm", "fx-01-debug", "--by", "fable", "--force", "--labels", str(tmp_path)]) == 0
    out = capsys.readouterr().out
    assert "opus-blind" in out and "fable" in out
    assert main(["confirm", "fx-01-debug", "--labels", str(tmp_path)]) == 0
    assert "opus-blind" not in capsys.readouterr().out


def test_confirm_needs_a_name_when_no_merge_recorded_one(tmp_path):
    label(tmp_path, [entry()])
    with pytest.raises(LabelError, match="--by"):
        confirm("fx-01-debug", tmp_path, by=None, date="2026-09-15")


def test_cli_confirm_takes_the_recorded_name_and_reports_a_mismatch(tmp_path, capsys):
    _merged(tmp_path)
    assert main(["confirm", "fx-01-debug", "--by", "fable", "--labels", str(tmp_path)]) == 1
    assert "label.py: " in capsys.readouterr().err
    assert main(["confirm", "fx-01-debug", "--labels", str(tmp_path)]) == 0


def test_label_files_are_written_with_lf_line_endings(tmp_path):
    fs = [Finding("fx-01-debug", "leftover-debug", "src/a.ts", 5, "1" * 16, "high", "typescript")]
    path = new("fx-01-debug", fs, "v0.5.0", tmp_path, by="opus", date="2026-09-14")
    assert b"\r" not in path.read_bytes()


def test_fixture_labels_load_and_are_all_confirmed():
    labels = load_labels(FIXTURE_LABELS)
    assert len(labels) == 10
    assert disagreements(labels) == []
    assert all(e.confirmed for lf in labels.values() for e in lf.entries)


def test_fixture_labels_carry_a_genuine_false_positive_and_a_genuine_miss():
    labels = load_labels(FIXTURE_LABELS)
    got = sorted((d, e.rule, e.file, e.line, e.verdict) for d, lf in labels.items() for e in lf.entries if e.verdict != "true")
    assert got == [
        ("fx-01-debug", "leftover-debug", "src/logger.ts", 3, "false-positive"),
        ("fx-03-unreachable", "unreachable", "src/c.ts", 9, "missed"),
    ]


def test_status_counts(tmp_path, capsys):
    label(tmp_path, [entry(), entry(line=9, pass2="false-positive"), entry(line=11, pass1="?", pass2="?")])
    status(tmp_path)
    out = capsys.readouterr().out
    assert "fx-01-debug" in out and "confirmed=1" in out and "unfilled=1" in out and "disagree=1" in out


def test_half_filled_entries_count_as_unfilled_and_never_as_disagreements(tmp_path, capsys):
    label(tmp_path, [entry(), entry(line=9, pass2="false-positive"), entry(line=13, pass2="?"),
                     entry(line=15, pass1="?", pass2="missed", id=None)])
    labels = load_labels(tmp_path)
    assert [(d, e.line) for d, e in disagreements(labels)] == [("fx-01-debug", 9)]
    assert [e.confirmed for e in labels["fx-01-debug"].entries] == [True, False, False, False]
    status(tmp_path)
    # Each disagreement is listed under its file's counts, so a maintainer can settle it.
    assert capsys.readouterr().out.splitlines() == [
        "fx-01-debug: entries=4 confirmed=1 unfilled=2 disagree=1",
        "  disagree: leftover-debug src/a.ts:9 pass1=true pass2=false-positive",
    ]


def test_an_adjudication_marked_pending_never_counts_until_it_is_settled(tmp_path):
    # Adjudication never edits the two passes, so the numbers cannot depend on a note. Should a
    # maintainer edit them anyway, a note that still says pending keeps the entry out of the numbers.
    label(tmp_path, [entry(note="adjudicated (opus), pending Fable review"),
                     entry(line=9, note="settled: the print is in a CLI script's main path")])
    es = load_labels(tmp_path)["fx-01-debug"].entries
    assert [e.confirmed for e in es] == [False, True]
    assert es[0].verdict is None and es[1].verdict == "true"


def test_cli_new_runs_the_harness_for_that_diff_and_keys_the_cache_on_it(tmp_path, monkeypatch):
    calls = {}

    def fake_findings_for(diff_id, locrin_version, corpus_root, work):
        calls["args"] = (diff_id, locrin_version, corpus_root)
        return [Finding(diff_id, "leftover-debug", "src/a.ts", 5, "2" * 16, "high", "typescript")]

    monkeypatch.setattr(label_tool, "_findings_for", fake_findings_for)
    out = tmp_path / "labels"
    rc = main(["new", "fx-01-debug", "--locrin", "v0.5.0", "--by", "opus", "--corpus", "fixtures/corpus", "--labels", str(out)])
    assert rc == 0
    assert calls["args"] == ("fx-01-debug", "v0.5.0", Path("fixtures/corpus"))
    rec = json.loads((out / "fx-01-debug.json").read_text())
    assert rec["entries"][0]["id"] == "2" * 16 and rec["pass1"]["by"] == "opus"


def test_findings_for_templates_only_what_the_diff_introduced_first_in_its_repository(tmp_path, monkeypatch, capsys):
    import bench.corpus
    import bench.materialise
    import bench.run
    from bench.corpus import Diff

    def git(ident):
        return Diff(ident, "git", "acme/w", ident[-1] * 40, "0" * 40, "MIT", "typescript", "u", ["x.ts"])

    diffs = [git("acme__w__1111111"), git("acme__w__2222222"), git("acme__w__3333333"),
             Diff("fx-01-tree", "tree", None, None, None, "MIT", "typescript", "fixture", ["x.ts"])]
    X, Y, Z = "e" * 16, "f" * 16, "9" * 16

    def result(line, ident):
        return {"ruleId": "leftover-debug", "partialFingerprints": {"locrin/id": ident},
                "locations": [{"physicalLocation": {"artifactLocation": {"uri": "x.ts"}, "region": {"startLine": line}}}]}

    # X was in x.ts before any diff; Y is introduced by 1111111 and again by 2222222; Z only by 2222222.
    at_commit = {"acme__w__1111111": [result(3, X), result(8, Y)],
                 "acme__w__2222222": [result(3, X), result(8, Y), result(9, Z)],
                 "acme__w__3333333": [result(3, X)], "fx-01-tree": [result(8, Y)]}
    calls = []
    monkeypatch.setattr(bench.corpus, "load_corpus", lambda root: diffs)
    monkeypatch.setattr(bench.run, "install_locrin", lambda version, cache: Path("locrin"))
    monkeypatch.setattr(bench.materialise, "materialise", lambda diff, root, cache: diff.id)

    def fake_run_check(locrin, checkout, work, diff_id):
        calls.append(("commit", diff_id, work))
        return {"runs": [{"results": at_commit[diff_id], "tool": {"driver": {"rules": []}}}]}

    def fake_check_parent(locrin, diff, checkout, cache, work, findings):
        calls.append(("parent", diff.id, cache, sorted({f.file for f in findings})))
        return [f for f in findings if f.id == X]

    monkeypatch.setattr(bench.run, "run_check", fake_run_check)
    monkeypatch.setattr(bench.run, "check_parent", fake_check_parent)
    got = label_tool._findings_for("acme__w__2222222", "v0.5.0", Path("corpus"), tmp_path)
    assert [(f.diff, f.line, f.id) for f in got] == [("acme__w__2222222", 9, Z)]
    # The labeller is told which earlier diffs from the repository already count what they introduced.
    assert "earlier diffs from this repository: acme__w__1111111" in capsys.readouterr().err
    # The earlier diff from the same repository ran too, the later one and the tree diff did not.
    assert calls == [("commit", "acme__w__1111111", tmp_path / ".work"), ("parent", "acme__w__1111111", tmp_path / ".cache", ["x.ts"]),
                     ("commit", "acme__w__2222222", tmp_path / ".work"), ("parent", "acme__w__2222222", tmp_path / ".cache", ["x.ts"])]
    assert label_tool._findings_for("acme__w__3333333", "v0.5.0", Path("corpus"), tmp_path) == []
    assert [(f.diff, f.id) for f in label_tool._findings_for("fx-01-tree", "v0.5.0", Path("corpus"), tmp_path)] == [("fx-01-tree", Y)]


def test_findings_for_templates_an_occurrence_a_child_diff_adds_beside_one_its_parent_held(tmp_path, monkeypatch):
    # Linear history: 1111111 adds a no-assert case `renders`; 2222222, its child, adds a second case with that
    # name. The child's parent run reports the first, so the child's new case is introduced, not a duplicate.
    import bench.corpus
    import bench.materialise
    import bench.run
    from bench.corpus import Diff

    diffs = [Diff(i, "git", "acme/w", i[-1] * 40, "0" * 40, "MIT", "typescript", "u", ["a.test.ts"])
             for i in ("acme__w__1111111", "acme__w__2222222")]
    W = "d" * 16

    def result(line):
        return {"ruleId": "test-no-assert", "partialFingerprints": {"locrin/id": W},
                "locations": [{"physicalLocation": {"artifactLocation": {"uri": "a.test.ts"}, "region": {"startLine": line}}}]}

    at_commit = {"acme__w__1111111": [result(8)], "acme__w__2222222": [result(8), result(13)]}
    monkeypatch.setattr(bench.corpus, "load_corpus", lambda root: diffs)
    monkeypatch.setattr(bench.run, "install_locrin", lambda version, cache: Path("locrin"))
    monkeypatch.setattr(bench.materialise, "materialise", lambda diff, root, cache: diff.id)
    monkeypatch.setattr(bench.materialise, "added_lines", lambda diff, co, cache, files: {"a.test.ts": {11, 12, 13}})
    monkeypatch.setattr(bench.run, "run_check", lambda locrin, checkout, work, diff_id: {
        "runs": [{"results": at_commit[diff_id], "tool": {"driver": {"rules": []}}}]})
    monkeypatch.setattr(bench.run, "check_parent", lambda locrin, diff, checkout, cache, work, findings:
                        findings[:1] if diff.id.endswith("2") else [])
    got = label_tool._findings_for("acme__w__2222222", "v0.5.0", Path("corpus"), tmp_path)
    assert [(f.diff, f.line) for f in got] == [("acme__w__2222222", 13)]
    assert [(f.diff, f.line) for f in label_tool._findings_for("acme__w__1111111", "v0.5.0", Path("corpus"), tmp_path)] == [
        ("acme__w__1111111", 8)]


def test_cli_confirm_refusal_exits_1(tmp_path, capsys):
    fs = [Finding("fx-01-debug", "leftover-debug", "src/a.ts", 5, "1" * 16, "high", "typescript")]
    new("fx-01-debug", fs, "v0.5.0", tmp_path, by="opus", date="2026-09-14")
    assert main(["confirm", "fx-01-debug", "--by", "fable", "--labels", str(tmp_path)]) == 1
    assert "unfilled" in capsys.readouterr().err


@pytest.mark.parametrize("error", [AttributeError("'NoneType' object has no attribute 'split'"),
                                   "materialise", "run"])
def test_cli_new_reports_a_harness_failure_naming_the_diff_and_exits_1(tmp_path, monkeypatch, capsys, error):
    from bench.materialise import MaterialiseError
    from bench.run import RunError

    exc = {"materialise": MaterialiseError("fx-01-debug: git clone failed: x"),
           "run": RunError("fx-01-debug: locrin exit 2: bad")}.get(error, error)

    def failing(diff_id, locrin_version, corpus_root, work):
        raise exc

    monkeypatch.setattr(label_tool, "_findings_for", failing)
    rc = main(["new", "fx-01-debug", "--locrin", "v0.5.0", "--by", "opus", "--labels", str(tmp_path / "labels")])
    assert rc == 1
    err = capsys.readouterr().err
    assert err.startswith("label.py: fx-01-debug: ") and "Traceback" not in err
    assert not (tmp_path / "labels" / "fx-01-debug.json").exists()


@pytest.mark.parametrize("value", [False, {}, "", {"by": "b"}, {"by": "", "date": "d"}, {"by": "b", "date": 3}, []])
@pytest.mark.parametrize("which", ["pass1", "pass2"])
def test_pass_metadata_is_null_or_names_who_and_when(tmp_path, which, value):
    label(tmp_path, [entry()])
    p = tmp_path / "fx-01-debug.json"
    raw = json.loads(p.read_text(encoding="utf-8"))
    raw[which] = value
    p.write_text(json.dumps(raw), encoding="utf-8")
    with pytest.raises(LabelError, match=which):
        load_labels(tmp_path)
    raw[which] = None
    p.write_text(json.dumps(raw), encoding="utf-8")
    assert getattr(load_labels(tmp_path)["fx-01-debug"], which) is None


@pytest.mark.parametrize("other", ["true", "not-applicable"])
def test_a_missed_entry_only_one_pass_found_takes_missed_false_positive_or_unfilled_from_the_other(tmp_path, other):
    for ok in ("missed", "false-positive", "?"):
        label(tmp_path, [entry(id=None, pass1="missed", pass2=ok), entry(id=None, line=7, pass1=ok, pass2="missed")])
        load_labels(tmp_path)
    label(tmp_path, [entry(id=None, pass1="missed", pass2=other)])
    with pytest.raises(LabelError, match="missed"):
        load_labels(tmp_path)


@pytest.mark.parametrize("file", ["../x.ts", "/etc/x.ts", "src\\a.ts", "C:/x.ts", "src/./a.ts", "src/"])
def test_an_entry_file_is_a_relative_forward_slash_path(tmp_path, file):
    label(tmp_path, [entry(file=file)])
    with pytest.raises(LabelError, match="file"):
        load_labels(tmp_path)


def test_new_writes_the_version_as_the_release_tag(tmp_path, monkeypatch):
    monkeypatch.setattr(label_tool, "_findings_for", lambda diff_id, locrin_version, corpus_root, work: [])
    for given in ("0.5.0", "v0.5.0"):
        assert main(["new", "fx-01-debug", "--locrin", given, "--by", "opus", "--labels", str(tmp_path), "--force"]) == 0
        assert json.loads((tmp_path / "fx-01-debug.json").read_text())["locrin"] == "v0.5.0"


def test_invalid_missed_names_repeats_unknown_rules_and_files_or_lines_the_commit_lacks(tmp_path):
    from bench.labels import LabelFile, invalid_missed, load_label_file

    root = tmp_path / "checkout"
    (root / "src").mkdir(parents=True)
    (root / "src" / "c.ts").write_bytes(b"one\ntwo\nthree")
    (root / "src" / "d.ts").write_bytes(b"one\ntwo\n")
    (root / "src" / "dir.ts").mkdir()
    label(tmp_path, [
        entry(rule="unreachable", file="src/c.ts", line=3, id=None, pass1="missed", pass2="missed"),
        entry(rule="unreachable", file="src/c.ts", line=3, id=None, pass1="missed", pass2="false-positive"),
        entry(rule="unreachable", file="src/d.ts", line=2, id=None, pass1="missed", pass2="missed"),
        entry(rule="unreachable", file="src/d.ts", line=3, id=None, pass1="missed", pass2="missed"),
        entry(rule="unreachable", file="src/gone.ts", line=1, id=None, pass1="missed", pass2="missed"),
        entry(rule="unreachable", file="src/dir.ts", line=1, id=None, pass1="missed", pass2="missed"),
        entry(rule="leftover-debugg", file="src/d.ts", line=1, id=None, pass1="missed", pass2="missed"),
        # A reported finding's entry on a missed entry's line is not a repeat.
        entry(rule="unreachable", file="src/c.ts", line=3, id="1" * 16),
    ])
    lf = load_label_file(tmp_path / "fx-01-debug.json")
    got = invalid_missed(lf, root, {"unreachable", "leftover-debug"})
    assert [(p["rule"], p["file"], p["line"], p["problem"]) for p in got] == [
        ("unreachable", "src/c.ts", 3, "repeats another missed entry on the same rule, file and line"),
        ("unreachable", "src/d.ts", 3, "line 3 is past the end of src/d.ts (2 lines) at the commit"),
        ("unreachable", "src/gone.ts", 1, "src/gone.ts is not a file at the commit"),
        ("unreachable", "src/dir.ts", 1, "src/dir.ts is not a file at the commit"),
        ("leftover-debugg", "src/d.ts", 1, "leftover-debugg is not a rule this locrin version has"),
    ]
    assert all(p["diff"] == "fx-01-debug" for p in got)
    assert invalid_missed(LabelFile("fx-01-debug", "v0.5.0", None, None, []), root, set()) == []


def test_a_missed_entry_on_a_finding_the_run_reported_and_left_out_is_invalid(tmp_path):
    from bench.labels import dropped_missed, load_label_file
    from bench.run import Finding

    label(tmp_path, [
        entry(rule="secret-exposed", file="src/s.ts", line=6, id=None, pass1="missed", pass2="missed"),
        entry(rule="secret-exposed", file="src/s.ts", line=7, id=None, pass1="missed", pass2="?"),
        entry(rule="leftover-debug", file="src/s.ts", line=6, id=None, pass1="missed", pass2="missed"),
        entry(rule="secret-exposed", file="src/s.ts", line=6, id="1" * 16),
    ])
    lf = load_label_file(tmp_path / "fx-01-debug.json")
    # The engine reported secret-exposed at src/s.ts:6 and the run left it out as pre-existing or a duplicate.
    left_out = [Finding("fx-01-debug", "secret-exposed", "src/s.ts", 6, "1" * 16, "high", "typescript"),
                Finding("fx-01-debug", "secret-exposed", "src/t.ts", 7, "1" * 16, "high", "typescript")]
    assert dropped_missed(lf, left_out) == [{
        "diff": "fx-01-debug", "rule": "secret-exposed", "file": "src/s.ts", "line": 6,
        "problem": "the engine reported secret-exposed here and the run left it out as pre-existing or a duplicate"}]
    assert dropped_missed(lf, []) == []
