import os
import shutil
import subprocess
from pathlib import Path

import pytest

from bench.corpus import Diff, load_corpus
from bench.materialise import Checkout, MaterialiseError, materialise


def tree_diff(tmp_path: Path) -> tuple[Diff, Path]:
    corpus = tmp_path / "corpus"
    (corpus / "fx-x" / "before" / "src").mkdir(parents=True)
    (corpus / "fx-x" / "after" / "src").mkdir(parents=True)
    (corpus / "fx-x" / "before" / "src" / "a.ts").write_text("export const a = 1;\n")
    (corpus / "fx-x" / "after" / "src" / "a.ts").write_text("export const a = 2;\n")
    (corpus / "fx-x" / "after" / "locrin.toml").write_text("[languages]\nphp = true\n")
    d = Diff(id="fx-x", source="tree", repo=None, sha=None, parent=None, licence="MIT",
             language="typescript", url="fixture", files=["src/a.ts"])
    return d, corpus


def test_tree_source_builds_two_commit_repo(tmp_path):
    d, corpus = tree_diff(tmp_path)
    co = materialise(d, corpus, tmp_path / "cache")
    assert isinstance(co, Checkout)
    assert (co.root / "src" / "a.ts").read_text() == "export const a = 2;\n"
    log = subprocess.run(["git", "log", "--format=%s"], cwd=co.root, capture_output=True, text=True, check=True).stdout.split()
    assert log == ["after", "before"]
    base = subprocess.run(["git", "show", f"{co.base_ref}:src/a.ts"], cwd=co.root, capture_output=True, text=True, check=True).stdout
    assert base == "export const a = 1;\n"


def test_tree_source_removes_engine_config_files(tmp_path):
    d, corpus = tree_diff(tmp_path)
    co = materialise(d, corpus, tmp_path / "cache")
    assert not (co.root / "locrin.toml").exists()
    assert co.removed == ["locrin.toml"]


def test_tree_source_is_idempotent(tmp_path):
    d, corpus = tree_diff(tmp_path)
    a = materialise(d, corpus, tmp_path / "cache")
    b = materialise(d, corpus, tmp_path / "cache")
    assert a.base_ref == b.base_ref


def test_tree_source_commits_are_reproducible_across_cache_dirs(tmp_path):
    d, corpus = tree_diff(tmp_path)
    a = materialise(d, corpus, tmp_path / "cache-a")
    b = materialise(d, corpus, tmp_path / "cache-b")
    assert a.base_ref == b.base_ref
    head = ["git", "rev-parse", "HEAD"]
    assert (subprocess.run(head, cwd=a.root, capture_output=True, text=True, check=True).stdout
            == subprocess.run(head, cwd=b.root, capture_output=True, text=True, check=True).stdout)


def test_tree_source_repo_keeps_line_endings(tmp_path):
    d, corpus = tree_diff(tmp_path)
    content = b"export const a = 2;\r\nexport const b = 3;\n"
    (corpus / "fx-x" / "after" / "src" / "a.ts").write_bytes(content)
    co = materialise(d, corpus, tmp_path / "cache")
    setting = subprocess.run(["git", "config", "--local", "--get", "core.autocrlf"], cwd=co.root,
                             capture_output=True, text=True, check=True).stdout.strip()
    assert setting == "false"
    assert (co.root / "src" / "a.ts").read_bytes() == content
    blob = subprocess.run(["git", "cat-file", "blob", "HEAD:src/a.ts"], cwd=co.root,
                          capture_output=True, check=True).stdout
    assert blob == content


def _fake_git_for(parent: str, calls: list[list[str]] | None = None, on=None):
    """A stand-in for bench.materialise._git that answers the first-parent check with parent."""
    def fake_git(args, cwd, **kw):
        if calls is not None:
            calls.append(list(args))
        if on is not None:
            on(args)
        if args[0] == "clone":
            Path(args[-1]).mkdir(parents=True, exist_ok=True)
        if args[0] == "rev-parse" and args[-1].endswith("^1"):
            return parent + "\n"
        return ""
    return fake_git


def test_git_source_uses_cached_clone(tmp_path, monkeypatch):
    calls: list[list[str]] = []
    d = Diff(id="acme__w__abc1234", source="git", repo="acme/w", sha="abc1234" * 5 + "abcde",
             parent="def5678" * 5 + "defgh", licence="MIT", language="typescript",
             url="https://github.com/acme/w/commit/abc1234", files=["src/a.ts"])
    monkeypatch.setattr("bench.materialise._git", _fake_git_for(d.parent, calls))
    co = materialise(d, tmp_path / "corpus", tmp_path / "cache")
    assert co.base_ref == d.parent
    assert co.root == tmp_path / "cache" / "repos" / "acme__w"
    assert calls[0][0] == "clone"
    # No template (hooks, info/exclude) from the machine, and no checkout of the default branch head.
    assert {"--template=", "--no-checkout", "--filter=blob:none"} <= set(calls[0])
    assert calls[0][-2] == "https://github.com/acme/w.git"
    materialise(d, tmp_path / "corpus", tmp_path / "cache")
    assert sum(1 for c in calls if c[0] == "clone") == 1
    checkout = ["checkout", "--detach", "-f", d.sha]
    assert checkout in calls
    assert calls[calls.index(checkout) + 1] == ["clean", "-fdq"]


def test_git_source_strips_engine_files_after_checkout(tmp_path, monkeypatch):
    root = tmp_path / "cache" / "repos" / "acme__w"

    def on(args):
        if args[0] == "checkout":
            root.mkdir(parents=True, exist_ok=True)
            (root / "locrin.toml").write_text("[rules]\n")
            (root / "locrin-baseline.json").write_text("{}\n")

    monkeypatch.setattr("bench.materialise._git", _fake_git_for("b" * 40, on=on))
    root.mkdir(parents=True)
    d = Diff(id="acme__w__aaaaaaa", source="git", repo="acme/w", sha="a" * 40, parent="b" * 40,
             licence="MIT", language="typescript", url="u", files=[])
    co = materialise(d, tmp_path / "corpus", tmp_path / "cache")
    assert co.removed == ["locrin.toml", "locrin-baseline.json"]
    assert not (root / "locrin.toml").exists()
    assert not (root / "locrin-baseline.json").exists()


