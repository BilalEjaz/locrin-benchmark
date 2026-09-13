"""Corpus records: one JSON file per diff, validated on load."""
from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path

ALLOWED_LICENCES = {"MIT", "Apache-2.0", "BSD-2-Clause", "BSD-3-Clause", "ISC"}
LANGUAGES = {"typescript", "javascript", "php", "python"}
LANGUAGE_OF_EXT = {
    ".ts": "typescript",
    ".tsx": "tsx",
    ".js": "javascript",
    ".jsx": "javascript",
    ".mjs": "javascript",
    ".cjs": "javascript",
    ".php": "php",
    ".phtml": "php",
    ".py": "python",
}


class CorpusError(Exception):
    pass


@dataclass(frozen=True)
class Diff:
    id: str
    source: str
    repo: str | None
    sha: str | None
    parent: str | None
    licence: str
    language: str
    url: str
    files: list[str]


def language_of(path: str) -> str | None:
    dot = path.rfind(".")
    if dot < 0:
        return None
    return LANGUAGE_OF_EXT.get(path[dot:].lower())


def _load_one(path: Path) -> Diff:
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as e:
        raise CorpusError(f"{path.name}: not valid JSON: {e}") from e
    required = ["id", "source", "repo", "sha", "parent", "licence", "language", "url", "files"]
    missing = [k for k in required if k not in raw]
    if missing:
        raise CorpusError(f"{path.name}: missing {', '.join(missing)}")
    if raw["id"] != path.stem:
        raise CorpusError(f"{path.name}: id {raw['id']!r} does not match the file name")
    if raw["source"] not in {"tree", "git"}:
        raise CorpusError(f"{path.name}: source must be tree or git")
    if raw["licence"] not in ALLOWED_LICENCES:
        raise CorpusError(f"{path.name}: licence {raw['licence']!r} is not one of {sorted(ALLOWED_LICENCES)}")
    if raw["language"] not in LANGUAGES:
        raise CorpusError(f"{path.name}: language {raw['language']!r} is not one of {sorted(LANGUAGES)}")
    if not isinstance(raw["files"], list) or not all(isinstance(f, str) and "\\" not in f for f in raw["files"]):
        raise CorpusError(f"{path.name}: files must be a list of forward-slash paths")
    if raw["source"] == "git":
        for k in ("repo", "sha", "parent"):
            if not isinstance(raw[k], str) or not raw[k]:
                raise CorpusError(f"{path.name}: git source needs {k}")
    else:
        for sub in ("before", "after"):
            if not (path.parent / raw["id"] / sub).is_dir():
                raise CorpusError(f"{path.name}: tree source needs {raw['id']}/{sub}/")
    return Diff(
        id=raw["id"], source=raw["source"], repo=raw["repo"], sha=raw["sha"], parent=raw["parent"],
        licence=raw["licence"], language=raw["language"], url=raw["url"], files=list(raw["files"]),
    )


def load_corpus(root: Path) -> list[Diff]:
    root = Path(root)
    if not root.is_dir():
        raise CorpusError(f"corpus directory {root} does not exist")
    return sorted((_load_one(p) for p in root.glob("*.json")), key=lambda d: d.id)
