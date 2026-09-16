"""Label files: two independent passes per entry; an entry counts only when they agree."""
from __future__ import annotations

import json
import re
from dataclasses import dataclass
from pathlib import Path

from bench.corpus import _valid_file

VERDICTS = {"true", "false-positive", "missed", "not-applicable", "?"}
MISSED_VERDICTS = {"missed", "false-positive", "?"}
_ID = re.compile(r"[0-9a-f]{16}")


def _pass(name: str, key: str, raw: object) -> dict | None:
    """A file's pass record: null until that pass is recorded, then who recorded it and when."""
    if raw is None:
        return None
    if not (isinstance(raw, dict) and all(isinstance(raw.get(k), str) and raw[k] for k in ("by", "date"))):
        raise LabelError(f"{name}: {key} must be null or an object with a non-empty by and date")
    return raw


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
    def adjudication_pending(self) -> bool:
        """A maintainer proposed a resolution and it is still waiting for the review the note names.

        Adjudication records the proposed resolution in the note and leaves the two passes as they
        are, so an adjudicated entry stays a disagreement. Should the passes be edited to agree
        while the note still says pending, this keeps the entry out of the numbers all the same:
        what counts must never depend on a maintainer remembering not to edit a pass.
        """
        note = self.note.strip().lower()
        return note.startswith("adjudicated") and "pending" in note

    @property
    def confirmed(self) -> bool:
        return self.pass1 != "?" and self.pass1 == self.pass2 and not self.adjudication_pending

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
    # Who made the blind pass two `label.py merge` folded in. Metadata only: until `label.py confirm`
    # stamps pass2 with a name and a date, none of the file's entries count, so a merge alone can
    # never publish numbers pass two has not signed off.
    pass2_by: str = ""
    # The locrin version the verdicts in this file were written for, when `label.py carry` brought them
    # over from that version's file. Metadata only: the file counts as labels for the version `locrin`
    # names, and `carried_from` says where its verdicts came from.
    carried_from: str = ""


def _entry(name: str, i: int, raw: object) -> Entry:
    if not isinstance(raw, dict):
        raise LabelError(f"{name}: entry {i} is not an object")
    for k in ("rule", "file", "line", "pass1", "pass2"):
        if k not in raw:
            raise LabelError(f"{name}: entry {i} missing {k}")
    for k in ("rule", "file"):
        if not isinstance(raw[k], str) or not raw[k]:
            raise LabelError(f"{name}: entry {i} {k} must be a non-empty string")
    if not _valid_file(raw["file"]):
        raise LabelError(f"{name}: entry {i} file must be a relative forward-slash path with no . or .. segments")
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
    if is_missed and not {raw["pass1"], raw["pass2"]} <= MISSED_VERDICTS:
        # A pass that did not find the miss itself says whether the construct is there: missed if it
        # agrees, false-positive if the definition is not met there. Anything else describes a finding.
        raise LabelError(f"{name}: entry {i} is missed in one pass, so the other pass is missed, false-positive or ?")
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
    by = raw.get("pass2_by", "")
    if not isinstance(by, str):
        raise LabelError(f"{path.name}: pass2_by must be a string")
    carried = raw.get("carried_from", "")
    if not isinstance(carried, str):
        raise LabelError(f"{path.name}: carried_from must be a string")
    return LabelFile(diff=raw["diff"], locrin=raw.get("locrin", ""), pass1=_pass(path.name, "pass1", raw.get("pass1")),
                     pass2=_pass(path.name, "pass2", raw.get("pass2")), entries=entries, pass2_by=by,
                     carried_from=carried)


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
        "diff": lf.diff, "locrin": lf.locrin,
        # Only written for a file `carry` wrote, so the key never appears in a file labelled from scratch.
        **({"carried_from": lf.carried_from} if lf.carried_from else {}),
        "pass1": lf.pass1, "pass2": lf.pass2,
        # Only written once a merge has recorded it, so the key never appears in a file no merge touched.
        **({"pass2_by": lf.pass2_by} if lf.pass2_by else {}),
        "entries": [{"rule": e.rule, "file": e.file, "line": e.line, "id": e.id, "pass1": e.pass1, "pass2": e.pass2, "note": e.note} for e in lf.entries],
    }
    # Bytes, so Windows never writes CRLF into a tracked label file.
    (Path(root) / f"{lf.diff}.json").write_bytes((json.dumps(raw, indent=2) + "\n").encode("utf-8"))


def invalid_missed(lf: LabelFile, root: Path, rules: set[str]) -> list[dict]:
    """Missed entries that cannot name a construct at the diff's commit, each with the reason.

    root is the checkout at the commit and rules the ids of the rules the engine run there has. A
    missed entry is invalid when it repeats an earlier missed entry on the same rule, file and line,
    when its rule is not one of those, or when its file is not a regular file at the commit or has
    fewer lines than its line. A missed entry may name any file, not only the ones the diff changed:
    a change can make a construct in another file meet a rule's definition.
    """
    out = []
    seen: set[tuple[str, str, int]] = set()
    root = Path(root)
    for e in lf.entries:
        if "missed" not in (e.pass1, e.pass2):
            continue
        key = (e.rule, e.file, e.line)
        path = root / e.file
        if key in seen:
            problem = "repeats another missed entry on the same rule, file and line"
        elif e.rule not in rules:
            problem = f"{e.rule} is not a rule this locrin version has"
        elif path.is_symlink() or not path.is_file():
            problem = f"{e.file} is not a file at the commit"
        else:
            data = path.read_bytes()
            lines = data.count(b"\n") + (1 if data and not data.endswith(b"\n") else 0)
            problem = f"line {e.line} is past the end of {e.file} ({lines} lines) at the commit" if e.line > lines else ""
        seen.add(key)
        if problem:
            out.append({"diff": lf.diff, "rule": e.rule, "file": e.file, "line": e.line, "problem": problem})
    return out


def dropped_missed(lf: LabelFile, left_out: list) -> list[dict]:
    """Missed entries on a finding the run reported at the commit and left out, each with the reason.

    left_out holds the diff's pre-existing and duplicate findings (bench.run.Finding). The engine did
    report its rule at that file and line, so a missed entry there names no miss: it is invalid, like
    the entries invalid_missed lists.
    """
    reported = {(f.rule, f.file, f.line) for f in left_out if f.diff == lf.diff}
    return [{"diff": lf.diff, "rule": e.rule, "file": e.file, "line": e.line,
             "problem": f"the engine reported {e.rule} here and the run left it out as pre-existing or a duplicate"}
            for e in lf.entries if "missed" in (e.pass1, e.pass2) and (e.rule, e.file, e.line) in reported]
