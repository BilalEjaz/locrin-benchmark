"""One run: install, materialise, check, score, write results, update the README."""
from __future__ import annotations

import argparse
import dataclasses
import datetime as dt
import json
import sys
from pathlib import Path

from bench.corpus import CorpusError, load_corpus
from bench.labels import LabelError, load_labels
from bench.materialise import MaterialiseError, materialise
from bench.readme_table import replace_table
from bench.run import Finding, RuleMeta, RunError, ignore_files_above, install_locrin, normalise, run_check
from bench.score import render_markdown, score, stale


def _now() -> str:
    return dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds")


def _write(path: Path, text: str) -> None:
    # Bytes, so Windows never turns the newlines into CRLF in a tracked results file.
    path.write_bytes(text.encode("utf-8"))


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(prog="bench")
    p.add_argument("--version", required=True, help="Locrin version tag, for example v0.5.0")
    p.add_argument("--corpus", default="corpus")
    p.add_argument("--labels", default="labels")
    p.add_argument("--out", default="results")
    p.add_argument("--work", default=".work")
    p.add_argument("--cache", default=".cache")
    p.add_argument("--readme", default="README.md")
    a = p.parse_args(argv)
    started = _now()
    try:
        above = ignore_files_above(Path(a.cache))
        if above:
            names = ", ".join(str(x) for x in above)
            raise RunError(f"locrin reads .ignore files above its checkouts, which would drop files from every diff: "
                           f"remove {names} or pass a --cache outside that directory")
        locrin = install_locrin(a.version, Path(a.cache))
        diffs = load_corpus(Path(a.corpus))
        labels = load_labels(Path(a.labels))
    except (RunError, CorpusError, LabelError) as e:
        print(f"bench: {e}", file=sys.stderr)
        return 2
    findings: list[Finding] = []
    rules: dict[str, RuleMeta] = {}
    ran: set[str] = set()
    mat_fail: list[str] = []
    run_fail: list[str] = []
    for d in diffs:
        try:
            co = materialise(d, Path(a.corpus), Path(a.cache))
        except MaterialiseError as e:
            mat_fail.append(str(e))
            print(f"materialise failed: {e}", file=sys.stderr)
            continue
        try:
            doc = run_check(locrin, co, Path(a.work), d.id)
            fs, rs = normalise(d.id, doc)
        except RunError as e:
            run_fail.append(str(e))
            print(f"run failed: {e}", file=sys.stderr)
            continue
        except (KeyError, IndexError, TypeError, ValueError) as e:
            msg = f"{d.id}: unexpected SARIF shape: {e!r}"
            run_fail.append(msg)
            print(f"run failed: {msg}", file=sys.stderr)
            continue
        ran.add(d.id)
        findings.extend(fs)
        rules = rs or rules
        print(f"{d.id}: {len(fs)} findings")
    findings.sort(key=lambda f: (f.diff, f.rule, f.file, f.line, f.id))
    # Only diffs that ran are scored, so a failed diff neither adds its misses nor loses its true entries.
    per_rule, per_pair, unlabelled = score(findings, labels, rules, ran=ran)
    unreported = stale(findings, labels, ran=ran)
    out = Path(a.out) / a.version
    out.mkdir(parents=True, exist_ok=True)
    _write(out / "findings.jsonl", "".join(json.dumps(dataclasses.asdict(f), sort_keys=True) + "\n" for f in findings))
    table = render_markdown(per_rule, per_pair, a.version, corpus_size=len(diffs), unlabelled=len(unlabelled), rules=rules)
    _write(out / "table.md", table)
    _write(out / "run.json", json.dumps({
        "locrin": a.version, "diffs": len(diffs), "findings": len(findings), "unlabelled": len(unlabelled),
        "materialise_failures": mat_fail, "run_failures": run_fail, "started": started, "finished": _now(),
    }, indent=2) + "\n")
    readme = Path(a.readme)
    if readme.exists():
        text = readme.read_bytes().decode("utf-8")
        _write(readme, replace_table(text, table))
    for f in unlabelled:
        print(f"unlabelled: {f.diff} {f.rule} {f.file}:{f.line} {f.id}", file=sys.stderr)
    for diff_id, e in unreported:
        print(f"stale: {diff_id} {e.rule} {e.file}:{e.line} {e.id}", file=sys.stderr)
    print(table)
    return 1 if (mat_fail or run_fail) else 0


if __name__ == "__main__":
    sys.exit(main())
