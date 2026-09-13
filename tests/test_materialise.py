import subprocess
from pathlib import Path

import pytest

from bench.corpus import Diff
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


def test_git_failure_names_the_diff(tmp_path, monkeypatch):
    def boom(args, cwd):
        raise subprocess.CalledProcessError(128, args, stderr="fatal: bad object")

    monkeypatch.setattr("bench.materialise._git", boom)
    d = Diff(id="acme__w__abc1234", source="git", repo="acme/w", sha="a" * 40, parent="b" * 40,
             licence="MIT", language="typescript", url="u", files=[])
    with pytest.raises(MaterialiseError, match="acme__w__abc1234"):
        materialise(d, tmp_path / "corpus", tmp_path / "cache")
