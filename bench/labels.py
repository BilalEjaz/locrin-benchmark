"""Label files: two independent passes per entry; an entry counts only when they agree."""
from __future__ import annotations

import json
import re
from dataclasses import dataclass
from pathlib import Path

VERDICTS = {"true", "false-positive", "missed", "not-applicable", "?"}
_ID = re.compile(r"[0-9a-f]{16}")


class LabelError(Exception):
    pass


@dataclass
class Entry:
    rule: str
    file: str
    line: int
    id: str | None
    pass1: str
    pass2: str
    note: str

    @property
    def confirmed(self) -> bool:
        return self.pass1 != "?" and self.pass1 == self.pass2

    @property
    def verdict(self) -> str | None:
        return self.pass1 if self.confirmed else None


@dataclass
class LabelFile:
    diff: str
    locrin: str
    pass1: dict | None
    pass2: dict | None
    entries: list[Entry]


def _entry(name: str, i: int, raw: object) -> Entry:
    if not isinstance(raw, dict):
        raise LabelError(f"{name}: entry {i} is not an object")
    for k in ("rule", "file", "line", "pass1", "pass2"):
        if k not in raw:
            raise LabelError(f"{name}: entry {i} missing {k}")
    for k in ("rule", "file"):
        if not isinstance(raw[k], str) or not raw[k]:
            raise LabelError(f"{name}: entry {i} {k} must be a non-empty string")
    if isinstance(raw["line"], bool) or not isinstance(raw["line"], int) or raw["line"] < 1:
        raise LabelError(f"{name}: entry {i} line must be a positive integer")
    for k in ("pass1", "pass2"):
        if raw[k] not in VERDICTS:
            raise LabelError(f"{name}: entry {i} has unknown verdict {raw[k]!r}")
    ident = raw.get("id")
    is_missed = "missed" in (raw["pass1"], raw["pass2"])
    if ident is None and not is_missed:
        raise LabelError(f"{name}: entry {i} needs an id unless it is missed")
    if ident is not None and is_missed:
        raise LabelError(f"{name}: entry {i} is missed, so its id must be null")
    if ident is not None and (not isinstance(ident, str) or not _ID.fullmatch(ident)):
        raise LabelError(f"{name}: entry {i} id must be 16 hex characters")
    return Entry(rule=raw["rule"], file=raw["file"], line=raw["line"], id=ident,
                 pass1=raw["pass1"], pass2=raw["pass2"], note=str(raw.get("note", "")))


def load_label_file(path: Path) -> LabelFile:
    path = Path(path)
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError) as e:
        raise LabelError(f"{path.name}: cannot read label file: {e}") from e
    if not isinstance(raw, dict):
        raise LabelError(f"{path.name}: a label file is a JSON object")
    if raw.get("diff") != path.stem:
        raise LabelError(f"{path.name}: diff {raw.get('diff')!r} does not match the file name")
    entries_raw = raw.get("entries", [])
    if not isinstance(entries_raw, list):
        raise LabelError(f"{path.name}: entries must be a list")
    entries = [_entry(path.name, i, e) for i, e in enumerate(entries_raw)]
    return LabelFile(diff=raw["diff"], locrin=raw.get("locrin", ""), pass1=raw.get("pass1"), pass2=raw.get("pass2"), entries=entries)


def load_labels(root: Path) -> dict[str, LabelFile]:
    root = Path(root)
    return {p.stem: load_label_file(p) for p in sorted(root.glob("*.json"))}


def disagreements(labels: dict[str, LabelFile]) -> list[tuple[str, Entry]]:
    out = []
    for diff, lf in labels.items():
        for e in lf.entries:
            if e.pass1 != "?" and e.pass2 != "?" and e.pass1 != e.pass2:
                out.append((diff, e))
    return out


def save_label_file(root: Path, lf: LabelFile) -> None:
    raw = {
        "diff": lf.diff, "locrin": lf.locrin, "pass1": lf.pass1, "pass2": lf.pass2,
        "entries": [{"rule": e.rule, "file": e.file, "line": e.line, "id": e.id, "pass1": e.pass1, "pass2": e.pass2, "note": e.note} for e in lf.entries],
    }
    # Bytes, so Windows never writes CRLF into a tracked label file.
    (Path(root) / f"{lf.diff}.json").write_bytes((json.dumps(raw, indent=2) + "\n").encode("utf-8"))
