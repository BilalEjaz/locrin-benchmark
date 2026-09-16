import json
from pathlib import Path

import pytest

import bench.label_tool as label_tool
from bench.label_tool import carry, confirm, main
from bench.labels import LabelError, load_label_file, save_label_file
from bench.run import Finding

DIFF = "fx-01-debug"
OLD, NEW = "v0.5.0", "v0.6.0"


def entry(**over):
    e = {"rule": "leftover-debug", "file": "src/a.ts", "line": 5, "id": "0" * 16, "pass1": "true", "pass2": "true",
         "note": ""}
    e.update(over)
    return e


def label(tmp_path, entries, diff=DIFF, locrin=OLD, pass2=True, pass2_by=None, root="labels"):
    """A label file as the passes leave it: pass one stamped, pass two stamped once it is confirmed."""
    out = tmp_path / root
    out.mkdir(parents=True, exist_ok=True)
    rec = {"diff": diff, "locrin": locrin, "pass1": {"by": "opus", "date": "2026-09-14"},
           "pass2": {"by": "fable", "date": "2026-09-15"} if pass2 else None, "entries": entries}
    if pass2_by is not None:
        rec["pass2_by"] = pass2_by
    (out / f"{diff}.json").write_text(json.dumps(rec, indent=2) + "\n", encoding="utf-8")
    return out


def finding(**over):
    f = {"diff": DIFF, "rule": "leftover-debug", "file": "src/a.ts", "line": 5, "id": "0" * 16, "confidence": "high",
         "language": "typescript"}
    f.update(over)
    return Finding(**f)


def entries_of(root, diff=DIFF):
    return [(e.rule, e.file, e.line, e.id, e.pass1, e.pass2, e.note) for e in load_label_file(root / f"{diff}.json").entries]


def test_carry_takes_every_verdict_over_when_the_new_version_reports_the_same_findings(tmp_path):
    root = label(tmp_path, [entry(note="a debug print in library code"),
                            entry(line=9, id="1" * 16, pass1="false-positive", pass2="false-positive")])
    counts = carry(DIFF, [finding(), finding(line=9, id="1" * 16)], root / f"{DIFF}.json", NEW, root,
                   date="2026-10-01")
    assert counts == {"carried": 2, "new": 0, "inferred": 0, "dropped_missed": 0, "dropped_reported": 0}
    assert entries_of(root) == [
        ("leftover-debug", "src/a.ts", 5, "0" * 16, "true", "true", "a debug print in library code"),
        ("leftover-debug", "src/a.ts", 9, "1" * 16, "false-positive", "false-positive", ""),
    ]
    lf = load_label_file(root / f"{DIFF}.json")
    # Nothing is left to judge, so the file is confirmed for the new version, under the old file's names.
    assert lf.locrin == NEW and lf.carried_from == OLD
    assert lf.pass1 == {"by": "opus", "date": "2026-10-01"} and lf.pass2 == {"by": "fable", "date": "2026-10-01"}
    assert lf.pass2_by == "fable"


def test_a_finding_the_new_version_reports_and_the_old_file_does_not_hold_is_left_for_both_passes(tmp_path):
    root = label(tmp_path, [entry()])
    counts = carry(DIFF, [finding(), finding(line=9, id="1" * 16)], root / f"{DIFF}.json", NEW, root, date="2026-10-01")
    assert (counts["carried"], counts["new"]) == (1, 1)
    assert entries_of(root)[1] == ("leftover-debug", "src/a.ts", 9, "1" * 16, "?", "?", "")
    # A file with an entry neither pass has judged is not confirmed, and confirm refuses it.
    assert load_label_file(root / f"{DIFF}.json").pass2 is None
    with pytest.raises(LabelError, match="unfilled"):
        confirm(DIFF, root, by=None, date="2026-10-01")
    record = json.loads((root / f"{DIFF}.json").read_text(encoding="utf-8"))
    record["entries"][1]["pass1"] = record["entries"][1]["pass2"] = "true"
    (root / f"{DIFF}.json").write_text(json.dumps(record, indent=2) + "\n", encoding="utf-8")
    # `confirm` takes the pass two name the carry brought over, so it needs no --by.
    confirm(DIFF, root, by=None, date="2026-10-02")
    assert load_label_file(root / f"{DIFF}.json").pass2 == {"by": "fable", "date": "2026-10-02"}


