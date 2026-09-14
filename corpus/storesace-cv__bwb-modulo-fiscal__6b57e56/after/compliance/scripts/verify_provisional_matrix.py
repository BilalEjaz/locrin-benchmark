#!/usr/bin/env python3
"""Fail-closed checks for the RM-REQ-001 provisional AO-* matrix.

Stdlib only. Does not claim requirements are confirmed.
"""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

MATRIX_REL = Path("compliance/derived/requirements/PROVISIONAL-MATRIX-RM-REQ-001.md")

REQUIRED_IDS = [
    "ASM-REG-001",
    "AO-ID-001",
    "AO-DOC-001",
    "AO-DOC-002",
    "AO-SEQ-001",
    "AO-SEQ-002",
    "AO-IDEM-001",
    "AO-TAX-001",
    "AO-CRYPTO-001",
    "AO-KEY-001",
    "AO-AGT-001",
    "AO-AGT-002",
    "AO-OFF-001",
    "AO-OFF-002",
    "AO-AUD-001",
    "AO-SAF-001",
    "AO-SAF-002",
    "AO-OPS-001",
    "AO-UPD-001",
]

# Citation page-by-page still pending — must not jump to partial/confirmed.
CITATION_PENDING_SCAFFOLD = [
    "AO-DOC-001",
    "AO-DOC-002",
    "AO-SEQ-001",
    "AO-TAX-001",
]

ALLOWED_STATUSES = {"scaffold", "partial", "blocked", "pending_validation"}
FORBIDDEN_STATUS_WORDS = re.compile(
    r"(?i)\b(confirmed|confirmado|validated_agt|aprovado_agt)\b"
)
ROW_RE = re.compile(
    r"^\|\s*(ASM-REG-001|AO-[A-Z]+-\d+)\s*\|\s*`([^`]+)`\s*\|",
    re.M,
)


def fail(msg: str, errors: list[str]) -> None:
    errors.append(msg)


