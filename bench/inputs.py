"""What a run measured: digests of the corpus and labels, and the harness commit.

run.json records them, so a published table can be tied to its inputs, and the scheduled job
measures a version again whenever the corpus or the labels changed since its last publishable run.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def digest(root: Path) -> str:
    """sha256 over every file under root: its path relative to root, its length and its bytes, in path order.

    A missing directory has the digest of an empty one. Where the tree lives does not change it.
    """
    root = Path(root)
    h = hashlib.sha256()
    files = sorted((p.relative_to(root).as_posix(), p) for p in root.rglob("*") if p.is_file()) if root.is_dir() else []
    for rel, p in files:
        data = p.read_bytes()
        name = rel.encode("utf-8")
        h.update(len(name).to_bytes(8, "big") + name + len(data).to_bytes(8, "big") + data)
    return f"sha256:{h.hexdigest()}"


def harness_commit() -> str | None:
    """The commit the harness checkout is at, or None when it is not a git checkout."""
    try:
        proc = subprocess.run(["git", "rev-parse", "--verify", "HEAD"], cwd=ROOT, capture_output=True,
                              encoding="utf-8", errors="replace", stdin=subprocess.DEVNULL)
    except OSError:
        return None
    if proc.returncode != 0:
        return None
    # A directory that is not a checkout of its own can sit inside another repository: only ROOT's own counts.
    top = subprocess.run(["git", "rev-parse", "--show-toplevel"], cwd=ROOT, capture_output=True,
                         encoding="utf-8", errors="replace", stdin=subprocess.DEVNULL)
    if top.returncode != 0 or Path(top.stdout.strip()).resolve() != ROOT.resolve():
        return None
    head = proc.stdout.strip()
    return head if len(head) == 40 else None


def complete(run_json: Path, version: str, corpus: Path, labels: Path) -> tuple[bool, str]:
    """Whether run_json records a publishable run of version over exactly these corpus and labels, and why."""
    try:
        run = json.loads(Path(run_json).read_bytes().decode("utf-8"))
    except (OSError, ValueError) as e:
        return False, f"{run_json} cannot be read: {e}"
    if not isinstance(run, dict) or run.get("publishable") is not True:
        return False, f"{run_json} does not record a publishable run"
    if run.get("locrin") != version:
        return False, f"{run_json} records locrin {run.get('locrin')!r}, not {version}"
    recorded = run.get("inputs") if isinstance(run.get("inputs"), dict) else {}
    for name, root in (("corpus", corpus), ("labels", labels)):
        if recorded.get(name) != digest(root):
            return False, f"the {name} changed since {run_json} was written"
    return True, f"{run_json} records a publishable run over the current corpus and labels"


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(prog="bench.inputs")
    p.add_argument("--complete", required=True, metavar="RUN_JSON",
                   help="exit 0 when this run.json records a publishable run over the current corpus and labels")
    p.add_argument("--version", required=True)
    p.add_argument("--corpus", default="corpus")
    p.add_argument("--labels", default="labels")
    a = p.parse_args(argv)
    ok, why = complete(Path(a.complete), a.version, Path(a.corpus), Path(a.labels))
    print(why)
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
