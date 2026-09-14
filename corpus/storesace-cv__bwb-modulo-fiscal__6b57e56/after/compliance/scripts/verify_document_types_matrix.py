#!/usr/bin/env python3
"""Fail-closed checks for the provisional document-types matrix.

Does not claim AO-DOC-* confirmed. Stdlib only.
"""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

MATRIX_REL = Path("compliance/derived/requirements/DOCUMENT-TYPES-MATRIX-RM-REQ-001.md")

REQUIRED_CODES = [
    "FA",
    "FT",
    "FR",
    "FG",
    "GF",
    "AC",
    "AR",
    "TV",
    "RC",
    "RG",
    "RE",
    "ND",
    "NC",
    "AF",
    "RP",
    "RA",
    "CS",
    "LD",
]

REQUIRED_TOKENS = [
    "não** confirma",
    "AO-LEG-DP-71-25-2025",
    "AO-LEG-DE-683-25-2025",
    "11903",
    "11904",
    "11905",
    "19169",
    "documentType",
    "InvoiceType",
    "C-DOC-001",
    "C-DOC-003",
    "pending_validation",
    "DEC-REG-003",
    "4931fd3c",
    "b01e4581",
]


def verify(root: Path) -> list[str]:
    errors: list[str] = []
    path = root / MATRIX_REL
    if not path.is_file():
        return [f"ausente: {MATRIX_REL.as_posix()}"]
    text = path.read_text(encoding="utf-8")

    if "não** confirma" not in text and "não confirma" not in text:
        errors.append("matriz deve declarar que não confirma AO-DOC-*")

    for token in REQUIRED_TOKENS:
        if token not in text:
            errors.append(f"token obrigatório ausente: {token}")

    for code in REQUIRED_CODES:
        if not re.search(rf"\b{code}\b", text):
            errors.append(f"código FE/SAF-T ausente: {code}")

    for bad in ("AO-DOC-001 confirmado", "tipos confirmados", "validated_agt"):
        if bad.lower() in text.lower() and "não" not in text.lower():
            errors.append(f"afirmação indevida: {bad}")

    # Affirmative confirmation scan
    for line in text.splitlines():
        if not re.search(r"(?i)AO-DOC-\d+.*confirmad|tipos?\s+documentais?\s+confirmad", line):
            continue
        lowered = line.lower()
        if "não" in lowered or "nao" in lowered or "nenhum" in lowered:
            continue
        errors.append(f"afirmação indevida de confirmação: {line.strip()[:120]}")
        break

    return errors


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo-root", type=Path, default=None)
    args = parser.parse_args(argv)
    root = (args.repo_root or Path(__file__).resolve().parents[2]).resolve()
    errors = verify(root)
    if errors:
        for e in errors:
            print(f"FAIL: {e}", file=sys.stderr)
        return 1
    print(f"OK: document-types matrix ({MATRIX_REL.as_posix()})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
