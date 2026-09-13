import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
LOCRIN = shutil.which("locrin")
pytestmark = pytest.mark.skipif(LOCRIN is None, reason="locrin not on PATH")

# The truthful fixture labels (Task 5) on locrin 0.5.0: leftover-debug has one genuine false
# positive (src/logger.ts is that module's real logging) and unreachable one genuine miss
# (a literal-condition branch in src/c.ts).
RULE_ROWS = [
    "| `leftover-debug` | on | 75% | 100% | 3 | 1 | 0 | n<5, not scored |",
    "| `leftover-commented-code` | on |  |  | 0 | 0 | 0 | n<5, not scored |",
    "| `leftover-agent-marker` | on | 100% | 100% | 2 | 0 | 0 | n<5, not scored |",
    "| `unused-import` | on | 100% | 100% | 1 | 0 | 0 | n<5, not scored |",
    "| `unreachable` | on | 100% | 50% | 1 | 0 | 1 | n<5, not scored |",
    "| `dead-file` | off |  |  | 0 | 0 | 0 | n<5, not scored |",
    "| `boundary-violation` | on |  |  | 0 | 0 | 0 | not benchmarked: needs per-repository config |",
    "| `swallowed-error` | off |  |  | 0 | 0 | 0 | n<5, not scored |",
    "| `test-no-assert` | on | 100% | 100% | 1 | 0 | 0 | n<5, not scored |",
    "| `secret-exposed` | locked | 100% | 100% | 1 | 0 | 0 | n<5, not scored |",
    "| `weak-crypto` | on | 100% | 100% | 1 | 0 | 0 | n<5, not scored |",
    "| `injection-sink` | off |  |  | 0 | 0 | 0 | n<5, not scored |",
    "| `vulnerable-dependency` | on |  |  | 0 | 0 | 0 | not benchmarked: advisory feed changes daily |",
    "| `express-route-without-auth` | on |  |  | 0 | 0 | 0 | not benchmarked: needs per-repository config |",
]
PAIR_ROWS = [
    "| `leftover-agent-marker@javascript` | on | 100% | 100% | 2 | 0 | 0 | n<5, not scored |",
    "| `leftover-debug@php` | on | 100% | 100% | 1 | 0 | 0 | n<5, not scored |",
    "| `leftover-debug@python` | on | 100% | 100% | 1 | 0 | 0 | n<5, not scored |",
    "| `leftover-debug@typescript` | on | 50% | 100% | 1 | 1 | 0 | n<5, not scored |",
    "| `secret-exposed@typescript` | locked | 100% | 100% | 1 | 0 | 0 | n<5, not scored |",
    "| `test-no-assert@typescript` | on | 100% | 100% | 1 | 0 | 0 | n<5, not scored |",
    "| `unreachable@typescript` | on | 100% | 50% | 1 | 0 | 1 | n<5, not scored |",
    "| `unused-import@typescript` | on | 100% | 100% | 1 | 0 | 0 | n<5, not scored |",
    "| `weak-crypto@typescript` | on | 100% | 100% | 1 | 0 | 0 | n<5, not scored |",
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
    assert run["unlabelled"] == 0
    assert run["findings"] == 11
    assert run["locrin"] == f"v{version}"

    table = (results / "table.md").read_text(encoding="utf-8")
    lines = table.splitlines()
    assert lines[0] == f"Locrin v{version}, 10 of 10 diffs ran, 0 unlabelled findings."
    for row in RULE_ROWS:
        assert row in lines, row
    pair_head = lines.index("| Pair | Ships | Precision | Recall | True | False positive | Missed | Note |")
    assert lines[pair_head + 2:] == PAIR_ROWS
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
