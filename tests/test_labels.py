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


def test_findings_for_passes_the_diff_id_to_run_check(tmp_path, monkeypatch):
    import bench.materialise
    import bench.run

    seen = {}
    monkeypatch.setattr(bench.run, "install_locrin", lambda version, cache: Path("locrin"))
    monkeypatch.setattr(bench.materialise, "materialise", lambda diff, root, cache: "checkout")

    def fake_run_check(locrin, checkout, work, diff_id):
        seen["run_check"] = (checkout, work, diff_id)
        return {"runs": [{"results": [], "tool": {"driver": {"rules": []}}}]}

    monkeypatch.setattr(bench.run, "run_check", fake_run_check)
    corpus_root = Path(__file__).resolve().parent.parent / "fixtures" / "corpus"
    assert label_tool._findings_for("fx-10-clean", "v0.5.0", corpus_root, tmp_path) == []
    assert seen["run_check"] == ("checkout", tmp_path / ".work", "fx-10-clean")


def test_cli_confirm_refusal_exits_1(tmp_path, capsys):
    fs = [Finding("fx-01-debug", "leftover-debug", "src/a.ts", 5, "1" * 16, "high", "typescript")]
    new("fx-01-debug", fs, "v0.5.0", tmp_path, by="opus", date="2026-09-14")
    assert main(["confirm", "fx-01-debug", "--by", "fable", "--labels", str(tmp_path)]) == 1
    assert "unfilled" in capsys.readouterr().err
