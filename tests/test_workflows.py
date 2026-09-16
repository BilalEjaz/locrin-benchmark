"""Text checks on the two workflows. The standard library has no YAML parser, so these read lines."""
import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
WORKFLOWS = ROOT / ".github" / "workflows"


def read(name: str) -> str:
    return (WORKFLOWS / name).read_bytes().decode("utf-8")


def step(text: str, name: str) -> str:
    """The block of one named step, from its '- name:' line to the next step."""
    start = text.index(f"- name: {name}\n")
    rest = text[start + 1:]
    end = rest.find("\n      - ")
    return text[start:] if end < 0 else text[start:start + 1 + end]


def test_ci_runs_on_every_push_and_pull_request():
    ci = read("ci.yml")
    assert "on:\n  push:\n  pull_request:\n" in ci
    assert "permissions:\n  contents: read\n" in ci


def test_ci_installs_locrin_runs_tests_fixture_run_and_em_dash_check():
    ci = read("ci.yml")
    assert "install.sh | bash -s v0.5.0" in ci
    assert "python -m pytest -q" in ci
    fixture = step(ci, "Fixture run end to end")
    assert "./run.sh v0.5.0 --corpus fixtures/corpus --labels fixtures/labels" in fixture
    assert "grep -rIl $'\\xe2\\x80\\x94'" in step(ci, "No em dashes")


def test_benchmark_has_schedule_and_dispatch_inputs_with_commit_default_true():
    bm = read("benchmark.yml")
    assert '    - cron: "17 3 * * *"\n' in bm
    assert "  workflow_dispatch:\n    inputs:\n      version:\n" in bm
    commit = bm[bm.index("      commit:\n"):]
    assert "        type: boolean\n" in commit.split("permissions:")[0]
    assert "        default: true\n" in commit.split("permissions:")[0]


def test_benchmark_commits_only_on_schedule_or_when_commit_is_true():
    bm = read("benchmark.yml")
    block = step(bm, "Commit results")
    assert "if: steps.v.outputs.skip != 'true' && (github.event_name == 'schedule' || inputs.commit)" in block
    assert "git push" in block
    assert "permissions:\n  contents: write\n" in bm


def test_benchmark_runs_one_at_a_time_so_two_runs_never_race_to_push():
    bm = read("benchmark.yml")
    assert "concurrency:\n  group: benchmark\n  cancel-in-progress: false\n" in bm


def test_benchmark_uses_the_workflow_token_through_gh_and_no_secret():
    bm = read("benchmark.yml")
    assert "GH_TOKEN: ${{ github.token }}" in step(bm, "Resolve version")
    assert "secrets." not in bm
    assert "GITHUB_TOKEN" not in bm


def test_workflow_inputs_reach_the_shell_through_env_only():
    for name in ("ci.yml", "benchmark.yml"):
        for line in read(name).splitlines():
            if "${{" in line and "inputs." in line:
                stripped = line.strip()
                assert stripped.startswith(("if:", "VERSION:", "COMMIT:")), (name, line)


def test_benchmark_schedule_only_runs_on_main_so_it_never_commits_to_a_feature_branch():
    bm = read("benchmark.yml")
    job = bm[bm.index("  measure:\n"):bm.index("    steps:\n")]
    assert "    if: github.event_name == 'workflow_dispatch' || github.ref == 'refs/heads/main'\n" in job


def test_benchmark_schedule_skips_until_the_corpus_and_labels_exist():
    # Without this guard the first scheduled run on main publishes an empty v0.5.0 table and
    # every later run skips that version because run.json exists.
    resolve = step(read("benchmark.yml"), "Resolve version")
    assert 'if [[ "$EVENT" == "schedule" ]]; then' in resolve
    assert 'compgen -G "labels/*.json"' in resolve
    assert 'compgen -G "corpus/*.json"' in resolve
    assert resolve.count('echo "skip=true" >> "$GITHUB_OUTPUT"') == 1


def test_benchmark_publishes_when_only_confirmed_gone_sources_failed_then_flags_them():
    bm = read("benchmark.yml")
    run = step(bm, "Run")
    assert "id: run\n" in run
    assert './run.sh "$V" --evict-repos || code=$?' in run
    assert 'echo "code=$code" >> "$GITHUB_OUTPUT"' in run
    flag = step(bm, "Flag diffs whose source is gone")
    assert "if: steps.run.outputs.code == '3'" in flag
    assert '["gone"]' in flag and "exit 1" in flag
    assert "materialise_failures" not in flag
    assert bm.index("- name: Commit results\n") < bm.index("- name: Flag diffs whose source is gone\n")