def test_tree_source_missing_side_names_the_diff(tmp_path):
    d, corpus = tree_diff(tmp_path)
    shutil.rmtree(corpus / "fx-x" / "after")
    with pytest.raises(MaterialiseError, match="fx-x"):
        materialise(d, corpus, tmp_path / "cache")
    with pytest.raises(MaterialiseError, match="fx-x"):
        materialise(d, tmp_path / "no-such-corpus", tmp_path / "cache")


FIXTURES = Path(__file__).resolve().parents[1] / "fixtures" / "corpus"


def test_tree_source_ignores_hostile_global_git_config(tmp_path, monkeypatch):
    (tmp_path / "ignore").write_text("lib/\n")
    hooks = tmp_path / "hooks"
    hooks.mkdir()
    for hook in ("pre-commit", "commit-msg", "post-commit"):
        (hooks / hook).write_text("#!/bin/sh\necho blocked by hook >&2\nexit 1\n", newline="\n")
        os.chmod(hooks / hook, 0o755)
    config = tmp_path / "gitconfig"
    config.write_text(
        "[core]\n"
        f"\texcludesFile = {(tmp_path / 'ignore').as_posix()}\n"
        f"\thooksPath = {hooks.as_posix()}\n"
        "[init]\n"
        "\tdefaultObjectFormat = sha256\n"
        "[commit]\n"
        "\tgpgsign = true\n",
        newline="\n",
    )
    monkeypatch.setenv("GIT_CONFIG_GLOBAL", str(config))
    monkeypatch.setenv("GIT_DEFAULT_HASH", "sha256")
    monkeypatch.setenv("GIT_TEMPLATE_DIR", str(tmp_path / "templates"))
    (tmp_path / "templates" / "hooks").mkdir(parents=True)
    (tmp_path / "templates" / "hooks" / "pre-commit").write_text("#!/bin/sh\nexit 1\n", newline="\n")
    os.chmod(tmp_path / "templates" / "hooks" / "pre-commit", 0o755)
    d = next(x for x in load_corpus(FIXTURES) if x.id == "fx-04-marker")
    co = materialise(d, FIXTURES, tmp_path / "cache")
    assert co.base_ref == "22d4783be682980439e633d89ffbb82bd691ad6a"
    tree = subprocess.run(["git", "ls-tree", "-r", "--name-only", "HEAD"], cwd=co.root, capture_output=True, text=True,
                          check=True).stdout.split()
    assert tree == ["lib/d.js", "package.json"]


def _hostile_user_git_dir(tmp_path: Path, monkeypatch, how: str, ignore: str, attributes: str) -> None:
    # Git reads $XDG_CONFIG_HOME/git/ignore and attributes (or $HOME/.config/git/...)
    # even when no config file names them.
    home = tmp_path / "home"
    xdg = home / ".config"
    (xdg / "git").mkdir(parents=True)
    (xdg / "git" / "ignore").write_text(ignore, newline="\n")
    (xdg / "git" / "attributes").write_text(attributes, newline="\n")
    monkeypatch.setenv("HOME", str(home))
    monkeypatch.setenv("USERPROFILE", str(home))
    if how == "xdg":
        monkeypatch.setenv("XDG_CONFIG_HOME", str(xdg))
    else:
        monkeypatch.delenv("XDG_CONFIG_HOME", raising=False)


@pytest.mark.parametrize("how", ["xdg", "home"])
@pytest.mark.parametrize("attributes", ["*.js working-tree-encoding=UTF-16LE\n", "* text=auto\n"])
def test_tree_source_ignores_default_global_ignore_and_attributes_files(tmp_path, monkeypatch, how, attributes):
    _hostile_user_git_dir(tmp_path, monkeypatch, how, "lib/\n", attributes)
    d = next(x for x in load_corpus(FIXTURES) if x.id == "fx-04-marker")
    co = materialise(d, FIXTURES, tmp_path / "cache")
    tree = subprocess.run(["git", "ls-tree", "-r", "--name-only", "HEAD"], cwd=co.root, capture_output=True, text=True,
                          check=True).stdout.split()
    assert tree == ["lib/d.js", "package.json"]
    assert co.base_ref == "22d4783be682980439e633d89ffbb82bd691ad6a"


@pytest.mark.parametrize("how", ["xdg", "home"])
def test_tree_source_keeps_crlf_under_a_global_text_auto_attributes_file(tmp_path, monkeypatch, how):
    _hostile_user_git_dir(tmp_path, monkeypatch, how, "", "* text=auto\n")
    d, corpus = tree_diff(tmp_path)
    content = b"export const a = 2;\r\nexport const b = 3;\r\n"
    (corpus / "fx-x" / "after" / "src" / "a.ts").write_bytes(content)
    co = materialise(d, corpus, tmp_path / "cache")
    blob = subprocess.run(["git", "cat-file", "blob", "HEAD:src/a.ts"], cwd=co.root,
                          capture_output=True, check=True).stdout
    assert blob == content


def _run(args: list[str], cwd: Path) -> str:
    env = dict(os.environ)
    env.update({"GIT_AUTHOR_NAME": "t", "GIT_AUTHOR_EMAIL": "t@example.invalid",
                "GIT_COMMITTER_NAME": "t", "GIT_COMMITTER_EMAIL": "t@example.invalid"})
    return subprocess.run(["git", "-c", "core.autocrlf=false", "-c", "commit.gpgsign=false", *args],
                          cwd=cwd, env=env, capture_output=True, text=True, check=True).stdout


