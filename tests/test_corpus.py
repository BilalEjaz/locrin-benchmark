import json
from pathlib import Path

import pytest

from bench.corpus import LANGUAGE_OF_EXT, CorpusError, Diff, language_of, load_corpus


def write(root: Path, rec: dict) -> None:
    (root / f"{rec['id']}.json").write_text(json.dumps(rec), encoding="utf-8")


def good(**over) -> dict:
    rec = {
        "id": "acme__widgets__abc1234",
        "source": "git",
        "repo": "acme/widgets",
        "sha": "abc1234abc1234abc1234abc1234abc1234abc12",
        "parent": "def5678def5678def5678def5678def5678def56",
        "licence": "MIT",
        "language": "typescript",
        "url": "https://github.com/acme/widgets/commit/abc1234",
        "files": ["src/a.ts", "src/b.tsx"],
    }
    rec.update(over)
    return rec


def test_loads_records_sorted_by_id(tmp_path):
    write(tmp_path, good(id="b__x__1111111", repo="b/x", sha="1111111" + "0" * 33))
    write(tmp_path, good(id="a__x__2222222", repo="a/x", sha="2222222" + "0" * 33))
    diffs = load_corpus(tmp_path)
    assert [d.id for d in diffs] == ["a__x__2222222", "b__x__1111111"]
    assert isinstance(diffs[0], Diff)
    assert diffs[0].files == ["src/a.ts", "src/b.tsx"]


def test_rejects_unknown_licence(tmp_path):
    write(tmp_path, good(licence="GPL-3.0"))
    with pytest.raises(CorpusError, match="licence"):
        load_corpus(tmp_path)


def test_rejects_id_mismatch_and_unknown_language(tmp_path):
    (tmp_path / "other.json").write_text(json.dumps(good()), encoding="utf-8")
    with pytest.raises(CorpusError, match="id"):
        load_corpus(tmp_path)
    (tmp_path / "other.json").unlink()
    write(tmp_path, good(language="rust"))
    with pytest.raises(CorpusError, match="language"):
        load_corpus(tmp_path)


def test_tree_source_needs_no_repo_fields(tmp_path):
    write(tmp_path, good(id="fx-01-debug", source="tree", repo=None, sha=None, parent=None, url="fixture"))
    (tmp_path / "fx-01-debug" / "before").mkdir(parents=True)
    (tmp_path / "fx-01-debug" / "after").mkdir(parents=True)
    assert load_corpus(tmp_path)[0].source == "tree"


def test_tree_source_requires_before_and_after_dirs(tmp_path):
    write(tmp_path, good(id="fx-01-debug", source="tree", repo=None, sha=None, parent=None, url="fixture"))
    with pytest.raises(CorpusError, match="before"):
        load_corpus(tmp_path)


def test_language_of_extension():
    assert language_of("src/a.ts") == "typescript"
    assert language_of("src/a.tsx") == "tsx"
    assert language_of("lib/x.mjs") == "javascript"
    assert language_of("app/x.phtml") == "php"
    assert language_of("pkg/m.py") == "python"
    assert language_of("README.md") is None


def test_sort_does_not_depend_on_directory_order(tmp_path, monkeypatch):
    # Code-point order puts "B" before "a"; case-insensitive order would not.
    write(tmp_path, good(id="a__x__1111111", repo="a/x", sha="1111111" + "0" * 33))
    write(tmp_path, good(id="B__x__2222222", repo="B/x", sha="2222222" + "0" * 33))
    real_glob = Path.glob

    def reversed_glob(self, pattern, *args, **kwargs):
        # Yield names in reverse code-point order, the opposite of the expected result.
        return iter(sorted(real_glob(self, pattern, *args, **kwargs), key=lambda q: q.name, reverse=True))

    monkeypatch.setattr(Path, "glob", reversed_glob)
    assert [d.id for d in load_corpus(tmp_path)] == ["B__x__2222222", "a__x__1111111"]


# Engine 0.5.0, crates/core/src/lang.rs, Language::from_path.
@pytest.mark.parametrize(
    "path, expected",
    [
        ("src/a.ts", "typescript"),
        ("src/a.mts", "typescript"),
        ("src/a.cts", "typescript"),
        ("src/a.tsx", "tsx"),
        ("lib/x.js", "javascript"),
        ("lib/x.jsx", "javascript"),
        ("lib/x.mjs", "javascript"),
        ("lib/x.cjs", "javascript"),
        ("app/x.php", "php"),
        ("app/x.phtml", "php"),
        ("pkg/m.py", "python"),
        ("top.py", "python"),
        ("..py", "python"),
        ("types/a.d.ts", None),
        ("types/a.d.mts", None),
        ("types/a.d.cts", None),
        ("pkg/m.pyi", None),
        ("a/B.TS", None),
        ("a/x.Py", None),
        ("a/.py", None),
        (".ts", None),
        ("a.b/c", None),
        ("a/b.", None),
        ("README.md", None),
        ("Makefile", None),
    ],
)
def test_language_of_mirrors_engine(path, expected):
    assert language_of(path) == expected


