"""label.py: new, confirm, status."""
from __future__ import annotations

import argparse
import datetime as dt
import sys
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

    As bench.main scores them: a finding the parent run also reports is pre-existing, and one an
    earlier diff (by id) from the same repository introduced is a duplicate. Neither gets an entry,
    so the earlier diffs from that repository run first.
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
    introduced: list[Finding] = []
    for d in diffs:
        if repository[d.id] != repository[diff_id] or d.id > diff_id:
            continue
        co = materialise_mod.materialise(d, corpus_root, work / ".cache")
        at_commit, _ = run_mod.normalise(d.id, run_mod.run_check(locrin, co, work / ".work", d.id))
        at_parent = run_mod.check_parent(locrin, d, co, work / ".cache", work / ".work", at_commit)
        introduced += score_mod.split_preexisting(at_commit, at_parent)[0]
    first, _ = score_mod.split_duplicates(introduced, repository)
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