def test_git_source_with_relative_cache_clones_into_the_cache(tmp_path, monkeypatch):
    work = tmp_path / "upstream"
    work.mkdir()
    _run(["init", "-q", "-b", "main"], work)
    (work / "src").mkdir()
    (work / "src" / "a.ts").write_bytes(b"export const a = 1;\n")
    _run(["add", "src/a.ts"], work)
    _run(["commit", "-q", "--no-verify", "-m", "one"], work)
    parent = _run(["rev-parse", "HEAD"], work).strip()
    (work / "src" / "a.ts").write_bytes(b"export const a = 2;\n")
    _run(["commit", "-q", "--no-verify", "-am", "two"], work)
    sha = _run(["rev-parse", "HEAD"], work).strip()
    remotes = tmp_path / "remotes"
    (remotes / "acme").mkdir(parents=True)
    _run(["clone", "-q", "--bare", str(work), str(remotes / "acme" / "w.git")], tmp_path)
    monkeypatch.setenv("GIT_CONFIG_COUNT", "1")
    monkeypatch.setenv("GIT_CONFIG_KEY_0", f"url.{remotes.as_uri()}/.insteadOf")
    monkeypatch.setenv("GIT_CONFIG_VALUE_0", "https://github.com/")
    run_dir = tmp_path / "run"
    run_dir.mkdir()
    monkeypatch.chdir(run_dir)
    d = Diff(id=f"acme__w__{sha[:7]}", source="git", repo="acme/w", sha=sha, parent=parent,
             licence="MIT", language="typescript", url="u", files=["src/a.ts"])
    for _ in range(2):
        co = materialise(d, Path("corpus"), Path("cache"))
        assert co.root.is_absolute()
        assert co.root.resolve() == (run_dir / "cache" / "repos" / "acme__w").resolve()
        assert co.base_ref == parent
        assert (co.root / "src" / "a.ts").read_bytes() == b"export const a = 2;\n"
    assert not (run_dir / "cache" / "repos" / "cache").exists()


def _write_side(work: Path, files: dict[str, bytes]) -> None:
    for p in work.iterdir():
        if p.name != ".git":
            shutil.rmtree(p) if p.is_dir() else p.unlink()
    for name, data in files.items():
        (work / name).parent.mkdir(parents=True, exist_ok=True)
        (work / name).write_bytes(data)


def _local_upstream(tmp_path: Path, monkeypatch, before: dict[str, bytes] | None = None,
                    after: dict[str, bytes] | None = None) -> Diff:
    work = tmp_path / "upstream"
    work.mkdir()
    _run(["init", "-q", "-b", "main"], work)
    _write_side(work, before or {"src/a.ts": b"export const a = 1;\n"})
    _run(["add", "-A"], work)
    _run(["commit", "-q", "--no-verify", "-m", "one"], work)
    parent = _run(["rev-parse", "HEAD"], work).strip()
    _write_side(work, after or {"src/a.ts": b"export const a = 2;\n"})
    _run(["add", "-A"], work)
    _run(["commit", "-q", "--no-verify", "-m", "two"], work)
    sha = _run(["rev-parse", "HEAD"], work).strip()
    remotes = tmp_path / "remotes"
    (remotes / "acme").mkdir(parents=True)
    _run(["clone", "-q", "--bare", str(work), str(remotes / "acme" / "w.git")], tmp_path)
    _run(["config", "uploadpack.allowFilter", "true"], remotes / "acme" / "w.git")
    monkeypatch.setenv("GIT_CONFIG_COUNT", "1")
    monkeypatch.setenv("GIT_CONFIG_KEY_0", f"url.{remotes.as_uri()}/.insteadOf")
    monkeypatch.setenv("GIT_CONFIG_VALUE_0", "https://github.com/")
    return Diff(id=f"acme__w__{sha[:7]}", source="git", repo="acme/w", sha=sha, parent=parent,
                licence="MIT", language="typescript", url="u", files=["src/a.ts"])


@pytest.mark.parametrize("how", ["xdg", "home"])
def test_git_source_ignores_default_global_ignore_and_attributes_files(tmp_path, monkeypatch, how):
    d = _local_upstream(tmp_path, monkeypatch)
    _hostile_user_git_dir(tmp_path, monkeypatch, how, "stale.ts\n", "*.ts text eol=crlf\n")
    co = materialise(d, tmp_path / "corpus", tmp_path / "cache")
    assert (co.root / "src" / "a.ts").read_bytes() == b"export const a = 2;\n"
    (co.root / "stale.ts").write_bytes(b"left over from an earlier run\n")
    co = materialise(d, tmp_path / "corpus", tmp_path / "cache")
    assert not (co.root / "stale.ts").exists()
    assert (co.root / "src" / "a.ts").read_bytes() == b"export const a = 2;\n"


def test_git_failure_names_the_diff(tmp_path, monkeypatch):
    def boom(args, cwd, **kw):
        raise subprocess.CalledProcessError(128, args, stderr="fatal: bad object")

    monkeypatch.setattr("bench.materialise._git", boom)
    monkeypatch.setattr("bench.materialise._repository_status", lambda repo: 200)
    d = Diff(id="acme__w__abc1234", source="git", repo="acme/w", sha="a" * 40, parent="b" * 40,
             licence="MIT", language="typescript", url="u", files=[])
    with pytest.raises(MaterialiseError, match="acme__w__abc1234"):
        materialise(d, tmp_path / "corpus", tmp_path / "cache")


def _plain_status(root: Path) -> subprocess.CompletedProcess:
    # The user's normal environment and config, plus fscache, which Git for
    # Windows enables system-wide and which cannot open the Windows null device.
    return subprocess.run(["git", "-c", "core.fscache=true", "status", "--porcelain"], cwd=root,
                          capture_output=True, text=True)


