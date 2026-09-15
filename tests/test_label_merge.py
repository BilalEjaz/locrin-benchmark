import json
from pathlib import Path

import pytest

from bench.label_tool import main, merge
from bench.labels import LabelError, load_label_file

DIFF = "fx-01-debug"


def entry(**over):
    e = {"rule": "leftover-debug", "file": "src/a.ts", "line": 5, "id": "0" * 16, "pass1": "true", "pass2": "?", "note": ""}
    e.update(over)
    return e


def label(tmp_path, entries, diff=DIFF):
    """A label file as pass one leaves it: pass1 filled, pass2 still `?`, pass two unrecorded."""
    root = tmp_path / "labels"
    root.mkdir(exist_ok=True)
    rec = {"diff": diff, "locrin": "v0.5.0", "pass1": {"by": "opus", "date": "2026-09-14"}, "pass2": None,
           "entries": entries}
    (root / f"{diff}.json").write_text(json.dumps(rec, indent=2) + "\n", encoding="utf-8")
    return root


def pass2_file(tmp_path, entries, diff=DIFF, by="opus-blind"):
    path = tmp_path / "pass2" / f"{diff}.json"
    path.parent.mkdir(exist_ok=True)
    path.write_text(json.dumps({"diff": diff, "by": by, "entries": entries}, indent=2) + "\n", encoding="utf-8")
    return path


def p2(**over):
    e = {"rule": "leftover-debug", "file": "src/a.ts", "line": 5, "id": "0" * 16, "pass2": "true", "note": ""}
    e.update(over)
    return e


def entries_of(root):
    return [(e.rule, e.file, e.line, e.id, e.pass1, e.pass2, e.note) for e in load_label_file(root / f"{DIFF}.json").entries]


def test_merge_folds_a_reported_verdict_and_the_three_kinds_of_missed_entry(tmp_path):
    root = label(tmp_path, [
        entry(),
        entry(line=9, id=None, pass1="missed"),
        entry(line=11, id=None, pass1="missed"),
    ])
    path = pass2_file(tmp_path, [
        p2(pass2="false-positive"),
        p2(line=11, id=None, pass2="missed"),
        p2(line=13, id=None, pass2="missed"),
    ])
    merge(DIFF, path, root)
    assert entries_of(root) == [
        # A reported entry takes pass two's verdict.
        ("leftover-debug", "src/a.ts", 5, "0" * 16, "true", "false-positive", ""),
        # A missed entry only pass one wrote waits for pass two to look at that construct.
        ("leftover-debug", "src/a.ts", 9, None, "missed", "?", ""),
        # A missed entry both passes wrote is one entry with missed in both.
        ("leftover-debug", "src/a.ts", 11, None, "missed", "missed", ""),
        # A missed entry only pass two wrote is appended, with pass one still to look at it.
        ("leftover-debug", "src/a.ts", 13, None, "?", "missed", ""),
    ]


def test_merge_never_copies_one_passs_missed_into_the_other(tmp_path):
    root = label(tmp_path, [entry(line=9, id=None, pass1="missed", pass2="missed")])
    path = pass2_file(tmp_path, [])
    merge(DIFF, path, root)
    assert entries_of(root) == [("leftover-debug", "src/a.ts", 9, None, "missed", "?", "")]


def test_merge_joins_notes_that_differ_and_keeps_one_that_does_not(tmp_path):
    root = label(tmp_path, [entry(note="the print is in a CLI script"), entry(line=7, note="same note")])
    path = pass2_file(tmp_path, [p2(note="a debug print in library code"), p2(line=7, note="same note")])
    merge(DIFF, path, root)
    notes = [e[-1] for e in entries_of(root)]
    assert notes == ["pass one: the print is in a CLI script pass two: a debug print in library code", "same note"]


def test_merge_records_who_made_pass_two_and_leaves_confirm_to_stamp_it(tmp_path):
    root = label(tmp_path, [entry()])
    merge(DIFF, pass2_file(tmp_path, [p2()], by="fable"), root)
    lf = load_label_file(root / f"{DIFF}.json")
    assert lf.pass2 is None and lf.pass2_by == "fable"


