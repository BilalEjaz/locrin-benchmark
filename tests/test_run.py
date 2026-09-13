import io
import json
import os
import subprocess
from pathlib import Path

import pytest

from bench.materialise import Checkout
from bench.run import BENCH_TOML, INSTALLER, Finding, RunError, install_locrin, normalise, run_check

SAMPLE = Path(__file__).resolve().parent.parent / "fixtures" / "sarif" / "sample.sarif"


def fake_locrin(tmp_path: Path, version: str) -> Path:
    """A stand-in binary that prints `locrin <version>` on any platform."""
    if os.name == "nt":
        fake = tmp_path / "locrin.cmd"
        fake.write_text(f"@echo locrin {version}\n")
    else:
        fake = tmp_path / "locrin"
        fake.write_text(f"#!/bin/sh\necho locrin {version}\n")
        fake.chmod(0o755)
    return fake


def test_normalise_extracts_rule_file_line_id_and_language():
    doc = json.loads(SAMPLE.read_text(encoding="utf-8"))
    findings, rules = normalise("fx-01-debug", doc)
    debug = [f for f in findings if f.rule == "leftover-debug"]
    assert [(f.file, f.line) for f in debug] == [("src/a.ts", 5), ("src/logger.ts", 3)]
    f = debug[0]
    assert isinstance(f, Finding)
    assert (f.diff, f.file, f.language) == ("fx-01-debug", "src/a.ts", "typescript")
    assert f.line == 5 and len(f.id) == 16 and f.confidence == "high"
    assert f.id == "29cc6238d682a721"
    assert debug[1].id == "01b73e4aa766c158"
    assert rules["dead-file"].enabled_by_default is False
    assert rules["leftover-debug"].enabled_by_default is True
    assert "php" in rules["leftover-debug"].languages
    assert "php" not in rules["unused-import"].languages


def test_normalise_orders_findings_deterministically():
    doc = json.loads(SAMPLE.read_text(encoding="utf-8"))
    doc["runs"][0]["results"].reverse()
    findings, _ = normalise("fx-01-debug", doc)
    keys = [(f.rule, f.file, f.line, f.id) for f in findings]
    assert keys == sorted(keys)


def test_install_uses_locrin_bin_when_set(tmp_path, monkeypatch):
    fake = fake_locrin(tmp_path, "0.5.0")
    monkeypatch.setenv("LOCRIN_BIN", str(fake))
    assert install_locrin("v0.5.0", tmp_path / "cache") == fake


def test_install_makes_a_relative_locrin_bin_absolute_and_keeps_a_bare_name(tmp_path, monkeypatch):
    tools = tmp_path / "tools"
    tools.mkdir()
    fake = fake_locrin(tools, "0.5.0")
    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv("LOCRIN_BIN", f"tools/{fake.name}")
    got = install_locrin("v0.5.0", Path("cache"))
    assert got.is_absolute()
    assert got == fake.resolve()
    # A bare name has no directory part, so it is left for a PATH lookup.
    monkeypatch.setattr("bench.run._version_of", lambda binary: "0.5.0")
    monkeypatch.setenv("LOCRIN_BIN", "locrin")
    assert install_locrin("v0.5.0", Path("cache")) == Path("locrin")


def test_install_rejects_version_mismatch(tmp_path, monkeypatch):
    fake = fake_locrin(tmp_path, "0.4.0")
    monkeypatch.setenv("LOCRIN_BIN", str(fake))
    with pytest.raises(RunError, match="0.4.0"):
        install_locrin("v0.5.0", tmp_path / "cache")


def test_install_on_windows_uses_locrin_on_path_when_version_matches(tmp_path, monkeypatch):
    fake = fake_locrin(tmp_path, "0.5.0")
    monkeypatch.delenv("LOCRIN_BIN", raising=False)
    monkeypatch.setattr("bench.run.platform.system", lambda: "Windows")
    monkeypatch.setattr("bench.run.shutil.which", lambda name: str(fake) if name == "locrin" else None)
    assert install_locrin("0.5.0", tmp_path / "cache") == fake
    assert not (tmp_path / "cache").exists()