@pytest.mark.parametrize("source", ["tree", "git"])
def test_checkout_supports_plain_git_status_and_add(tmp_path, monkeypatch, source):
    if source == "tree":
        d, corpus = tree_diff(tmp_path)
    else:
        d, corpus = _local_upstream(tmp_path, monkeypatch), tmp_path / "corpus"
    _hostile_user_git_dir(tmp_path, monkeypatch, "xdg", "untracked.ts\n", "*.ts working-tree-encoding=UTF-16LE\n")
    co = materialise(d, corpus, tmp_path / "cache")
    (co.root / "untracked.ts").write_bytes(b"export const u = 1;\n")
    status = _plain_status(co.root)
    assert status.returncode == 0, status.stderr
    assert "?? untracked.ts" in status.stdout.splitlines()
    add = subprocess.run(["git", "-c", "core.fscache=true", "add", "-A", "--dry-run"], cwd=co.root,
                         capture_output=True, text=True)
    assert add.returncode == 0, add.stderr
    attrs = subprocess.run(["git", "check-attr", "-a", "src/a.ts"], cwd=co.root, capture_output=True, text=True)
    assert attrs.returncode == 0, attrs.stderr
    # The global working-tree-encoding never applies: the checkout's pinned attributes unset it and every
    # other converting attribute, and nothing else is set.
    assert sorted(attrs.stdout.splitlines()) == sorted(
        f"src/a.ts: {name}: unset" for name in ("text", "eol", "ident", "filter", "working-tree-encoding"))


def test_git_source_prefetches_the_parent_blobs_so_locrin_never_fetches(tmp_path, monkeypatch):
    # run_check gives locrin an empty home, so a lazy blob fetch there would lose the machine's
    # network settings. Every blob locrin's base diff reads must already be local.
    d = _local_upstream(tmp_path, monkeypatch)
    _run(["config", "uploadpack.allowFilter", "true"], tmp_path / "remotes" / "acme" / "w.git")
    co = materialise(d, tmp_path / "corpus", tmp_path / "cache")
    assert _run(["config", "--get", "remote.origin.promisor"], co.root).strip() == "true"
    env = dict(os.environ, GIT_NO_LAZY_FETCH="1")
    probe = subprocess.run(["git", "cat-file", "-e", f"{d.parent}:src/a.ts"], cwd=co.root, env=env,
                           capture_output=True, text=True)
    assert probe.returncode == 0, probe.stderr


@pytest.mark.parametrize("name", ["locrin.toml", "locrin-baseline.json"])
def test_an_engine_file_name_held_by_a_directory_is_a_materialise_error(tmp_path, name):
    d, corpus = tree_diff(tmp_path)
    (corpus / "fx-x" / "after" / "locrin.toml").unlink()
    (corpus / "fx-x" / "after" / name).mkdir()
    (corpus / "fx-x" / "after" / name / "keep.py").write_text("x = 1\n")
    with pytest.raises(MaterialiseError, match=f"fx-x: .*{name}.* is a directory"):
        materialise(d, corpus, tmp_path / "cache")


def test_an_os_error_while_materialising_names_the_diff(tmp_path, monkeypatch):
    d, corpus = tree_diff(tmp_path)

    def refuse(src, dst):
        raise PermissionError(13, "Permission denied", str(dst))

    monkeypatch.setattr("bench.materialise.shutil.copyfile", refuse)
    with pytest.raises(MaterialiseError, match="fx-x: .*Permission denied"):
        materialise(d, corpus, tmp_path / "cache")


def _symlink_or_skip(link: Path, target: str, *, directory: bool = False) -> None:
    try:
        os.symlink(target, link, target_is_directory=directory)
    except (OSError, NotImplementedError) as e:
        pytest.skip(f"cannot create symbolic links here: {e}")


@pytest.mark.parametrize("kind", ["file", "dir"])
def test_a_symlink_in_a_tree_source_is_a_materialise_error_and_copies_nothing_from_outside(tmp_path, kind):
    d, corpus = tree_diff(tmp_path)
    outside = tmp_path / "outside"
    (outside / "sub").mkdir(parents=True)
    (outside / "secret.ts").write_text("export const leaked = 1;\n")
    (outside / "sub" / "secret.ts").write_text("export const leaked = 2;\n")
    after = corpus / "fx-x" / "after" / "src"
    if kind == "file":
        _symlink_or_skip(after / "b.ts", str(outside / "secret.ts"))
    else:
        _symlink_or_skip(after / "lib", str(outside / "sub"), directory=True)
    with pytest.raises(MaterialiseError, match="fx-x: .*symbolic link"):
        materialise(d, corpus, tmp_path / "cache")
    root = tmp_path / "cache" / "tree" / "fx-x"
    assert not (root / "src" / "b.ts").exists() and not (root / "src" / "lib").exists()


def test_git_source_strips_a_dangling_engine_config_symlink(tmp_path, monkeypatch):
    root = tmp_path / "cache" / "repos" / "acme__w"
    root.mkdir(parents=True)
    target = tmp_path / "outside" / "x.yml"
    (tmp_path / "outside").mkdir()
    _symlink_or_skip(root / "probe", str(target))
    (root / "probe").unlink()

    def on(args):
        if args[0] == "checkout":
            os.symlink(str(target), root / "locrin.toml")

    monkeypatch.setattr("bench.materialise._git", _fake_git_for("b" * 40, on=on))
    d = Diff(id="acme__w__aaaaaaa", source="git", repo="acme/w", sha="a" * 40, parent="b" * 40,
             licence="MIT", language="typescript", url="u", files=[])
    co = materialise(d, tmp_path / "corpus", tmp_path / "cache")
    assert co.removed == ["locrin.toml"]
    assert not os.path.lexists(root / "locrin.toml")
    assert not target.exists()


def test_git_source_fetches_a_commit_the_cached_clone_does_not_have(tmp_path, monkeypatch):
    d = _local_upstream(tmp_path, monkeypatch)
    # A full clone, not a promisor one: git never fetches a missing commit into it by itself.
    cached = tmp_path / "cache" / "repos" / "acme__w"
    cached.parent.mkdir(parents=True)
    _run(["clone", "-q", str(tmp_path / "remotes" / "acme" / "w.git"), str(cached)], tmp_path)
    promisor = subprocess.run(["git", "config", "--get", "remote.origin.promisor"], cwd=cached, capture_output=True)
    assert promisor.returncode != 0
    co = materialise(d, tmp_path / "corpus", tmp_path / "cache")
    work = tmp_path / "upstream"
    (work / "src" / "a.ts").write_bytes(b"export const a = 3;\n")
    _run(["commit", "-q", "--no-verify", "-am", "three"], work)
    sha = _run(["rev-parse", "HEAD"], work).strip()
    _run(["push", "-q", str(tmp_path / "remotes" / "acme" / "w.git"), "main"], work)
    newer = Diff(id=f"acme__w__{sha[:7]}", source="git", repo="acme/w", sha=sha, parent=d.sha,
                 licence="MIT", language="typescript", url="u", files=["src/a.ts"])
    co = materialise(newer, tmp_path / "corpus", tmp_path / "cache")
    assert (co.root / "src" / "a.ts").read_bytes() == b"export const a = 3;\n"
    assert co.base_ref == d.sha


