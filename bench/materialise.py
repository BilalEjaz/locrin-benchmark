"""Turn a corpus record into a git checkout with a base ref for locrin check --base."""
from __future__ import annotations

import os
import re
import shutil
import stat
import subprocess
import urllib.error
import urllib.request
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
    # Git Credential Manager can open a sign-in window even with terminal prompts off.
    "GCM_INTERACTIVE": "never",
    # A corpus diff is scored on the files git stores; an LFS pointer stays a pointer.
    "GIT_LFS_SKIP_SMUDGE": "1",
    # Skip the system-wide gitattributes file, which no config setting can turn off.
    "GIT_ATTR_NOSYSTEM": "1",
}
# Settings that keep line endings, path length limits, blob contents, the set of
# committed or cleaned files, and signing independent of the machine. They go on
# every git call and into each repository's own config. Git reads a default ignore
# file and attributes file ($XDG_CONFIG_HOME/git/ or ~/.config/git/) even when no
# config file names them, so set both to an empty path, which git treats as a
# missing file on every platform. The null device is not an option: on Windows
# os.devnull is "nul", and with core.fscache (on by default in Git for Windows)
# plain `git status` and `git add` die with "cannot use nul as an exclude file".
# core.longpaths lets Git for Windows write paths over 260 characters (Linux ignores
# it); core.eol=lf keeps any text conversion LF on every platform, although PINNED_ATTRIBUTES
# below turns conversion off in every checkout.
_SETTINGS = (
    ("core.autocrlf", "false"),
    ("core.eol", "lf"),
    ("core.longpaths", "true"),
    # A symbolic link checks out as a link where the platform has them and as a text file holding the
    # target path where it does not, and the engine would then read different bytes on each platform.
    # Pinned to false, so every platform checks the link out as that text file. A commit that changes
    # one is refused below all the same: its text file is then scored as source.
    ("core.symlinks", "false"),
    ("core.excludesFile", ""),
    ("core.attributesFile", ""),
    ("commit.gpgsign", "false"),
)
_CONFIG = tuple(arg for key, value in _SETTINGS for arg in ("-c", f"{key}={value}"))
# Variables that let the machine's environment inject configuration files, templates,
# another repository or a different object format. Every call drops them.
_LEAKY_ENV = ("GIT_TEMPLATE_DIR", "GIT_DEFAULT_HASH", "GIT_DIR", "GIT_WORK_TREE",
              "GIT_INDEX_FILE", "GIT_OBJECT_DIRECTORY", "GIT_ALTERNATE_OBJECT_DIRECTORIES",
              "GIT_ATTR_SOURCE", "GIT_CONFIG", "GIT_CONFIG_GLOBAL", "GIT_CONFIG_SYSTEM")
# Written to .git/info/attributes, which outranks every .gitattributes in the tree. It turns off each
# attribute that converts content between the blob and the working tree, so a checked-out file always
# holds its blob's bytes. Without it a blob stored with CRLF under an in-repo `text` attribute shows as
# modified whenever git rehashes its index entry (a racily clean entry written in the same second as the
# index), and locrin, which scores the files `git diff <base>` lists, would then report findings on a
# file the commit never touched, depending on checkout timing.
PINNED_ATTRIBUTES = b"* -text -eol -ident -filter -working-tree-encoding\n"
# A commit the server does not have, as git reports it after an explicit fetch of that sha.
_NOT_OUR_REF = re.compile(r"not our ref|couldn't find remote ref|no such remote ref|unadvertised object", re.I)


class MaterialiseError(Exception):
    pass


class SourceGone(MaterialiseError):
    """The source is confirmed gone: the repository answers 404, or the server lacks the commit after a fetch."""


@dataclass
class Checkout:
    root: Path
    base_ref: str
    removed: list[str] = field(default_factory=list)


def _hermetic(cache: Path) -> Path:
    """cache/git-hermetic, holding an empty global config file and an empty hooks directory.

    Anything found in either is removed first, so neither can carry settings or hooks into a run.
    """
    base = Path(cache) / "git-hermetic"
    hooks = base / "hooks"
    config = base / "config"
    if hooks.is_symlink() or (hooks.exists() and not hooks.is_dir()):
        hooks.unlink()
    elif hooks.is_dir() and any(hooks.iterdir()):
        _rmtree(hooks)
    if config.is_symlink():
        config.unlink()
    elif config.is_dir():
        _rmtree(config)
    hooks.mkdir(parents=True, exist_ok=True)
    if not config.is_file() or config.stat().st_size:
        config.write_bytes(b"")
    return base


