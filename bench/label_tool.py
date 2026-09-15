"""label.py: new, merge, confirm, status."""
from __future__ import annotations

import argparse
import datetime as dt
import json
import re
import sys
from collections import defaultdict
from dataclasses import replace
from pathlib import Path

from bench.labels import Entry, LabelError, LabelFile, disagreements, load_label_file, load_labels, save_label_file
from bench.run import Finding


def _refuse_overwrite(diff_id: str, out_root: Path, force: bool) -> None:
    if not force and (Path(out_root) / f"{diff_id}.json").exists():
        raise LabelError(f"{diff_id}: {Path(out_root) / (diff_id + '.json')} already exists; pass --force to overwrite")


def new(diff_id: str, findings: list[Finding], locrin_version: str, out_root: Path, by: str, date: str,
        force: bool = False) -> Path:
    _refuse_overwrite(diff_id, out_root, force)
    entries = [Entry(rule=f.rule, file=f.file, line=f.line, id=f.id, pass1="?", pass2="?", note="") for f in findings]
    lf = LabelFile(diff=diff_id, locrin=locrin_version, pass1={"by": by, "date": date}, pass2=None, entries=entries)
    Path(out_root).mkdir(parents=True, exist_ok=True)
    save_label_file(out_root, lf)
    return Path(out_root) / f"{diff_id}.json"


def confirm(diff_id: str, root: Path, by: str, date: str) -> None:
    lf = load_label_file(Path(root) / f"{diff_id}.json")
    unfilled = [e for e in lf.entries if e.pass1 == "?" or e.pass2 == "?"]
    if unfilled:
        raise LabelError(f"{diff_id}: {len(unfilled)} unfilled entries; fill pass1 and pass2 before confirming")
    lf.pass2 = {"by": by, "date": date}
    save_label_file(root, lf)


PASS2_VERDICTS = {"true", "false-positive", "not-applicable", "missed"}
# A note this command joined before, so a second merge of the same pass-two file joins nothing twice.
_JOINED = re.compile(r"pass one: (?P<one>.*?) pass two: (?P<two>.*)", re.S)


def _note(one: str, two: str) -> str:
    """The note of a merged entry: both passes' notes when they differ, otherwise the one that is there."""
    one, two = one.strip(), two.strip()
    already = _JOINED.fullmatch(one)
    if already:
        one = already.group("one")
    if one and two and one != two:
        return f"pass one: {one} pass two: {two}"
    return one or two


def _pass2_entries(diff_id: str, path: Path) -> tuple[str, dict, dict]:
    """The pass-two file as (who made it, reported entries by key in order, missed entries by key).

    Raises LabelError on anything the merge rules cannot fold: another diff, a verdict pass two may
    not give, or an entry with no id that is not a missed entry.
    """
    try:
        raw = json.loads(Path(path).read_text(encoding="utf-8"))
    except (OSError, ValueError) as e:
        raise LabelError(f"{diff_id}: cannot read the pass two file {path}: {e}") from e
    if not isinstance(raw, dict) or not isinstance(raw.get("entries"), list):
        raise LabelError(f"{diff_id}: {path} is not a pass two file (an object with a diff, a by and entries)")
    if raw.get("diff") != diff_id:
        raise LabelError(f"{diff_id}: the pass two file names diff {raw.get('diff')!r}")
    by = raw.get("by")
    if not isinstance(by, str) or not by:
        raise LabelError(f"{diff_id}: the pass two file must say who made it in a non-empty by")
    reported: dict[tuple, list[dict]] = defaultdict(list)
    missed: dict[tuple, dict] = {}
    for e in raw["entries"]:
        if not isinstance(e, dict) or not all(k in e for k in ("rule", "file", "line")):
            raise LabelError(f"{diff_id}: a pass two entry is not an object with a rule, file and line")
        where = f"{e['rule']} {e['file']}:{e['line']}"
        if e.get("pass2") not in PASS2_VERDICTS:
            raise LabelError(f"{diff_id}: pass two verdict {e.get('pass2')!r} at {where} is not one of "
                             f"{', '.join(sorted(PASS2_VERDICTS))}")
        if e.get("id") is None:
            if e["pass2"] != "missed":
                raise LabelError(f"{diff_id}: the pass two entry without an id at {where} is {e['pass2']}, not missed")
            key = (e["rule"], e["file"], e["line"])
            if key in missed:
                raise LabelError(f"{diff_id}: pass two wrote the missed entry at {where} twice")
            missed[key] = e
        else:
            if e["pass2"] == "missed":
                raise LabelError(f"{diff_id}: pass two judged the reported finding at {where} missed; "
                                 "a missed entry names a construct the engine did not report and has no id")
            reported[(e["rule"], e["file"], e["line"], e["id"])].append(e)
    return by, reported, missed