def test_install_on_windows_without_a_matching_locrin_asks_for_locrin_bin(tmp_path, monkeypatch):
    fake = fake_locrin(tmp_path, "0.4.0")
    monkeypatch.delenv("LOCRIN_BIN", raising=False)
    monkeypatch.setattr("bench.run.platform.system", lambda: "Windows")
    monkeypatch.setattr("bench.run.shutil.which", lambda name: str(fake))
    with pytest.raises(RunError, match="LOCRIN_BIN"):
        install_locrin("v0.5.0", tmp_path / "cache")
    monkeypatch.setattr("bench.run.shutil.which", lambda name: None)
    with pytest.raises(RunError, match="LOCRIN_BIN"):
        install_locrin("v0.5.0", tmp_path / "cache")


def test_install_elsewhere_runs_install_sh_into_the_versioned_cache(tmp_path, monkeypatch):
    monkeypatch.delenv("LOCRIN_BIN", raising=False)
    monkeypatch.setattr("bench.run.platform.system", lambda: "Linux")
    fetched = []

    def fake_urlopen(url, timeout):
        fetched.append(url)
        return io.BytesIO(b"#!/usr/bin/env bash\n")

    calls = []

    def fake_run(cmd, **kw):
        calls.append((cmd, kw))
        if cmd[0] == "bash":
            Path(kw["env"]["LOCRIN_INSTALL_DIR"], "locrin").write_text("binary")
            return subprocess.CompletedProcess(cmd, 0, stdout="", stderr="")
        return subprocess.CompletedProcess(cmd, 0, stdout="locrin 0.5.0\n", stderr="")

    monkeypatch.setattr("bench.run.urllib.request.urlopen", fake_urlopen)
    monkeypatch.setattr("bench.run.subprocess.run", fake_run)
    # A relative cache, as bench.main passes by default: the returned binary must be
    # absolute, because run_check runs it with cwd set to the checkout root.
    monkeypatch.chdir(tmp_path)
    bin_dir = (tmp_path / "cache" / "bin" / "v0.5.0").resolve()
    got = install_locrin("0.5.0", Path("cache"))
    assert got.is_absolute()
    assert got == bin_dir / "locrin"
    assert fetched == [INSTALLER]
    (bash, bash_kw), (version, _) = calls
    assert bash == ["bash", str(bin_dir / "install.sh"), "v0.5.0"]
    assert bash_kw["env"]["LOCRIN_INSTALL_DIR"] == str(bin_dir)
    assert version == [str(bin_dir / "locrin"), "--version"]
    calls.clear()
    fetched.clear()
    assert install_locrin("v0.5.0", Path("cache")) == bin_dir / "locrin"
    assert fetched == [] and [c[0] for c in calls] == [[str(bin_dir / "locrin"), "--version"]]


def test_run_check_writes_config_accepts_exit_1_and_rejects_exit_2(tmp_path, monkeypatch):
    root = tmp_path / "co"
    root.mkdir()
    co = Checkout(root=root, base_ref="abc")
    seen = {}

    def fake_run(cmd, **kw):
        seen["cmd"] = cmd
        seen["kw"] = kw
        return subprocess.CompletedProcess(cmd, fake_run.code, stdout=fake_run.stdout, stderr="boom")

    fake_run.code = 1
    fake_run.stdout = json.dumps({"runs": [{"results": [], "tool": {"driver": {"rules": []}}}]})
    monkeypatch.setattr("bench.run.subprocess.run", fake_run)
    work = tmp_path / "work"
    doc = run_check(Path("/bin/locrin"), co, work, "fx-01-debug")
    assert doc["runs"][0]["results"] == []
    assert (root / "locrin.toml").read_text(encoding="utf-8") == BENCH_TOML
    assert seen["cmd"][1:] == ["check", "--root", str(root), "--base", "abc", "--sarif", "--offline"]
    assert seen["kw"]["cwd"] == root
    assert seen["kw"]["env"]["LOCRIN_CACHE_DIR"] == str(work / "cache" / "fx-01-debug")
    assert (work / "cache" / "fx-01-debug").is_dir()
    fake_run.code = 0
    assert run_check(Path("/bin/locrin"), co, work, "fx-01-debug") == doc
    fake_run.code = 2
    with pytest.raises(RunError, match="fx-01-debug: locrin exit 2"):
        run_check(Path("/bin/locrin"), co, work, "fx-01-debug")
    fake_run.code = 1
    fake_run.stdout = "not json"
    with pytest.raises(RunError, match="fx-01-debug"):
        run_check(Path("/bin/locrin"), co, work, "fx-01-debug")


