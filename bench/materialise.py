"""Turn a corpus record into a git checkout with a base ref for locrin check --base."""
from __future__ import annotations

import os
import shutil
import stat
import subprocess
from dataclasses import dataclass, field
from pathlib import Path

from bench.corpus import Diff

ENGINE_FILES = ("locrin.toml", "locrin-baseline.json")
_ENV = {
    "GIT_AUTHOR_NAME": "bench",
    "GIT_AUTHOR_EMAIL": "bench@example.invalid",
    "GIT_AUTHOR_DATE": "2026-01-01T00:00:00+0000",
    "GIT_COMMITTER_NAME": "bench",
    "GIT_COMMITTER_EMAIL": "bench@example.invalid",
    "GIT_COMMITTER_DATE": "2026-01-01T00:00:00+0000",
    "GIT_TERMINAL_PROMPT": "0",
    # Skip the system-wide gitattributes file, which no config setting can turn off.
    "GIT_ATTR_NOSYSTEM": "1",
}
# Settings that keep line endings, blob contents, the set of committed or
# cleaned files, and signing independent of the machine. They go on every git
# call and into each repository's own config. Git reads a default ignore file
# and attributes file ($XDG_CONFIG_HOME/git/ or ~/.config/git/) even when no
# config file names them, so set both to an empty path, which git treats as a
# missing file on every platform. The null device is not an option: on Windows
# os.devnull is "nul", and with core.fscache (on by default in Git for Windows)
# plain `git status` and `git add` die with "cannot use nul as an exclude file".
_SETTINGS = (
    ("core.autocrlf", "false"),
    ("core.excludesFile", ""),
    ("core.attributesFile", ""),
    ("commit.gpgsign", "false"),
)
_CONFIG = tuple(arg for key, value in _SETTINGS for arg in ("-c", f"{key}={value}"))
# Variables that let the machine's environment inject configuration, templates
# or a different object format. Isolated calls drop them.
_LEAKY_ENV_PREFIXES = ("GIT_CONFIG",)
_LEAKY_ENV = ("GIT_TEMPLATE_DIR", "GIT_DEFAULT_HASH", "GIT_DIR", "GIT_WORK_TREE",
              "GIT_INDEX_FILE", "GIT_OBJECT_DIRECTORY", "GIT_ALTERNATE_OBJECT_DIRECTORIES",
              "GIT_ATTR_SOURCE")


class MaterialiseError(Exception):
    pass


@dataclass
class Checkout:
    root: Path
    base_ref: str
    removed: list[str] = field(default_factory=list)


def _git(args: list[str], cwd: Path, *, isolated: bool = False) -> str:
    """Run git in cwd.

    Every call carries _CONFIG and skips the default global ignore and
    attributes files. isolated=True also ignores the global and system git
    configuration and the environment overrides above, so the throwaway tree
    repositories get the same files, hooks (none) and shas on every machine.
    Git-source calls stay unisolated because clone and the lazy blob fetches of
    a partial clone may need the machine's network settings (proxy, CA bundle).
    """
    env = dict(os.environ)
    if isolated:
        for key in list(env):
            if key.startswith(_LEAKY_ENV_PREFIXES) or key in _LEAKY_ENV:
                del env[key]
        env["GIT_CONFIG_GLOBAL"] = os.devnull
        env["GIT_CONFIG_NOSYSTEM"] = "1"
    env.update(_ENV)
    try:
        return subprocess.run(["git", *_CONFIG, *args], cwd=cwd, env=env, check=True,
                              capture_output=True, text=True).stdout
    except subprocess.CalledProcessError as e:
        raise subprocess.CalledProcessError(e.returncode, ["git", *args], e.output, e.stderr) from None


def _copy_tree(src: Path, dst: Path) -> None:
    # A tree source holds regular files only. A symbolic link would copy bytes from
    # outside the corpus into the checkout, so it fails the diff before anything is copied.
    files = []
    for dirpath, dirnames, filenames in os.walk(src, followlinks=False):
        for name in (*dirnames, *filenames):
            p = Path(dirpath) / name
            if p.is_symlink():
                rel = p.relative_to(src).as_posix()
                raise MaterialiseError(f"{src.name}/{rel} is a symbolic link; a tree source holds regular files only")
        files.extend(Path(dirpath) / name for name in filenames)
    for p in files:
        if p.is_file():
            target = dst / p.relative_to(src)
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(p, target)


def _make_writable_and_retry(func, path, _exc) -> None:
    # git writes its object files read-only, and Windows refuses to delete a
    # read-only file, so clear the flag and try once more.
    os.chmod(path, stat.S_IWRITE)
    func(path)


