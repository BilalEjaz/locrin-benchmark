import json
import os
import shutil
import subprocess
from pathlib import Path

import pytest

import bench.main as main_mod
from bench.corpus import Diff
from bench.materialise import Checkout, MaterialiseError
from bench.run import RunError

ROOT = Path(__file__).resolve().parent.parent


def diff(ident: str) -> Diff:
    return Diff(id=ident, source="tree", repo="", sha="", parent="", licence="MIT",
                language="typescript", url="fixture", files=["src/x.ts"])


def sarif(results: list[dict]) -> dict:
    rules = [{"id": "leftover-debug", "defaultConfiguration": {"enabled": True}, "properties": {"languages": ["typescript"]}}]
    return {"runs": [{"results": results, "tool": {"driver": {"name": "locrin", "rules": rules}}}]}


def result(file: str, line: int, ident: str) -> dict:
    return {
        "ruleId": "leftover-debug",
        "locations": [{"physicalLocation": {"artifactLocation": {"uri": file}, "region": {"startLine": line}}}],
        "partialFingerprints": {"locrin/id": ident},
        "properties": {"confidence": "high"},
    }


def entry(file: str, line: int, ident: str | None, verdict: str) -> dict:
    return {"rule": "leftover-debug", "file": file, "line": line, "id": ident, "pass1": verdict, "pass2": verdict, "note": ""}


def write_label(root: Path, ident: str, entries: list[dict]) -> None:
    raw = {"diff": ident, "locrin": "v0.5.0", "pass1": {"by": "a", "date": "d"}, "pass2": {"by": "b", "date": "d"}, "entries": entries}
    (root / f"{ident}.json").write_bytes(json.dumps(raw).encode("utf-8"))


def test_failed_diffs_are_listed_the_rest_scored_and_their_labels_ignored(tmp_path, monkeypatch, capsys):
    labels = tmp_path / "labels"
    labels.mkdir()
    # fx-01 ran: one true finding reported, one true entry no longer reported (stale, so missed).
    write_label(labels, "fx-01-ok", [entry("src/x.ts", 2, "a" * 16, "true"), entry("src/x.ts", 9, "b" * 16, "true")])
    # fx-02 fails to materialise and fx-03 fails to run: their entries must count nowhere.
    write_label(labels, "fx-02-nomat", [entry("src/x.ts", 4, "c" * 16, "true")])
    write_label(labels, "fx-03-norun", [entry("src/x.ts", 5, None, "missed")])
    diffs = [diff("fx-01-ok"), diff("fx-02-nomat"), diff("fx-03-norun")]
    calls = []

    def fake_materialise(d, corpus_root, cache):
        if d.id == "fx-02-nomat":
            raise MaterialiseError(f"{d.id}: git init failed: boom")
        return Checkout(root=tmp_path / "co" / d.id, base_ref="0" * 40, removed=[])

    def fake_run_check(locrin, co, work, diff_id):
        calls.append((locrin, diff_id, work))
        if diff_id == "fx-03-norun":
            raise RunError(f"{diff_id}: locrin exit 2: bad")
        return sarif([result("src/x.ts", 2, "a" * 16), result("src/y.ts", 7, "d" * 16)])

    monkeypatch.setattr(main_mod, "install_locrin", lambda version, cache: Path("locrin"))
    monkeypatch.setattr(main_mod, "load_corpus", lambda root: diffs)
    monkeypatch.setattr(main_mod, "materialise", fake_materialise)
    monkeypatch.setattr(main_mod, "run_check", fake_run_check)
    readme = tmp_path / "README.md"
    readme.write_bytes(b"x\n<!-- results:start -->\nold\n<!-- results:end -->\n")
    out = tmp_path / "results"

    code = main_mod.main(["--version", "v0.5.0", "--labels", str(labels), "--out", str(out),
                          "--work", str(tmp_path / "work"), "--cache", str(tmp_path / "cache"), "--readme", str(readme)])

    assert code == 1
    assert [c[1] for c in calls] == ["fx-01-ok", "fx-03-norun"]
    assert all(c[2] == tmp_path / "work" for c in calls)
    run = json.loads((out / "v0.5.0" / "run.json").read_text(encoding="utf-8"))
    assert run["diffs"] == 3 and run["findings"] == 2 and run["unlabelled"] == 1
    assert run["materialise_failures"] == ["fx-02-nomat: git init failed: boom"]
    assert run["run_failures"] == ["fx-03-norun: locrin exit 2: bad"]
    assert run["locrin"] == "v0.5.0" and run["started"] and run["finished"]
    table = (out / "v0.5.0" / "table.md").read_text(encoding="utf-8")
    # One true reported, one stale true counted missed; fx-02's true and fx-03's miss count nowhere.
    assert "| `leftover-debug` | on | 100% | 50% | 1 | 0 | 1 | n<5, not scored |" in table
    lines = (out / "v0.5.0" / "findings.jsonl").read_bytes().split(b"\n")
    assert lines[-1] == b"" and len(lines) == 3 and b"\r" not in b"".join(lines)
    assert json.loads(lines[0]) == {"diff": "fx-01-ok", "rule": "leftover-debug", "file": "src/x.ts", "line": 2,
                                    "id": "a" * 16, "confidence": "high", "language": "typescript"}
    # A run with failures that are not confirmed gone sources publishes nothing: the README keeps its table.
    assert run["publishable"] is False
    assert readme.read_bytes() == b"x\n<!-- results:start -->\nold\n<!-- results:end -->\n"
    err = capsys.readouterr().err
    assert "materialise failed: fx-02-nomat: git init failed: boom" in err
    assert "run failed: fx-03-norun: locrin exit 2: bad" in err
    assert f"unlabelled: fx-01-ok leftover-debug src/y.ts:7 {'d' * 16}" in err
    assert f"stale: fx-01-ok leftover-debug src/x.ts:9 {'b' * 16}" in err


