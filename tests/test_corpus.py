import json
from pathlib import Path

import pytest

from bench.corpus import CorpusError, Diff, language_of, load_corpus


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
    write(tmp_path, good(id="b__x__1111111"))
    write(tmp_path, good(id="a__x__2222222"))
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
