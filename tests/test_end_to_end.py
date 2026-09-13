import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
LOCRIN = shutil.which("locrin")


def _locrin_version() -> str | None:
    if LOCRIN is None:
        return None
    proc = subprocess.run([LOCRIN, "--version"], capture_output=True, text=True)
    words = proc.stdout.split()
    return f"v{words[-1]}" if proc.returncode == 0 and words else None


def _fixture_labels_version() -> str:
    versions = {json.loads(p.read_text(encoding="utf-8"))["locrin"] for p in (ROOT / "fixtures" / "labels").glob("*.json")}
    assert len(versions) == 1, versions
    return versions.pop()


LOCRIN_VERSION = _locrin_version()
FIXTURE_VERSION = _fixture_labels_version()
# The expected numbers below are the fixture labels' truth for one locrin version; another version
# may report differently, which is not a harness failure.
pytestmark = [
    pytest.mark.skipif(LOCRIN is None, reason="locrin not on PATH"),
    pytest.mark.skipif(LOCRIN is not None and LOCRIN_VERSION != FIXTURE_VERSION,
                       reason=f"fixture labels are for locrin {FIXTURE_VERSION}, locrin on PATH is {LOCRIN_VERSION}"),
]

# The truthful fixture labels (Task 5) on locrin 0.5.0: leftover-debug has one genuine false
# positive (src/logger.ts is that module's real logging) and unreachable one genuine miss
# (a literal-condition branch in src/c.ts).
RULE_ROWS = [
    "| `leftover-debug` | on | 75% | 100% | 3 | 1 | 0 | 0 | 0 | n<5, not scored |",
    "| `leftover-commented-code` | on |  |  | 0 | 0 | 0 | 0 | 0 | n<5, not scored |",
    "| `leftover-agent-marker` | on | 100% | 100% | 2 | 0 | 0 | 0 | 0 | n<5, not scored |",
    "| `unused-import` | on | 100% | 100% | 1 | 0 | 0 | 0 | 0 | n<5, not scored |",
    "| `unreachable` | on | 100% | 50% | 1 | 0 | 1 | 0 | 0 | n<5, not scored |",
    "| `dead-file` | off |  |  | 0 | 0 | 0 | 0 | 0 | n<5, not scored |",
    "| `boundary-violation` | on |  |  | 0 | 0 | 0 | 0 | 0 | not benchmarked: needs per-repository config |",
    "| `swallowed-error` | off |  |  | 0 | 0 | 0 | 0 | 0 | n<5, not scored |",
    "| `test-no-assert` | on | 100% | 100% | 1 | 0 | 0 | 0 | 0 | n<5, not scored |",
    "| `secret-exposed` | locked | 100% | 100% | 1 | 0 | 0 | 0 | 0 | n<5, not scored |",
    "| `weak-crypto` | on | 100% | 100% | 1 | 0 | 0 | 0 | 0 | n<5, not scored |",
    "| `injection-sink` | off |  |  | 0 | 0 | 0 | 0 | 0 | n<5, not scored |",
    "| `vulnerable-dependency` | on |  |  | 0 | 0 | 0 | 0 | 0 | not benchmarked: advisory feed changes daily |",
    "| `express-route-without-auth` | on |  |  | 0 | 0 | 0 | 0 | 0 | not benchmarked: needs per-repository config |",
]
PAIR_ROWS = [
    "| `leftover-agent-marker@javascript` | on | 100% | 100% | 2 | 0 | 0 | 0 | 0 | n<5, not scored |",
    "| `leftover-debug@php` | opt-in | 100% | 100% | 1 | 0 | 0 | 0 | 0 | n<5, not scored |",
    "| `leftover-debug@python` | opt-in | 100% | 100% | 1 | 0 | 0 | 0 | 0 | n<5, not scored |",
    "| `leftover-debug@typescript` | on | 50% | 100% | 1 | 1 | 0 | 0 | 0 | n<5, not scored |",
    "| `secret-exposed@typescript` | locked | 100% | 100% | 1 | 0 | 0 | 0 | 0 | n<5, not scored |",
    "| `test-no-assert@typescript` | on | 100% | 100% | 1 | 0 | 0 | 0 | 0 | n<5, not scored |",
    "| `unreachable@typescript` | on | 100% | 50% | 1 | 0 | 1 | 0 | 0 | n<5, not scored |",
    "| `unused-import@typescript` | on | 100% | 100% | 1 | 0 | 0 | 0 | 0 | n<5, not scored |",
    "| `weak-crypto@typescript` | on | 100% | 100% | 1 | 0 | 0 | 0 | 0 | n<5, not scored |",
]