def merge(diff_id: str, pass2_path: Path, root: Path, dry_run: bool = False) -> dict[str, int]:
    """Fold a blind pass two into labels/<diff_id>.json under the rules in LABELLING.md "Two passes".

    Each entry for a reported finding takes pass two's verdict, matched on rule, file, line and engine
    id, equal keys in order. A missed entry both passes wrote becomes one entry with `missed` in both;
    one only pass one wrote keeps `missed` with pass two `?`, for pass two to look at that construct;
    one only pass two wrote is appended with pass one `?`. One pass's `missed` is never copied into the
    other: that would record an agreement that never happened. Nothing already recorded is cleared; the
    merge writes `?` only into a slot that is `?`, so a verdict a hand recorded for a missed entry pass
    two did not write survives a re-merge of the same pass-two file. Notes that differ are joined. Returns the counts, and with dry_run writes nothing.
    """
    path = Path(root) / f"{diff_id}.json"
    lf = load_label_file(path)
    by, p2_reported, p2_missed = _pass2_entries(diff_id, Path(pass2_path))
    free = {k: list(v) for k, v in p2_reported.items()}
    counts = {"reported": 0, "missed_both": 0, "missed_pass_one_only": 0, "missed_pass_two_only": 0, "notes_joined": 0}
    out: list[Entry] = []
    written: set[tuple] = set()
    for e in lf.entries:
        if e.id is not None:
            key = (e.rule, e.file, e.line, e.id)
            queue = free.get(key)
            if not queue:
                raise LabelError(f"{diff_id}: the reported entry {e.rule} {e.file}:{e.line} {e.id} has no pass two verdict")
            p2 = queue.pop(0)
            note = _note(e.note, str(p2.get("note", "")))
            counts["notes_joined"] += note != e.note.strip() and bool(e.note.strip())
            counts["reported"] += 1
            out.append(replace(e, pass2=p2["pass2"], note=note))
            continue
        key = (e.rule, e.file, e.line)
        written.add(key)
        if key in p2_missed:
            note = _note(e.note, str(p2_missed[key].get("note", "")))
            counts["notes_joined"] += note != e.note.strip() and bool(e.note.strip())
            counts["missed_both" if e.pass1 == "missed" else "missed_pass_two_only"] += 1
            out.append(replace(e, pass2="missed", note=note))
        else:
            # Pass two did not write this entry, so the merge leaves its slot open. It writes `?` only
            # into a slot that is already `?`: a verdict in the file is a labeller's work, and a re-merge
            # of the same pass-two file would otherwise throw away what a hand recorded there.
            counts["missed_pass_one_only"] += 1
            out.append(e)
    left = sorted(k for k, queue in free.items() if queue)
    if left:
        rule, file, line, ident = left[0]
        raise LabelError(f"{diff_id}: pass two judged {rule} {file}:{line} {ident}, which is not in the label file")
    for key in sorted(k for k in p2_missed if k not in written):
        rule, file, line = key
        counts["missed_pass_two_only"] += 1
        out.append(Entry(rule=rule, file=file, line=line, id=None, pass1="?", pass2="missed",
                         note=_note("", str(p2_missed[key].get("note", "")))))
    lf.entries = out
    lf.pass2_by = by
    if not dry_run:
        save_label_file(root, lf)
    return counts


def status(root: Path) -> None:
    labels = load_labels(root)
    dis = {(d, id(e)) for d, e in disagreements(labels)}
    for diff, lf in labels.items():
        confirmed = sum(1 for e in lf.entries if e.confirmed)
        unfilled = sum(1 for e in lf.entries if e.pass1 == "?" or e.pass2 == "?")
        disputed = [e for e in lf.entries if (diff, id(e)) in dis]
        print(f"{diff}: entries={len(lf.entries)} confirmed={confirmed} unfilled={unfilled} disagree={len(disputed)}")
        for e in disputed:
            print(f"  disagree: {e.rule} {e.file}:{e.line} pass1={e.pass1} pass2={e.pass2}")