def test_run_check_resolves_a_relative_work_dir_outside_the_checkout(tmp_path, monkeypatch):
    root = tmp_path / "co"
    root.mkdir()
    co = Checkout(root=root, base_ref="abc")
    seen = {}

    def fake_run(cmd, **kw):
        seen["kw"] = kw
        return subprocess.CompletedProcess(cmd, 0, stdout='{"runs": []}', stderr="")

    monkeypatch.setattr("bench.run.subprocess.run", fake_run)
    monkeypatch.chdir(tmp_path)
    run_check(Path("/bin/locrin"), co, Path("work"), "fx-01-debug")
    cache = seen["kw"]["env"]["LOCRIN_CACHE_DIR"]
    assert Path(cache).is_absolute()
    assert cache == str((tmp_path / "work" / "cache" / "fx-01-debug").resolve())
    assert Path(cache).is_dir()


def test_run_check_makes_a_relative_locrin_path_absolute_and_keeps_a_bare_name(tmp_path, monkeypatch):
    root = tmp_path / "co"
    root.mkdir()
    co = Checkout(root=root, base_ref="abc")
    seen = []

    def fake_run(cmd, **kw):
        seen.append(cmd[0])
        return subprocess.CompletedProcess(cmd, 0, stdout='{"runs": []}', stderr="")

    monkeypatch.setattr("bench.run.subprocess.run", fake_run)
    monkeypatch.chdir(tmp_path)
    run_check(Path("bin") / "locrin", co, Path("work"), "fx-01-debug")
    run_check(Path("locrin"), co, Path("work"), "fx-01-debug")
    assert seen == [str((tmp_path / "bin" / "locrin").resolve()), "locrin"]


def test_run_check_really_runs_a_relative_binary_from_another_cwd(tmp_path, monkeypatch):
    """No mock: on POSIX a relative program path is looked up from the child's cwd."""
    root = tmp_path / "co"
    root.mkdir()
    tools = tmp_path / "tools"
    tools.mkdir()
    if os.name == "nt":
        fake = tools / "locrin.cmd"
        fake.write_text('@echo {"runs": [{"results": []}]}\n')
    else:
        fake = tools / "locrin"
        fake.write_text('#!/bin/sh\necho \'{"runs": [{"results": []}]}\'\n')
        fake.chmod(0o755)
    monkeypatch.chdir(tmp_path)
    doc = run_check(Path("tools") / fake.name, Checkout(root=root, base_ref="abc"), Path("work"), "fx-01-debug")
    assert doc == {"runs": [{"results": []}]}
    assert not (root / "work").exists()


def test_bench_toml_has_no_carriage_returns_and_enables_the_ships_off_rules():
    assert "\r" not in BENCH_TOML
    for rule in ("dead-file", "swallowed-error", "injection-sink"):
        assert f"[rules.{rule}]\nenabled = true" in BENCH_TOML