def test_a_missed_entry_the_new_version_reports_is_dropped_and_its_verdict_inferred(tmp_path):
    root = label(tmp_path, [entry(line=9, id=None, pass1="missed", pass2="missed", note="the print above the guard")])
    counts = carry(DIFF, [finding(line=9, id="1" * 16)], root / f"{DIFF}.json", NEW, root, date="2026-10-01")
    assert (counts["inferred"], counts["dropped_missed"], counts["new"]) == (1, 1, 0)
    assert entries_of(root) == [("leftover-debug", "src/a.ts", 9, "1" * 16, "true", "true",
                                 f"carried from {OLD}: both passes wrote this as a missed entry, "
                                 "and the engine now reports it")]
    assert load_label_file(root / f"{DIFF}.json").pass2 == {"by": "fable", "date": "2026-10-01"}


def test_a_missed_entry_the_passes_did_not_agree_on_is_dropped_and_nothing_is_inferred(tmp_path):
    """Only an agreed miss infers a verdict: a disputed one says the two passes read the construct differently."""
    root = label(tmp_path, [entry(line=9, id=None, pass1="missed", pass2="false-positive")])
    counts = carry(DIFF, [finding(line=9, id="1" * 16)], root / f"{DIFF}.json", NEW, root, date="2026-10-01")
    assert (counts["inferred"], counts["dropped_missed"], counts["new"]) == (0, 1, 1)
    assert entries_of(root) == [("leftover-debug", "src/a.ts", 9, "1" * 16, "?", "?", "")]


def test_a_missed_entry_the_new_version_still_does_not_report_is_carried_verbatim(tmp_path):
    root = label(tmp_path, [entry(), entry(line=9, id=None, pass1="missed", pass2="missed", note="the second print")])
    counts = carry(DIFF, [finding()], root / f"{DIFF}.json", NEW, root, date="2026-10-01")
    assert (counts["carried"], counts["dropped_missed"]) == (2, 0)
    assert entries_of(root)[1] == ("leftover-debug", "src/a.ts", 9, None, "missed", "missed", "the second print")


def test_an_entry_the_new_version_no_longer_reports_is_dropped_and_counted(tmp_path):
    root = label(tmp_path, [entry(), entry(line=9, id="1" * 16, pass1="false-positive", pass2="false-positive")])
    counts = carry(DIFF, [finding()], root / f"{DIFF}.json", NEW, root, date="2026-10-01")
    assert (counts["carried"], counts["dropped_reported"]) == (1, 1)
    assert entries_of(root) == [("leftover-debug", "src/a.ts", 5, "0" * 16, "true", "true", "")]


def test_carry_matches_on_the_engine_id_so_a_moved_finding_is_judged_again(tmp_path):
    root = label(tmp_path, [entry(note="the same construct, another id")])
    counts = carry(DIFF, [finding(id="1" * 16)], root / f"{DIFF}.json", NEW, root, date="2026-10-01")
    assert (counts["carried"], counts["new"], counts["dropped_reported"]) == (0, 1, 1)
    assert entries_of(root) == [("leftover-debug", "src/a.ts", 5, "1" * 16, "?", "?", "")]


def test_carry_refuses_an_existing_file_for_the_new_version_unless_forced(tmp_path):
    source = label(tmp_path, [entry()], root="old")
    root = label(tmp_path, [entry(line=9, id="1" * 16)], locrin=NEW)
    before = (root / f"{DIFF}.json").read_bytes()
    with pytest.raises(LabelError, match="already exists.*--force"):
        carry(DIFF, [finding()], source / f"{DIFF}.json", NEW, root, date="2026-10-01")
    assert (root / f"{DIFF}.json").read_bytes() == before
    carry(DIFF, [finding()], source / f"{DIFF}.json", NEW, root, date="2026-10-01", force=True)
    assert entries_of(root) == [("leftover-debug", "src/a.ts", 5, "0" * 16, "true", "true", "")]


def test_carry_refuses_a_file_already_written_for_the_new_version(tmp_path):
    root = label(tmp_path, [entry()], locrin=NEW)
    with pytest.raises(LabelError, match=NEW):
        carry(DIFF, [finding()], root / f"{DIFF}.json", NEW, root, date="2026-10-01")


