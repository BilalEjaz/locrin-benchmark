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


def test_git_source_uses_cached_clone(tmp_path, monkeypatch):
    calls: list[list[str]] = []

    def fake_git(args, cwd):
        calls.append(list(args))
        if args[:2] == ["clone", "--filter=blob:none"]:
            Path(args[-1]).mkdir(parents=True, exist_ok=True)
        return ""

    monkeypatch.setattr("bench.materialise._git", fake_git)
    d = Diff(id="acme__w__abc1234", source="git", repo="acme/w", sha="abc1234" * 5 + "abcde",
             parent="def5678" * 5 + "defgh", licence="MIT", language="typescript",
             url="https://github.com/acme/w/commit/abc1234", files=["src/a.ts"])
    co = materialise(d, tmp_path / "corpus", tmp_path / "cache")
    assert co.base_ref == d.parent
    assert co.root == tmp_path / "cache" / "repos" / "acme__w"
    assert calls[0][:2] == ["clone", "--filter=blob:none"]
    assert calls[0][2] == "https://github.com/acme/w.git"
    materialise(d, tmp_path / "corpus", tmp_path / "cache")
    assert sum(1 for c in calls if c[0] == "clone") == 1
    checkout = ["checkout", "--detach", "-f", d.sha]
    assert checkout in calls
    assert calls[calls.index(checkout) + 1] == ["clean", "-fdq"]


def test_git_source_strips_engine_files_after_checkout(tmp_path, monkeypatch):
    root = tmp_path / "cache" / "repos" / "acme__w"

    def fake_git(args, cwd):
        if args[0] == "checkout":
            root.mkdir(parents=True, exist_ok=True)
            (root / "locrin.toml").write_text("[rules]\n")
            (root / "locrin-baseline.json").write_text("{}\n")
        return ""

    monkeypatch.setattr("bench.materialise._git", fake_git)
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


def _local_upstream(tmp_path: Path, monkeypatch) -> Diff:
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
    def boom(args, cwd):
        raise subprocess.CalledProcessError(128, args, stderr="fatal: bad object")

    monkeypatch.setattr("bench.materialise._git", boom)
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
    assert attrs.stdout == ""


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

    def fake_git(args, cwd):
        if args[0] == "checkout":
            os.symlink(str(target), root / "locrin.toml")
        return ""

    monkeypatch.setattr("bench.materialise._git", fake_git)
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
