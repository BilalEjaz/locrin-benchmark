import json
from pathlib import Path

from bench.corpus import language_of, load_corpus

FIXTURES = Path(__file__).resolve().parent.parent / "fixtures" / "corpus"


def test_ten_tree_fixtures_load():
    diffs = load_corpus(FIXTURES)
    assert len(diffs) == 10
    assert all(d.source == "tree" for d in diffs)
    assert [d.id for d in diffs][:2] == ["fx-01-debug", "fx-02-unused-import"]


def test_every_changed_file_differs_between_before_and_after():
    for d in load_corpus(FIXTURES):
        for f in d.files:
            before = FIXTURES / d.id / "before" / f
            after = FIXTURES / d.id / "after" / f
            assert after.is_file(), f"{d.id}: {f} missing in after"
            if before.exists():
                assert before.read_bytes() != after.read_bytes(), f"{d.id}: {f} unchanged"


def test_fixture_languages_cover_three_languages():
    langs = {d.language for d in load_corpus(FIXTURES)}
    assert {"typescript", "php", "python"} <= langs


def _tree(root: Path) -> dict[str, bytes]:
    return {p.relative_to(root).as_posix(): p.read_bytes() for p in sorted(root.rglob("*")) if p.is_file()}


def test_before_and_after_differ_only_by_the_named_files():
    for d in load_corpus(FIXTURES):
        before = _tree(FIXTURES / d.id / "before")
        after = _tree(FIXTURES / d.id / "after")
        changed = {p for p in before.keys() | after.keys() if before.get(p) != after.get(p)}
        assert changed == set(d.files), f"{d.id}: changed {sorted(changed)}, record names {sorted(d.files)}"


def test_every_fixture_is_a_project_naming_its_sources_as_entry_points():
    for d in load_corpus(FIXTURES):
        after = FIXTURES / d.id / "after"
        manifest = json.loads((after / "package.json").read_text(encoding="utf-8"))
        assert manifest["name"] == d.id
        targets = set(manifest["exports"].values())
        sources = {p for p in _tree(after) if language_of(p) is not None}
        assert sources, f"{d.id}: no source files"
        assert {f"./{p}" for p in sources} <= targets, f"{d.id}: exports miss a source file"
