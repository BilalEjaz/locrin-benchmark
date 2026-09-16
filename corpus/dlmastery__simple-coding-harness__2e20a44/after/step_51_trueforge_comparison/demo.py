"""Step 51 - print one capability's comparison table from the README.

The README is the deliverable of this step. This script reads it, finds the
section named on the command line and prints that section's table with one
block per row: the aspect, then the three harness cells, then the sources.
With no argument it lists the capability names.

    python demo.py                # list the capabilities
    python demo.py permissions    # print one table
"""

import re
import sys
from pathlib import Path

README = Path(__file__).with_name("README.md")
CAPABILITIES = ("Loop", "Tools", "Permissions", "Sandbox", "Skills", "Context",
                "Sessions", "Subagents", "Hooks", "Memory", "Evals", "Streaming", "UI")
LINK = re.compile(r"\[([^\]]+)\]\((https?://[^)\s]+)\)")


def section(name, text=None):
    """The lines between `## name` and the next `## ` heading."""
    lines = (text or README.read_text(encoding="utf-8")).splitlines()
    start = lines.index(f"## {name}") + 1
    body = []
    for line in lines[start:]:
        if line.startswith("## "):
            break
        body.append(line)
    return body


def cells(row):
    """The stripped cells of one markdown table row."""
    return [c.strip() for c in row.strip().strip("|").split("|")]


def table(name, text=None, index=0):
    """(header, rows) of one table in a section, each as a list of cells."""
    runs, run = [], []
    for line in section(name, text) + [""]:
        if line.startswith("|"):
            run.append(line)
        elif run:
            runs.append(run)
            run = []
    if len(runs) <= index or len(runs[index]) < 3:
        raise ValueError(f"no table {index} under {name}")
    header, _separator, *rows = runs[index]
    return cells(header), [cells(r) for r in rows]


def plain(cell):
    """A cell with its markdown links reduced to their labels."""
    return LINK.sub(r"\1", cell)


def render(name, text=None):
    """The table of one capability as text, one block per row."""
    header, rows = table(name, text)
    out = [f"== {name} ==", ""]
    for row in rows:
        out.append(f"* {row[0]}")
        for label, cell in zip(header[1:-1], row[1:-1]):
            out.append(f"    {label}: {plain(cell)}")
        out.append(f"    sources: {', '.join(url for _, url in LINK.findall(row[-1]))}")
        out.append("")
    return "\n".join(out)


def main(argv=None):
    argv = sys.argv[1:] if argv is None else argv
    if not argv:
        print("capabilities: " + ", ".join(c.lower() for c in CAPABILITIES))
        return 0
    wanted = argv[0].lower()
    names = {c.lower(): c for c in CAPABILITIES}
    if wanted not in names:
        print(f"unknown capability {wanted!r}; pick one of: " + ", ".join(names))
        return 1
    print(render(names[wanted]))
    return 0


if __name__ == "__main__":
    sys.exit(main())