def test_carry_refuses_a_diff_with_no_label_file_and_a_file_for_another_diff(tmp_path):
    root = label(tmp_path, [entry()])
    with pytest.raises(LabelError, match="cannot read"):
        carry("fx-02-unused-import", [finding()], root / "fx-02-unused-import.json", NEW, root, date="2026-10-01")
    with pytest.raises(LabelError, match=DIFF):
        carry("fx-02-unused-import", [finding()], root / f"{DIFF}.json", NEW, root, date="2026-10-01")


def test_carry_dry_run_counts_and_writes_nothing(tmp_path):
    root = label(tmp_path, [entry(), entry(line=9, id="1" * 16)])
    before = (root / f"{DIFF}.json").read_bytes()
    counts = carry(DIFF, [finding(), finding(line=11, id="2" * 16)], root / f"{DIFF}.json", NEW, root,
                   date="2026-10-01", dry_run=True)
    assert (counts["carried"], counts["new"], counts["dropped_reported"]) == (1, 1, 1)
    assert (root / f"{DIFF}.json").read_bytes() == before


def test_carried_from_survives_a_round_trip_and_a_file_without_it_still_loads(tmp_path):
    root = label(tmp_path, [entry()])
    assert load_label_file(root / f"{DIFF}.json").carried_from == ""
    lf = load_label_file(root / f"{DIFF}.json")
    lf.carried_from = OLD
    save_label_file(root, lf)
    assert json.loads((root / f"{DIFF}.json").read_text(encoding="utf-8"))["carried_from"] == OLD
    assert load_label_file(root / f"{DIFF}.json").carried_from == OLD
    raw = json.loads((root / f"{DIFF}.json").read_text(encoding="utf-8"))
    raw["carried_from"] = 3
    (root / f"{DIFF}.json").write_text(json.dumps(raw), encoding="utf-8")
    with pytest.raises(LabelError, match="carried_from"):
        load_label_file(root / f"{DIFF}.json")


def test_cli_carry_runs_the_engine_for_the_new_version_and_prints_one_line(tmp_path, monkeypatch, capsys):
    calls = []

    def fake_findings_for(diff_id, locrin_version, corpus_root, work):
        calls.append((diff_id, locrin_version, corpus_root))
        return [finding(), finding(line=9, id="1" * 16)]

    monkeypatch.setattr(label_tool, "_findings_for", fake_findings_for)
    root = label(tmp_path, [entry()])
    rc = main(["carry", DIFF, "--locrin", "0.6.0", "--corpus", "fixtures/corpus", "--labels", str(root)])
    assert rc == 0
    # The version is normalised as `new` normalises it, so 0.6.0 and v0.6.0 name one version.
    assert calls == [(DIFF, NEW, Path("fixtures/corpus"))]
    out = capsys.readouterr().out.splitlines()
    assert len(out) == 1 and out[0].startswith(f"{DIFF}: ") and OLD in out[0] and NEW in out[0]
    assert load_label_file(root / f"{DIFF}.json").locrin == NEW


def test_cli_carry_refuses_before_running_the_engine_and_reports_the_refusal(tmp_path, monkeypatch, capsys):
    calls = []
    monkeypatch.setattr(label_tool, "_findings_for",
                        lambda diff_id, locrin_version, corpus_root, work: calls.append(diff_id) or [])
    source = label(tmp_path, [entry()], root="old")
    root = label(tmp_path, [entry()], locrin=NEW)
    before = (root / f"{DIFF}.json").read_bytes()
    args = ["carry", DIFF, "--locrin", NEW, "--from", str(source / f"{DIFF}.json"), "--labels", str(root)]
    assert main(args) == 1
    assert "--force" in capsys.readouterr().err
    assert calls == [] and (root / f"{DIFF}.json").read_bytes() == before
    assert main(args + ["--force"]) == 0
    assert calls == [DIFF]


def test_cli_carry_dry_run_writes_nothing_and_says_so(tmp_path, monkeypatch, capsys):
    monkeypatch.setattr(label_tool, "_findings_for", lambda diff_id, locrin_version, corpus_root, work: [finding()])
    root = label(tmp_path, [entry()])
    before = (root / f"{DIFF}.json").read_bytes()
    assert main(["carry", DIFF, "--locrin", NEW, "--labels", str(root), "--dry-run"]) == 0
    assert "would" in capsys.readouterr().out
    assert (root / f"{DIFF}.json").read_bytes() == before
