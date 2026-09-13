"""Install a Locrin version, run check in SARIF mode, normalise the findings."""
from __future__ import annotations

import json
import os
import platform
import shutil
import subprocess
import urllib.request
from dataclasses import dataclass
from pathlib import Path

from bench.corpus import language_of
from bench.materialise import Checkout

INSTALLER = "https://raw.githubusercontent.com/BilalEjaz/locrin/main/install.sh"

BENCH_TOML = """# Written by locrin-benchmark. Every measurable rule on, every language on.
[languages]
php = true
python = true

[rules.dead-file]
enabled = true
[rules.swallowed-error]
enabled = true
[rules.injection-sink]
enabled = true
[rules.leftover-commented-code]
languages = ["typescript", "tsx", "javascript", "php", "python"]
"""


class RunError(Exception):
    pass


@dataclass(frozen=True)
class Finding:
    diff: str
    rule: str
    file: str
    line: int
    id: str
    confidence: str
    language: str | None


@dataclass(frozen=True)
class RuleMeta:
    id: str
    enabled_by_default: bool
    languages: list[str]


def _version_of(binary: Path) -> str:
    try:
        proc = subprocess.run([str(binary), "--version"], capture_output=True, text=True,
                              encoding="utf-8", errors="replace", check=True)
    except (OSError, subprocess.CalledProcessError) as e:
        raise RunError(f"could not run {binary} --version: {e}") from e
    words = proc.stdout.split()
    if not words:
        raise RunError(f"{binary} --version printed nothing")
    return words[-1]


def _program(path: Path) -> Path:
    """Make a program path with a directory part absolute; leave a bare name for PATH lookup.

    run_check runs locrin with cwd set to the checkout root, and on POSIX a relative program
    path is looked up from the child's cwd, so a relative path would point into the checkout.
    abspath, not resolve, so a symlinked binary keeps the name it was invoked by.
    """
    path = Path(path)
    if path.parent == Path("."):
        return path
    return Path(os.path.abspath(path))


def install_locrin(version: str, cache: Path) -> Path:
    want = version[1:] if version.startswith("v") else version
    tag = f"v{want}"
    override = os.environ.get("LOCRIN_BIN")
    if override:
        binary = _program(Path(override))
        got = _version_of(binary)
        if got != want:
            raise RunError(f"LOCRIN_BIN is locrin {got}, wanted {want}")
        return binary
    if platform.system() == "Windows":
        # install.sh refuses to run on Windows, so only a locrin already on PATH will do.
        found = shutil.which("locrin")
        hint = f"install.sh does not run on Windows; set LOCRIN_BIN to a locrin {want} binary"
        if not found:
            raise RunError(f"no locrin on PATH; {hint}")
        binary = _program(Path(found))
        got = _version_of(binary)
        if got != want:
            raise RunError(f"locrin on PATH is {got}, wanted {want}; {hint}")
        return binary
    # Resolved so the returned binary is absolute even when the caller passes --cache .cache.
    bin_dir = Path(cache).resolve() / "bin" / tag
    binary = bin_dir / "locrin"
    if not binary.exists():
        bin_dir.mkdir(parents=True, exist_ok=True)
        script = bin_dir / "install.sh"
        with urllib.request.urlopen(INSTALLER, timeout=60) as r:
            script.write_bytes(r.read())
        env = dict(os.environ, LOCRIN_INSTALL_DIR=str(bin_dir))
        try:
            subprocess.run(["bash", str(script), tag], env=env, check=True)
        except (OSError, subprocess.CalledProcessError) as e:
            raise RunError(f"install.sh {tag} failed: {e}") from e
    got = _version_of(binary)
    if got != want:
        raise RunError(f"installed locrin {got}, wanted {want}")
    return binary