def test_benchmark_reports_disk_and_memory_around_the_run_and_streams_each_diff():
    # The first run of this workflow died at 64 minutes with "the hosted runner lost communication",
    # having filled the disk, and the log showed neither the free space nor how far the run had got.
    bm = read("benchmark.yml")
    assert bm.index("- name: Runner resources\n") < bm.index("- name: Run\n")
    before = step(bm, "Runner resources")
    assert "df -h /" in before and "free -m" in before
    run = step(bm, "Run")
    # Inside the Run step and after the exit code is recorded, so they land in the log even when it fails.
    assert run.index('echo "code=$code"') < run.index("df -h /") < run.index("free -m") < run.index('exit "$code"')
    assert 'PYTHONUNBUFFERED: "1"' in run
    for text in (before, run):
        assert text.count("df -h / || true") == 1 and text.count("free -m || true") == 1


def test_benchmark_evicts_each_clone_so_one_repository_is_on_disk_at_a_time():
    # The runner has about 14 GB; every clone together is 5.2 GB of packs and growing with the corpus.
    assert "--evict-repos" in step(read("benchmark.yml"), "Run")


# The step scripts themselves, run with bash, so the skip and publish logic is tested, not just its text.

def _bash() -> str | None:
    found = shutil.which("bash")
    # On Windows, System32\bash.exe is the WSL launcher, which cannot see these paths.
    if found is None or "system32" in found.lower():
        return None
    return found


needs_bash = pytest.mark.skipif(_bash() is None, reason="no POSIX bash")


def script(text: str, name: str) -> str:
    """The shell script of one step's `run: |` block, dedented."""
    block = step(text, name)
    lines = block.split("\n")
    start = next(i for i, line in enumerate(lines) if line.strip() == "run: |") + 1
    body = [line for line in lines[start:]]
    indent = min(len(line) - len(line.lstrip(" ")) for line in body if line.strip())
    return "\n".join(line[indent:] for line in body).strip("\n") + "\n"


def _run_step(tmp_path: Path, name: str, env: dict[str, str]) -> tuple[subprocess.CompletedProcess, dict[str, str]]:
    (tmp_path / "step.sh").write_bytes(script(read("benchmark.yml"), name).encode("utf-8"))
    output = tmp_path / "github_output"
    output.write_bytes(b"")
    path = os.pathsep.join([str(Path(sys.executable).parent), os.environ.get("PATH", "")])
    # The steps run from the repository root, where `python -m bench...` finds the harness.
    full = dict(os.environ, PATH=path, GITHUB_OUTPUT=str(output), PYTHONPATH=str(ROOT), **env)
    proc = subprocess.run([_bash(), "-e", "step.sh"], cwd=tmp_path, env=full, capture_output=True, text=True)
    outputs = dict(line.split("=", 1) for line in output.read_text(encoding="utf-8").splitlines() if "=" in line)
    return proc, outputs


def _scheduled_tree(tmp_path: Path, run_json: dict | None) -> None:
    from bench import inputs

    (tmp_path / "corpus").mkdir()
    (tmp_path / "corpus" / "acme__w__1234567.json").write_bytes(b"{}")
    (tmp_path / "labels").mkdir()
    (tmp_path / "labels" / "acme__w__1234567.json").write_bytes(b"{}")
    if run_json is not None:
        run_json = dict(run_json)
        if run_json.get("labels") == "covered":
            run_json["labels"] = {"versions": ["v0.5.0"], "other_version": [], "missing": [], "unconfirmed": [], "unreproduced": [],
                                  "invalid_missed": []}
            run_json.setdefault("not_publishable", [])
            run_json.setdefault("gone", [])
        if run_json.get("inputs") == "current":
            run_json["inputs"] = {"corpus": inputs.digest(tmp_path / "corpus"), "labels": inputs.digest(tmp_path / "labels"),
                                  "bench": inputs.harness_digest()}
        (tmp_path / "results" / "v0.5.0").mkdir(parents=True)
        (tmp_path / "results" / "v0.5.0" / "run.json").write_bytes(json.dumps(run_json).encode("utf-8"))