def _findings_for(diff_id: str, locrin_version: str, corpus_root: Path, work: Path) -> list[Finding]:
    """The findings a label file for diff_id lists: those the diff introduced and no earlier diff counts.

    As bench.main scores them: for each rule, file and id, as many findings as the parent run reports
    are pre-existing, and the introduced occurrences earlier diffs (by id) from the same repository already
    introduced, counted on top of what each diff's parent held, are duplicates (score.split_duplicates).
    Neither gets an entry, so the earlier diffs from that repository run first, and their ids are printed:
    a construct one of them already introduced is not a missed entry for this diff either.
    """
    from bench import materialise as materialise_mod
    from bench import run as run_mod
    from bench import score as score_mod
    from bench.corpus import load_corpus
    diffs = load_corpus(corpus_root)
    if not any(d.id == diff_id for d in diffs):
        raise LabelError(f"{diff_id}: not in {corpus_root}")
    repository = {d.id: score_mod.repository_of(d) for d in diffs}
    locrin = run_mod.install_locrin(locrin_version, work / ".cache")
    earlier = [d.id for d in diffs if repository[d.id] == repository[diff_id] and d.id < diff_id]
    if earlier:
        print(f"{diff_id}: earlier diffs from this repository: {', '.join(earlier)}; what they introduced, reported or missed, "
              "counts there, not here", file=sys.stderr)
    introduced: list[Finding] = []
    preexisting: list[Finding] = []
    for d in diffs:
        if repository[d.id] != repository[diff_id] or d.id > diff_id:
            continue
        co = materialise_mod.materialise(d, corpus_root, work / ".cache")
        at_commit, _ = run_mod.normalise(d.id, run_mod.run_check(locrin, co, work / ".work", d.id))
        added = materialise_mod.added_lines(d, co, work / ".cache", score_mod.repeated_files(at_commit))
        at_parent = run_mod.check_parent(locrin, d, co, work / ".cache", work / ".work", at_commit)
        new, old = score_mod.split_preexisting(at_commit, at_parent, added)
        introduced += new
        preexisting += old
    first, _ = score_mod.split_duplicates(introduced, repository, preexisting)
    return [f for f in first if f.diff == diff_id]


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(prog="label.py")
    sub = p.add_subparsers(dest="cmd", required=True)
    n = sub.add_parser("new")
    n.add_argument("diff")
    n.add_argument("--locrin", required=True)
    n.add_argument("--by", required=True)
    n.add_argument("--corpus", default="corpus")
    n.add_argument("--labels", default="labels")
    n.add_argument("--force", action="store_true", help="overwrite an existing label file")
    m = sub.add_parser("merge")
    m.add_argument("diff")
    m.add_argument("--pass2", help="the blind pass two file (default .work/pass2/<diff>.json)")
    m.add_argument("--labels", default="labels")
    m.add_argument("--dry-run", action="store_true", help="print what the merge would change and write nothing")
    c = sub.add_parser("confirm")
    c.add_argument("diff")
    c.add_argument("--by", required=True)
    c.add_argument("--labels", default="labels")
    s = sub.add_parser("status")
    s.add_argument("--labels", default="labels")
    a = p.parse_args(argv)
    today = dt.date.today().isoformat()
    try:
        if a.cmd == "new":
            _refuse_overwrite(a.diff, Path(a.labels), a.force)
            # The release tag, as bench.main compares it: 0.5.0 and v0.5.0 name one version.
            tag = a.locrin if a.locrin.startswith("v") else f"v{a.locrin}"
            findings = _findings_for(a.diff, tag, Path(a.corpus), Path("."))
            print(new(a.diff, findings, tag, Path(a.labels), a.by, today, force=a.force))
        elif a.cmd == "merge":
            pass2 = Path(a.pass2) if a.pass2 else Path(".work") / "pass2" / f"{a.diff}.json"
            counts = merge(a.diff, pass2, Path(a.labels), dry_run=a.dry_run)
            done = "would take" if a.dry_run else "took"
            print(f"{a.diff}: {done} {counts['reported']} reported verdicts from {pass2}, "
                  f"{counts['missed_both']} missed in both passes, {counts['missed_pass_one_only']} missed by pass one "
                  f"only, {counts['missed_pass_two_only']} missed by pass two only, {counts['notes_joined']} notes joined")
        elif a.cmd == "confirm":
            confirm(a.diff, Path(a.labels), a.by, today)
            print(f"{a.diff}: pass two recorded")
        else:
            status(Path(a.labels))
    except LabelError as e:
        print(f"label.py: {e}", file=sys.stderr)
        return 1
    except Exception as e:
        # A materialise or run failure, or a harness bug, while running the engine for `new`: name the diff, no traceback.
        from bench.materialise import MaterialiseError
        from bench.run import RunError
        msg = str(e) if isinstance(e, (MaterialiseError, RunError)) else f"unexpected error: {e!r}"
        diff_id = getattr(a, "diff", None)
        if diff_id and not msg.startswith(f"{diff_id}: "):
            msg = f"{diff_id}: {msg}"
        print(f"label.py: {msg}", file=sys.stderr)
        return 1
    return 0