def _git(args: list[str], cwd: Path, *, hermetic: Path, isolated: bool = False) -> str:
    """Run git in cwd, isolated from the machine's git configuration.

    Every call ignores the system config, reads an empty global config, runs no hooks,
    uses no credential helper, takes _CONFIG, and drops the environment overrides above,
    so clones, fetches, checkouts and the throwaway tree repositories behave the same on
    every machine. Output is decoded as UTF-8 whatever the locale: git prints path names as
    raw bytes, and the Windows code page leaves some UTF-8 bytes undefined. Network access still works: proxies and CA bundles set in the
    environment (HTTPS_PROXY, GIT_SSL_CAINFO) pass through, and public https clones need
    no credentials. Clone and init also pass --template= themselves.

    isolated=True also drops the GIT_CONFIG_COUNT and GIT_CONFIG_PARAMETERS lists from the
    environment. Git-source calls keep them, as the documented per-process way to route a
    remote; every setting above is given on the command line, which git reads after them.
    """
    env = dict(os.environ)
    for key in list(env):
        if key in _LEAKY_ENV or (isolated and key.startswith("GIT_CONFIG")):
            del env[key]
    env["GIT_CONFIG_GLOBAL"] = str(hermetic / "config")
    env["GIT_CONFIG_NOSYSTEM"] = "1"
    env.update(_ENV)
    config = [*_CONFIG, "-c", "credential.helper=", "-c", f"core.hooksPath={(hermetic / 'hooks').as_posix()}"]
    try:
        return subprocess.run(["git", *config, *args], cwd=cwd, env=env, check=True,
                              capture_output=True, encoding="utf-8", errors="surrogateescape").stdout
    except subprocess.CalledProcessError as e:
        raise subprocess.CalledProcessError(e.returncode, ["git", *args], e.output, e.stderr) from None


def _repository_status(repo: str) -> int | None:
    """The HTTP status https://github.com/<repo> answers, or None when it cannot be reached.

    GitHub answers 404 for a repository that is deleted or private. Everything else,
    a redirect for a renamed repository included, means the repository is not confirmed gone.
    """
    req = urllib.request.Request(f"https://github.com/{repo}", method="HEAD")
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return int(r.status)
    except urllib.error.HTTPError as e:
        return int(e.code)
    except (urllib.error.URLError, OSError, ValueError):
        return None


def _gone_or_raise(diff: Diff, e: subprocess.CalledProcessError) -> None:
    """Raise SourceGone when the repository answers 404, otherwise re-raise the git failure as it was."""
    status = _repository_status(diff.repo)
    if status == 404:
        detail = (e.stderr or "").strip()
        raise SourceGone(f"https://github.com/{diff.repo} answers HTTP 404; git said: {detail}") from e
    raise e


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


def _materialise_tree(diff: Diff, corpus_root: Path, cache: Path, hermetic: Path) -> Checkout:
    src = corpus_root / diff.id
    if not ((src / "before").is_dir() and (src / "after").is_dir()):
        raise MaterialiseError(f"{diff.id}: tree source needs {src / 'before'} and {src / 'after'}")
    root = cache / "tree" / diff.id
    if root.exists():
        _rmtree(root)
    root.mkdir(parents=True)

    def git(args: list[str]) -> str:
        return _git(args, root, hermetic=hermetic, isolated=True)

    git(["init", "-q", "--template=", "--object-format=sha1", "-b", "main"])
    _persist_settings(git)
    # Before anything is added, so a tree's own `text` attribute cannot rewrite the bytes git stores.
    _pin_attributes(root)
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


def _pin_attributes(root: Path) -> None:
    info = root / ".git" / "info"
    if info.is_symlink() or (info.exists() and not info.is_dir()):
        info.unlink()
    info.mkdir(parents=True, exist_ok=True)
    attributes = info / "attributes"
    if attributes.is_symlink():
        attributes.unlink()
    elif attributes.is_dir():
        _rmtree(attributes)
    if not attributes.is_file() or attributes.read_bytes() != PINNED_ATTRIBUTES:
        attributes.write_bytes(PINNED_ATTRIBUTES)


def _names(out: str) -> list[str]:
    """The paths in git's NUL-separated -z output, sorted."""
    return sorted(n for n in out.split("\0") if n)