def test_all_diffs_ran_exits_zero_and_missing_readme_is_left_alone(tmp_path, monkeypatch):
    monkeypatch.setattr(main_mod, "install_locrin", lambda version, cache: Path("locrin"))
    monkeypatch.setattr(main_mod, "load_corpus", lambda root: [diff("fx-01-ok")])
    monkeypatch.setattr(main_mod, "materialise", lambda d, c, k: Checkout(root=tmp_path, base_ref="0" * 40, removed=[]))
    monkeypatch.setattr(main_mod, "run_check", lambda locrin, co, work, diff_id: sarif([]))
    readme = tmp_path / "README.md"
    code = main_mod.main(["--version", "v0.5.0", "--labels", str(tmp_path / "labels"), "--out", str(tmp_path / "r"),
                          "--readme", str(readme)])
    assert code == 0
    assert not readme.exists()
    assert (tmp_path / "r" / "v0.5.0" / "findings.jsonl").read_bytes() == b""


def test_setup_error_exits_two_with_a_message(tmp_path, monkeypatch, capsys):
    def boom(version, cache):
        raise RunError("no locrin on PATH; set LOCRIN_BIN")

    monkeypatch.setattr(main_mod, "install_locrin", boom)
    code = main_mod.main(["--version", "v0.5.0", "--out", str(tmp_path / "r"), "--readme", str(tmp_path / "README.md")])
    assert code == 2
    assert "bench: no locrin on PATH; set LOCRIN_BIN" in capsys.readouterr().err
    assert not (tmp_path / "r").exists()


def _posix_bash() -> str | None:
    found = shutil.which("bash")
    # On Windows, System32\bash.exe is the WSL launcher, which cannot see this checkout's paths.
    if found is None or "system32" in found.lower():
        return None
    return found


@pytest.mark.skipif(_posix_bash() is None, reason="no POSIX bash")
def test_run_sh_without_a_version_prints_usage_and_exits_two():
    proc = subprocess.run([_posix_bash(), "run.sh"], cwd=ROOT, capture_output=True, text=True)
    assert proc.returncode == 2
    assert "usage: ./run.sh <locrin version tag>" in proc.stderr


def _fake_locrin(directory: Path, version: str) -> Path:
    """A stand-in binary that prints `locrin <version>`: a .cmd file on Windows, an sh script elsewhere."""
    if os.name == "nt":
        fake = directory / "locrin.cmd"
        fake.write_bytes(f"@echo locrin {version}\r\n".encode("ascii"))
    else:
        fake = directory / "locrin"
        fake.write_bytes(f"#!/bin/sh\necho locrin {version}\n".encode("ascii"))
        fake.chmod(0o755)
    return fake


