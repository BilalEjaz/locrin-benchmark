"""One run: install, materialise, check, score, write results, update the README."""
from __future__ import annotations

import argparse
import dataclasses
import datetime as dt
import json
import sys
from pathlib import Path

from bench import inputs
from bench.corpus import CorpusError, load_corpus
from bench.labels import LabelError, load_labels
from bench.materialise import MaterialiseError, SourceGone, materialise
from bench.readme_table import replace_table
from bench.run import Finding, RuleMeta, RunError, ignore_files_above, install_locrin, normalise, run_check
from bench.score import excluded, excluded_count, render_markdown, score, unreproduced


# Exit codes. Only 0 and 3 are publishable, and only then is the README table rewritten. Publishable also
# needs labels that cover the run: every diff that ran has a label file written for this locrin version and
# confirmed by pass two with no entry left `?`, every finding has a label entry, and every labelled finding
# is reported again by this run. Entries whose two passes disagree are excluded, and the table counts them.
# 0 every diff ran.
# 1 not publishable: locrin or the harness failed on a diff, a source could not be materialised for any
#   reason other than being confirmed gone (a network, DNS, server or disk error may pass), or no diff ran.
# 2 setup failed (no locrin, a bad or empty corpus, bad labels), nothing ran.
# 3 at least one diff ran, and every diff that did not is a confirmed gone source: its repository answers
#   404 or the server lacks its commit after an explicit fetch. run.json lists them under "gone".
# 4 not publishable: everything that could run ran, but the labels do not cover the run (a finding with no
#   label entry, a diff with no label file, a label file written for another locrin version, a label file
#   pass two never confirmed or with an entry still `?`, or a labelled finding this run did not report).
EXIT_RUN_FAILED = 1
EXIT_SETUP = 2
EXIT_SOURCE_GONE = 3
EXIT_LABELS = 4


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
        if not diffs:
            raise CorpusError(f"corpus directory {a.corpus} holds no record")
        labels = load_labels(Path(a.labels))
    except (RunError, CorpusError, LabelError) as e:
        print(f"bench: {e}", file=sys.stderr)
        return EXIT_SETUP
    # Taken before anything runs, so run.json names the corpus and labels this run actually read.
    measured = {"corpus": inputs.digest(Path(a.corpus)), "labels": inputs.digest(Path(a.labels))}
    harness = inputs.harness_commit()
    findings: list[Finding] = []
    rules: dict[str, RuleMeta] = {}
    ran: set[str] = set()
    mat_fail: list[str] = []
    gone: list[dict[str, str]] = []
    run_fail: list[str] = []
    for d in diffs:
        try:
            co = materialise(d, Path(a.corpus), Path(a.cache))
        except SourceGone as e:
            gone.append({"id": d.id, "evidence": str(e).removeprefix(f"{d.id}: ")})
            print(f"source gone: {e}", file=sys.stderr)
            continue
        except MaterialiseError as e:
            mat_fail.append(str(e))
            print(f"materialise failed: {e}", file=sys.stderr)
            continue
        except Exception as e:
            # A harness bug on one diff fails that diff by name; the rest still run and the run is not publishable.
            msg = f"{d.id}: unexpected error: {e!r}"
            mat_fail.append(msg)
            print(f"materialise failed: {msg}", file=sys.stderr)
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
        except Exception as e:
            msg = f"{d.id}: unexpected error: {e!r}"
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
    left_out = excluded(findings, labels, ran=ran)
    left_out_total = excluded_count(findings, labels, ran=ran)
    missing = sorted(d for d in ran if d not in labels)
    other_version = sorted(d for d in ran if d in labels and labels[d].locrin != a.version)
    # label.py new writes every entry as `?` with pass two unrecorded; such a file only looks like labels.
    unconfirmed = sorted(d for d in ran if d in labels and (
        labels[d].pass2 is None or any("?" in (e.pass1, e.pass2) for e in labels[d].entries)))
    # Labels for this version were written from this version's output, so an entry no finding matches means
    # the run did not reproduce what was labelled (another engine build, checkout or machine difference).
    not_reproduced = unreproduced(findings, labels, ran=ran)
    not_reproduced_here = [(d, e) for d, e in not_reproduced if labels[d].locrin == a.version]
    label_versions = sorted({labels[d].locrin for d in ran if d in labels})
    reasons = []
    if not ran:
        reasons.append("no diff ran")
    if run_fail:
        reasons.append(f"{len(run_fail)} run failures")
    if mat_fail:
        reasons.append(f"{len(mat_fail)} materialise failures that are not confirmed gone sources")
    if unlabelled:
        reasons.append(f"{len(unlabelled)} unlabelled finding{'' if len(unlabelled) == 1 else 's'}")
    if missing:
        reasons.append(f"no label file for {', '.join(missing)}")
    if other_version:
        found = ", ".join(v for v in label_versions if v != a.version)
        reasons.append(f"labels written for locrin {found}, not {a.version}: {', '.join(other_version)}")
    if unconfirmed:
        reasons.append(f"labels pass two has not confirmed, or with an entry still `?`: {', '.join(unconfirmed)}")
    if not_reproduced_here:
        n = len(not_reproduced_here)
        reasons.append(f"{n} labelled finding{'' if n == 1 else 's'} not reproduced by this run")
    publishable = not reasons
    out = Path(a.out) / a.version
    out.mkdir(parents=True, exist_ok=True)
    _write(out / "findings.jsonl", "".join(json.dumps(dataclasses.asdict(f), sort_keys=True) + "\n" for f in findings))
    table = render_markdown(per_rule, per_pair, a.version, corpus_size=len(diffs), unlabelled=len(unlabelled), rules=rules,
                           ran=len(ran), excluded=left_out_total)
    _write(out / "table.md", table)
    _write(out / "run.json", json.dumps({
        "locrin": a.version, "diffs": len(diffs), "ran": len(ran), "findings": len(findings), "unlabelled": len(unlabelled),
        "excluded": left_out_total, "publishable": publishable, "not_publishable": reasons, "gone": gone,
        "materialise_failures": mat_fail, "run_failures": run_fail,
        "labels": {"versions": label_versions, "other_version": other_version, "missing": missing,
                   "unconfirmed": unconfirmed,
                   "unreproduced": [{"diff": d, "rule": e.rule, "file": e.file, "line": e.line, "id": e.id,
                                     "pass1": e.pass1, "pass2": e.pass2} for d, e in not_reproduced_here]},
        "inputs": measured, "harness": harness, "started": started, "finished": _now(),
    }, indent=2) + "\n")
    readme = Path(a.readme)
    if publishable and readme.exists():
        text = readme.read_bytes().decode("utf-8")
        _write(readme, replace_table(text, table))
    for f in unlabelled:
        print(f"unlabelled: {f.diff} {f.rule} {f.file}:{f.line} {f.id}", file=sys.stderr)
    for diff_id, e in not_reproduced:
        print(f"unreproduced: {diff_id} {e.rule} {e.file}:{e.line} {e.id} {e.pass1}/{e.pass2}", file=sys.stderr)
    for f in left_out:
        print(f"excluded: {f.diff} {f.rule} {f.file}:{f.line} {f.id}", file=sys.stderr)
    print(table)
    if not publishable:
        why = f"{len(ran)} of {len(diffs)} diffs ran; " + "; ".join(reasons)
        print(f"bench: not publishable ({why}); the README was left unchanged", file=sys.stderr)
        return EXIT_RUN_FAILED if not ran or run_fail or mat_fail else EXIT_LABELS
    return EXIT_SOURCE_GONE if gone else 0


if __name__ == "__main__":
    sys.exit(main())
