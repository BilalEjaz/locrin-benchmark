"""Text checks on the two workflows. The standard library has no YAML parser, so these read lines."""
from pathlib import Path

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


def test_benchmark_publishes_when_only_source_checkouts_failed_then_flags_them():
    bm = read("benchmark.yml")
    run = step(bm, "Run")
    assert "id: run\n" in run
    assert './run.sh "$V" || code=$?' in run
    assert 'echo "code=$code" >> "$GITHUB_OUTPUT"' in run
    assert 'if [[ "$code" != 0 && "$code" != 3 ]]; then exit "$code"; fi' in run
    flag = step(bm, "Flag diffs that could not be checked out")
    assert "if: steps.run.outputs.code == '3'" in flag
    assert "materialise_failures" in flag and "exit 1" in flag
    assert bm.index("- name: Commit results\n") < bm.index("- name: Flag diffs that could not be checked out\n")