def _hostile_home(tmp_path: Path) -> dict[str, str]:
    """A user home whose global ignore files would drop fixture files from locrin's own file walk."""
    home = tmp_path / "hostile-home"
    (home / ".config" / "git").mkdir(parents=True)
    (home / ".config" / "git" / "ignore").write_bytes(b"lib/\nlogger.ts\n*.py\n")
    (home / "excludes").write_bytes(b"*.php\ntests/\n")
    (home / ".gitconfig").write_bytes(f"[core]\n\texcludesFile = {(home / 'excludes').as_posix()}\n".encode("utf-8"))
    return {"HOME": str(home), "USERPROFILE": str(home), "XDG_CONFIG_HOME": str(home / ".config")}


@pytest.mark.parametrize("home", ["machine", "hostile"])
def test_fixture_corpus_scores_exactly(tmp_path, home):
    version = subprocess.run([LOCRIN, "--version"], capture_output=True, text=True, check=True).stdout.split()[-1]
    env = dict(os.environ, LOCRIN_BIN=LOCRIN)
    if home == "hostile":
        # The same numbers on any machine: a global gitignore must not hide files from the engine.
        env.update(_hostile_home(tmp_path))
    out = tmp_path / "results"
    readme = tmp_path / "README.md"
    readme.write_bytes(b"# r\n\n<!-- results:start -->\nNo results yet.\n<!-- results:end -->\n\n## tail\n")
    proc = subprocess.run(
        [sys.executable, "-m", "bench.main", "--version", f"v{version}", "--corpus", "fixtures/corpus",
         "--labels", "fixtures/labels", "--out", str(out), "--work", str(tmp_path / "work"),
         "--cache", str(tmp_path / "cache"), "--readme", str(readme)],
        cwd=ROOT, env=env, capture_output=True, text=True,
    )
    assert proc.returncode == 0, proc.stdout + proc.stderr
    results = out / f"v{version}"
    run = json.loads((results / "run.json").read_text(encoding="utf-8"))
    assert run["diffs"] == 10 and run["ran"] == 10 and run["run_failures"] == [] and run["materialise_failures"] == []
    assert run["unlabelled"] == 0 and run["excluded"] == 0 and run["gone"] == [] and run["publishable"] is True
    assert run["findings"] == 11
    assert run["locrin"] == f"v{version}"
    assert run["not_publishable"] == [] and run["labels"] == {"versions": [f"v{version}"], "other_version": [], "missing": [],
                                                            "unconfirmed": [], "unreproduced": []}
    from bench import inputs
    assert run["inputs"] == {"corpus": inputs.digest(ROOT / "fixtures" / "corpus"),
                             "labels": inputs.digest(ROOT / "fixtures" / "labels")}

    table = (results / "table.md").read_text(encoding="utf-8")
    lines = table.splitlines()
    assert lines[0] == f"Locrin v{version}, 10 of 10 diffs ran, 0 unlabelled findings, 0 excluded until their label passes agree."
    for row in RULE_ROWS:
        assert row in lines, row
    pair_head = lines.index("| Pair | Ships | Precision | Recall | True | False positive | Missed | Unlabelled | Excluded | Note |")
    assert lines[pair_head + 2:pair_head + 2 + len(PAIR_ROWS)] == PAIR_ROWS
    assert lines[pair_head + 2 + len(PAIR_ROWS):] == [
        "", "Locrin reads PHP and Python only when `[languages]` turns them on, so their pairs ship opt-in; "
            "the benchmark turns both on."]
    # At least one row below 100 percent precision and one below 100 percent recall.
    assert any("| 75% |" in r or "| 50% | 100% |" in r for r in lines)
    assert any("| 100% | 50% |" in r for r in lines)

    findings = [json.loads(line) for line in (results / "findings.jsonl").read_text(encoding="utf-8").splitlines()]
    assert len(findings) == 11
    keys = [(f["diff"], f["rule"], f["file"], f["line"], f["id"]) for f in findings]
    assert keys == sorted(keys)
    assert ("fx-01-debug", "leftover-debug", "src/logger.ts", 3, "01b73e4aa766c158") in keys
    assert not any(f["diff"] == "fx-10-clean" for f in findings)

    for name in ("table.md", "run.json", "findings.jsonl"):
        assert b"\r" not in (results / name).read_bytes(), name
    updated = readme.read_bytes()
    assert b"\r" not in updated
    assert updated == b"# r\n\n<!-- results:start -->\n" + table.encode("utf-8") + b"<!-- results:end -->\n\n## tail\n"