# Hermetic git for git sources: the machine's template, hooks, credentials and default
# ignore files never reach a clone, a fetch or a checkout.

MARKER_BEFORE = FIXTURES / "fx-04-marker" / "before"
MARKER_AFTER = FIXTURES / "fx-04-marker" / "after"


def _side(root: Path) -> dict[str, bytes]:
    return {p.relative_to(root).as_posix(): p.read_bytes() for p in sorted(root.rglob("*")) if p.is_file()}


def _hostile_template(tmp_path: Path, monkeypatch, marker: Path) -> None:
    """A git template and global config that would hide lib/ and run a hook on every checkout."""
    tpl = tmp_path / "hostile-template"
    (tpl / "info").mkdir(parents=True)
    (tpl / "info" / "exclude").write_bytes(b"lib/\n")
    (tpl / "hooks").mkdir()
    hook = f'#!/bin/sh\necho ran > "{marker.as_posix()}"\n'.encode("utf-8")
    hooks = tmp_path / "hostile-hooks"
    hooks.mkdir()
    for d in (tpl / "hooks", hooks):
        (d / "post-checkout").write_bytes(hook)
        os.chmod(d / "post-checkout", 0o755)
    home = tmp_path / "hostile-git-home"
    home.mkdir()
    (home / ".gitconfig").write_bytes(
        f"[init]\n\ttemplateDir = {tpl.as_posix()}\n[core]\n\thooksPath = {hooks.as_posix()}\n".encode("utf-8"))
    monkeypatch.setenv("HOME", str(home))
    monkeypatch.setenv("USERPROFILE", str(home))
    monkeypatch.setenv("GIT_CONFIG_GLOBAL", str(home / ".gitconfig"))
    monkeypatch.setenv("GIT_TEMPLATE_DIR", str(tpl))
    # The environment's own config list, which routes the remote in these tests, carries a template too.
    monkeypatch.setenv("GIT_CONFIG_COUNT", "2")
    monkeypatch.setenv("GIT_CONFIG_KEY_1", "init.templateDir")
    monkeypatch.setenv("GIT_CONFIG_VALUE_1", str(tpl))


def test_git_source_clone_takes_no_template_exclude_and_runs_no_hook(tmp_path, monkeypatch):
    d = _local_upstream(tmp_path, monkeypatch, _side(MARKER_BEFORE), _side(MARKER_AFTER))
    marker = tmp_path / "hook-ran"
    _hostile_template(tmp_path, monkeypatch, marker)
    co = materialise(d, tmp_path / "corpus", tmp_path / "cache")
    exclude = co.root / ".git" / "info" / "exclude"
    assert not exclude.exists() or exclude.read_bytes() == b""
    assert not marker.exists()
    assert (co.root / "lib" / "d.js").read_bytes() == (MARKER_AFTER / "lib" / "d.js").read_bytes()
    ignored = subprocess.run(["git", "check-ignore", "-q", "lib/d.js"], cwd=co.root, capture_output=True)
    assert ignored.returncode == 1


def test_a_cached_clone_with_a_non_empty_info_exclude_is_cleaned_on_every_checkout(tmp_path, monkeypatch):
    d = _local_upstream(tmp_path, monkeypatch)
    co = materialise(d, tmp_path / "corpus", tmp_path / "cache")
    (co.root / ".git" / "info").mkdir(exist_ok=True)
    (co.root / ".git" / "info" / "exclude").write_bytes(b"src/\n")
    co = materialise(d, tmp_path / "corpus", tmp_path / "cache")
    exclude = co.root / ".git" / "info" / "exclude"
    assert not exclude.exists() or exclude.read_bytes() == b""


@pytest.mark.skipif(shutil.which("locrin") is None, reason="locrin not on PATH")
def test_git_source_findings_do_not_change_under_a_hostile_template(tmp_path, monkeypatch):
    from bench.run import normalise, run_check

    locrin = Path(shutil.which("locrin"))
    d = _local_upstream(tmp_path, monkeypatch, _side(MARKER_BEFORE), _side(MARKER_AFTER))

    def findings(cache: str) -> list[tuple]:
        co = materialise(d, tmp_path / "corpus", tmp_path / cache)
        fs, _ = normalise(d.id, run_check(locrin, co, tmp_path / f"work-{cache}", d.id))
        return [(f.rule, f.file, f.line, f.id) for f in fs]

    machine = findings("cache-machine")
    assert [f[:2] for f in machine] == [("leftover-agent-marker", "lib/d.js")] * 2
    _hostile_template(tmp_path, monkeypatch, tmp_path / "hook-ran")
    assert findings("cache-hostile") == machine