@pytest.mark.skipif(_posix_bash() is None, reason="no POSIX bash")
def test_run_sh_passes_the_version_and_options_to_bench_main(tmp_path):
    # Run a copy, so a broken wrapper can never write results/ or README.md into the real checkout.
    repo = tmp_path / "repo"
    repo.mkdir()
    shutil.copy2(ROOT / "run.sh", repo / "run.sh")
    shutil.copytree(ROOT / "bench", repo / "bench", ignore=shutil.ignore_patterns("__pycache__"))
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    env = dict(os.environ, LOCRIN_BIN=str(_fake_locrin(bin_dir, "1.2.3")))
    out = tmp_path / "out"
    proc = subprocess.run(
        [_posix_bash(), "run.sh", "v1.2.3", "--corpus", "does-not-exist", "--labels", str(tmp_path / "labels"),
         "--out", str(out), "--work", str(tmp_path / "work"), "--cache", str(tmp_path / "cache"),
         "--readme", str(tmp_path / "R.md")],
        cwd=repo, env=env, capture_output=True, text=True,
    )
    # A dropped version fails argparse, a wrong version fails the LOCRIN_BIN check, and dropped
    # options would not name does-not-exist: only a faithful wrapper reaches the corpus check.
    assert proc.returncode == 2, proc.stdout + proc.stderr
    assert "bench: corpus directory does-not-exist does not exist" in proc.stderr
    assert not out.exists() and not (repo / "results").exists() and not (repo / "README.md").exists()


def test_run_sh_is_executable_in_git():
    if shutil.which("git") is None or not (ROOT / ".git").exists():
        pytest.skip("not a git checkout")
    staged = subprocess.run(["git", "ls-files", "-s", "run.sh"], cwd=ROOT, capture_output=True, text=True, check=True).stdout
    if not staged:
        pytest.skip("run.sh not yet in the index")
    assert staged.startswith("100755 ")


def test_malformed_sarif_is_a_run_failure_naming_the_diff(tmp_path, monkeypatch, capsys):
    monkeypatch.setattr(main_mod, "install_locrin", lambda version, cache: Path("locrin"))
    monkeypatch.setattr(main_mod, "load_corpus", lambda root: [diff("fx-01-ok")])
    monkeypatch.setattr(main_mod, "materialise", lambda d, c, k: Checkout(root=tmp_path, base_ref="0" * 40, removed=[]))
    monkeypatch.setattr(main_mod, "run_check", lambda locrin, co, work, diff_id: {"runs": []})
    code = main_mod.main(["--version", "v0.5.0", "--labels", str(tmp_path / "labels"), "--out", str(tmp_path / "r"),
                          "--readme", str(tmp_path / "README.md")])
    assert code == 1
    run = json.loads((tmp_path / "r" / "v0.5.0" / "run.json").read_text(encoding="utf-8"))
    assert len(run["run_failures"]) == 1 and run["run_failures"][0].startswith("fx-01-ok: unexpected SARIF shape")
    assert "run failed: fx-01-ok: unexpected SARIF shape" in capsys.readouterr().err


def test_a_dot_ignore_above_the_cache_is_a_setup_error(tmp_path, monkeypatch, capsys):
    # locrin's walker reads .ignore files in every parent of the checkout, which would drop files silently.
    nest = tmp_path / "nest"
    nest.mkdir()
    (nest / ".ignore").write_text("lib/\n")
    monkeypatch.setattr(main_mod, "install_locrin", lambda version, cache: Path("locrin"))
    monkeypatch.setattr(main_mod, "load_corpus", lambda root: [diff("fx-01-ok")])
    code = main_mod.main(["--version", "v0.5.0", "--labels", str(tmp_path / "labels"), "--out", str(tmp_path / "r"),
                          "--cache", str(nest / "cache"), "--readme", str(tmp_path / "README.md")])
    assert code == 2
    err = capsys.readouterr().err
    assert "bench:" in err and str((nest / ".ignore").resolve()) in err
    assert not (tmp_path / "r").exists()