def _clear_info_exclude(root: Path) -> None:
    # A template (init.templateDir, GIT_TEMPLATE_DIR) copies info/exclude into a clone, and
    # locrin's file walker reads it, so a non-empty one would hide files. Clones cached
    # before clone ran with --template= are cleaned here too.
    exclude = root / ".git" / "info" / "exclude"
    if exclude.is_symlink() or (exclude.is_file() and exclude.stat().st_size):
        exclude.unlink()


def _tree_entries(out: str) -> list[tuple[str, str]]:
    """The (mode, path) pairs of `git ls-tree -r -z <sha>`, whose records read `<mode> <type> <sha>\tpath`."""
    entries = []
    for record in out.split("\0"):
        if record:
            meta, _, name = record.partition("\t")
            entries.append((meta.split(" ", 1)[0], name))
    return entries


def _case_clash(names: list[str]) -> str | None:
    """Two paths (files or directories) in one tree that differ only by case, or None."""
    seen: dict[str, str] = {}
    for name in names:
        parts = name.split("/")
        for i in range(1, len(parts) + 1):
            path = "/".join(parts[:i])
            other = seen.setdefault(path.casefold(), path)
            if other != path:
                return f"{other!r} and {path!r} differ only by case"
    return None


def _materialise_git(diff: Diff, cache: Path, hermetic: Path) -> Checkout:
    owner, name = diff.repo.split("/", 1)
    root = cache / "repos" / f"{owner}__{name}"

    def git(args: list[str]) -> str:
        return _git(args, root, hermetic=hermetic)

    if not root.exists():
        root.parent.mkdir(parents=True, exist_ok=True)
        # --no-checkout: only the corpus commit is ever checked out, so a path the default
        # branch head holds cannot fail the clone.
        try:
            _git(["clone", "-q", "--template=", "--no-checkout", "--filter=blob:none",
                  f"https://github.com/{diff.repo}.git", str(root)], root.parent, hermetic=hermetic)
        except subprocess.CalledProcessError as e:
            # Leave nothing behind, so the next run clones afresh instead of trusting a broken clone.
            if root.exists():
                _rmtree(root)
            _gone_or_raise(diff, e)
    _persist_settings(git)
    _clear_info_exclude(root)
    _pin_attributes(root)
    checkout = ["checkout", "--detach", "-f", diff.sha]
    try:
        git(checkout)
    except subprocess.CalledProcessError:
        # A clone cached before the commit landed upstream: a promisor clone fetches the commit by
        # itself, a full clone does not. A commit the server no longer has is confirmed by this fetch.
        try:
            git(["fetch", "-q", "origin", diff.sha])
        except subprocess.CalledProcessError as e:
            detail = (e.stderr or "").strip()
            if _NOT_OUR_REF.search(detail):
                raise SourceGone(f"commit {diff.sha} is not on {diff.repo} after an explicit fetch: {detail}") from e
            _gone_or_raise(diff, e)
        git(checkout)
    git(["clean", "-fdq"])
    _clear_info_exclude(root)
    _pin_attributes(root)
    # locrin diffs against merge-base(parent, HEAD), so a parent that is not the commit's own
    # first parent would score a different change from the one labelled.
    first = git(["rev-parse", "--verify", f"{diff.sha}^1"]).strip()
    if first != diff.parent:
        raise MaterialiseError(f"recorded parent {diff.parent} is not the first parent {first or '(none)'} of {diff.sha}")
    tree = _tree_entries(git(["ls-tree", "-r", "-z", diff.sha]))
    clash = _case_clash([name for _, name in tree])
    if clash:
        raise MaterialiseError(f"the tree at {diff.sha[:7]} holds {clash}, "
                               "so a case-insensitive filesystem would check out other files")
    # A partial clone fetches blobs lazily. run_check gives locrin an empty home, so a fetch
    # from locrin's own git calls would lose the machine's network settings (proxy, CA bundle).
    # Diffing the parent against the commit and against the worktree, with rename detection,
    # reads every blob locrin's `git diff <base>` and `git show <base>:<path>` read.
    try:
        git(["diff", "--stat", "-M", diff.parent, diff.sha])
        git(["diff", "--stat", "-M", diff.parent])
        # locrin scores the files `git diff --name-only --diff-filter=ACMR <base>` lists against the working
        # tree. They must be exactly the files the commit changed, or locrin would scope the run to other files.
        # Graph rules still report on files the commit did not change (dead-file on an importer of a changed
        # file); bench.main drops those the parent run also reports, as pre-existing.
        changed = _names(git(["diff", "--name-only", "-z", "--diff-filter=ACMR", diff.parent, diff.sha]))
        worktree = _names(git(["diff", "--name-only", "-z", "--diff-filter=ACMR", diff.parent]))
    except subprocess.CalledProcessError as e:
        _gone_or_raise(diff, e)
    links = sorted({name for mode, name in tree if mode == "120000"} & set(changed))
    if links:
        raise MaterialiseError(f"the commit changes the symbolic link {links[0]}, which checks out as a link "
                               "where the platform has them and as a text file holding its target where it does not")
    if worktree != changed:
        extra = sorted(set(worktree) ^ set(changed))
        raise MaterialiseError(f"the working tree differs from {diff.sha[:7]} in {', '.join(extra)}, "
                               "so locrin would score other files than the commit changed")
    removed = _strip_engine_files(root)
    return Checkout(root=root, base_ref=diff.parent, removed=removed)