def test_every_git_call_is_isolated_from_machine_configuration(tmp_path, monkeypatch):
    import bench.materialise as m

    seen = {}

    def fake_run(cmd, **kw):
        seen["cmd"], seen["env"] = cmd, kw["env"]
        return subprocess.CompletedProcess(cmd, 0, stdout="", stderr="")

    monkeypatch.setenv("GIT_TEMPLATE_DIR", "hostile")
    monkeypatch.setenv("GIT_CONFIG_SYSTEM", "hostile")
    monkeypatch.setenv("GIT_CONFIG_GLOBAL", "hostile")
    monkeypatch.setattr(m.subprocess, "run", fake_run)
    hermetic = m._hermetic(tmp_path / "cache")
    for isolated in (False, True):
        m._git(["status"], tmp_path, hermetic=hermetic, isolated=isolated)
        env, cmd = seen["env"], seen["cmd"]
        assert env["GIT_CONFIG_NOSYSTEM"] == "1"
        assert "GIT_TEMPLATE_DIR" not in env and "GIT_CONFIG_SYSTEM" not in env
        assert Path(env["GIT_CONFIG_GLOBAL"]).is_file() and Path(env["GIT_CONFIG_GLOBAL"]).read_bytes() == b""
        hooks = [a.split("=", 1)[1] for a in cmd if a.startswith("core.hooksPath=")]
        assert len(hooks) == 1 and Path(hooks[0]).is_dir() and not any(Path(hooks[0]).iterdir())
        for setting in ("credential.helper=", "core.longpaths=true", "core.eol=lf", "core.autocrlf=false"):
            assert setting in cmd, setting
        assert env["GCM_INTERACTIVE"] == "never" and env["GIT_LFS_SKIP_SMUDGE"] == "1"
        assert env["GIT_TERMINAL_PROMPT"] == "0"
        assert cmd[-1] == "status"


def test_the_hermetic_directory_is_emptied_again_when_something_lands_in_it(tmp_path):
    import bench.materialise as m

    hermetic = m._hermetic(tmp_path / "cache")
    (hermetic / "hooks" / "post-checkout").write_bytes(b"#!/bin/sh\n")
    (hermetic / "config").write_bytes(b"[core]\n\thooksPath = /x\n")
    hermetic = m._hermetic(tmp_path / "cache")
    assert list((hermetic / "hooks").iterdir()) == []
    assert (hermetic / "config").read_bytes() == b""


def test_git_source_checkout_is_lf_under_an_in_repo_text_auto_attribute(tmp_path, monkeypatch):
    files = {".gitattributes": b"* text=auto\n", "src/a.ts": b"export const a = 1;\nexport const b = 2;\n"}
    after = dict(files, **{"src/a.ts": b"export const a = 2;\nexport const b = 3;\n"})
    d = _local_upstream(tmp_path, monkeypatch, files, after)
    co = materialise(d, tmp_path / "corpus", tmp_path / "cache")
    assert (co.root / "src" / "a.ts").read_bytes() == b"export const a = 2;\nexport const b = 3;\n"
    for key, value in (("core.longpaths", "true"), ("core.eol", "lf"), ("core.autocrlf", "false")):
        got = subprocess.run(["git", "config", "--local", "--get", key], cwd=co.root, capture_output=True, text=True)
        assert got.stdout.strip() == value, key


def _commit_tree(bare: Path, parent: str, files: dict[str, bytes], tmp_path: Path) -> str:
    """A commit on top of parent holding exactly files, written with plumbing into a bare repository."""
    index = tmp_path / "plumbing.index"
    if index.exists():
        index.unlink()
    env = dict(os.environ, GIT_INDEX_FILE=str(index), GIT_AUTHOR_NAME="t", GIT_AUTHOR_EMAIL="t@example.invalid",
               GIT_COMMITTER_NAME="t", GIT_COMMITTER_EMAIL="t@example.invalid")
    for name, data in files.items():
        blob = subprocess.run(["git", "hash-object", "-w", "--stdin"], cwd=bare, input=data,
                              capture_output=True, check=True).stdout.decode().strip()
        subprocess.run(["git", "update-index", "--add", "--cacheinfo", f"100644,{blob},{name}"], cwd=bare, env=env,
                       check=True, capture_output=True)
    tree = subprocess.run(["git", "write-tree"], cwd=bare, env=env, capture_output=True, text=True,
                          check=True).stdout.strip()
    sha = subprocess.run(["git", "commit-tree", tree, "-p", parent, "-m", "plumbing"], cwd=bare, env=env,
                         capture_output=True, text=True, check=True).stdout.strip()
    subprocess.run(["git", "update-ref", "refs/heads/main", sha], cwd=bare, check=True)
    return sha


def test_git_source_checks_out_a_path_longer_than_the_windows_default_limit(tmp_path, monkeypatch):
    d = _local_upstream(tmp_path, monkeypatch)
    deep = "/".join(["some-fairly-long-directory-name-for-a-package"] * 7) + "/index.ts"
    bare = tmp_path / "remotes" / "acme" / "w.git"
    # Written with plumbing, so the test never needs a long worktree path of its own.
    sha = _commit_tree(bare, d.sha, {"src/a.ts": b"export const a = 3;\n", deep: b"export const x = 1;\n"}, tmp_path)
    deep_diff = Diff(id=f"acme__w__{sha[:7]}", source="git", repo="acme/w", sha=sha, parent=d.sha,
                     licence="MIT", language="typescript", url="u", files=["src/a.ts"])
    co = materialise(deep_diff, tmp_path / "corpus", tmp_path / "c")
    assert len(str(co.root / deep)) > 260
    assert co.base_ref == d.sha
    assert (co.root / "src" / "a.ts").read_bytes() == b"export const a = 3;\n"


@pytest.mark.parametrize("names", [["src/Util.ts", "src/util.ts"], ["Src/x.ts", "src/y.ts"], ["lib.ts", "LIB.ts/x.ts"]])
def test_a_tree_holding_paths_that_differ_only_by_case_is_a_materialise_error(tmp_path, monkeypatch, names):
    # A case-insensitive filesystem checks such a tree out differently, so the engine would see other files.
    d = _local_upstream(tmp_path, monkeypatch)
    bare = tmp_path / "remotes" / "acme" / "w.git"
    files = {"src/a.ts": b"export const a = 3;\n", **{n: b"export const u = 1;\n" for n in names}}
    sha = _commit_tree(bare, d.sha, files, tmp_path)
    clash = Diff(id=f"acme__w__{sha[:7]}", source="git", repo="acme/w", sha=sha, parent=d.sha,
                 licence="MIT", language="typescript", url="u", files=["src/a.ts"])
    with pytest.raises(MaterialiseError, match=f"{clash.id}: .*differ only by case"):
        materialise(clash, tmp_path / "corpus", tmp_path / "cache")