def test_a_diff_whose_engine_file_is_a_directory_fails_alone_and_the_rest_still_run(tmp_path, monkeypatch):
    corpus = tmp_path / "corpus"
    for ident in ("fx-01-bad", "fx-02-ok"):
        for side in ("before", "after"):
            (corpus / ident / side / "src").mkdir(parents=True)
            (corpus / ident / side / "src" / "x.ts").write_text("export const x = 1;\n")
    (corpus / "fx-01-bad" / "after" / "locrin.toml").mkdir()
    (corpus / "fx-01-bad" / "after" / "locrin.toml" / "keep.py").write_text("x = 1\n")
    ran = []
    monkeypatch.setattr(main_mod, "install_locrin", lambda version, cache: Path("locrin"))
    monkeypatch.setattr(main_mod, "load_corpus", lambda root: [diff("fx-01-bad"), diff("fx-02-ok")])
    monkeypatch.setattr(main_mod, "run_check", lambda locrin, co, work, diff_id: ran.append(diff_id) or sarif([]))
    out = tmp_path / "r"
    code = main_mod.main(["--version", "v0.5.0", "--corpus", str(corpus), "--labels", str(tmp_path / "labels"),
                          "--out", str(out), "--cache", str(tmp_path / "cache"), "--readme", str(tmp_path / "README.md")])
    assert code != 0
    assert ran == ["fx-02-ok"]
    run = json.loads((out / "v0.5.0" / "run.json").read_text(encoding="utf-8"))
    assert len(run["materialise_failures"]) == 1 and run["materialise_failures"][0].startswith("fx-01-bad: ")


def _materialise_failing(tmp_path: Path, failures: dict[str, Exception]):
    def fake_materialise(d, corpus_root, cache):
        if d.id in failures:
            raise failures[d.id]
        return Checkout(root=tmp_path, base_ref="0" * 40, removed=[])
    return fake_materialise


def _setup(tmp_path: Path, monkeypatch, ids: list[str], failures: dict[str, Exception]) -> list[str]:
    monkeypatch.setattr(main_mod, "install_locrin", lambda version, cache: Path("locrin"))
    monkeypatch.setattr(main_mod, "load_corpus", lambda root: [diff(i) for i in ids])
    monkeypatch.setattr(main_mod, "materialise", _materialise_failing(tmp_path, failures))
    monkeypatch.setattr(main_mod, "run_check", lambda locrin, co, work, diff_id: sarif([]))
    readme = tmp_path / "README.md"
    readme.write_bytes(b"x\n<!-- results:start -->\nold\n<!-- results:end -->\n")
    return ["--version", "v0.5.0", "--labels", str(tmp_path / "labels"), "--out", str(tmp_path / "r"),
            "--readme", str(readme)]


def _run_json(tmp_path: Path) -> dict:
    return json.loads((tmp_path / "r" / "v0.5.0" / "run.json").read_text(encoding="utf-8"))


def test_only_confirmed_gone_sources_exit_three_publish_and_record_the_evidence(tmp_path, monkeypatch, capsys):
    from bench.materialise import SourceGone

    gone = SourceGone("fx-02-gone: commit 1111 is not on acme/w after an explicit fetch: not our ref 1111")
    args = _setup(tmp_path, monkeypatch, ["fx-01-ok", "fx-02-gone"], {"fx-02-gone": gone})
    assert main_mod.main(args) == 3
    table = (tmp_path / "r" / "v0.5.0" / "table.md").read_text(encoding="utf-8")
    assert table.startswith("Locrin v0.5.0, 1 of 2 diffs ran, 0 unlabelled findings.\n")
    run = _run_json(tmp_path)
    assert run["diffs"] == 2 and run["ran"] == 1 and run["publishable"] is True
    assert run["gone"] == [{"id": "fx-02-gone", "evidence": "commit 1111 is not on acme/w after an explicit fetch: not our ref 1111"}]
    assert run["materialise_failures"] == []
    assert (tmp_path / "README.md").read_bytes() == b"x\n<!-- results:start -->\n" + table.encode("utf-8") + b"<!-- results:end -->\n"
    assert "source gone: fx-02-gone: commit 1111" in capsys.readouterr().err

    def failing_run(locrin, co, work, diff_id):
        raise RunError(f"{diff_id}: locrin exit 2: bad")

    monkeypatch.setattr(main_mod, "run_check", failing_run)
    assert main_mod.main(args) == 1
    assert _run_json(tmp_path)["publishable"] is False