def _as_template(raw: dict) -> dict:
    """A label file as `label.py new` writes it: every finding entry marked `?`, no missed entry, pass two not recorded."""
    return dict(raw, pass2=None, entries=[dict(e, pass1="?", pass2="?") for e in raw["entries"] if e["id"] is not None])


@pytest.mark.parametrize("change", ["unlabelled", "other-version", "pass-two-null", "templates",
                                    "unreproduced-false-positive", "unreproduced-true"])
def test_labels_that_do_not_cover_the_run_publish_nothing(tmp_path, change):
    # A finding a new locrin version adds has no label entry; label files written for another version would
    # score it with stale verdicts; a file pass two never confirmed would drop its findings from the numbers;
    # a labelled finding this run does not report means the run did not reproduce what was labelled. Every
    # one exits 4 and the README keeps its table.
    labels = tmp_path / "labels"
    shutil.copytree(ROOT / "fixtures" / "labels", labels)
    target = labels / "fx-01-debug.json"
    raw = json.loads(target.read_text(encoding="utf-8"))
    if change == "unlabelled":
        raw["entries"] = [e for e in raw["entries"] if e["file"] != "src/logger.ts"]
    elif change == "other-version":
        raw["locrin"] = "v0.4.0"
    elif change == "pass-two-null":
        raw["pass2"] = None
    elif change == "templates":
        for other in labels.glob("*.json"):
            tpl = _as_template(json.loads(other.read_text(encoding="utf-8")))
            other.write_bytes((json.dumps(tpl, indent=2) + "\n").encode("utf-8"))
        raw = _as_template(raw)
    else:
        verdict = change.removeprefix("unreproduced-")
        raw["entries"].append({"rule": "leftover-debug", "file": "src/logger.ts", "line": 7, "id": "f" * 16,
                               "pass1": verdict, "pass2": verdict, "note": "a finding this run does not report"})
    target.write_bytes((json.dumps(raw, indent=2) + "\n").encode("utf-8"))
    readme = tmp_path / "README.md"
    before = b"# r\n\n<!-- results:start -->\nNo results yet.\n<!-- results:end -->\n"
    readme.write_bytes(before)
    out = tmp_path / "results"
    proc = subprocess.run(
        [sys.executable, "-m", "bench.main", "--version", LOCRIN_VERSION, "--corpus", "fixtures/corpus",
         "--labels", str(labels), "--out", str(out), "--work", str(tmp_path / "work"),
         "--cache", str(tmp_path / "cache"), "--readme", str(readme)],
        cwd=ROOT, env=dict(os.environ, LOCRIN_BIN=LOCRIN), capture_output=True, text=True,
    )
    assert proc.returncode == 4, proc.stdout + proc.stderr
    run = json.loads((out / LOCRIN_VERSION / "run.json").read_text(encoding="utf-8"))
    assert run["publishable"] is False and run["ran"] == 10
    assert readme.read_bytes() == before
    table = (out / LOCRIN_VERSION / "table.md").read_text(encoding="utf-8")
    if change == "unlabelled":
        assert run["unlabelled"] == 1
        assert "| `leftover-debug` | on | 100% | 100% | 3 | 0 | 0 | 1 | 0 | n<5, not scored |" in table
    elif change == "other-version":
        assert run["labels"]["other_version"] == ["fx-01-debug"]
    elif change == "pass-two-null":
        assert run["unlabelled"] == 0 and run["labels"]["unconfirmed"] == ["fx-01-debug"]
    elif change == "templates":
        assert run["unlabelled"] == 0 and len(run["labels"]["unconfirmed"]) == 10
    else:
        assert run["unlabelled"] == 0 and run["labels"]["unconfirmed"] == []
        assert [(u["diff"], u["file"], u["line"], u["id"]) for u in run["labels"]["unreproduced"]] == [
            ("fx-01-debug", "src/logger.ts", 7, "f" * 16)]