def test_a_parent_that_is_not_the_commits_first_parent_is_a_materialise_error(tmp_path, monkeypatch):
    d = _local_upstream(tmp_path, monkeypatch)
    wrong = Diff(id=d.id, source="git", repo=d.repo, sha=d.sha, parent=d.sha, licence="MIT",
                 language="typescript", url="u", files=d.files)
    with pytest.raises(MaterialiseError, match=f"{d.id}: .*first parent"):
        materialise(wrong, tmp_path / "corpus", tmp_path / "cache")


# A source is confirmed gone only on the repository's own 404 or a commit the server
# says it does not have after an explicit fetch. Anything else is transient.

def test_a_commit_missing_after_an_explicit_fetch_is_a_confirmed_gone_source(tmp_path, monkeypatch):
    from bench.materialise import SourceGone

    d = _local_upstream(tmp_path, monkeypatch)
    materialise(d, tmp_path / "corpus", tmp_path / "cache")
    monkeypatch.setattr("bench.materialise._repository_status", lambda repo: pytest.fail("no probe needed"))
    gone = Diff(id="acme__w__1111111", source="git", repo="acme/w", sha="1" * 40, parent=d.sha, licence="MIT",
                language="typescript", url="u", files=["src/a.ts"])
    with pytest.raises(SourceGone, match="acme__w__1111111: .*not our ref"):
        materialise(gone, tmp_path / "corpus", tmp_path / "cache")


def test_a_clone_of_a_repository_that_answers_404_is_a_confirmed_gone_source(tmp_path, monkeypatch):
    from bench.materialise import SourceGone

    d = _local_upstream(tmp_path, monkeypatch)
    (tmp_path / "remotes" / "acme" / "w.git").rename(tmp_path / "remotes" / "acme" / "moved.git")
    monkeypatch.setattr("bench.materialise._repository_status", lambda repo: 404)
    with pytest.raises(SourceGone, match=f"{d.id}: .*acme/w.*404"):
        materialise(d, tmp_path / "corpus", tmp_path / "cache")
    assert not (tmp_path / "cache" / "repos" / "acme__w").exists()


@pytest.mark.parametrize("status", [200, 500, 503, 429, None])
def test_a_clone_that_fails_for_any_other_reason_is_transient_and_leaves_no_clone(tmp_path, monkeypatch, status):
    from bench.materialise import SourceGone

    d = _local_upstream(tmp_path, monkeypatch)
    (tmp_path / "remotes" / "acme" / "w.git").rename(tmp_path / "remotes" / "acme" / "moved.git")
    monkeypatch.setattr("bench.materialise._repository_status", lambda repo: status)
    with pytest.raises(MaterialiseError, match=f"{d.id}: git clone") as caught:
        materialise(d, tmp_path / "corpus", tmp_path / "cache")
    assert not isinstance(caught.value, SourceGone)
    assert not (tmp_path / "cache" / "repos" / "acme__w").exists()


def test_a_fetch_that_fails_without_not_our_ref_is_transient_unless_the_repository_answers_404(tmp_path, monkeypatch):
    from bench.materialise import SourceGone

    d = Diff(id="acme__w__aaaaaaa", source="git", repo="acme/w", sha="a" * 40, parent="b" * 40,
             licence="MIT", language="typescript", url="u", files=[])
    (tmp_path / "cache" / "repos" / "acme__w").mkdir(parents=True)

    def fake_git(args, cwd, **kw):
        if args[0] in ("checkout", "fetch"):
            raise subprocess.CalledProcessError(128, args, stderr="fatal: unable to access: Could not resolve host")
        return ""

    monkeypatch.setattr("bench.materialise._git", fake_git)
    monkeypatch.setattr("bench.materialise._repository_status", lambda repo: None)
    with pytest.raises(MaterialiseError, match="Could not resolve host") as caught:
        materialise(d, tmp_path / "corpus", tmp_path / "cache")
    assert not isinstance(caught.value, SourceGone)
    monkeypatch.setattr("bench.materialise._repository_status", lambda repo: 404)
    with pytest.raises(SourceGone, match="404"):
        materialise(d, tmp_path / "corpus", tmp_path / "cache")


def test_repository_status_reports_the_http_status_or_none(monkeypatch):
    import urllib.error

    import bench.materialise as m

    class Response:
        status = 200

        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

    urls = []

    def ok(req, timeout):
        urls.append((req.full_url, req.get_method()))
        return Response()

    monkeypatch.setattr(m.urllib.request, "urlopen", ok)
    assert m._repository_status("acme/w") == 200
    assert urls == [("https://github.com/acme/w", "HEAD")]

    def not_found(req, timeout):
        raise urllib.error.HTTPError(req.full_url, 404, "Not Found", {}, None)

    monkeypatch.setattr(m.urllib.request, "urlopen", not_found)
    assert m._repository_status("acme/w") == 404

    def offline(req, timeout):
        raise urllib.error.URLError("no route")

    monkeypatch.setattr(m.urllib.request, "urlopen", offline)
    assert m._repository_status("acme/w") is None

    def timed_out(req, timeout):
        raise TimeoutError("timed out")

    monkeypatch.setattr(m.urllib.request, "urlopen", timed_out)
    assert m._repository_status("acme/w") is None


def test_a_non_ascii_path_anywhere_in_the_tree_materialises(tmp_path, monkeypatch):
    # git prints raw UTF-8 names; decoded with the Windows code page, the byte 0x81 in "Á" would lose all output.
    before = {"src/a.ts": b"export const a = 1;\n", "src/Á.ts": b"export const b = 1;\n"}
    after = {"src/a.ts": b"console.log(1);\nexport const a = 1;\n", "src/Á.ts": b"export const b = 1;\n"}
    d = _local_upstream(tmp_path, monkeypatch, before, after)
    co = materialise(d, tmp_path / "corpus", tmp_path / "cache")
    assert (co.root / "src" / "Á.ts").read_bytes() == b"export const b = 1;\n"
    assert co.base_ref == d.parent


