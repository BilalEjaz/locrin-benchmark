"""Replace the results table between the README markers."""
from __future__ import annotations

START = "<!-- results:start -->"
END = "<!-- results:end -->"


def replace_table(readme: str, table: str) -> str:
    if START not in readme:
        raise ValueError(f"README has no {START} marker")
    head, rest = readme.split(START, 1)
    if END not in rest:
        raise ValueError(f"README has no {END} marker after {START}")
    _, tail = rest.split(END, 1)
    body = table if table.endswith("\n") else table + "\n"
    return f"{head}{START}\n{body}{END}{tail}"