def test_run_check_gives_locrin_an_empty_home_and_drops_git_location_overrides(tmp_path, monkeypatch):
    # locrin's file walker reads the global gitignore through HOME, USERPROFILE and XDG_CONFIG_HOME,
    # which the harness's own git settings never reach, so locrin gets an empty home of its own.
    root = tmp_path / "co"
    root.mkdir()
    seen = {}

    def fake_run(cmd, **kw):
        seen["env"] = kw["env"]
        seen["home_entries"] = sorted(p.name for p in Path(kw["env"]["HOME"]).iterdir())
        return subprocess.CompletedProcess(cmd, 0, stdout='{"runs": []}', stderr="")

    monkeypatch.setattr("bench.run.subprocess.run", fake_run)
    for key in ("GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE", "GIT_CONFIG_GLOBAL", "GIT_CONFIG_COUNT",
                "GIT_CONFIG_KEY_0", "GIT_CONFIG_VALUE_0", "GIT_CONFIG_PARAMETERS"):
        monkeypatch.setenv(key, "hostile")
    work = tmp_path / "work"
    home = (work / "home").resolve()
    home.mkdir(parents=True)
    (home / ".gitconfig").write_text("[core]\n\texcludesFile = /x\n")
    run_check(Path("/bin/locrin"), Checkout(root=root, base_ref="abc"), work, "fx-01-debug")
    env = seen["env"]
    for key in ("HOME", "USERPROFILE", "XDG_CONFIG_HOME"):
        assert env[key] == str(home), key
    assert seen["home_entries"] == []
    for key in ("GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE"):
        assert key not in env, key
    assert not [key for key in env if key.startswith("GIT_CONFIG")]
    assert env["GIT_ATTR_NOSYSTEM"] == "1"


def test_ignore_files_above_lists_a_dot_ignore_in_the_cache_or_any_parent(tmp_path):
    from bench.run import ignore_files_above

    cache = tmp_path / "a" / "cache"
    assert ignore_files_above(cache) == []
    (tmp_path / ".ignore").write_text("lib/\n")
    (cache / "tree").mkdir(parents=True)
    (cache / "tree" / ".ignore").write_text("*.ts\n")
    (tmp_path / "a" / ".ignore").mkdir()
    assert ignore_files_above(cache) == [(cache / "tree" / ".ignore").resolve(), (tmp_path / ".ignore").resolve()]


def test_run_check_turns_a_config_write_or_cache_failure_into_a_run_error(tmp_path, monkeypatch):
    def never(cmd, **kw):
        raise AssertionError("locrin must not run")

    monkeypatch.setattr("bench.run.subprocess.run", never)
    root = tmp_path / "co"
    (root / "locrin.toml").mkdir(parents=True)
    with pytest.raises(RunError, match="fx-01-debug: .*locrin.toml"):
        run_check(Path("/bin/locrin"), Checkout(root=root, base_ref="abc"), tmp_path / "work", "fx-01-debug")
    root2 = tmp_path / "co2"
    root2.mkdir()
    work = tmp_path / "work2"
    work.mkdir()
    (work / "cache").write_text("a file where the cache directory goes\n")
    with pytest.raises(RunError, match="fx-01-debug"):
        run_check(Path("/bin/locrin"), Checkout(root=root2, base_ref="abc"), work, "fx-01-debug")


def test_run_check_never_writes_the_config_through_a_symlink(tmp_path, monkeypatch):
    root = tmp_path / "co"
    root.mkdir()
    target = tmp_path / "outside" / "x.yml"
    (tmp_path / "outside").mkdir()
    try:
        os.symlink(str(target), root / "locrin.toml")
    except (OSError, NotImplementedError) as e:
        pytest.skip(f"cannot create symbolic links here: {e}")
    monkeypatch.setattr("bench.run.subprocess.run",
                        lambda cmd, **kw: subprocess.CompletedProcess(cmd, 0, stdout='{"runs": []}', stderr=""))
    run_check(Path("/bin/locrin"), Checkout(root=root, base_ref="abc"), tmp_path / "work", "fx-01-debug")
    assert not target.exists()
    assert not (root / "locrin.toml").is_symlink()
    assert (root / "locrin.toml").read_bytes() == BENCH_TOML.encode("utf-8")


def test_run_check_replaces_an_existing_config_file_byte_for_byte(tmp_path, monkeypatch):
    root = tmp_path / "co"
    root.mkdir()
    (root / "locrin.toml").write_bytes(b"[languages]\r\nphp = false\r\n" * 50)
    monkeypatch.setattr("bench.run.subprocess.run",
                        lambda cmd, **kw: subprocess.CompletedProcess(cmd, 0, stdout='{"runs": []}', stderr=""))
    run_check(Path("/bin/locrin"), Checkout(root=root, base_ref="abc"), tmp_path / "work", "fx-01-debug")
    assert (root / "locrin.toml").read_bytes() == BENCH_TOML.encode("utf-8")