@needs_bash
@pytest.mark.parametrize("run_json, skip", [
    ({"locrin": "v0.5.0", "ran": 3, "publishable": True, "gone": [], "inputs": "current", "labels": "covered"}, True),
    # A partial table from a run with gone sources is measured again, so the job keeps flagging them.
    ({"locrin": "v0.5.0", "ran": 2, "publishable": True, "gone": [{"id": "x", "evidence": "404"}], "inputs": "current",
      "labels": "covered"}, False),
    # Written before run.json recorded whether every label file was confirmed and every labelled finding
    # reproduced, or recording labels that do not cover the run: measured again.
    ({"locrin": "v0.5.0", "ran": 3, "publishable": True, "gone": [], "inputs": "current"}, False),
    ({"locrin": "v0.5.0", "ran": 3, "publishable": True, "gone": [], "inputs": "current", "not_publishable": [],
      "labels": {"versions": ["v0.5.0"], "other_version": [], "missing": [], "unconfirmed": ["x"], "unreproduced": []}}, False),
    # Published before run.json recorded its inputs, or over other labels or corpus: measured again.
    ({"locrin": "v0.5.0", "ran": 3, "publishable": True, "gone": []}, False),
    ({"locrin": "v0.5.0", "ran": 3, "publishable": True, "inputs": {"corpus": "sha256:0", "labels": "sha256:0"}}, False),
    ({"locrin": "v0.4.0", "ran": 3, "publishable": True, "inputs": "current"}, False),
    ({"locrin": "v0.5.0", "ran": 1, "publishable": False, "gone": [], "inputs": "current"}, False),
    ({"locrin": "v0.5.0", "ran": 3, "publishable": False, "not_publishable": ["1 unlabelled finding"], "inputs": "current"}, False),
    ({"diffs": 3, "ran": 0, "materialise_failures": ["x: git clone failed"]}, False),
    (None, False),
])
def test_scheduled_run_skips_a_version_only_when_its_run_json_records_a_publishable_run_over_the_current_inputs(tmp_path, run_json, skip):
    _scheduled_tree(tmp_path, run_json)
    proc, outputs = _run_step(tmp_path, "Resolve version", {"VERSION": "v0.5.0", "EVENT": "schedule"})
    assert proc.returncode == 0, proc.stderr
    assert outputs["version"] == "v0.5.0"
    assert (outputs.get("skip") == "true") is skip, proc.stdout


@needs_bash
def test_a_version_is_measured_again_after_its_labels_change(tmp_path):
    _scheduled_tree(tmp_path, {"locrin": "v0.5.0", "publishable": True, "inputs": "current", "labels": "covered"})
    (tmp_path / "labels" / "acme__w__1234567.json").write_bytes(b'{"relabelled": true}')
    proc, outputs = _run_step(tmp_path, "Resolve version", {"VERSION": "v0.5.0", "EVENT": "schedule"})
    assert proc.returncode == 0, proc.stderr
    assert "skip" not in outputs
    assert "labels changed" in proc.stdout


@needs_bash
def test_a_malformed_run_json_is_measured_again_not_skipped(tmp_path):
    _scheduled_tree(tmp_path, None)
    (tmp_path / "results" / "v0.5.0").mkdir(parents=True)
    (tmp_path / "results" / "v0.5.0" / "run.json").write_bytes(b"not json")
    proc, outputs = _run_step(tmp_path, "Resolve version", {"VERSION": "v0.5.0", "EVENT": "schedule"})
    assert proc.returncode == 0, proc.stderr
    assert "skip" not in outputs


@needs_bash
def test_a_dispatched_run_never_skips(tmp_path):
    _scheduled_tree(tmp_path, {"publishable": True})
    proc, outputs = _run_step(tmp_path, "Resolve version", {"VERSION": "v0.5.0", "EVENT": "workflow_dispatch"})
    assert proc.returncode == 0, proc.stderr
    assert "skip" not in outputs


@needs_bash
@pytest.mark.parametrize("code, passes", [(0, True), (3, True), (1, False), (2, False), (4, False)])
def test_the_run_step_lets_only_publishable_exit_codes_through(tmp_path, code, passes):
    (tmp_path / "run.sh").write_bytes(f"#!/usr/bin/env bash\nexit {code}\n".encode("utf-8"))
    os.chmod(tmp_path / "run.sh", 0o755)
    proc, outputs = _run_step(tmp_path, "Run", {"V": "v0.5.0"})
    assert (proc.returncode == 0) is passes, proc.stderr
    assert outputs["code"] == str(code)


@needs_bash
def test_the_flag_step_prints_each_gone_diff_as_one_json_string_and_fails(tmp_path):
    (tmp_path / "results" / "v0.5.0").mkdir(parents=True)
    gone = [{"id": "acme__w__1234567", "evidence": "::error::https://github.com/acme/w answers HTTP 404"}]
    (tmp_path / "results" / "v0.5.0" / "run.json").write_bytes(json.dumps({"gone": gone}).encode("utf-8"))
    proc, _ = _run_step(tmp_path, "Flag diffs whose source is gone", {"V": "v0.5.0"})
    assert proc.returncode == 1
    lines = proc.stdout.splitlines()
    assert lines[0] == "source gone: " + json.dumps("acme__w__1234567: ::error::https://github.com/acme/w answers HTTP 404")
    assert not any(line.startswith("::") for line in lines)
    assert "build_corpus --check-gone" in proc.stdout
