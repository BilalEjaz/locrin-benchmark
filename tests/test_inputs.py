import json
from pathlib import Path

import pytest

from bench import inputs


def tree(root: Path, files: dict[str, bytes]) -> Path:
    for name, data in files.items():
        (root / name).parent.mkdir(parents=True, exist_ok=True)
        (root / name).write_bytes(data)
    return root


def test_the_digest_depends_on_every_path_and_byte_and_not_on_where_the_tree_lives(tmp_path):
    files = {"a.json": b"{}\n", "a/before/src/x.ts": b"x\n"}
    one = inputs.digest(tree(tmp_path / "one", files))
    assert one.startswith("sha256:") and len(one) == len("sha256:") + 64
    assert inputs.digest(tree(tmp_path / "two", files)) == one
    assert inputs.digest(tree(tmp_path / "bytes", dict(files, **{"a.json": b"{ }\n"}))) != one
    assert inputs.digest(tree(tmp_path / "added", dict(files, **{"b.json": b""}))) != one
    moved = {"a.json": b"{}\n", "a/after/src/x.ts": b"x\n"}
    assert inputs.digest(tree(tmp_path / "moved", moved)) != one
    # A name and its content can never run together into the same bytes as another tree.
    assert inputs.digest(tree(tmp_path / "s1", {"ab": b"c"})) != inputs.digest(tree(tmp_path / "s2", {"a": b"bc"}))


def test_a_missing_directory_has_the_digest_of_an_empty_one(tmp_path):
    (tmp_path / "empty").mkdir()
    assert inputs.digest(tmp_path / "missing") == inputs.digest(tmp_path / "empty")


def _published(tmp_path: Path, **overrides) -> tuple[Path, Path, Path]:
    corpus = tree(tmp_path / "corpus", {"acme__w__1234567.json": b"{}\n"})
    labels = tree(tmp_path / "labels", {"acme__w__1234567.json": b"{}\n"})
    run = {"locrin": "v0.5.0", "publishable": True,
           "inputs": {"corpus": inputs.digest(corpus), "labels": inputs.digest(labels)}}
    run.update(overrides)
    path = tmp_path / "run.json"
    path.write_bytes(json.dumps(run).encode("utf-8"))
    return path, corpus, labels


def test_a_publishable_run_over_the_same_inputs_is_complete(tmp_path):
    path, corpus, labels = _published(tmp_path)
    ok, why = inputs.complete(path, "v0.5.0", corpus, labels)
    assert ok is True and "publishable" in why


@pytest.mark.parametrize("change", ["labels", "corpus", "unpublishable", "version", "no-inputs", "malformed", "missing"])
def test_anything_else_is_measured_again(tmp_path, change):
    path, corpus, labels = _published(tmp_path)
    if change == "labels":
        (labels / "acme__w__1234567.json").write_bytes(b'{"relabelled": true}\n')
    elif change == "corpus":
        tree(corpus, {"acme__w__7654321.json": b"{}\n"})
    elif change == "unpublishable":
        path.write_bytes(json.dumps(dict(json.loads(path.read_bytes()), publishable=False)).encode("utf-8"))
    elif change == "version":
        path.write_bytes(json.dumps(dict(json.loads(path.read_bytes()), locrin="v0.4.0")).encode("utf-8"))
    elif change == "no-inputs":
        raw = json.loads(path.read_bytes())
        del raw["inputs"]
        path.write_bytes(json.dumps(raw).encode("utf-8"))
    elif change == "malformed":
        path.write_bytes(b"not json")
    else:
        path.unlink()
    ok, why = inputs.complete(path, "v0.5.0", corpus, labels)
    assert ok is False and why


def test_the_command_exits_zero_only_for_a_complete_run(tmp_path, capsys):
    path, corpus, labels = _published(tmp_path)
    args = ["--complete", str(path), "--version", "v0.5.0", "--corpus", str(corpus), "--labels", str(labels)]
    assert inputs.main(args) == 0
    (labels / "acme__w__1234567.json").write_bytes(b"[]\n")
    assert inputs.main(args) == 1
    assert "labels" in capsys.readouterr().out


def test_harness_commit_is_the_checkout_head_or_none(tmp_path, monkeypatch):
    head = inputs.harness_commit()
    assert head is None or (len(head) == 40 and all(c in "0123456789abcdef" for c in head))
    monkeypatch.setattr(inputs, "ROOT", tmp_path)
    assert inputs.harness_commit() is None