def verify(root: Path) -> list[str]:
    errors: list[str] = []
    path = root / MATRIX_REL
    if not path.is_file():
        return [f"ausente: {MATRIX_REL.as_posix()}"]
    text = path.read_text(encoding="utf-8")

    if "não** é matriz AO-* confirmada" not in text and "não é matriz AO-* confirmada" not in text:
        fail("matriz deve declarar explicitamente que não é confirmada", errors)
    if "AO-LEG-RECT-10-19-2019" not in text or "b3db14e2" not in text:
        fail("matriz deve admitir AO-LEG-RECT-10-19-2019 reviewed v2 (b3db14e2…)", errors)
    if "AO-LEG-DP-71-25-2025" not in text or "4931fd3c" not in text:
        fail("matriz deve admitir AO-LEG-DP-71-25-2025 reviewed (4931fd3c…)", errors)
    if "11902" not in text or "11920" not in text:
        fail("matriz deve limitar DP 71/25 a 11902–11920", errors)
    if "11921" not in text and "372/25" not in text:
        fail("matriz deve alertar p.21 / DE 372/25 fora do intervalo DP 71/25", errors)
    if "GAP-002" not in text:
        fail("matriz deve referir GAP-002", errors)
    if "RM-SRC-004" not in text:
        fail("matriz deve referir RM-SRC-004", errors)
    if "DOCUMENT-TYPES-MATRIX-RM-REQ-001" not in text:
        fail("matriz deve referir DOCUMENT-TYPES-MATRIX-RM-REQ-001 (inventário tipos)", errors)
    if "19164" not in text or "19227" not in text:
        fail("matriz deve limitar DE 683/25 a 19164–19227", errors)
    if "19228" not in text and "Aviso" not in text:
        fail("matriz deve alertar p.66 / Aviso 4/25", errors)

    rows = {m.group(1): m.group(2).strip() for m in ROW_RE.finditer(text)}
    missing = [i for i in REQUIRED_IDS if i not in rows]
    if missing:
        fail(f"IDs em falta na tabela: {', '.join(missing)}", errors)

    for rid, status in rows.items():
        if status not in ALLOWED_STATUSES:
            fail(f"{rid}: estado inválido `{status}`", errors)
        if FORBIDDEN_STATUS_WORDS.search(status):
            fail(f"{rid}: estado proibido `{status}`", errors)

    # Body must not claim confirmed requirements (scan every line; banner negation
    # must not disable detection of later affirmative claims).
    for line in text.splitlines():
        if not re.search(r"(?i)AO-\*.*confirmad|requisitos?\s+AO-\*\s+confirmad", line):
            continue
        lowered = line.lower()
        if "não" in lowered or "nao" in lowered or "nenhum" in lowered:
            continue
        fail(f"afirmação indevida de confirmação: {line.strip()[:120]}", errors)
        break

    for rid in CITATION_PENDING_SCAFFOLD:
        st = rows.get(rid)
        if st != "scaffold":
            fail(
                f"{rid}: deve estar `scaffold` até citação página a página "
                "(fontes OCR reviewed ≠ AO-* confirmados)",
                errors,
            )

    if rows.get("AO-SAF-001") != "pending_validation":
        fail("AO-SAF-001: deve estar `pending_validation`", errors)
    for token in (
        "AO-SAFT-XSD-1.01_01",
        "e9a938e1",
        "AuditFile",
        "urn:OECD:StandardAuditFile-Tax:AO_1.01_01",
        "SAFTAO1.01_01.xsd",
    ):
        if token not in text:
            fail(f"citação AO-SAF-001 deve incluir `{token}`", errors)
    saf_rows = [ln for ln in text.splitlines() if re.match(r"^\|\s*AO-SAF-001\s*\|", ln)]
    if saf_rows:
        sl = saf_rows[0].lower()
        if "`pending_validation`" not in saf_rows[0]:
            fail("AO-SAF-001: célula de estado deve ser `pending_validation`", errors)
        if re.search(r"(?i)\b(confirmed|confirmado|validated_agt)\b", sl) and "não" not in sl and "nao" not in sl:
            fail("AO-SAF-001: afirmação de confirmação sem negação na linha", errors)
        if "não" not in sl or "satisfeito" not in sl:
            fail("AO-SAF-001: a linha deve declarar que o critério não fica satisfeito", errors)

    # AO-SEQ-002: partial citation to DE 683 ART.4 / gazeta 19164 — never confirmed.
    if rows.get("AO-SEQ-002") != "partial":
        fail("AO-SEQ-002: deve estar `partial` (citação preliminar DE 683/25 ART.4)", errors)
    if "AO-LEG-DE-683-25-2025" not in text:
        fail("citação AO-SEQ-002 deve referir source_id AO-LEG-DE-683-25-2025", errors)
    if "b01e4581" not in text:
        fail("citação AO-SEQ-002 deve referir sha256 do original DE 683/25 (b01e4581…)", errors)
    if "ARTIGO 4" not in text and "ART. 4" not in text:
        fail("matriz deve citar ARTIGO 4.º / ART. 4 para AO-SEQ-002", errors)
    if "19164" not in text:
        fail("citação AO-SEQ-002 deve incluir gazeta 19164", errors)
    if "não** fica satisfeito" not in text and "não fica satisfeito" not in text:
        fail("matriz deve declarar que critérios de catálogo não ficam satisfeitos só com as citações parciais", errors)

    def check_partial_row(rid: str) -> None:
        rows_ln = [ln for ln in text.splitlines() if re.match(rf"^\|\s*{re.escape(rid)}\s*\|", ln)]
        if not rows_ln:
            fail(f"linha de tabela {rid} ausente", errors)
            return
        line = rows_ln[0]
        if "`partial`" not in line:
            fail(f"{rid}: célula de estado deve ser `partial`", errors)
        if re.search(r"(?i)\b(confirmed|confirmado|validated_agt)\b", line) and not re.search(
            r"(?i)não|nao", line
        ):
            fail(f"{rid}: afirmação de confirmação sem negação na linha", errors)
        if not re.search(r"(?i)não\*\*\s*confirmado|não\s+confirmado|\*\*não\*\*\s+confirmado", line):
            fail(f"{rid}: linha deve declarar explicitamente que não está confirmado", errors)

    check_partial_row("AO-SEQ-002")

    # AO-ID-001: partial citation — contribuinte/software fields; never full catalog criterion.
    if rows.get("AO-ID-001") != "partial":
        fail("AO-ID-001: deve estar `partial` (citação preliminar DE 683/25 campos FE)", errors)
    for token in ("taxRegistrationNumber", "softwareValidationNumber", "productVersion", "19166", "19167"):
        if token not in text:
            fail(f"citação AO-ID-001 deve incluir `{token}`", errors)
    check_partial_row("AO-ID-001")
    id_rows = [ln for ln in text.splitlines() if re.match(r"^\|\s*AO-ID-001\s*\|", ln)]
    if id_rows:
        id_line = id_rows[0].lower()
        if "estabelecimento" not in id_line or "terminal" not in id_line:
            fail("AO-ID-001: a linha da tabela deve declarar lacuna estabelecimento/terminal", errors)
        if "não" not in id_line or "satisfeito" not in id_line:
            fail("AO-ID-001: a linha da tabela deve declarar que o critério não fica satisfeito", errors)

    # AO-CRYPTO-001: partial — JWS document signature + RS256 FE; never confirmed; ≠ SAF-T.
    if rows.get("AO-CRYPTO-001") != "partial":
        fail("AO-CRYPTO-001: deve estar `partial` (jwsDocumentSignature + RS256 FE)", errors)
    for token in (
        "jwsDocumentSignature",
        "19168",
        "RS256",
        "AO-FE-SNAP-HML-2026-07-25-ESTRUTURA",
        "pending_validation",
    ):
        if token not in text:
            fail(f"citação AO-CRYPTO-001 deve incluir `{token}`", errors)
    if "SAF-T" not in text and "SAFT" not in text:
        fail("AO-CRYPTO-001 deve distinguir JWS FE de mecanismos SAF-T", errors)
    check_partial_row("AO-CRYPTO-001")
    crypto_rows = [ln for ln in text.splitlines() if re.match(r"^\|\s*AO-CRYPTO-001\s*\|", ln)]
    if crypto_rows:
        cl = crypto_rows[0].lower()
        if "encadeamento" not in cl and "encadear" not in cl:
            fail("AO-CRYPTO-001: a linha deve mencionar encadeamento (lacuna/não citado)", errors)
        if "não" not in cl or "satisfeito" not in cl:
            fail("AO-CRYPTO-001: a linha deve declarar que o critério não fica satisfeito", errors)

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
    print(f"OK: provisional matrix ({MATRIX_REL.as_posix()})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