def test_merging_twice_gives_the_same_file(tmp_path):
    root = label(tmp_path, [entry(note="one"), entry(line=9, id=None, pass1="missed"),
                            entry(line=11, id=None, pass1="missed")])
    path = pass2_file(tmp_path, [p2(note="two"), p2(line=11, id=None, pass2="missed", note="two"),
                                 p2(line=13, id=None, pass2="missed")])
    merge(DIFF, path, root)
    once = (root / f"{DIFF}.json").read_bytes()
    merge(DIFF, path, root)
    assert (root / f"{DIFF}.json").read_bytes() == once


def test_merge_refuses_a_pass_two_file_for_another_diff(tmp_path):
    root = label(tmp_path, [entry()])
    path = pass2_file(tmp_path, [p2()], diff=DIFF)
    raw = json.loads(path.read_text(encoding="utf-8"))
    raw["diff"] = "fx-02-other"
    path.write_text(json.dumps(raw), encoding="utf-8")
    with pytest.raises(LabelError, match="fx-02-other"):
        merge(DIFF, path, root)


def test_merge_refuses_a_verdict_outside_the_four_pass_two_may_give(tmp_path):
    root = label(tmp_path, [entry()])
    for verdict in ("?", "maybe", None):
        with pytest.raises(LabelError, match="verdict"):
            merge(DIFF, pass2_file(tmp_path, [p2(pass2=verdict)]), root)


def test_merge_refuses_when_a_reported_entry_is_missing_from_pass_two(tmp_path):
    root = label(tmp_path, [entry(), entry(line=9, id="1" * 16)])
    with pytest.raises(LabelError, match="no pass two verdict"):
        merge(DIFF, pass2_file(tmp_path, [p2()]), root)


def test_merge_refuses_a_pass_two_verdict_for_a_finding_the_label_file_does_not_hold(tmp_path):
    root = label(tmp_path, [entry()])
    with pytest.raises(LabelError, match="not in the label file"):
        merge(DIFF, pass2_file(tmp_path, [p2(), p2(line=9, id="1" * 16)]), root)


def test_merge_refuses_a_pass_two_entry_without_an_id_that_is_not_missed(tmp_path):
    root = label(tmp_path, [entry()])
    with pytest.raises(LabelError, match="without an id"):
        merge(DIFF, pass2_file(tmp_path, [p2(), p2(line=9, id=None, pass2="true")]), root)


def test_merge_refuses_a_pass_two_missed_verdict_on_a_reported_finding(tmp_path):
    root = label(tmp_path, [entry()])
    with pytest.raises(LabelError, match="missed"):
        merge(DIFF, pass2_file(tmp_path, [p2(pass2="missed")]), root)


def test_cli_merge_writes_the_file_and_dry_run_writes_nothing(tmp_path, capsys, monkeypatch):
    root = label(tmp_path, [entry()])
    path = pass2_file(tmp_path, [p2(pass2="false-positive")])
    before = (root / f"{DIFF}.json").read_bytes()
    assert main(["merge", DIFF, "--pass2", str(path), "--labels", str(root), "--dry-run"]) == 0
    assert (root / f"{DIFF}.json").read_bytes() == before
    assert "would" in capsys.readouterr().out
    assert main(["merge", DIFF, "--pass2", str(path), "--labels", str(root)]) == 0
    assert entries_of(root) == [("leftover-debug", "src/a.ts", 5, "0" * 16, "true", "false-positive", "")]


def test_cli_merge_defaults_to_the_work_pass2_directory_and_reports_a_refusal(tmp_path, capsys, monkeypatch):
    root = label(tmp_path, [entry()])
    work = tmp_path / ".work" / "pass2"
    work.mkdir(parents=True)
    (work / f"{DIFF}.json").write_text(json.dumps({"diff": DIFF, "by": "b", "entries": [p2(pass2="?")]}), encoding="utf-8")
    monkeypatch.chdir(tmp_path)
    assert main(["merge", DIFF, "--labels", str(root)]) == 1
    assert "label.py: " in capsys.readouterr().err


def test_cli_merge_reports_a_missing_pass_two_file(tmp_path, capsys):
    root = label(tmp_path, [entry()])
    assert main(["merge", DIFF, "--pass2", str(tmp_path / "nope.json"), "--labels", str(root)]) == 1
    assert "cannot read" in capsys.readouterr().err
