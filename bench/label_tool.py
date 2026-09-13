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
        disagree = sum(1 for e in lf.entries if (diff, id(e)) in dis)
        print(f"{diff}: entries={len(lf.entries)} confirmed={confirmed} unfilled={unfilled} disagree={disagree}")


def _findings_for(diff_id: str, locrin_version: str, corpus_root: Path, work: Path) -> list[Finding]:
    from bench import materialise as materialise_mod
    from bench import run as run_mod
    from bench.corpus import load_corpus
    diff = next((d for d in load_corpus(corpus_root) if d.id == diff_id), None)
    if diff is None:
        raise LabelError(f"{diff_id}: not in {corpus_root}")
    locrin = run_mod.install_locrin(locrin_version, work / ".cache")
    co = materialise_mod.materialise(diff, corpus_root, work / ".cache")
    findings, _ = run_mod.normalise(diff_id, run_mod.run_check(locrin, co, work / ".work", diff_id))
    return findings


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
            findings = _findings_for(a.diff, a.locrin, Path(a.corpus), Path("."))
            print(new(a.diff, findings, a.locrin, Path(a.labels), a.by, today, force=a.force))
        elif a.cmd == "confirm":
            confirm(a.diff, Path(a.labels), a.by, today)
            print(f"{a.diff}: pass two recorded")
        else:
            status(Path(a.labels))
    except LabelError as e:
        print(f"label.py: {e}", file=sys.stderr)
        return 1
    return 0
