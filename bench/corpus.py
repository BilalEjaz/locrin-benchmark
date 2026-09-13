"""Corpus records: one JSON file per diff, validated on load."""
from __future__ import annotations

import json
import re
from dataclasses import dataclass
from pathlib import Path

ALLOWED_LICENCES = {"MIT", "Apache-2.0", "BSD-2-Clause", "BSD-3-Clause", "ISC"}
LANGUAGES = {"typescript", "javascript", "php", "python"}
LANGUAGE_OF_EXT = {
    ".ts": "typescript",
    ".mts": "typescript",
    ".cts": "typescript",
    ".tsx": "tsx",
    ".js": "javascript",
    ".jsx": "javascript",
    ".mjs": "javascript",
    ".cjs": "javascript",
    ".php": "php",
    ".phtml": "php",
    ".py": "python",
}
# Declaration files hold signatures, not code that runs; the engine skips them.
_DECLARATION_SUFFIXES = (".d.ts", ".d.mts", ".d.cts")
_FIXTURE_ID = re.compile(r"fx-[0-9]{2}-[a-z0-9-]+")
_REAL_ID = re.compile(r"([A-Za-z0-9._-]+)__([A-Za-z0-9._-]+)__[0-9a-f]{7}")
_REPO = re.compile(r"([A-Za-z0-9._-]+)/([A-Za-z0-9._-]+)")
_COMMIT = re.compile(r"[0-9a-f]{40}")
_DRIVE = re.compile(r"[A-Za-z]:")


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
    """The engine language for a path, mirroring Language::from_path in locrin 0.5.0.

    Only the last path segment counts. Extensions compare case-sensitively, a
    name whose only dot is its first character has no extension, and
    declaration files map to None.
    """
    name = path.rstrip("/").rsplit("/", 1)[-1]
    if name.endswith(_DECLARATION_SUFFIXES):
        return None
    dot = name.rfind(".")
    if dot <= 0:
        return None
    return LANGUAGE_OF_EXT.get(name[dot:])


def _valid_id(value: str) -> bool:
    if _FIXTURE_ID.fullmatch(value):
        return True
    m = _REAL_ID.fullmatch(value)
    return bool(m) and all(part not in {".", ".."} for part in m.groups())


def _valid_repo(value: object) -> bool:
    m = _REPO.fullmatch(value) if isinstance(value, str) else None
    return bool(m) and all(part not in {".", ".."} for part in m.groups())


def _valid_file(value: object) -> bool:
    if not isinstance(value, str) or not value or "\\" in value:
        return False
    if _DRIVE.match(value):
        return False
    # An empty segment also rejects a leading or trailing slash.
    return all(seg not in {"", ".", ".."} for seg in value.split("/"))


def _load_one(path: Path) -> Diff:
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, UnicodeDecodeError) as e:
        raise CorpusError(f"{path.name}: not valid JSON: {e}") from e
    if not isinstance(raw, dict):
        raise CorpusError(f"{path.name}: must hold a JSON object")
    required = ["id", "source", "repo", "sha", "parent", "licence", "language", "url", "files"]
    missing = [k for k in required if k not in raw]
    if missing:
        raise CorpusError(f"{path.name}: missing {', '.join(missing)}")
    for k in ("id", "source", "licence", "language", "url"):
        if not isinstance(raw[k], str):
            raise CorpusError(f"{path.name}: {k} must be a string")
    if not _valid_id(raw["id"]):
        raise CorpusError(f"{path.name}: {raw['id']!r} is not a valid diff id")
    if raw["id"] != path.stem:
        raise CorpusError(f"{path.name}: id {raw['id']!r} does not match the file name")
    if raw["source"] not in {"tree", "git"}:
        raise CorpusError(f"{path.name}: source must be tree or git")
    if raw["licence"] not in ALLOWED_LICENCES:
        raise CorpusError(f"{path.name}: licence {raw['licence']!r} is not one of {sorted(ALLOWED_LICENCES)}")
    if raw["language"] not in LANGUAGES:
        raise CorpusError(f"{path.name}: language {raw['language']!r} is not one of {sorted(LANGUAGES)}")
    if not isinstance(raw["files"], list):
        raise CorpusError(f"{path.name}: files must be a list of forward-slash paths")
    for f in raw["files"]:
        if not _valid_file(f):
            raise CorpusError(
                f"{path.name}: files entry {f!r} must be a non-empty relative forward-slash path with no . or .. segments"
            )
    if raw["source"] == "git":
        for k in ("repo", "sha", "parent"):
            if not isinstance(raw[k], str) or not raw[k]:
                raise CorpusError(f"{path.name}: git source needs {k}")
        if not _valid_repo(raw["repo"]):
            raise CorpusError(f"{path.name}: repo must be owner/name, got {raw['repo']!r}")
        for k in ("sha", "parent"):
            if not _COMMIT.fullmatch(raw[k]):
                raise CorpusError(f"{path.name}: {k} must be a 40-character lowercase commit hash")
        expected = raw["repo"].replace("/", "__") + "__" + raw["sha"][:7]
        if raw["id"] != expected:
            raise CorpusError(f"{path.name}: id {raw['id']!r} does not match repo and sha (expected {expected!r})")
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