def test_language_of_ext_covers_engine_extensions():
    for ext in (".ts", ".mts", ".cts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".php", ".phtml", ".py"):
        assert ext in LANGUAGE_OF_EXT


def test_rejects_missing_key(tmp_path):
    rec = good()
    del rec["files"]
    write(tmp_path, rec)
    with pytest.raises(CorpusError, match="missing files"):
        load_corpus(tmp_path)


def test_rejects_non_object_json(tmp_path):
    (tmp_path / "acme__widgets__abc1234.json").write_text("[1, 2]", encoding="utf-8")
    with pytest.raises(CorpusError, match="JSON object"):
        load_corpus(tmp_path)


def test_rejects_invalid_json(tmp_path):
    (tmp_path / "acme__widgets__abc1234.json").write_text("{", encoding="utf-8")
    with pytest.raises(CorpusError, match="not valid JSON"):
        load_corpus(tmp_path)


def test_rejects_missing_corpus_directory(tmp_path):
    with pytest.raises(CorpusError, match="does not exist"):
        load_corpus(tmp_path / "nope")


def test_rejects_unknown_source(tmp_path):
    write(tmp_path, good(source="svn"))
    with pytest.raises(CorpusError, match="source must be"):
        load_corpus(tmp_path)


@pytest.mark.parametrize("key", ["repo", "sha", "parent"])
@pytest.mark.parametrize("value", [None, ""])
def test_git_source_needs_repo_sha_parent(tmp_path, key, value):
    write(tmp_path, good(**{key: value}))
    with pytest.raises(CorpusError, match="git source needs"):
        load_corpus(tmp_path)


def test_rejects_backslash_in_files(tmp_path):
    write(tmp_path, good(files=["src" + chr(92) + "a.ts"]))
    with pytest.raises(CorpusError, match="forward-slash"):
        load_corpus(tmp_path)


@pytest.mark.parametrize(
    "bad",
    ["/etc/passwd", "../../x.ts", "src/../x.ts", "./src/a.ts", "src/./a.ts", "C:/Windows/x.ts", "c:x.ts", "", "src//a.ts", "src/"],
)
def test_rejects_unsafe_file_paths(tmp_path, bad):
    write(tmp_path, good(files=["src/a.ts", bad]))
    with pytest.raises(CorpusError, match="files"):
        load_corpus(tmp_path)


def test_rejects_non_list_files(tmp_path):
    write(tmp_path, good(files="src/a.ts"))
    with pytest.raises(CorpusError, match="files"):
        load_corpus(tmp_path)


def test_tree_source_requires_after_dir(tmp_path):
    write(tmp_path, good(id="fx-01-debug", source="tree", repo=None, sha=None, parent=None, url="fixture"))
    (tmp_path / "fx-01-debug" / "before").mkdir(parents=True)
    with pytest.raises(CorpusError, match="after"):
        load_corpus(tmp_path)


@pytest.mark.parametrize("bad_id", [".", "..", "fx-1-debug", "fx-01-Debug", "x__y", "a__b__ABC1234", "a b__c__abc1234"])
def test_rejects_malformed_id(tmp_path, bad_id):
    (tmp_path / f"{bad_id}.json").write_text(
        json.dumps(good(id=bad_id, source="tree", repo=None, sha=None, parent=None, url="fixture")), encoding="utf-8"
    )
    (tmp_path / bad_id / "before").mkdir(parents=True, exist_ok=True)
    (tmp_path / bad_id / "after").mkdir(parents=True, exist_ok=True)
    with pytest.raises(CorpusError, match="not a valid diff id"):
        load_corpus(tmp_path)


@pytest.mark.parametrize("bad_id", [".__x__abc1234", "..__x__abc1234", "a__..__abc1234"])
def test_rejects_dot_parts_in_real_id(tmp_path, bad_id):
    (tmp_path / f"{bad_id}.json").write_text(
        json.dumps(good(id=bad_id, source="tree", repo=None, sha=None, parent=None, url="fixture")), encoding="utf-8"
    )
    (tmp_path / bad_id / "before").mkdir(parents=True, exist_ok=True)
    (tmp_path / bad_id / "after").mkdir(parents=True, exist_ok=True)
    with pytest.raises(CorpusError, match="not a valid diff id"):
        load_corpus(tmp_path)


@pytest.mark.parametrize("repo", ["noslash", "a/../../../../escape", "a/b/c", "../b", "a/..", "./b", "a/.", "a b/c", "/b", "a/"])
def test_rejects_malformed_repo(tmp_path, repo):
    write(tmp_path, good(repo=repo))
    with pytest.raises(CorpusError, match="repo must be owner/name"):
        load_corpus(tmp_path)


@pytest.mark.parametrize("key", ["sha", "parent"])
@pytest.mark.parametrize(
    "value", ["--orphan=pwn", "abc1234", "ABC1234ABC1234ABC1234ABC1234ABC1234ABC12", "g" * 40, "a" * 41, "a" * 40 + "\n"]
)
def test_rejects_malformed_commit_hash(tmp_path, key, value):
    write(tmp_path, good(**{key: value}))
    with pytest.raises(CorpusError, match=f"{key} must be a 40-character lowercase commit hash"):
        load_corpus(tmp_path)


def test_git_id_must_derive_from_repo_and_sha(tmp_path):
    write(tmp_path, good(id="acme__widgets__def5678"))
    with pytest.raises(CorpusError, match="does not match repo and sha"):
        load_corpus(tmp_path)
    (tmp_path / "acme__widgets__def5678.json").unlink()
    write(tmp_path, good(id="other__widgets__abc1234"))
    with pytest.raises(CorpusError, match="does not match repo and sha"):
        load_corpus(tmp_path)


def test_git_source_rejects_fixture_id(tmp_path):
    write(tmp_path, good(id="fx-01-debug"))
    with pytest.raises(CorpusError, match="does not match repo and sha"):
        load_corpus(tmp_path)


@pytest.mark.parametrize("key, value", [("url", 5), ("url", None), ("licence", ["MIT"]), ("language", ["python"]), ("source", ["git"]), ("id", 7)])
def test_rejects_non_string_fields(tmp_path, key, value):
    (tmp_path / "acme__widgets__abc1234.json").write_text(json.dumps(good(**{key: value})), encoding="utf-8")
    with pytest.raises(CorpusError, match=f"{key} must be a string"):
        load_corpus(tmp_path)