def test_a_transient_materialise_failure_beside_a_gone_source_exits_one_and_publishes_nothing(tmp_path, monkeypatch, capsys):
    from bench.materialise import SourceGone

    failures = {
        "fx-02-gone": SourceGone("fx-02-gone: https://github.com/acme/w answers HTTP 404; git said: x"),
        "fx-03-net": MaterialiseError("fx-03-net: git clone failed: Could not resolve host: github.com"),
    }
    args = _setup(tmp_path, monkeypatch, ["fx-01-ok", "fx-02-gone", "fx-03-net"], failures)
    assert main_mod.main(args) == 1
    run = _run_json(tmp_path)
    assert run["publishable"] is False and run["ran"] == 1
    assert [g["id"] for g in run["gone"]] == ["fx-02-gone"]
    assert run["materialise_failures"] == ["fx-03-net: git clone failed: Could not resolve host: github.com"]
    assert (tmp_path / "README.md").read_bytes() == b"x\n<!-- results:start -->\nold\n<!-- results:end -->\n"
    assert "not publishable" in capsys.readouterr().err


@pytest.mark.parametrize("kind", ["transient", "gone", "os"])
def test_when_no_diff_runs_the_run_exits_one_and_publishes_nothing(tmp_path, monkeypatch, kind):
    from bench.materialise import SourceGone

    error = {"transient": MaterialiseError("fx-01-a: git clone failed: Could not read from remote repository"),
             "gone": SourceGone("fx-01-a: https://github.com/acme/w answers HTTP 404; git said: x"),
             "os": MaterialiseError("fx-01-a: [WinError 267] The directory name is invalid")}[kind]
    args = _setup(tmp_path, monkeypatch, ["fx-01-a"], {"fx-01-a": error})
    assert main_mod.main(args) == 1
    run = _run_json(tmp_path)
    assert run["ran"] == 0 and run["publishable"] is False
    assert (tmp_path / "README.md").read_bytes() == b"x\n<!-- results:start -->\nold\n<!-- results:end -->\n"


def test_an_empty_corpus_is_a_setup_error_and_leaves_the_readme_alone(tmp_path, monkeypatch, capsys):
    args = _setup(tmp_path, monkeypatch, [], {})
    assert main_mod.main(args) == 2
    assert "holds no record" in capsys.readouterr().err
    assert not (tmp_path / "r").exists()
    assert (tmp_path / "README.md").read_bytes() == b"x\n<!-- results:start -->\nold\n<!-- results:end -->\n"


def test_findings_matched_to_unconfirmed_entries_are_listed_as_excluded(tmp_path, monkeypatch, capsys):
    labels = tmp_path / "labels"
    labels.mkdir()
    write_label(labels, "fx-01-ok", [entry("src/x.ts", 2, "a" * 16, "true"),
                                     dict(entry("src/x.ts", 3, "b" * 16, "true"), pass2="false-positive")])
    args = _setup(tmp_path, monkeypatch, ["fx-01-ok"], {})
    monkeypatch.setattr(main_mod, "run_check", lambda locrin, co, work, diff_id: sarif(
        [result("src/x.ts", 2, "a" * 16), result("src/x.ts", 3, "b" * 16)]))
    assert main_mod.main(args) == 0
    run = _run_json(tmp_path)
    assert run["excluded"] == 1 and run["unlabelled"] == 0 and run["publishable"] is True
    assert f"excluded: fx-01-ok leftover-debug src/x.ts:3 {'b' * 16}" in capsys.readouterr().err


def test_an_unexpected_error_while_materialising_fails_that_diff_by_name_and_the_rest_run(tmp_path, monkeypatch, capsys):
    args = _setup(tmp_path, monkeypatch, ["fx-01-bad", "fx-02-ok"],
                  {"fx-01-bad": AttributeError("'NoneType' object has no attribute 'split'")})
    ran = []
    monkeypatch.setattr(main_mod, "run_check", lambda locrin, co, work, diff_id: ran.append(diff_id) or sarif([]))
    assert main_mod.main(args) == 1
    assert ran == ["fx-02-ok"]
    run = _run_json(tmp_path)
    assert run["publishable"] is False and run["ran"] == 1
    assert len(run["materialise_failures"]) == 1
    assert run["materialise_failures"][0].startswith("fx-01-bad: unexpected error: AttributeError")
    assert "materialise failed: fx-01-bad: unexpected error" in capsys.readouterr().err


def test_an_unexpected_error_while_running_fails_that_diff_by_name(tmp_path, monkeypatch):
    args = _setup(tmp_path, monkeypatch, ["fx-01-bad"], {})

    def boom(locrin, co, work, diff_id):
        raise RuntimeError("harness bug")

    monkeypatch.setattr(main_mod, "run_check", boom)
    assert main_mod.main(args) == 1
    assert _run_json(tmp_path)["run_failures"][0].startswith("fx-01-bad: unexpected error: RuntimeError")