def test_git_output_is_decoded_as_utf8_whatever_the_locale(tmp_path, monkeypatch):
    import bench.materialise as m

    seen = {}

    def fake_run(cmd, **kw):
        seen.update(kw)
        return subprocess.CompletedProcess(cmd, 0, stdout="", stderr="")

    monkeypatch.setattr(m.subprocess, "run", fake_run)
    m._git(["status"], tmp_path, hermetic=m._hermetic(tmp_path / "cache"))
    assert seen["encoding"] == "utf-8" and seen["errors"] == "surrogateescape"


# A blob stored with CRLF under an in-repo `text` attribute: git would list the file as modified
# whenever it rehashes the index entry (a racily clean entry, a changed timestamp), so the files
# locrin scores would depend on checkout timing. The harness pins every attribute that converts content.

OLD_CRLF = b"export function old() {\r\n  console.log('old');\r\n  // TODO(agent): remove\r\n}\r\n"


def _crlf_under_text(tmp_path: Path, monkeypatch) -> tuple[Diff, str]:
    """(Y, c1): c1 holds aaa/old.ts as a CRLF blob plus `*.ts text`; Y adds only src/new.ts on top of c1."""
    d = _local_upstream(tmp_path, monkeypatch)
    bare = tmp_path / "remotes" / "acme" / "w.git"
    base = {"src/a.ts": b"export const a = 2;\n", "aaa/old.ts": OLD_CRLF, ".gitattributes": b"*.ts text\n"}
    c1 = _commit_tree(bare, d.sha, base, tmp_path)
    y = _commit_tree(bare, c1, dict(base, **{"src/new.ts": b"export const n = 1;\n"}), tmp_path)
    return Diff(id=f"acme__w__{y[:7]}", source="git", repo="acme/w", sha=y, parent=c1, licence="MIT",
                language="typescript", url="u", files=["src/new.ts"]), c1


def _rehash(path: Path) -> None:
    # A timestamp the index does not hold makes git read and clean the file again, as a racily clean entry does.
    future = path.stat().st_mtime + 3600
    os.utime(path, (future, future))


def _changed(root: Path, base: str) -> list[str]:
    out = subprocess.run(["git", "diff", "--name-only", "-z", "--diff-filter=ACMR", base], cwd=root,
                         capture_output=True, check=True).stdout
    return sorted(n.decode("utf-8") for n in out.split(b"\0") if n)


def test_a_crlf_blob_under_a_text_attribute_never_shows_as_changed_in_a_git_checkout(tmp_path, monkeypatch):
    d, c1 = _crlf_under_text(tmp_path, monkeypatch)
    co = materialise(d, tmp_path / "corpus", tmp_path / "cache")
    assert (co.root / "aaa" / "old.ts").read_bytes() == OLD_CRLF
    _rehash(co.root / "aaa" / "old.ts")
    assert _changed(co.root, c1) == ["src/new.ts"]
    assert (co.root / ".git" / "info" / "attributes").read_bytes() == b"* -text -eol -ident -filter -working-tree-encoding\n"


def test_the_pinned_attributes_file_is_restored_on_every_checkout_of_a_cached_clone(tmp_path, monkeypatch):
    d, c1 = _crlf_under_text(tmp_path, monkeypatch)
    co = materialise(d, tmp_path / "corpus", tmp_path / "cache")
    (co.root / ".git" / "info" / "attributes").write_bytes(b"*.ts text\n")
    co = materialise(d, tmp_path / "corpus", tmp_path / "cache")
    _rehash(co.root / "aaa" / "old.ts")
    assert _changed(co.root, c1) == ["src/new.ts"]


def test_a_crlf_file_under_a_text_attribute_in_a_tree_source_keeps_its_bytes_and_never_shows_as_changed(tmp_path):
    d, corpus = tree_diff(tmp_path)
    for side in ("before", "after"):
        (corpus / "fx-x" / side / ".gitattributes").write_bytes(b"*.ts text\n")
        (corpus / "fx-x" / side / "aaa").mkdir()
        (corpus / "fx-x" / side / "aaa" / "old.ts").write_bytes(OLD_CRLF)
    co = materialise(d, corpus, tmp_path / "cache")
    blob = subprocess.run(["git", "cat-file", "blob", "HEAD:aaa/old.ts"], cwd=co.root, capture_output=True,
                          check=True).stdout
    assert blob == OLD_CRLF
    _rehash(co.root / "aaa" / "old.ts")
    assert "aaa/old.ts" not in _changed(co.root, co.base_ref)


def test_a_working_tree_that_differs_from_the_commit_is_a_materialise_error(tmp_path, monkeypatch):
    root = tmp_path / "cache" / "repos" / "acme__w"
    root.mkdir(parents=True)
    d = Diff(id="acme__w__aaaaaaa", source="git", repo="acme/w", sha="a" * 40, parent="b" * 40,
             licence="MIT", language="typescript", url="u", files=[])
    fake = _fake_git_for(d.parent)

    def git(args, cwd, **kw):
        if args[:2] == ["diff", "--name-only"]:
            return "src/new.ts\0" if args[-1] == d.sha else "aaa/old.ts\0src/new.ts\0"
        return fake(args, cwd, **kw)

    monkeypatch.setattr("bench.materialise._git", git)
    with pytest.raises(MaterialiseError, match=f"{d.id}: .*working tree.*aaa/old.ts"):
        materialise(d, tmp_path / "corpus", tmp_path / "cache")


@pytest.mark.skipif(shutil.which("locrin") is None, reason="locrin not on PATH")
def test_findings_on_a_file_the_commit_did_not_change_never_depend_on_checkout_timing(tmp_path, monkeypatch):
    from bench.run import normalise, run_check

    d, _ = _crlf_under_text(tmp_path, monkeypatch)
    co = materialise(d, tmp_path / "corpus", tmp_path / "cache")
    _rehash(co.root / "aaa" / "old.ts")
    fs, _ = normalise(d.id, run_check(Path(shutil.which("locrin")), co, tmp_path / "work", d.id))
    assert [f.file for f in fs if f.file == "aaa/old.ts"] == []