def _rmtree(path: Path) -> None:
    shutil.rmtree(path, onexc=_make_writable_and_retry)


def _clear_worktree(root: Path) -> None:
    for p in root.iterdir():
        if p.name == ".git":
            continue
        _rmtree(p) if p.is_dir() else p.unlink()


def _persist_settings(git) -> None:
    # Written to the repository's own config so locrin's later git calls in the
    # checkout see the same line endings, attributes and ignore rules. These reach
    # git only: locrin's own file walker never reads git config from the repository,
    # it reads the global gitignore through the home directory, which run_check
    # replaces with an empty one.
    for key, value in _SETTINGS:
        if key != "commit.gpgsign":
            git(["config", key, value])


def _strip_engine_files(root: Path) -> list[str]:
    removed = []
    for name in ENGINE_FILES:
        p = root / name
        if p.is_symlink():
            # exists() follows the link and says False for a dangling one, which run_check would then
            # write through, creating a file wherever the link points.
            p.unlink()
            removed.append(name)
            continue
        if p.is_dir():
            raise MaterialiseError(f"{name} in the checkout is a directory, not an engine config file")
        if p.exists():
            p.unlink()
            removed.append(name)
    return removed


def _materialise_tree(diff: Diff, corpus_root: Path, cache: Path) -> Checkout:
    src = corpus_root / diff.id
    if not ((src / "before").is_dir() and (src / "after").is_dir()):
        raise MaterialiseError(f"{diff.id}: tree source needs {src / 'before'} and {src / 'after'}")
    root = cache / "tree" / diff.id
    if root.exists():
        _rmtree(root)
    root.mkdir(parents=True)

    def git(args: list[str]) -> str:
        return _git(args, root, isolated=True)

    git(["init", "-q", "--template=", "--object-format=sha1", "-b", "main"])
    _persist_settings(git)
    _copy_tree(src / "before", root)
    _strip_engine_files(root)
    git(["add", "-A"])
    git(["commit", "-q", "--no-verify", "-m", "before", "--allow-empty"])
    base = git(["rev-parse", "HEAD"]).strip()
    _clear_worktree(root)
    _copy_tree(src / "after", root)
    removed = _strip_engine_files(root)
    git(["add", "-A"])
    git(["commit", "-q", "--no-verify", "-m", "after", "--allow-empty"])
    return Checkout(root=root, base_ref=base, removed=removed)


def _materialise_git(diff: Diff, cache: Path) -> Checkout:
    owner, name = diff.repo.split("/", 1)
    root = cache / "repos" / f"{owner}__{name}"
    if not root.exists():
        root.parent.mkdir(parents=True, exist_ok=True)
        _git(["clone", "--filter=blob:none", f"https://github.com/{diff.repo}.git", str(root)], root.parent)
        _persist_settings(lambda args: _git(args, root))
    _git(["checkout", "--detach", "-f", diff.sha], root)
    _git(["clean", "-fdq"], root)
    removed = _strip_engine_files(root)
    # A partial clone fetches blobs lazily. run_check gives locrin an empty home, so a fetch
    # from locrin's own git calls would lose the machine's network settings (proxy, CA bundle).
    # Diffing the parent against the commit and against the worktree, with rename detection,
    # reads every blob locrin's `git diff <base>` and `git show <base>:<path>` read.
    _git(["diff", "--stat", "-M", diff.parent, diff.sha], root)
    _git(["diff", "--stat", "-M", diff.parent], root)
    return Checkout(root=root, base_ref=diff.parent, removed=removed)


def materialise(diff: Diff, corpus_root: Path, cache: Path) -> Checkout:
    # Resolve once: git runs with cwd set inside the cache, so a relative path
    # handed to it would be resolved against the wrong directory.
    corpus_root = Path(corpus_root).resolve()
    cache = Path(cache).resolve()
    try:
        if diff.source == "tree":
            return _materialise_tree(diff, corpus_root, cache)
        return _materialise_git(diff, cache)
    except MaterialiseError as e:
        if str(e).startswith(f"{diff.id}: "):
            raise
        raise MaterialiseError(f"{diff.id}: {e}") from e
    except OSError as e:
        # A locked file, a path too long for Windows, a name the disk refuses: this diff fails, the run goes on.
        raise MaterialiseError(f"{diff.id}: {e}") from e
    except subprocess.CalledProcessError as e:
        cmd = e.cmd if isinstance(e.cmd, list) else [str(e.cmd)]
        if cmd and cmd[0] == "git":
            cmd = cmd[1:]
        detail = (e.stderr or e.stdout or "").strip()
        raise MaterialiseError(f"{diff.id}: git {' '.join(map(str, cmd))} failed: {detail}") from e