def _named(diff: Diff, step):
    """Run step(); every failure becomes a MaterialiseError (SourceGone kept) whose message starts with the diff id."""
    try:
        return step()
    except MaterialiseError as e:
        if str(e).startswith(f"{diff.id}: "):
            raise
        raise type(e)(f"{diff.id}: {e}") from e
    except OSError as e:
        # A locked file, a path too long for Windows, a name the disk refuses: this diff fails, the run goes on.
        raise MaterialiseError(f"{diff.id}: {e}") from e
    except subprocess.CalledProcessError as e:
        cmd = e.cmd if isinstance(e.cmd, list) else [str(e.cmd)]
        if cmd and cmd[0] == "git":
            cmd = cmd[1:]
        detail = (e.stderr or e.stdout or "").strip()
        raise MaterialiseError(f"{diff.id}: git {' '.join(map(str, cmd))} failed: {detail}") from e


def materialise(diff: Diff, corpus_root: Path, cache: Path) -> Checkout:
    """A checkout of the diff's after side with its before side as base_ref.

    Raises SourceGone when a git source is confirmed gone, and MaterialiseError for every
    other failure, a clone or fetch that failed for a reason that may pass included.
    """
    # Resolve once: git runs with cwd set inside the cache, so a relative path
    # handed to it would be resolved against the wrong directory.
    corpus_root = Path(corpus_root).resolve()
    cache = Path(cache).resolve()

    def step() -> Checkout:
        hermetic = _hermetic(cache)
        if diff.source == "tree":
            return _materialise_tree(diff, corpus_root, cache, hermetic)
        return _materialise_git(diff, cache, hermetic)

    return _named(diff, step)


def checkout_base(diff: Diff, checkout: Checkout, cache: Path) -> None:
    """Move a checkout materialise made to its base commit, for the run that finds pre-existing findings.

    The same hygiene as the checkout of the commit: forced, cleaned, attributes pinned, no
    info/exclude, and the engine files stripped, so a baseline the parent holds cannot hide a
    finding that was already there. The next materialise of any diff checks out its own commit.
    Raises MaterialiseError naming the diff.
    """
    cache = Path(cache).resolve()

    def step() -> None:
        hermetic = _hermetic(cache)
        root = checkout.root
        for args in (["checkout", "--detach", "-f", checkout.base_ref], ["clean", "-fdq"]):
            _git(args, root, hermetic=hermetic, isolated=diff.source == "tree")
        _clear_info_exclude(root)
        _pin_attributes(root)
        _strip_engine_files(root)

    _named(diff, step)


_HUNK = re.compile(r"^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@", re.M)


def added_lines(diff: Diff, checkout: Checkout, cache: Path, files: list[str]) -> dict[str, set[int]]:
    """For each named file, the line numbers at the commit that the change added, from `git diff -U0`.

    Call it while the checkout is at the commit, before checkout_base. A file the parent lacks has
    every line added. Each name is a literal path, never a glob. Raises MaterialiseError naming the diff.
    """
    if not files:
        return {}
    cache = Path(cache).resolve()

    def step() -> dict[str, set[int]]:
        hermetic = _hermetic(cache)
        out: dict[str, set[int]] = {}
        for name in files:
            patch = _git(["diff", "-U0", "--no-color", "--no-ext-diff", "--no-textconv", checkout.base_ref, "HEAD",
                          "--", f":(literal){name}"], checkout.root, hermetic=hermetic, isolated=diff.source == "tree")
            out[name] = {start + i for m in _HUNK.finditer(patch)
                         for start, count in [(int(m.group(1)), int(m.group(2) or 1))] for i in range(count)}
        return out

    return _named(diff, step)