def normalise(diff_id: str, sarif: dict) -> tuple[list[Finding], dict[str, RuleMeta]]:
    run = sarif["runs"][0]
    findings = []
    for r in run.get("results", []):
        loc = r["locations"][0]["physicalLocation"]
        file = loc["artifactLocation"]["uri"]
        findings.append(Finding(
            diff=diff_id,
            rule=r["ruleId"],
            file=file,
            line=int(loc["region"]["startLine"]),
            id=r.get("partialFingerprints", {}).get("locrin/id", ""),
            confidence=str(r.get("properties", {}).get("confidence", "")).lower(),
            language=language_of(file),
        ))
    findings.sort(key=lambda f: (f.rule, f.file, f.line, f.id))
    rules = {}
    for r in run.get("tool", {}).get("driver", {}).get("rules", []):
        rules[r["id"]] = RuleMeta(
            id=r["id"],
            enabled_by_default=bool(r.get("defaultConfiguration", {}).get("enabled", True)),
            languages=list(r.get("properties", {}).get("languages", [])),
        )
    return findings, rules


# Environment variables that point git at another repository, index or configuration.
# locrin's own git calls must see only the checkout and its repository config.
_GIT_LOCATION_ENV = ("GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE", "GIT_OBJECT_DIRECTORY",
                     "GIT_ALTERNATE_OBJECT_DIRECTORIES", "GIT_CEILING_DIRECTORIES", "GIT_ATTR_SOURCE")
# The home variables locrin's file walker reads the global gitignore through:
# core.excludesFile in ~/.gitconfig, $XDG_CONFIG_HOME/git/ignore and ~/.config/git/ignore.
_HOME_ENV = ("HOME", "USERPROFILE", "XDG_CONFIG_HOME")


def ignore_files_above(cache: Path) -> list[Path]:
    """Every .ignore file locrin's walker would read from above a checkout root.

    Checkouts live in cache/tree/<id> and cache/repos/<name>. The engine's walker
    reads a .ignore file in every parent directory of the root it walks, git
    repository or not, so one here would silently drop files from every diff.
    Nearest first.
    """
    cache = Path(cache).resolve()
    dirs = [cache / "tree", cache / "repos", cache, *cache.parents]
    return [d / ".ignore" for d in dirs if (d / ".ignore").is_file()]


def _locrin_env(work: Path, cache_dir: Path) -> dict[str, str]:
    """The parent environment with an empty home and no git location or configuration overrides.

    The harness's git settings (materialise) reach git only. locrin's file walker
    reads the machine's global gitignore itself, so it gets a home directory of its
    own, emptied before every run. Materialise fetches every blob locrin's git calls
    read, so those calls never need the machine's network settings.
    """
    home = work / "home"
    if home.exists():
        shutil.rmtree(home)
    home.mkdir(parents=True)
    env = {k: v for k, v in os.environ.items()
           if k not in _GIT_LOCATION_ENV and not k.startswith("GIT_CONFIG")}
    env.update({key: str(home) for key in _HOME_ENV})
    env["LOCRIN_CACHE_DIR"] = str(cache_dir)
    # GIT_ATTR_NOSYSTEM keeps the machine's system gitattributes out of locrin's own git calls.
    env["GIT_ATTR_NOSYSTEM"] = "1"
    return env


def run_check(locrin: Path, checkout: Checkout, work: Path, diff_id: str) -> dict:
    root = checkout.root
    work = Path(work).resolve()
    # Keyed on the diff, not the checkout: several git diffs share one checkout root.
    # Resolved: locrin runs with cwd=root and would read a relative cache dir from inside the checkout.
    cache_dir = work / "cache" / diff_id
    try:
        (root / "locrin.toml").write_bytes(BENCH_TOML.encode("utf-8"))
        cache_dir.mkdir(parents=True, exist_ok=True)
        env = _locrin_env(work, cache_dir)
    except OSError as e:
        raise RunError(f"{diff_id}: could not prepare the run: {e}") from e
    cmd = [str(_program(locrin)), "check", "--root", str(root), "--base", checkout.base_ref, "--sarif", "--offline"]
    try:
        proc = subprocess.run(cmd, cwd=root, env=env, capture_output=True, text=True,
                              encoding="utf-8", errors="replace", stdin=subprocess.DEVNULL)
    except OSError as e:
        raise RunError(f"{diff_id}: could not run locrin: {e}") from e
    if proc.returncode not in (0, 1):
        raise RunError(f"{diff_id}: locrin exit {proc.returncode}: {proc.stderr.strip()[:500]}")
    try:
        return json.loads(proc.stdout)
    except json.JSONDecodeError as e:
        raise RunError(f"{diff_id}: locrin printed no SARIF: {e}") from e
